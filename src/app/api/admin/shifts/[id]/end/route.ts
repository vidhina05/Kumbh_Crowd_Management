import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { endShift } from "@/server/services/shifts";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("shifts.use");
  const { handoverTo, notes } = await parseBody(req, z.object({ handoverTo: z.string().uuid().nullable(), notes: z.string().trim().max(2000).default("") }));
  return json(await endShift(zId.parse((await ctx.params).id), user.id, handoverTo, notes));
});
