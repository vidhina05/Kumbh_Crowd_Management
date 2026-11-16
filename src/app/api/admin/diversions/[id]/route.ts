import { handler, json, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { diversionDetail } from "@/server/services/diversions";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("batches.view");
  return json(await diversionDetail(zId.parse((await ctx.params).id)));
});
