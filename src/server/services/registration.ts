import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { encrypt, randomCode } from "../crypto";
import { HttpError, badRequest, conflict, notFound } from "../http";
import { env } from "../env";
import { audit } from "../audit";
import { phoneForChallenge } from "./otp";
import type { RegistrationInput } from "@/shared/validation";
import { addDays, crowdLevel, istDate, istInstant, minutesAgo } from "@/shared/time";

export const CONSENT_VERSION = "2026-01";

/** Who gets a wristband: the group leader, children under 12 and people 65 or older. */
export function needsBand(m: { age: number; isLeader: boolean }) {
  return m.isLeader || m.age < 12 || m.age >= 65;
}

export async function listSlots(day: string) {
  const db = await getDb();
  const ghats = await db.select().from(schema.ghats).orderBy(asc(schema.ghats.sortOrder));
  const slots = await db.select().from(schema.slots).where(eq(schema.slots.day, day)).orderBy(asc(schema.slots.startTime));
  return ghats.map((g) => ({
    id: g.id,
    name: g.name,
    nameHi: g.nameHi,
    gate: g.gate,
    walkNote: g.walkNote,
    crowd: {
      percent: Math.round((g.occupancy / g.capacity) * 100),
      level: crowdLevel(g.occupancy, g.capacity),
      source: g.occupancySource,
      updatedMinutesAgo: minutesAgo(g.occupancyUpdatedAt),
    },
    slots: slots
      .filter((s) => s.ghatId === g.id)
      .map((s) => ({ id: s.id, start: s.startTime, end: s.endTime, batchNo: s.batchNo, left: s.capacity - s.booked, capacity: s.capacity })),
  }));
}

type Q = Pick<Awaited<ReturnType<typeof getDb>>, "select">;

/** Must use the caller's transaction handle — a second connection inside a transaction can deadlock. */
async function uniquePassCode(db: Q, batchNo: number): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = `KMB-${batchNo}-${randomCode(4)}`;
    const [hit] = await db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.passCode, code));
    if (!hit) return code;
  }
  throw new Error("Could not allocate a pass code");
}

function bandId() {
  return `WB-${randomCode(6)}`;
}

/** Decode the photo and check it really is a JPEG (starts with FF D8 FF, ends with FF D9). */
function photoBytes(dataUrl: string): Buffer {
  const b = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  const ok = b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  if (!ok) throw badRequest("The photo could not be read. Please take it again.");
  return b;
}

export async function createRegistration(input: RegistrationInput, kioskId: string, challengeId: string) {
  const db = await getDb();
  const phone = await phoneForChallenge(challengeId);

  // One active registration per phone: offer "Find my registration" instead of a duplicate.
  const today = istDate();
  const existing = await db
    .select({ id: schema.families.id })
    .from(schema.families)
    .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
    .where(and(eq(schema.families.phoneHash, phone.phoneHash), gte(schema.slots.day, today)));
  if (existing.length) throw conflict("This phone number already has a registration.", { reason: "already_registered" });

  if (!input.consent.photo && input.members.some((m) => m.photo)) throw badRequest("Photos need photo consent.");
  const photos = input.members.map((m) => (input.consent.photo && m.photo ? photoBytes(m.photo) : null));

  const people = input.members.length;
  const result = await db.transaction(async (tx) => {
    // Atomic seat booking: only succeeds if the slot still has room for the whole family.
    const booked = await tx
      .update(schema.slots)
      .set({ booked: sql`${schema.slots.booked} + ${people}` })
      .where(and(eq(schema.slots.id, input.slotId), sql`${schema.slots.booked} + ${people} <= ${schema.slots.capacity}`, gte(schema.slots.day, today)))
      .returning();
    const slot = booked[0];
    if (!slot) throw new HttpError(409, "slot_full", "That time is now full. Please choose another time.");
    const [ghat] = await tx.select().from(schema.ghats).where(eq(schema.ghats.id, slot.ghatId));

    const passCode = await uniquePassCode(tx, slot.batchNo);
    const deleteAfter = new Date(istInstant(slot.day, slot.endTime).getTime() + env().RETENTION_HOURS * 3600_000);
    const [family] = await tx
      .insert(schema.families)
      .values({
        passCode,
        leaderName: input.members[0].name,
        phoneEnc: phone.phoneEnc,
        phoneHash: phone.phoneHash,
        phoneLast4: phone.last4,
        homeTown: input.homeTown,
        language: input.language,
        meetingPoint: ghat.meetingPoint,
        slotId: slot.id,
        kioskId,
        consentVersion: CONSENT_VERSION,
        consentAt: new Date(),
        photoConsent: input.consent.photo,
        deleteAfter,
      })
      .returning();

    const rows = input.members.map((m, i) => {
      const isLeader = i === 0;
      return {
        familyId: family.id,
        name: m.name,
        age: m.age,
        relation: isLeader ? "self" : m.relation,
        needs: m.needs,
        isLeader,
        bandId: needsBand({ age: m.age, isLeader }) ? bandId() : null,
        photoEnc: photos[i] ? encrypt(photos[i]!) : null,
        sortOrder: i,
      };
    });
    const inserted = await tx.insert(schema.members).values(rows).returning();
    return { family, slot, ghat, members: inserted };
  });

  await audit({
    actorType: "kiosk",
    actorId: kioskId,
    action: "registration.create",
    entityType: "family",
    entityId: result.family.id,
    details: { people, bands: result.members.filter((m) => m.bandId).length, photos: result.members.filter((m) => m.photoEnc).length, language: input.language },
  });
  return passView(result.family, result.slot, result.ghat, result.members);
}

type FamilyRow = typeof schema.families.$inferSelect;
type SlotRow = typeof schema.slots.$inferSelect;
type GhatRow = typeof schema.ghats.$inferSelect;
type MemberRow = typeof schema.members.$inferSelect;

export function passView(f: FamilyRow, s: SlotRow, g: GhatRow, ms: MemberRow[]) {
  return {
    passCode: f.passCode,
    leaderName: f.leaderName,
    phoneLast4: f.phoneLast4,
    language: f.language,
    meetingPoint: f.meetingPoint,
    slotChangesLeft: f.slotChangesLeft,
    slot: { id: s.id, day: s.day, start: s.startTime, end: s.endTime, batchNo: s.batchNo },
    ghat: { id: g.id, name: g.name, nameHi: g.nameHi, gate: g.gate, walkNote: g.walkNote },
    members: ms
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ name: m.name, age: m.age, relation: m.relation, needs: m.needs, isLeader: m.isLeader, hasBand: Boolean(m.bandId), bandId: m.bandId })),
  };
}

export async function findMyRegistration(phoneHash: string) {
  const db = await getDb();
  const rows = await db
    .select({ f: schema.families, s: schema.slots, g: schema.ghats })
    .from(schema.families)
    .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
    .innerJoin(schema.ghats, eq(schema.slots.ghatId, schema.ghats.id))
    .where(and(eq(schema.families.phoneHash, phoneHash), gte(schema.slots.day, addDays(istDate(), -1))))
    .orderBy(desc(schema.families.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("We couldn't find a registration for this phone number.");
  const ms = await db.select().from(schema.members).where(eq(schema.members.familyId, row.f.id));
  return passView(row.f, row.s, row.g, ms);
}

export async function changeSlot(phoneHash: string, newSlotId: string, kioskId: string) {
  const db = await getDb();
  const today = istDate();
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ f: schema.families, s: schema.slots })
      .from(schema.families)
      .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
      .where(and(eq(schema.families.phoneHash, phoneHash), gte(schema.slots.day, today)))
      .orderBy(desc(schema.families.createdAt))
      .limit(1);
    const cur = rows[0];
    if (!cur) throw notFound("We couldn't find a registration for this phone number.");
    if (cur.f.slotChangesLeft <= 0) throw new HttpError(409, "no_changes_left", "This registration can't be changed again. Please ask a volunteer.");
    if (cur.s.id === newSlotId) throw badRequest("That is already your time.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.members).where(eq(schema.members.familyId, cur.f.id));
    const booked = await tx
      .update(schema.slots)
      .set({ booked: sql`${schema.slots.booked} + ${n}` })
      .where(and(eq(schema.slots.id, newSlotId), sql`${schema.slots.booked} + ${n} <= ${schema.slots.capacity}`, gte(schema.slots.day, today)))
      .returning();
    const slot = booked[0];
    if (!slot) throw new HttpError(409, "slot_full", "That time is now full. Please choose another time.");
    await tx.update(schema.slots).set({ booked: sql`greatest(${schema.slots.booked} - ${n}, 0)` }).where(eq(schema.slots.id, cur.s.id));
    const [ghat] = await tx.select().from(schema.ghats).where(eq(schema.ghats.id, slot.ghatId));
    const passCode = await uniquePassCode(tx, slot.batchNo);
    const deleteAfter = new Date(istInstant(slot.day, slot.endTime).getTime() + env().RETENTION_HOURS * 3600_000);
    const [family] = await tx
      .update(schema.families)
      .set({ slotId: slot.id, passCode, meetingPoint: ghat.meetingPoint, slotChangesLeft: cur.f.slotChangesLeft - 1, deleteAfter })
      .where(eq(schema.families.id, cur.f.id))
      .returning();
    const ms = await tx.select().from(schema.members).where(eq(schema.members.familyId, family.id));
    return { pass: passView(family, slot, ghat, ms), oldPass: cur.f.passCode, familyId: family.id };
  });
  await audit({ actorType: "kiosk", actorId: kioskId, action: "registration.change_slot", entityType: "family", entityId: result.familyId });
  return { ...result.pass, replaces: result.oldPass };
}

export async function familyIdByPass(passCode: string | undefined) {
  if (!passCode) return null;
  const db = await getDb();
  const [f] = await db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.passCode, passCode.toUpperCase()));
  return f?.id ?? null;
}

export async function membersOf(familyIds: string[]) {
  if (!familyIds.length) return [];
  const db = await getDb();
  return db.select().from(schema.members).where(inArray(schema.members.familyId, familyIds));
}
