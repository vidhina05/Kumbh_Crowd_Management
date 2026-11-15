import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { updateHelp } from "@/server/services/cases";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("help.update");
  const id = zId.parse((await ctx.params).id);
  const patch = await parseBody(
    req,
    z.object({
      status: z.enum(["open", "assigned", "in_progress", "resolved", "cancelled"]).optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      priority: z.enum(["normal", "high", "critical"]).optional(),
    }),
  );
  return json(await updateHelp(user, id, patch));
});
