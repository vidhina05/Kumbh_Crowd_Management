import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db";
import { randomToken, safeEqual, sha256 } from "../crypto";
import { HttpError, badRequest, notFound, unauthorized } from "../http";
import { audit } from "../audit";
import { rateLimit } from "../ratelimit";
import { recordOccupancy } from "./crowd";

/**
 * Crowd sensors: gate counters (people in/out), zone counters (people in an area) and camera counters
 * (people detected in a camera's view). Each device posts to /api/sensors/ingest with its own key.
 */
export const SENSOR_KINDS = ["gate_counter", "zone_counter", "camera_counter"] as const;

export const ingestInput = z
  .object({
    at: z.string().datetime().optional(),
    peopleIn: z.number().int().min(0).max(100_000).optional(),
    peopleOut: z.number().int().min(0).max(100_000).optional(),
    occupancy: z.number().int().min(0).max(5_000_000).optional(),
  })
  .refine((v) => v.peopleIn !== undefined || v.peopleOut !== undefined || v.occupancy !== undefined, "Send peopleIn/peopleOut or occupancy");

async function nextSensorId() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sensors);
  for (let i = n + 1; i < n + 1000; i++) {
    const id = `S-${String(i).padStart(4, "0")}`;
    const [hit] = await db.select({ id: schema.sensors.id }).from(schema.sensors).where(eq(schema.sensors.id, id));
    if (!hit) return id;
  }
  throw new Error("No free sensor id");
}

export async function createSensor(
  input: { name: string; kind: (typeof SENSOR_KINDS)[number]; ghatId: string; gateId?: string | null; simulated?: boolean },
  by: string | null,
) {
  const db = await getDb();
  const [ghat] = await db.select({ id: schema.ghats.id }).from(schema.ghats).where(eq(schema.ghats.id, input.ghatId));
  if (!ghat) throw badRequest("Unknown ghat.");
  if (input.gateId) {
    const [gate] = await db.select().from(schema.gates).where(eq(schema.gates.id, input.gateId));
    if (!gate || gate.ghatId !== input.ghatId) throw badRequest("That gate is not at this ghat.");
  }
  if (input.kind === "gate_counter" && !input.gateId) throw badRequest("A gate counter needs a gate.");
  const id = await nextSensorId();
  const key = `sk_${randomToken(24)}`;
  await db.insert(schema.sensors).values({
    id,
    name: input.name,
    kind: input.kind,
    ghatId: input.ghatId,
    gateId: input.gateId ?? null,
    keyHash: sha256(key),
    isSimulated: Boolean(input.simulated),
  });
  await audit({ actorType: by ? "admin" : "system", actorId: by, action: "sensor.create", entityType: "sensor", entityId: id, details: { kind: input.kind, simulated: Boolean(input.simulated) } });
  return { id, key };
}

export async function rotateSensorKey(id: string, by: string) {
  const db = await getDb();
  const key = `sk_${randomToken(24)}`;
  const [row] = await db.update(schema.sensors).set({ keyHash: sha256(key) }).where(eq(schema.sensors.id, id)).returning({ id: schema.sensors.id });
  if (!row) throw notFound();
  await audit({ actorType: "admin", actorId: by, action: "sensor.rotate_key", entityType: "sensor", entityId: id });
  return { id, key };
}

export async function setSensorActive(id: string, active: boolean, by: string) {
  const db = await getDb();
  const [row] = await db.update(schema.sensors).set({ active }).where(eq(schema.sensors.id, id)).returning({ id: schema.sensors.id });
  if (!row) throw notFound();
  await audit({ actorType: "admin", actorId: by, action: active ? "sensor.enable" : "sensor.disable", entityType: "sensor", entityId: id });
}

export async function listSensors() {
  const db = await getDb();
  const rows = await db
    .select({ s: schema.sensors, ghatName: schema.ghats.name, gateName: schema.gates.name })
    .from(schema.sensors)
    .innerJoin(schema.ghats, eq(schema.sensors.ghatId, schema.ghats.id))
    .leftJoin(schema.gates, eq(schema.sensors.gateId, schema.gates.id))
    .orderBy(asc(schema.ghats.sortOrder), asc(schema.sensors.id));
  const since = new Date(Date.now() - 60 * 60_000);
  const counts = await db
    .select({ id: schema.sensorReadings.sensorId, n: sql<number>`count(*)::int` })
    .from(schema.sensorReadings)
    .where(gte(schema.sensorReadings.at, since))
    .groupBy(schema.sensorReadings.sensorId);
  return rows.map(({ s, ghatName, gateName }) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    ghatId: s.ghatId,
    ghatName,
    gateId: s.gateId,
    gateName,
    active: s.active,
    simulated: s.isSimulated,
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    lastReading: s.lastReading,
    readingsLastHour: counts.find((c) => c.id === s.id)?.n ?? 0,
    status: !s.active ? "disabled" : !s.lastSeenAt ? "never" : Date.now() - s.lastSeenAt.getTime() < 3 * 60_000 ? "online" : "stale",
  }));
}

/** Device → server. Authenticated with the sensor's own key; a kiosk or staff session can't use this. */
export async function ingest(sensorId: string, key: string, body: z.infer<typeof ingestInput>) {
  if (!/^S-\d{4,6}$/.test(sensorId) || key.length < 10 || key.length > 128) throw unauthorized("Unknown sensor.");
  await rateLimit(`sensor:${sensorId}`, 120, 60_000);
  const db = await getDb();
  const [s] = await db.select().from(schema.sensors).where(eq(schema.sensors.id, sensorId));
  if (!s || !s.active || s.isSimulated || !safeEqual(s.keyHash, sha256(key))) throw unauthorized("Unknown sensor.");
  const at = body.at ? new Date(body.at) : new Date();
  if (Math.abs(at.getTime() - Date.now()) > 10 * 60_000) throw badRequest("Reading time is more than 10 minutes off. Check the device clock.");
  if (s.kind === "gate_counter" && body.peopleIn === undefined && body.peopleOut === undefined) throw badRequest("A gate counter sends peopleIn and/or peopleOut.");
  if (s.kind !== "gate_counter" && body.occupancy === undefined) throw badRequest("This sensor sends occupancy.");

  await db.insert(schema.sensorReadings).values({ sensorId: s.id, at, peopleIn: body.peopleIn ?? null, peopleOut: body.peopleOut ?? null, occupancy: body.occupancy ?? null, source: "sensor" });
  const reading = s.kind === "gate_counter" ? { peopleIn: body.peopleIn ?? 0, peopleOut: body.peopleOut ?? 0 } : { occupancy: body.occupancy };
  await db.update(schema.sensors).set({ lastSeenAt: at, lastReading: reading }).where(eq(schema.sensors.id, s.id));

  // Update the ghat's crowd number. Zone counters measure the whole ghat; gate counters adjust it.
  const [g] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, s.ghatId));
  if (s.kind === "zone_counter") {
    await recordOccupancy(g.id, body.occupancy!, "sensor", { at });
  } else if (s.kind === "gate_counter") {
    const base = g.occupancySource === "simulated" ? 0 : g.occupancy;
    await recordOccupancy(g.id, base + (body.peopleIn ?? 0) - (body.peopleOut ?? 0), "sensor", { at, inflow: body.peopleIn ?? null, outflow: body.peopleOut ?? null });
  }
  // Camera counters report people in view; they are shown per camera and don't overwrite the ghat total.
  return { ok: true, sensorId: s.id, at: at.toISOString() };
}

export async function sensorDetail(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.sensors).where(eq(schema.sensors.id, id));
  if (!s) throw notFound();
  const readings = await db
    .select()
    .from(schema.sensorReadings)
    .where(eq(schema.sensorReadings.sensorId, id))
    .orderBy(desc(schema.sensorReadings.at))
    .limit(60);
  return { id: s.id, name: s.name, kind: s.kind, simulated: s.isSimulated, readings: readings.reverse().map((r) => ({ at: r.at.toISOString(), peopleIn: r.peopleIn, peopleOut: r.peopleOut, occupancy: r.occupancy, source: r.source })) };
}

export function assertSensorHeaders(req: Request) {
  const id = req.headers.get("x-sensor-id") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!id || !key) throw new HttpError(401, "unauthorized", "Send X-Sensor-Id and Authorization: Bearer <key>.");
  return { id, key };
}
