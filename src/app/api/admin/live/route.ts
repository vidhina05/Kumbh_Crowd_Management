import { crowdSeries } from "@/server/services/crowd";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { ghatsLive } from "@/server/services/crowd";
import { getDb, schema } from "@/server/db";
import { istDate, istTime } from "@/shared/time";
import { batchPlan } from "@/server/services/diversions";

/** One call for the map, the command overview and the wall view. */
export const GET = handler(async () => {
  await requireUser("map.view");
  const db = await getDb();
  const ghats = await ghatsLive();
  const today = istDate();
  const [help] = await db
    .select({ open: sql<number>`count(*)::int`, lost: sql<number>`count(*) filter (where ${schema.helpRequests.type} = 'lost_person')::int`, medical: sql<number>`count(*) filter (where ${schema.helpRequests.type} = 'medical')::int`, oldest: sql<Date | null>`min(${schema.helpRequests.createdAt})` })
    .from(schema.helpRequests)
    .where(inArray(schema.helpRequests.status, ["open", "assigned", "in_progress"]));
  const lostOpen = await db
    .select({ code: schema.lostCases.code, personName: schema.lostCases.personName, age: schema.lostCases.age, createdAt: schema.lostCases.createdAt })
    .from(schema.lostCases)
    .where(inArray(schema.lostCases.status, ["open", "searching"]));
  const alerts = await db.select().from(schema.alerts).where(and(eq(schema.alerts.status, "active"), sql`${schema.alerts.startsAt} <= now()`)).orderBy(sql`${schema.alerts.createdAt} desc`).limit(5);
  const plan = await batchPlan(today);
  const [kioskRows] = await db
    .select({ total: sql<number>`count(*)::int`, online: sql<number>`count(*) filter (where ${schema.kiosks.lastSeenAt} > now() - interval '90 seconds')::int` })
    .from(schema.kiosks)
    .where(eq(schema.kiosks.active, true));
  const [sensorRows] = await db
    .select({ total: sql<number>`count(*)::int`, real: sql<number>`count(*) filter (where not ${schema.sensors.isSimulated})::int`, online: sql<number>`count(*) filter (where ${schema.sensors.lastSeenAt} > now() - interval '3 minutes')::int` })
    .from(schema.sensors)
    .where(eq(schema.sensors.active, true));
  const pending = await db
    .select({ id: schema.diversions.id, code: schema.diversions.code })
    .from(schema.diversions)
    .where(and(eq(schema.diversions.status, "awaiting_approval"), eq(schema.diversions.day, today)));
  // Next peak: the upcoming 30-minute window with the most people booked across all ghats.
  const byTime = new Map<string, number>();
  for (const g of plan.ghats) for (const s of g.slots) if (s.phase === "later") byTime.set(s.start, (byTime.get(s.start) ?? 0) + s.booked);
  const nextPeak = [...byTime.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const sources = [...new Set(ghats.filter((g) => g.updatedAt).map((g) => g.source))];

  // Sparklines: real series, oldest first.
  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const hist = await crowdSeries(ghats.map((g) => g.id), hourAgo, 5);
  const buckets = [...new Set(hist.map((h) => h.at))].sort();
  const lastBy = new Map<string, number>();
  const peopleSeries = buckets.map((b) => {
    for (const h of hist) if (h.at === b) lastBy.set(h.ghatId, h.occupancy);
    return [...lastBy.values()].reduce((a, v) => a + v, 0);
  });
  const helpRows = await db.select({ at: schema.helpRequests.createdAt }).from(schema.helpRequests).where(gte(schema.helpRequests.createdAt, hourAgo));
  const helpSeries = Array.from({ length: 6 }, (_, i) => helpRows.filter((r) => { const m = (Date.now() - r.at.getTime()) / 60_000; return m < 60 - i * 10 && m >= 50 - i * 10; }).length);
  const slotTimes = [...new Set(plan.ghats.flatMap((g) => g.slots.map((s) => s.start)))].sort();
  const demandSeries = slotTimes.map((t) => plan.ghats.reduce((a, g) => a + (g.slots.find((s) => s.start === t)?.booked ?? 0), 0));
  const doneSeries = slotTimes.map((t) => plan.ghats.reduce((a, g) => a + g.slots.filter((s) => s.start <= t && s.phase === "done").length, 0));
  const kioskPins = await db.select({ id: schema.kiosks.id, location: schema.kiosks.location, mapX: schema.kiosks.mapX, mapY: schema.kiosks.mapY, lastSeenAt: schema.kiosks.lastSeenAt }).from(schema.kiosks).where(eq(schema.kiosks.active, true));
  const cams = await db.select().from(schema.sensors).where(and(eq(schema.sensors.active, true), eq(schema.sensors.kind, "camera_counter")));
  const allGates = ghats.flatMap((g) => g.gates);
  const onShift = await db.select({ name: schema.adminUsers.name }).from(schema.shifts).innerJoin(schema.adminUsers, eq(schema.shifts.userId, schema.adminUsers.id)).where(isNull(schema.shifts.endedAt));
  return json({
    generatedAt: new Date().toISOString(),
    now: istTime(new Date()),
    today,
    ghats,
    totals: {
      people: ghats.reduce((a, g) => a + g.occupancy, 0),
      sources,
      batchesDone: plan.totals.done,
      batches: plan.totals.batches,
      overfull: plan.totals.overfull,
    },
    help: { open: help.open, lost: help.lost, medical: help.medical, oldestMinutes: help.oldest ? Math.round((Date.now() - new Date(help.oldest).getTime()) / 60000) : null },
    lostOpen: lostOpen.map((l) => ({ code: l.code, personName: l.personName, age: l.age, minutes: Math.round((Date.now() - l.createdAt.getTime()) / 60000) })),
    alerts: alerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, message: a.message, createdAt: a.createdAt.toISOString() })),
    nextPeak: nextPeak ? { time: nextPeak[0], people: nextPeak[1] } : null,
    kiosks: kioskRows,
    sensors: sensorRows,
    fixes: plan.fixes.slice(0, 3),
    pendingDiversions: pending,
    onShift: onShift.map((x) => x.name),
    series: { people: peopleSeries, help: helpSeries, demand: demandSeries, done: doneSeries },
    kioskPins: kioskPins.filter((k) => k.mapX !== null && k.mapY !== null).map((k) => ({ id: k.id, location: k.location, mapX: k.mapX!, mapY: k.mapY!, online: Boolean(k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < 90_000) })),
    cameras: cams.map((c) => {
      const gate = allGates.find((x) => x.id === c.gateId);
      const g = ghats.find((x) => x.id === c.ghatId);
      const r = c.lastReading as { occupancy?: number } | null;
      return { id: c.id, name: c.name, ghatId: c.ghatId, simulated: c.isSimulated, mapX: gate?.mapX ?? (g ? g.mapX + 2.5 : 50), mapY: gate?.mapY ?? (g ? g.mapY + 2.5 : 50), count: r?.occupancy ?? null, online: Boolean(c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < 180_000) };
    }),
  });
});
