import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { badRequest, conflict, notFound } from "../http";
import { audit } from "../audit";

/** Control-room shifts: start, the live shift report, and handover to the next person. */
export async function currentShift(userId: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.shifts).where(and(eq(schema.shifts.userId, userId), isNull(schema.shifts.endedAt))).orderBy(desc(schema.shifts.startedAt)).limit(1);
  return s ?? null;
}

export async function startShift(userId: string, controlRoom: string) {
  const existing = await currentShift(userId);
  if (existing) return existing;
  const db = await getDb();
  const [s] = await db.insert(schema.shifts).values({ userId, controlRoom }).returning();
  // Handover notes left for this person by the previous shift.
  await audit({ actorType: "admin", actorId: userId, action: "shift.start", entityType: "shift", entityId: s.id });
  return s;
}

export async function handoverForMe(userId: string) {
  const db = await getDb();
  const [s] = await db
    .select({ s: schema.shifts, fromName: schema.adminUsers.name })
    .from(schema.shifts)
    .innerJoin(schema.adminUsers, eq(schema.shifts.userId, schema.adminUsers.id))
    .where(eq(schema.shifts.handoverTo, userId))
    .orderBy(desc(schema.shifts.endedAt))
    .limit(1);
  if (!s) return null;
  return { from: s.fromName, endedAt: s.s.endedAt?.toISOString() ?? null, notes: s.s.handoverNotes, summary: s.s.summary };
}

export async function shiftReport(shiftId: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
  if (!s) throw notFound();
  const from = s.startedAt;
  const to = s.endedAt ?? new Date();
  const inWindow = <T extends { getSQL: () => unknown }>(col: T) => and(gte(col as never, from), lte(col as never, to));

  const [help] = await db
    .select({ total: sql<number>`count(*)::int`, closed: sql<number>`count(*) filter (where ${schema.helpRequests.status} in ('resolved','cancelled'))::int`, medical: sql<number>`count(*) filter (where ${schema.helpRequests.type} = 'medical')::int` })
    .from(schema.helpRequests)
    .where(inWindow(schema.helpRequests.createdAt));
  const [lost] = await db
    .select({ total: sql<number>`count(*)::int`, reunited: sql<number>`count(*) filter (where ${schema.lostCases.status} in ('reunited','closed'))::int` })
    .from(schema.lostCases)
    .where(inWindow(schema.lostCases.createdAt));
  const [div] = await db
    .select({ n: sql<number>`count(*)::int`, families: sql<number>`coalesce(sum(${schema.diversions.familiesCount}),0)::int` })
    .from(schema.diversions)
    .where(and(inWindow(schema.diversions.createdAt), inArray(schema.diversions.status, ["sent", "undone"])));
  const [al] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.alerts).where(inWindow(schema.alerts.createdAt));
  const [reg] = await db
    .select({ families: sql<number>`count(distinct ${schema.families.id})::int`, people: sql<number>`count(${schema.members.id})::int` })
    .from(schema.families)
    .leftJoin(schema.members, eq(schema.members.familyId, schema.families.id))
    .where(inWindow(schema.families.createdAt));

  // Crowd through the shift: total people across all ghats, every 15 minutes (last value per ghat per bucket).
  const hist = await db
    .select({ ghatId: schema.crowdHistory.ghatId, at: schema.crowdHistory.at, occupancy: schema.crowdHistory.occupancy })
    .from(schema.crowdHistory)
    .where(inWindow(schema.crowdHistory.at))
    .orderBy(asc(schema.crowdHistory.at));
  const bucketMs = 15 * 60_000;
  const buckets = new Map<number, Map<string, number>>();
  for (const h of hist) {
    const b = Math.floor(h.at.getTime() / bucketMs) * bucketMs;
    if (!buckets.has(b)) buckets.set(b, new Map());
    buckets.get(b)!.set(h.ghatId, h.occupancy);
  }
  const series: { at: string; total: number }[] = [];
  let carry = new Map<string, number>();
  for (const [b, m] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
    carry = new Map([...carry, ...m]);
    series.push({ at: new Date(b).toISOString(), total: [...carry.values()].reduce((a, v) => a + v, 0) });
  }
  const peak = series.reduce((a, x) => (x.total > a.total ? x : a), { at: from.toISOString(), total: 0 });
  const events = await db
    .select({ at: schema.diversionEvents.at, message: schema.diversionEvents.message })
    .from(schema.diversionEvents)
    .where(and(inWindow(schema.diversionEvents.at), eq(schema.diversionEvents.kind, "sent")))
    .orderBy(asc(schema.diversionEvents.at));
  const [user] = await db.select({ name: schema.adminUsers.name }).from(schema.adminUsers).where(eq(schema.adminUsers.id, s.userId));
  const openHelp = await db
    .select({ id: schema.helpRequests.id, code: schema.helpRequests.code, type: schema.helpRequests.type, location: schema.helpRequests.location, status: schema.helpRequests.status })
    .from(schema.helpRequests)
    .where(inArray(schema.helpRequests.status, ["open", "assigned", "in_progress"]))
    .limit(10);
  const openLost = await db
    .select({ id: schema.lostCases.id, code: schema.lostCases.code, personName: schema.lostCases.personName, age: schema.lostCases.age, status: schema.lostCases.status, createdAt: schema.lostCases.createdAt })
    .from(schema.lostCases)
    .where(inArray(schema.lostCases.status, ["open", "searching", "found"]))
    .limit(10);
  return {
    id: s.id,
    user: user?.name ?? "Staff",
    controlRoom: s.controlRoom,
    startedAt: from.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    help,
    lost,
    diversions: div,
    alerts: al.n,
    registrations: reg,
    series,
    peak,
    markers: events.map((e) => ({ at: e.at.toISOString(), label: e.message })),
    stillOpen: { help: openHelp, lost: openLost.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })) },
    handoverTo: s.handoverTo,
    handoverNotes: s.handoverNotes,
  };
}

export async function endShift(shiftId: string, userId: string, handoverTo: string | null, notes: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, shiftId));
  if (!s || s.userId !== userId) throw notFound();
  if (s.endedAt) throw conflict("This shift has already ended.");
  if (handoverTo === userId) throw badRequest("Hand over to someone else.");
  if (handoverTo) {
    const [u] = await db.select({ id: schema.adminUsers.id, active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, handoverTo));
    if (!u?.active) throw badRequest("That person can't take the handover.");
  }
  const report = await shiftReport(shiftId);
  const summary = { help: report.help, lost: report.lost, diversions: report.diversions, alerts: report.alerts, peak: report.peak };
  await db.update(schema.shifts).set({ endedAt: new Date(), handoverTo, handoverNotes: notes, summary }).where(eq(schema.shifts.id, shiftId));
  await audit({ actorType: "admin", actorId: userId, action: "shift.end", entityType: "shift", entityId: shiftId, details: { handover: Boolean(handoverTo) } });
  return shiftReport(shiftId);
}

export async function recentShifts(limit = 20) {
  const db = await getDb();
  const rows = await db
    .select({ s: schema.shifts, name: schema.adminUsers.name })
    .from(schema.shifts)
    .innerJoin(schema.adminUsers, eq(schema.shifts.userId, schema.adminUsers.id))
    .where(or(isNull(schema.shifts.endedAt), gte(schema.shifts.startedAt, new Date(Date.now() - 7 * 86400_000))))
    .orderBy(desc(schema.shifts.startedAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.s.id, user: r.name, startedAt: r.s.startedAt.toISOString(), endedAt: r.s.endedAt?.toISOString() ?? null }));
}
