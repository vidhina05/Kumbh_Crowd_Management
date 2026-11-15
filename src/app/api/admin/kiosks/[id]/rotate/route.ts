import { z } from "zod";
import { assertSameOrigin, handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { rotateKioskToken } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("kiosks.manage");
  const id = z.string().regex(/^K-\d{1,4}$/).parse((await ctx.params).id);
  return json(await rotateKioskToken(user, id));
});
