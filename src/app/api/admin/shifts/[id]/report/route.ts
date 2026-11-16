import { handler, json, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { shiftReport } from "@/server/services/shifts";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("shifts.use");
  return json(await shiftReport(zId.parse((await ctx.params).id)));
});
