import { eq } from "drizzle-orm";
import { handler, notFound, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { getDb, schema } from "@/server/db";
import { decryptToBuffer } from "@/server/crypto";
import { audit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser("lost.view");
  const id = zId.parse((await ctx.params).id);
  const db = await getDb();
  const [c] = await db.select({ p: schema.lostCases.foundPhotoEnc }).from(schema.lostCases).where(eq(schema.lostCases.id, id));
  if (!c?.p) throw notFound("No photo for this case.");
  await audit({ actorType: "admin", actorId: user.id, action: "lost.found_photo_viewed", entityType: "lost", entityId: id });
  return new Response(new Uint8Array(decryptToBuffer(c.p)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, private" } });
});
