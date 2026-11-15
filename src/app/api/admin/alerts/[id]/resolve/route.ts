import { assertSameOrigin, handler, json, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { resolveAlert } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("alerts.manage");
  return json(await resolveAlert(user, zId.parse((await ctx.params).id)));
});
