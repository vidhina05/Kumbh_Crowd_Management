import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { notFound } from "../http";
import { crowdLevel, istDate, istInstant, minutesAgo } from "@/shared/time";

const KIOSK_ONLINE_SECONDS = 90;

export async function ghatStatus() {
  const db = await getDb();
  const ghats = await db.select().from(schema.ghats).orderBy(asc(schema.ghats.sortOrder));
  return ghats.map((g) => ({
    id: g.id,
    name: g.name,
    nameHi: g.nameHi,
    gate: g.gate,
    capacity: g.capacity,
    occupancy: g.occupancy,
    percent: Math.round((g.occupancy / g.capacity) * 100),
    level: crowdLevel(g.occupancy, g.capacity),
    source: g.occupancySource,
    updatedMinutesAgo: minutesAgo(g.occupancyUpdatedAt),
    meetingPoint: g.meetingPoint,
  }));
}

export async function overview() {
  const db = await getDb();
  const today = istDate();
  const startOfToday = istInstant(today, "00:00");
  const [[fam], [ppl], helpByType, [lost], alerts, kiosks, ghats, langs, slotsToday] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.families).where(gte(schema.families.createdAt, startOfToday)),
    db
      .select({ n: sql<number>`count(*)::int`, bands: sql<number>`count(${schema.members.bandId})::int` })
      .from(schema.members)
      .innerJoin(schema.families, eq(schema.members.familyId, schema.families.id))
      .where(gte(schema.families.createdAt, startOfToday)),
    db
      .select({ type: schema.helpRequests.type, n: sql<number>`count(*)::int` })
      .from(schema.helpRequests)
      .where(inArray(schema.helpRequests.status, ["open", "assigned", "in_progress"]))
      .groupBy(schema.helpRequests.type),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.lostCases).where(inArray(schema.lostCases.status, ["open", "searching", "found"])),
    db.select().from(schema.alerts).where(eq(schema.alerts.status, "active")).orderBy(desc(schema.alerts.createdAt)).limit(10),
    db.select({ id: schema.kiosks.id, active: schema.kiosks.active, lastSeenAt: schema.kiosks.lastSeenAt }).from(schema.kiosks),
    ghatStatus(),
    db
      .select({ language: schema.families.language, n: sql<number>`count(*)::int` })
      .from(schema.families)
      .where(gte(schema.families.createdAt, startOfToday))
      .groupBy(schema.families.language),
    db
      .select({ capacity: sql<number>`coalesce(sum(${schema.slots.capacity}),0)::int`, booked: sql<number>`coalesce(sum(${schema.slots.booked}),0)::int` })
      .from(schema.slots)
      .where(eq(schema.slots.day, today)),
  ]);
  const activeKiosks = kiosks.filter((k) => k.active);
  const online = activeKiosks.filter((k) => k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < KIOSK_ONLINE_SECONDS * 1000).length;
  return {
    generatedAt: new Date().toISOString(),
    today,
    registrationsToday: fam.n,
    peopleToday: ppl.n,
    bandsToday: ppl.bands,
    slotsToday: slotsToday[0],
    openHelp: Object.fromEntries(helpByType.map((h) => [h.type, h.n])),
    openHelpTotal: helpByType.reduce((a, h) => a + h.n, 0),
    openLost: lost.n,
    alerts,
    kiosks: { online, total: activeKiosks.length },
    ghats,
    languagesToday: langs.sort((a, b) => b.n - a.n),
  };
}

/** Aggregate, PII-free snapshot for Sahayak (the AI assistant). */
export async function assistantSnapshot() {
  const o = await overview();
  return {
    now: o.generatedAt,
    ghats: o.ghats.map((g) => ({ name: g.name, percentFull: g.percent, level: g.level, source: g.source, updatedMinutesAgo: g.updatedMinutesAgo })),
    registrationsToday: o.registrationsToday,
    peopleToday: o.peopleToday,
    slotSeatsToday: o.slotsToday,
    openHelpRequestsByType: o.openHelp,
    openLostPersonCases: o.openLost,
    activeAlerts: o.alerts.map((a) => ({ severity: a.severity, title: a.title, ghat: a.ghatId })),
    kiosks: o.kiosks,
  };
}

export async function searchFamilies(q: string) {
  const db = await getDb();
  const term = q.trim();
  const where = term
    ? or(ilike(schema.families.leaderName, `%${term}%`), ilike(schema.families.passCode, `%${term}%`), eq(schema.families.phoneLast4, term), ilike(schema.families.homeTown, `%${term}%`))
    : undefined;
  const rows = await db
    .select({ f: schema.families, s: schema.slots, g: schema.ghats, n: sql<number>`(select count(*)::int from members m where m.family_id = ${schema.families.id})` })
    .from(schema.families)
    .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
    .innerJoin(schema.ghats, eq(schema.slots.ghatId, schema.ghats.id))
    .where(where)
    .orderBy(desc(schema.families.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.f.id,
    passCode: r.f.passCode,
    leaderName: r.f.leaderName,
    homeTown: r.f.homeTown,
    people: r.n,
    status: r.f.status,
    phoneLast4: r.f.phoneLast4,
    ghat: r.g.name,
    day: r.s.day,
    start: r.s.startTime,
    batchNo: r.s.batchNo,
  }));
}

export async function familyDetail(id: string) {
  const db = await getDb();
  const rows = await db
    .select({ f: schema.families, s: schema.slots, g: schema.ghats, k: schema.kiosks })
    .from(schema.families)
    .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
    .innerJoin(schema.ghats, eq(schema.slots.ghatId, schema.ghats.id))
    .leftJoin(schema.kiosks, eq(schema.families.kioskId, schema.kiosks.id))
    .where(eq(schema.families.id, id));
  const r = rows[0];
  if (!r) throw notFound();
  const ms = await db.select().from(schema.members).where(eq(schema.members.familyId, id)).orderBy(asc(schema.members.sortOrder));
  const lost = await db
    .select({ id: schema.lostCases.id, code: schema.lostCases.code, status: schema.lostCases.status, personName: schema.lostCases.personName })
    .from(schema.lostCases)
    .where(eq(schema.lostCases.familyId, id));
  const help = await db
    .select({ id: schema.helpRequests.id, code: schema.helpRequests.code, status: schema.helpRequests.status, type: schema.helpRequests.type })
    .from(schema.helpRequests)
    .where(eq(schema.helpRequests.familyId, id));
  return {
    id: r.f.id,
    passCode: r.f.passCode,
    leaderName: r.f.leaderName,
    phoneLast4: r.f.phoneLast4,
    homeTown: r.f.homeTown,
    language: r.f.language,
    status: r.f.status,
    meetingPoint: r.f.meetingPoint,
    slotChangesLeft: r.f.slotChangesLeft,
    registeredAt: r.f.createdAt,
    kiosk: r.k ? { id: r.k.id, name: r.k.name, location: r.k.location } : null,
    consent: { version: r.f.consentVersion, at: r.f.consentAt, photo: r.f.photoConsent },
    deleteAfter: r.f.deleteAfter,
    slot: { day: r.s.day, start: r.s.startTime, end: r.s.endTime, batchNo: r.s.batchNo },
    ghat: { name: r.g.name, gate: r.g.gate },
    members: ms.map((m) => ({ id: m.id, name: m.name, age: m.age, relation: m.relation, needs: m.needs, isLeader: m.isLeader, bandId: m.bandId, hasPhoto: Boolean(m.photoEnc) })),
    lostCases: lost,
    helpRequests: help,
  };
}

export async function reports() {
  const db = await getDb();
  const today = istDate();
  const start = istInstant(today, "00:00");
  const hourly = await db
    .select({ hour: sql<number>`extract(hour from (${schema.families.createdAt} at time zone 'Asia/Kolkata'))::int`, n: sql<number>`count(*)::int` })
    .from(schema.families)
    .where(gte(schema.families.createdAt, start))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const byKiosk = await db
    .select({ kiosk: schema.families.kioskId, n: sql<number>`count(*)::int` })
    .from(schema.families)
    .where(gte(schema.families.createdAt, start))
    .groupBy(schema.families.kioskId);
  const helpTimes = await db
    .select({
      type: schema.helpRequests.type,
      resolved: sql<number>`count(${schema.helpRequests.resolvedAt})::int`,
      total: sql<number>`count(*)::int`,
      avgMinutes: sql<number | null>`round(avg(extract(epoch from (${schema.helpRequests.resolvedAt} - ${schema.helpRequests.createdAt})) / 60))::int`,
    })
    .from(schema.helpRequests)
    .where(gte(schema.helpRequests.createdAt, start))
    .groupBy(schema.helpRequests.type);
  const lostTimes = await db
    .select({
      total: sql<number>`count(*)::int`,
      reunited: sql<number>`count(*) filter (where ${schema.lostCases.status} = 'reunited')::int`,
      avgMinutes: sql<number | null>`round(avg(extract(epoch from (${schema.lostCases.closedAt} - ${schema.lostCases.createdAt})) / 60) filter (where ${schema.lostCases.status} = 'reunited'))::int`,
    })
    .from(schema.lostCases)
    .where(gte(schema.lostCases.createdAt, start));
  const langs = await db
    .select({ language: schema.families.language, n: sql<number>`count(*)::int` })
    .from(schema.families)
    .where(gte(schema.families.createdAt, start))
    .groupBy(schema.families.language);
  return { today, hourly, byKiosk, helpTimes, lost: lostTimes[0], languages: langs.sort((a, b) => b.n - a.n) };
}

export { and };
