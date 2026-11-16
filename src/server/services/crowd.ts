import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { crowdLevel, minutesAgo } from "@/shared/time";

/**
 * Crowd numbers for each ghat, where they come from, and what happens next.
 *
 * Sources, always shown to staff:
 * - "sensor"    — a real device (gate counter, zone counter) posted it through /api/sensors/ingest
 * - "manual"    — a staff member typed it in
 * - "simulated" — the built-in simulator (for training and demos). Never mixed up with real data:
 *                 a ghat with a fresh real reading ignores the simulator.
 */
export type Source = "manual" | "sensor" | "simulated";
const FRESH_MINUTES = 5;

type Exec = Pick<Awaited<ReturnType<typeof getDb>>, "select" | "insert" | "update">;

export async function recordOccupancy(
  ghatId: string,
  occupancy: number,
  source: Source,
  opts: { by?: string | null; inflow?: number | null; outflow?: number | null; at?: Date; tx?: Exec } = {},
) {
  const db = opts.tx ?? (await getDb());
  const at = opts.at ?? new Date();
  const occ = Math.max(0, Math.round(occupancy));
  await db
    .update(schema.ghats)
    .set({ occupancy: occ, occupancySource: source, occupancyUpdatedAt: at, occupancyUpdatedBy: opts.by ?? null })
    .where(eq(schema.ghats.id, ghatId));
  await db.insert(schema.crowdHistory).values({ ghatId, occupancy: occ, source, at, inflowPerMin: opts.inflow ?? null, outflowPerMin: opts.outflow ?? null });
}

/** People per minute coming in and going out of a ghat over the last `minutes`, from gate counters. */
export async function ghatFlows(ghatId: string, minutes = 10) {
  const db = await getDb();
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await db
    .select({
      sensorId: schema.sensorReadings.sensorId,
      gateId: schema.sensors.gateId,
      source: schema.sensorReadings.source,
      pin: sql<number>`coalesce(sum(${schema.sensorReadings.peopleIn}),0)::int`,
      pout: sql<number>`coalesce(sum(${schema.sensorReadings.peopleOut}),0)::int`,
      n: sql<number>`count(*)::int`,
      first: sql<Date>`min(${schema.sensorReadings.at})`,
      last: sql<Date>`max(${schema.sensorReadings.at})`,
    })
    .from(schema.sensorReadings)
    .innerJoin(schema.sensors, eq(schema.sensorReadings.sensorId, schema.sensors.id))
    .where(and(eq(schema.sensors.ghatId, ghatId), eq(schema.sensors.kind, "gate_counter"), gte(schema.sensorReadings.at, since)))
    .groupBy(schema.sensorReadings.sensorId, schema.sensors.gateId, schema.sensorReadings.source);
  if (!rows.length) return null;
  const span = Math.max(1, minutes);
  const gates = new Map<string, { in: number; out: number; source: string }>();
  for (const r of rows) {
    const k = r.gateId ?? r.sensorId;
    const g = gates.get(k) ?? { in: 0, out: 0, source: r.source };
    g.in += r.pin / span;
    g.out += r.pout / span;
    gates.set(k, g);
  }
  const all = [...gates.values()];
  return {
    inPerMin: Math.round(all.reduce((a, g) => a + g.in, 0)),
    outPerMin: Math.round(all.reduce((a, g) => a + g.out, 0)),
    source: (rows.some((r) => r.source === "sensor") ? "sensor" : "simulated") as Source,
    gates: [...gates.entries()].map(([gateId, g]) => ({ gateId, inPerMin: Math.round(g.in), outPerMin: Math.round(g.out) })),
  };
}

/**
 * When will this ghat reach its safe limit and its capacity, if nothing changes?
 * A straight-line projection of the net flow over the last 10 minutes — simple and explainable.
 */
export function projectFill(occupancy: number, capacity: number, safeLimitPct: number, netPerMin: number | null) {
  if (netPerMin === null) return { minutesToSafeLimit: null, minutesToFull: null, trend: "unknown" as const };
  const safe = (capacity * safeLimitPct) / 100;
  const trend = netPerMin > 5 ? ("rising" as const) : netPerMin < -5 ? ("falling" as const) : ("steady" as const);
  const until = (target: number) => (occupancy >= target ? 0 : netPerMin > 0 ? Math.round((target - occupancy) / netPerMin) : null);
  return { minutesToSafeLimit: until(safe), minutesToFull: until(capacity), trend };
}

export async function crowdSeries(ghatIds: string[], since: Date, bucketMinutes = 5) {
  if (!ghatIds.length) return [];
  const db = await getDb();
  const rows = await db
    .select({ ghatId: schema.crowdHistory.ghatId, at: schema.crowdHistory.at, occupancy: schema.crowdHistory.occupancy, source: schema.crowdHistory.source })
    .from(schema.crowdHistory)
    .where(and(inArray(schema.crowdHistory.ghatId, ghatIds), gte(schema.crowdHistory.at, since)))
    .orderBy(asc(schema.crowdHistory.at));
  // Last value in each bucket.
  const out = new Map<string, { at: string; occupancy: number; source: string }>();
  for (const r of rows) {
    const b = Math.floor(r.at.getTime() / (bucketMinutes * 60_000)) * bucketMinutes * 60_000;
    out.set(`${r.ghatId}|${b}`, { at: new Date(b).toISOString(), occupancy: r.occupancy, source: r.source });
  }
  return [...out.entries()].map(([k, v]) => ({ ghatId: k.split("|")[0], ...v }));
}

/** Everything the map, overview and wall view need about each ghat. */
export async function ghatsLive() {
  const db = await getDb();
  await simulateTick();
  const ghats = await db.select().from(schema.ghats).orderBy(asc(schema.ghats.sortOrder));
  const gates = await db.select().from(schema.gates);
  const flows = await Promise.all(ghats.map((g) => ghatFlows(g.id)));
  return ghats.map((g, i) => {
    const f = flows[i];
    const percent = g.capacity > 0 ? Math.round((g.occupancy / g.capacity) * 100) : 0;
    const net = f ? f.inPerMin - f.outPerMin : null;
    return {
      id: g.id,
      name: g.name,
      nameHi: g.nameHi,
      gate: g.gate,
      capacity: g.capacity,
      occupancy: g.occupancy,
      percent,
      safeLimitPct: g.safeLimitPct,
      level: crowdLevel(g.occupancy, g.capacity),
      source: g.occupancySource as Source,
      updatedAt: g.occupancyUpdatedAt?.toISOString() ?? null,
      updatedMinutesAgo: minutesAgo(g.occupancyUpdatedAt),
      meetingPoint: g.meetingPoint,
      walkNote: g.walkNote,
      mapX: g.mapX,
      mapY: g.mapY,
      flow: f ? { inPerMin: f.inPerMin, outPerMin: f.outPerMin, source: f.source } : null,
      projection: projectFill(g.occupancy, g.capacity, g.safeLimitPct, net),
      gates: gates
        .filter((x) => x.ghatId === g.id)
        .map((x) => ({ id: x.id, name: x.name, kind: x.kind, status: x.status, mapX: x.mapX, mapY: x.mapY, ...(f?.gates.find((fg) => fg.gateId === x.id) ?? { inPerMin: null, outPerMin: null }) })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Simulator — for training, demos and load tests only. Every reading it writes is marked "simulated".
// ---------------------------------------------------------------------------------------------

/** Deterministic pseudo-random number in [0,1) from a string — the same minute always gives the same value. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Typical bathing-day shape: busiest 05:00–09:00 IST, a smaller bump in the afternoon. 0..1. */
export function demandCurve(istMinutes: number) {
  const h = istMinutes / 60;
  const morning = Math.exp(-((h - 6.5) ** 2) / 3.2);
  const afternoon = 0.45 * Math.exp(-((h - 15) ** 2) / 4);
  return Math.min(1, 0.12 + 0.88 * Math.max(morning, afternoon));
}

let lastTick = 0;

/** Bring simulated sensors up to date (one reading per minute). Cheap to call on every request. */
export async function simulateTick(now = new Date(), maxMinutes = 180) {
  if (now.getTime() - lastTick < 20_000) return 0;
  lastTick = now.getTime();
  const db = await getDb();
  const sims = await db.select().from(schema.sensors).where(and(eq(schema.sensors.isSimulated, true), eq(schema.sensors.active, true)));
  if (!sims.length) return 0;
  const ghats = await db.select().from(schema.ghats);
  const nowMin = Math.floor(now.getTime() / 60_000);
  let written = 0;
  const byGhat = new Map<string, typeof sims>();
  for (const s of sims) byGhat.set(s.ghatId, [...(byGhat.get(s.ghatId) ?? []), s]);

  for (const [ghatId, list] of byGhat) {
    const g = ghats.find((x) => x.id === ghatId);
    if (!g) continue;
    // A fresh REAL reading always wins over the simulator.
    if (g.occupancySource === "sensor" && (minutesAgo(g.occupancyUpdatedAt) ?? 99) < FRESH_MINUTES) continue;
    if (g.occupancySource === "manual" && (minutesAgo(g.occupancyUpdatedAt) ?? 99) < 15) continue;
    const startMin = Math.max(
      nowMin - maxMinutes,
      ...list.map((s) => (s.lastSeenAt ? Math.floor(s.lastSeenAt.getTime() / 60_000) + 1 : nowMin - maxMinutes)),
    );
    if (startMin > nowMin) continue;
    let occ = g.occupancy;
    const readings: (typeof schema.sensorReadings.$inferInsert)[] = [];
    const hist: (typeof schema.crowdHistory.$inferInsert)[] = [];
    let lastIn = 0;
    let lastOut = 0;
    for (let m = startMin; m <= nowMin; m++) {
      const at = new Date(m * 60_000);
      const istMin = ((m + 330) % 1440 + 1440) % 1440;
      const target = g.capacity * (g.id === "sangam" ? 0.98 : 0.85) * demandCurve(istMin) * (0.75 + 0.5 * rand(`${g.id}:day`));
      let tin = 0;
      let tout = 0;
      for (const s of list) {
        if (s.kind === "gate_counter") {
          const base = Math.max(20, g.capacity / 90);
          const pull = (target - occ) / Math.max(1, list.filter((x) => x.kind === "gate_counter").length * 8);
          const pin = Math.max(0, Math.round(base * (0.8 + 0.4 * rand(`${s.id}:${m}:i`)) + Math.max(0, pull)));
          const pout = Math.max(0, Math.round(base * (0.8 + 0.4 * rand(`${s.id}:${m}:o`)) + Math.max(0, -pull)));
          tin += pin;
          tout += pout;
          readings.push({ sensorId: s.id, at, peopleIn: pin, peopleOut: pout, source: "simulated" });
        }
      }
      occ = Math.max(0, Math.min(g.capacity * 1.08, occ + tin - tout));
      for (const s of list.filter((x) => x.kind !== "gate_counter")) {
        const noisy = Math.round(occ * (0.97 + 0.06 * rand(`${s.id}:${m}`)));
        readings.push({ sensorId: s.id, at, occupancy: s.kind === "camera_counter" ? Math.round(noisy / 400) : noisy, source: "simulated" });
      }
      lastIn = tin;
      lastOut = tout;
      if (m % 2 === 0 || m === nowMin) hist.push({ ghatId, at, occupancy: Math.round(occ), source: "simulated", inflowPerMin: tin, outflowPerMin: tout });
    }
    for (let i = 0; i < readings.length; i += 500) await db.insert(schema.sensorReadings).values(readings.slice(i, i + 500));
    for (let i = 0; i < hist.length; i += 500) await db.insert(schema.crowdHistory).values(hist.slice(i, i + 500));
    const at = new Date(nowMin * 60_000);
    await db
      .update(schema.ghats)
      .set({ occupancy: Math.round(occ), occupancySource: "simulated", occupancyUpdatedAt: at, occupancyUpdatedBy: null })
      .where(eq(schema.ghats.id, ghatId));
    for (const s of list) {
      await db
        .update(schema.sensors)
        .set({ lastSeenAt: at, lastReading: s.kind === "gate_counter" ? { peopleIn: lastIn, peopleOut: lastOut } : { occupancy: Math.round(occ) } })
        .where(eq(schema.sensors.id, s.id));
    }
    written += readings.length;
  }
  return written;
}

export function resetSimulatorClockForTests() {
  lastTick = 0;
}

/** Recent readings for one sensor (for the sensor detail sparkline). */
export async function sensorHistory(sensorId: string, minutes = 60) {
  const db = await getDb();
  return db
    .select({ at: schema.sensorReadings.at, peopleIn: schema.sensorReadings.peopleIn, peopleOut: schema.sensorReadings.peopleOut, occupancy: schema.sensorReadings.occupancy, source: schema.sensorReadings.source })
    .from(schema.sensorReadings)
    .where(and(eq(schema.sensorReadings.sensorId, sensorId), gte(schema.sensorReadings.at, new Date(Date.now() - minutes * 60_000))))
    .orderBy(desc(schema.sensorReadings.at))
    .limit(240);
}
