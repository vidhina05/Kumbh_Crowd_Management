import { eq } from "drizzle-orm";
import { assertSameOrigin, handler, json, notFound, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { decrypt } from "@/server/crypto";
import { audit } from "@/server/audit";
import { sendTextSms } from "@/server/integrations/sms";

type Ctx = { params: Promise<{ id: string }> };

/** Send the family their current pass again by SMS (approved template: pass code, ghat, gate). */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("families.update");
  const id = zId.parse((await ctx.params).id);
  const db = await getDb();
  const [f] = await db
    .select({ phoneEnc: schema.families.phoneEnc, passCode: schema.families.passCode, ghat: schema.ghats.name, gate: schema.ghats.gate })
    .from(schema.families)
    .innerJoin(schema.slots, eq(schema.families.slotId, schema.slots.id))
    .innerJoin(schema.ghats, eq(schema.slots.ghatId, schema.ghats.id))
    .where(eq(schema.families.id, id));
  if (!f) throw notFound();
  const r = await sendTextSms(decrypt(f.phoneEnc), "pass", { pass: f.passCode, ghat: f.ghat, gate: f.gate });
  await audit({ actorType: "admin", actorId: user.id, action: "family.pass_resent", entityType: "family", entityId: id, details: { sent: r.sent } });
  return json({ sent: r.sent, reason: r.sent ? null : r.reason });
});
