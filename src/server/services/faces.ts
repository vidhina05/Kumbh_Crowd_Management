import "server-only";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, decryptToBuffer, encrypt, signToken } from "../crypto";
import { HttpError, badRequest, notFound } from "../http";
import { audit } from "../audit";
import { PILGRIM_TOKEN_MINUTES } from "../kioskAuth";
import { rateLimit } from "../ratelimit";

/**
 * Opt-in face matching.
 *
 * - Only families that ticked "find us by face" at the kiosk have face templates.
 * - A template is a list of 1024 numbers that describes a face (computed on the device by the
 *   on-device model). It is encrypted at rest and deleted with the family (48 h after their slot).
 * - Matching never decides anything on its own: staff see the candidates and confirm, and every
 *   search and confirmation is logged. At the kiosk, a face match also needs the last 4 phone digits.
 */
export const TEMPLATE_LENGTH = 1024;
export const MATCH_THRESHOLD = 0.62; // cosine similarity; tuned to prefer "no match" over a wrong match
export const STRONG_MATCH = 0.75;

export function parseTemplate(b64: string): Float32Array {
  const bin = Buffer.from(b64, "base64");
  if (bin.length !== TEMPLATE_LENGTH * 4) throw badRequest("Face data is not valid.");
  const arr = new Float32Array(TEMPLATE_LENGTH);
  for (let i = 0; i < TEMPLATE_LENGTH; i++) arr[i] = bin.readFloatLE(i * 4);
  if (arr.some((x) => !Number.isFinite(x))) throw badRequest("Face data is not valid.");
  return arr;
}

export function encodeTemplate(t: Float32Array): string {
  const b = Buffer.alloc(t.length * 4);
  t.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b.toString("base64");
}

export function similarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function encryptTemplate(b64: string) {
  parseTemplate(b64); // validate
  return encrypt(b64);
}

async function candidates() {
  const db = await getDb();
  return db
    .select({
      memberId: schema.members.id,
      name: schema.members.name,
      age: schema.members.age,
      relation: schema.members.relation,
      template: schema.members.faceTemplateEnc,
      familyId: schema.families.id,
      passCode: schema.families.passCode,
      leaderName: schema.families.leaderName,
      phoneLast4: schema.families.phoneLast4,
      phoneHash: schema.families.phoneHash,
      meetingPoint: schema.families.meetingPoint,
    })
    .from(schema.members)
    .innerJoin(schema.families, eq(schema.members.familyId, schema.families.id))
    .where(and(isNotNull(schema.members.faceTemplateEnc), eq(schema.families.faceConsent, true), gt(schema.families.deleteAfter, new Date())));
}

export async function rank(probe: Float32Array, limit = 5) {
  const list = await candidates();
  return list
    .map((c) => ({ ...c, score: similarity(probe, parseTemplate(decrypt(c.template!))) }))
    .filter((c) => c.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Staff search with a photo of a found person. Results are suggestions for a person to check. */
export async function searchForCase(caseId: string, templateB64: string, photoDataUrl: string | undefined, userId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.lostCases).where(eq(schema.lostCases.id, caseId));
  if (!c) throw notFound();
  const probe = parseTemplate(templateB64);
  const top = await rank(probe);
  if (photoDataUrl) {
    const b = Buffer.from(photoDataUrl.split(",")[1] ?? "", "base64");
    if (b.length < 100 || b[0] !== 0xff || b[1] !== 0xd8) throw badRequest("The photo must be a JPEG.");
    await db.update(schema.lostCases).set({ foundPhotoEnc: encrypt(b), updatedAt: new Date() }).where(eq(schema.lostCases.id, caseId));
  }
  await db.delete(schema.faceMatches).where(and(eq(schema.faceMatches.lostCaseId, caseId), eq(schema.faceMatches.status, "suggested")));
  if (top.length) await db.insert(schema.faceMatches).values(top.map((t) => ({ lostCaseId: caseId, memberId: t.memberId, score: t.score })));
  await audit({ actorType: "admin", actorId: userId, action: "face.search", entityType: "lost_case", entityId: caseId, details: { candidates: top.length } });
  return caseMatches(caseId);
}

export async function caseMatches(caseId: string) {
  const db = await getDb();
  const rows = await db
    .select({ m: schema.faceMatches, name: schema.members.name, age: schema.members.age, relation: schema.members.relation, hasPhoto: isNotNull(schema.members.photoEnc), familyId: schema.families.id, passCode: schema.families.passCode, leaderName: schema.families.leaderName, phoneLast4: schema.families.phoneLast4, meetingPoint: schema.families.meetingPoint })
    .from(schema.faceMatches)
    .innerJoin(schema.members, eq(schema.faceMatches.memberId, schema.members.id))
    .innerJoin(schema.families, eq(schema.members.familyId, schema.families.id))
    .where(eq(schema.faceMatches.lostCaseId, caseId));
  return rows
    .sort((a, b) => b.m.score - a.m.score)
    .map((r) => ({
      id: r.m.id,
      memberId: r.m.memberId,
      score: Math.round(r.m.score * 100),
      strength: r.m.score >= STRONG_MATCH ? "strong" : "possible",
      status: r.m.status,
      name: r.name,
      age: r.age,
      relation: r.relation,
      hasPhoto: r.hasPhoto,
      family: { id: r.familyId, passCode: r.passCode, leaderName: r.leaderName, phoneLast4: r.phoneLast4, meetingPoint: r.meetingPoint },
    }));
}

/** A person confirmed (or rejected) a suggestion. Confirming links the case to that family member. */
export async function reviewMatch(matchId: string, decision: "confirmed" | "rejected", userId: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.faceMatches).where(eq(schema.faceMatches.id, matchId));
  if (!m) throw notFound();
  await db.update(schema.faceMatches).set({ status: decision, reviewedBy: userId, reviewedAt: new Date() }).where(eq(schema.faceMatches.id, matchId));
  if (decision === "confirmed") {
    const [mem] = await db.select().from(schema.members).where(eq(schema.members.id, m.memberId));
    await db
      .update(schema.lostCases)
      .set({ familyId: mem.familyId, memberId: mem.id, status: "found", foundAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.lostCases.id, m.lostCaseId));
    await db.update(schema.faceMatches).set({ status: "rejected", reviewedBy: userId, reviewedAt: new Date() }).where(and(eq(schema.faceMatches.lostCaseId, m.lostCaseId), eq(schema.faceMatches.status, "suggested")));
  }
  await audit({ actorType: "admin", actorId: userId, action: `face.${decision}`, entityType: "lost_case", entityId: m.lostCaseId, details: { score: Math.round(m.score * 100) } });
  return caseMatches(m.lostCaseId);
}

/** The stored photo of a matched member — staff need it to compare by eye. Logged. */
export async function memberPhoto(memberId: string, userId: string) {
  const db = await getDb();
  const [m] = await db.select({ photoEnc: schema.members.photoEnc, familyId: schema.members.familyId }).from(schema.members).where(eq(schema.members.id, memberId));
  if (!m?.photoEnc) throw notFound("No photo for this person.");
  await audit({ actorType: "admin", actorId: userId, action: "member.photo_view", entityType: "member", entityId: memberId });
  return decryptToBuffer(m.photoEnc);
}

/** Kiosk "Find me by face": needs a face match AND the last 4 digits of the family's phone. */
export async function findByFace(kioskId: string, templateB64: string, phoneLast4: string) {
  await rateLimit(`face-find:${kioskId}`, 10, 60_000);
  if (!/^\d{4}$/.test(phoneLast4)) throw badRequest("Enter the last 4 digits of your phone number.");
  const top = await rank(parseTemplate(templateB64), 10);
  const hit = top.find((t) => t.phoneLast4 === phoneLast4 && t.score >= STRONG_MATCH);
  await audit({ actorType: "kiosk", actorId: kioskId, action: hit ? "face.find_ok" : "face.find_none" });
  if (!hit) throw new HttpError(404, "face_no_match", "We couldn't find you by face. Please use your phone number, or ask a volunteer.");
  const pilgrimToken = signToken({ ph: hit.phoneHash, k: kioskId, f: hit.familyId }, PILGRIM_TOKEN_MINUTES * 60);
  return { pilgrimToken };
}

export async function familiesWithFaces(ids: string[]) {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db.select({ id: schema.members.id }).from(schema.members).where(and(inArray(schema.members.familyId, ids), isNotNull(schema.members.faceTemplateEnc)));
  return rows.length;
}
