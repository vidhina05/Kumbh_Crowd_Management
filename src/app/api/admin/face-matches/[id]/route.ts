import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { reviewMatch } from "@/server/services/faces";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("faces.search");
  const { decision } = await parseBody(req, z.object({ decision: z.enum(["confirmed", "rejected"]) }));
  return json({ matches: await reviewMatch(zId.parse((await ctx.params).id), decision, user.id) });
});
