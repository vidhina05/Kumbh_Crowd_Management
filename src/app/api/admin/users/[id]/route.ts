import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { updateUser } from "@/server/services/admin";
import { ROLES } from "@/shared/rbac";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("users.manage");
  const id = zId.parse((await ctx.params).id);
  const patch = await parseBody(req, z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), password: z.string().min(12).max(200).optional() }));
  await updateUser(user, id, patch);
  return json({ ok: true });
});
