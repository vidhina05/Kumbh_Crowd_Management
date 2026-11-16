import { eq } from "drizzle-orm";
import { assertSameOrigin, handler, json, notFound, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { audit } from "@/server/audit";
import { decrypt } from "@/server/crypto";
import { sendTextSms } from "@/server/integrations/sms";

type Ctx = { params: Promise<{ id: string }> };

/** Thank the reporter (and log who helped) when closing a reunion. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("lost.update");
  const id = zId.parse((await ctx.params).id);
  const db = await getDb();
  const [c] = await db.select().from(schema.lostCases).where(eq(schema.lostCases.id, id));
  if (!c) throw notFound();
  let sms: "sent" | "not_connected" | "no_phone" | "failed" = "no_phone";
  if (c.reporterPhoneEnc) {
    const r = await sendTextSms(decrypt(c.reporterPhoneEnc), "thanks", { name: c.personName, code: c.code });
    sms = r.sent ? "sent" : r.reason === "not_configured" ? "not_connected" : "failed";
  }
  await db.update(schema.lostCases).set({ thanksSentAt: new Date() }).where(eq(schema.lostCases.id, id));
  await audit({ actorType: "admin", actorId: user.id, action: "lost.thanks", entityType: "lost", entityId: id, details: { sms } });
  return json({ ok: true, sms });
});
