import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { updateLost } from "@/server/services/cases";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("lost.update");
  const id = zId.parse((await ctx.params).id);
  const patch = await parseBody(req, z.object({ status: z.enum(["open", "searching", "found", "reunited", "closed"]).optional(), assignedTo: z.string().uuid().nullable().optional(), passCode: z.string().trim().min(5).max(20).optional(), memberId: z.string().uuid().nullable().optional() }));
  return json(await updateLost(user, id, patch));
});
