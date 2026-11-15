import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decryptToBuffer, encrypt, randomDigits } from "../crypto";
import { HttpError, forbidden, notFound } from "../http";
import { audit } from "../audit";
import { normalisePhone } from "./otp";
import { familyIdByPass } from "./registration";
import type { AdminUser } from "../auth";
import { canUpdateHelpType } from "@/shared/rbac";

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
const causeCode = (e: unknown): string | undefined => (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;

async function insertWithCode<T>(prefix: string, insert: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; i < 8; i++) {
    try {
      return await insert(`${prefix}-${randomDigits(4)}`);
    } catch (e) {
      if (causeCode(e) === "23505" || isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a case code");
}

// ---------- Kiosk side ----------

export async function createHelpRequest(
  input: { type: "medical" | "lost_person" | "wheelchair" | "language" | "other"; description: string; passCode?: string; clientRequestId: string },
  kiosk: { id: string; location: string },
) {
  const db = await getDb();
  // Idempotent: a kiosk retrying after a network drop gets the same request back.
  const [dup] = await db.select().from(schema.helpRequests).where(eq(schema.helpRequests.clientRequestId, input.clientRequestId));
  if (dup) return { code: dup.code, status: dup.status, duplicate: true };
  const familyId = await familyIdByPass(input.passCode);
  const priority = input.type === "medical" || input.type === "lost_person" ? "high" : "normal";
  const row = await insertWithCode("H", async (code) => {
    const [r] = await db
      .insert(schema.helpRequests)
      .values({ code, clientRequestId: input.clientRequestId, type: input.type, description: input.description, location: kiosk.location, priority, kioskId: kiosk.id, familyId })
      .returning();
    return r;
  });
  await audit({ actorType: "kiosk", actorId: kiosk.id, action: "help.create", entityType: "help", entityId: row.id, details: { type: input.type } });
  return { code: row.code, status: row.status, duplicate: false };
}

export async function createLostCase(
  input: { personName: string; age?: number; description: string; lastSeen: string; reporterName: string; reporterPhone?: string; clientRequestId: string },
  kiosk: { id: string },
  phoneHash?: string,
) {
  const db = await getDb();
  const [dup] = await db.select().from(schema.lostCases).where(eq(schema.lostCases.clientRequestId, input.clientRequestId));
  if (dup) return { code: dup.code, status: dup.status, duplicate: true };
  const phone = input.reporterPhone ? normalisePhone(input.reporterPhone) : null;

  // If the reporter verified their phone, link the case to their family and the matching member.
  let familyId: string | null = null;
  let memberId: string | null = null;
  if (phoneHash) {
    const [f] = await db.select().from(schema.families).where(eq(schema.families.phoneHash, phoneHash)).orderBy(desc(schema.families.createdAt)).limit(1);
    if (f) {
      familyId = f.id;
      const ms = await db.select().from(schema.members).where(eq(schema.members.familyId, f.id));
      memberId = ms.find((m) => m.name.toLowerCase() === input.personName.toLowerCase())?.id ?? null;
    }
  }
  const row = await insertWithCode("L", async (code) => {
    const [r] = await db
      .insert(schema.lostCases)
      .values({
        code,
        clientRequestId: input.clientRequestId,
        personName: input.personName,
        age: input.age ?? null,
        description: input.description,
        lastSeen: input.lastSeen,
        reporterName: input.reporterName,
        reporterPhoneEnc: phone ? encrypt(phone) : null,
        reporterPhoneLast4: phone ? phone.slice(-4) : null,
        kioskId: kiosk.id,
        familyId,
        memberId,
      })
      .returning();
    return r;
  });
  await audit({ actorType: "kiosk", actorId: kiosk.id, action: "lost.create", entityType: "lost", entityId: row.id, details: { linkedFamily: Boolean(familyId) } });
  return { code: row.code, status: row.status, duplicate: false, linkedToFamily: Boolean(familyId) };
}

// ---------- Admin side ----------

export async function listHelp(filter: { status?: string; type?: string }) {
  const db = await getDb();
  const conds = [];
  if (filter.status === "active") conds.push(inArray(schema.helpRequests.status, ["open", "assigned", "in_progress"]));
  else if (filter.status) conds.push(eq(schema.helpRequests.status, filter.status));
  if (filter.type) conds.push(eq(schema.helpRequests.type, filter.type));
  const rows = await db
    .select({ h: schema.helpRequests, assignee: schema.adminUsers.name, pass: schema.families.passCode, family: schema.families.leaderName })
    .from(schema.helpRequests)
    .leftJoin(schema.adminUsers, eq(schema.helpRequests.assignedTo, schema.adminUsers.id))
    .leftJoin(schema.families, eq(schema.helpRequests.familyId, schema.families.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.helpRequests.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.h, assigneeName: r.assignee, passCode: r.pass, familyName: r.family }));
}

const HELP_FLOW: Record<string, string[]> = {
  open: ["assigned", "in_progress", "resolved", "cancelled"],
  assigned: ["in_progress", "resolved", "cancelled", "open"],
  in_progress: ["resolved", "cancelled", "assigned"],
  resolved: ["open"],
  cancelled: ["open"],
};

export async function updateHelp(user: AdminUser, id: string, patch: { status?: string; assignedTo?: string | null; priority?: string }) {
  const db = await getDb();
  const [h] = await db.select().from(schema.helpRequests).where(eq(schema.helpRequests.id, id));
  if (!h) throw notFound();
  if (!canUpdateHelpType(user.role, h.type)) throw forbidden("Your role can only update medical requests.");
  if (patch.status && patch.status !== h.status && !HELP_FLOW[h.status]?.includes(patch.status)) {
    throw new HttpError(409, "bad_transition", `A ${h.status.replace("_", " ")} request can't move to ${patch.status.replace("_", " ")}.`);
  }
  if (patch.assignedTo) {
    const [u] = await db.select({ id: schema.adminUsers.id, active: schema.adminUsers.active }).from(schema.adminUsers).where(eq(schema.adminUsers.id, patch.assignedTo));
    if (!u || !u.active) throw notFound("That staff member doesn't exist.");
  }
  const status = patch.status ?? (patch.assignedTo && h.status === "open" ? "assigned" : h.status);
  const [row] = await db
    .update(schema.helpRequests)
    .set({
      status,
      assignedTo: patch.assignedTo === undefined ? h.assignedTo : patch.assignedTo,
      priority: patch.priority ?? h.priority,
      updatedAt: new Date(),
      resolvedAt: status === "resolved" ? new Date() : status === "open" ? null : h.resolvedAt,
    })
    .where(eq(schema.helpRequests.id, id))
    .returning();
  await audit({ actorType: "admin", actorId: user.id, action: "help.update", entityType: "help", entityId: id, details: { from: h.status, to: status, assigned: patch.assignedTo !== undefined } });
  return row;
}

export async function listLost(filter: { status?: string; q?: string }) {
  const db = await getDb();
  const conds = [];
  if (filter.status === "active") conds.push(inArray(schema.lostCases.status, ["open", "searching", "found"]));
  else if (filter.status) conds.push(eq(schema.lostCases.status, filter.status));
  if (filter.q) conds.push(or(ilike(schema.lostCases.personName, `%${filter.q}%`), ilike(schema.lostCases.code, `%${filter.q}%`)));
  const rows = await db
    .select({ c: schema.lostCases, assignee: schema.adminUsers.name, pass: schema.families.passCode, memberName: schema.members.name, hasPhoto: sql<boolean>`${schema.members.photoEnc} is not null` })
    .from(schema.lostCases)
    .leftJoin(schema.adminUsers, eq(schema.lostCases.assignedTo, schema.adminUsers.id))
    .leftJoin(schema.families, eq(schema.lostCases.familyId, schema.families.id))
    .leftJoin(schema.members, eq(schema.lostCases.memberId, schema.members.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.lostCases.createdAt))
    .limit(200);
  return rows.map((r) => {
    const { reporterPhoneEnc: _omit, ...c } = r.c;
    return { ...c, assigneeName: r.assignee, passCode: r.pass, memberName: r.memberName, hasPhoto: Boolean(r.hasPhoto) };
  });
}

const LOST_FLOW: Record<string, string[]> = {
  open: ["searching", "found", "closed"],
  searching: ["found", "closed", "open"],
  found: ["reunited", "searching"],
  reunited: [],
  closed: ["open"],
};

export async function updateLost(user: AdminUser, id: string, patch: { status?: string; assignedTo?: string | null; passCode?: string; memberId?: string | null }) {
  const db = await getDb();
  const [c] = await db.select().from(schema.lostCases).where(eq(schema.lostCases.id, id));
  if (!c) throw notFound();

  // Link the case to a registered family (by pass number) and, if possible, to the missing member.
  if (patch.passCode !== undefined || patch.memberId !== undefined) {
    let familyId = c.familyId;
    if (patch.passCode !== undefined) {
      const [f] = await db.select({ id: schema.families.id }).from(schema.families).where(eq(schema.families.passCode, patch.passCode.trim().toUpperCase()));
      if (!f) throw notFound("No family has that pass number.");
      familyId = f.id;
    }
    if (!familyId) throw new HttpError(409, "not_linked", "Link the case to a family first.");
    const ms = await db.select().from(schema.members).where(eq(schema.members.familyId, familyId));
    let memberId: string | null = null;
    if (patch.memberId) {
      if (!ms.some((m) => m.id === patch.memberId)) throw new HttpError(400, "bad_member", "That person is not in this family.");
      memberId = patch.memberId;
    } else if (patch.memberId === undefined) {
      memberId = ms.find((m) => m.name.toLowerCase() === c.personName.toLowerCase())?.id ?? null;
    }
    await db.update(schema.lostCases).set({ familyId, memberId, updatedAt: new Date() }).where(eq(schema.lostCases.id, id));
    await audit({ actorType: "admin", actorId: user.id, action: "lost.link_family", entityType: "lost", entityId: id, details: { member: Boolean(memberId) } });
    c.familyId = familyId;
    c.memberId = memberId;
  }
  if (patch.status && patch.status !== c.status && !LOST_FLOW[c.status]?.includes(patch.status)) {
    throw new HttpError(409, "bad_transition", `A ${c.status} case can't move to ${patch.status}.`);
  }
  const status = patch.status ?? (patch.assignedTo && c.status === "open" ? "searching" : c.status);
  const [row] = await db
    .update(schema.lostCases)
    .set({
      status,
      assignedTo: patch.assignedTo === undefined ? c.assignedTo : patch.assignedTo,
      updatedAt: new Date(),
      closedAt: status === "reunited" || status === "closed" ? new Date() : null,
    })
    .where(eq(schema.lostCases.id, id))
    .returning();
  await audit({ actorType: "admin", actorId: user.id, action: "lost.update", entityType: "lost", entityId: id, details: { from: c.status, to: status } });
  const { reporterPhoneEnc: _omit, ...safe } = row;
  return safe;
}

/** Photo of the missing person, only while the case is open, and every view is logged. */
export async function lostCasePhoto(user: AdminUser, id: string): Promise<Buffer> {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.lostCases.status, photo: schema.members.photoEnc })
    .from(schema.lostCases)
    .leftJoin(schema.members, eq(schema.lostCases.memberId, schema.members.id))
    .where(eq(schema.lostCases.id, id));
  const r = rows[0];
  if (!r || !r.photo) throw notFound("No photo on file.");
  if (!["open", "searching", "found"].includes(r.status)) throw forbidden("Photos are only shown while a case is open.");
  await audit({ actorType: "admin", actorId: user.id, action: "lost.photo_viewed", entityType: "lost", entityId: id });
  return decryptToBuffer(r.photo);
}

export async function addNote(user: AdminUser, caseType: "help" | "lost", caseId: string, note: string) {
  const db = await getDb();
  const table = caseType === "help" ? schema.helpRequests : schema.lostCases;
  const [exists] = await db.select({ id: table.id }).from(table).where(eq(table.id, caseId));
  if (!exists) throw notFound();
  if (caseType === "help") {
    const [h] = await db.select({ type: schema.helpRequests.type }).from(schema.helpRequests).where(eq(schema.helpRequests.id, caseId));
    if (!canUpdateHelpType(user.role, h.type)) throw forbidden("Your role can only update medical requests.");
  }
  const [n] = await db.insert(schema.caseNotes).values({ caseType, caseId, authorId: user.id, note }).returning();
  await audit({ actorType: "admin", actorId: user.id, action: `${caseType}.note`, entityType: caseType, entityId: caseId });
  return n;
}

export async function listNotes(caseType: "help" | "lost", caseId: string) {
  const db = await getDb();
  return db
    .select({ id: schema.caseNotes.id, note: schema.caseNotes.note, createdAt: schema.caseNotes.createdAt, author: schema.adminUsers.name })
    .from(schema.caseNotes)
    .leftJoin(schema.adminUsers, eq(schema.caseNotes.authorId, schema.adminUsers.id))
    .where(and(eq(schema.caseNotes.caseType, caseType), eq(schema.caseNotes.caseId, caseId)))
    .orderBy(desc(schema.caseNotes.createdAt));
}
