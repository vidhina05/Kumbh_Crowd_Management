import { assertSameOrigin, handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { rotateSensorKey } from "@/server/services/sensors";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("sensors.manage");
  return json(await rotateSensorKey((await ctx.params).id, user.id));
});
