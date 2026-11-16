import { assertSameOrigin, handler, json, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { disableMfa } from "@/server/services/mfa";

type Ctx = { params: Promise<{ id: string }> };

/** Super admin: reset someone's two-step sign-in (lost phone). They must set it up again. */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("users.manage");
  await disableMfa(zId.parse((await ctx.params).id), user.id);
  return json({ ok: true });
});
