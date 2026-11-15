import { z } from "zod";
import { eq } from "drizzle-orm";
import { assertSameOrigin, handler, json, notFound, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { familyDetail } from "@/server/services/overview";
import { getDb, schema } from "@/server/db";
import { audit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("families.view");
  const id = zId.parse((await ctx.params).id);
  return json(await familyDetail(id));
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("families.update");
  const id = zId.parse((await ctx.params).id);
  const { status } = await parseBody(req, z.object({ status: z.enum(["registered", "on_the_way", "bathing", "left"]) }));
  const db = await getDb();
  const [row] = await db.update(schema.families).set({ status }).where(eq(schema.families.id, id)).returning({ id: schema.families.id });
  if (!row) throw notFound();
  await audit({ actorType: "admin", actorId: user.id, action: "family.status", entityType: "family", entityId: id, details: { status } });
  return json(await familyDetail(id));
});
