import { and, eq } from "drizzle-orm";
import { handler, json, notFound, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { listNotes } from "@/server/services/cases";
import { caseMatches } from "@/server/services/faces";

type Ctx = { params: Promise<{ id: string }> };

/** Everything for the case page and the "Reunited" summary. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("lost.view");
  const id = zId.parse((await ctx.params).id);
  const db = await getDb();
  const [c] = await db.select().from(schema.lostCases).where(eq(schema.lostCases.id, id));
  if (!c) throw notFound();
  const family = c.familyId ? (await db.select().from(schema.families).where(eq(schema.families.id, c.familyId)))[0] : null;
  const member = c.memberId ? (await db.select().from(schema.members).where(eq(schema.members.id, c.memberId)))[0] : null;
  const kiosk = c.kioskId ? (await db.select().from(schema.kiosks).where(eq(schema.kiosks.id, c.kioskId)))[0] : null;
  const confirmed = (await caseMatches(id)).filter((m) => m.status === "confirmed");
  const assignee = c.assignedTo ? (await db.select({ name: schema.adminUsers.name }).from(schema.adminUsers).where(and(eq(schema.adminUsers.id, c.assignedTo))))[0]?.name : null;
  const mins = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : null);
  return json({
    id: c.id,
    code: c.code,
    personName: c.personName,
    age: c.age,
    description: c.description,
    lastSeen: c.lastSeen,
    status: c.status,
    reporterName: c.reporterName,
    reporterPhoneLast4: c.reporterPhoneLast4,
    foundLocation: c.foundLocation,
    hasFoundPhoto: Boolean(c.foundPhotoEnc),
    hasMemberPhoto: Boolean(member?.photoEnc),
    memberId: member?.id ?? null,
    family: family ? { id: family.id, passCode: family.passCode, leaderName: family.leaderName, meetingPoint: family.meetingPoint, bandIds: [] as string[] } : null,
    member: member ? { name: member.name, age: member.age, bandId: member.bandId } : null,
    kiosk: kiosk ? { id: kiosk.id, location: kiosk.location } : null,
    assignee,
    times: { reportedAt: c.createdAt.toISOString(), foundAt: c.foundAt?.toISOString() ?? null, reunitedAt: c.reunitedAt?.toISOString() ?? null, minutesToReunite: mins(c.createdAt, c.reunitedAt) },
    faceMatch: confirmed[0] ? { score: confirmed[0].score } : null,
    thanksSentAt: c.thanksSentAt?.toISOString() ?? null,
    notes: await listNotes("lost", id),
  });
});
