import { assertSameOrigin, handler, json, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { remindDiversion } from "@/server/services/diversions";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("diversions.create");
  return json(await remindDiversion(zId.parse((await ctx.params).id), user.id));
});
