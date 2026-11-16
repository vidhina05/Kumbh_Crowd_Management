import { z } from "zod";
import { assertSameOrigin, clientIp, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { approveDiversion } from "@/server/services/diversions";

type Ctx = { params: Promise<{ id: string }> };

/** Second check: another staff member confirms with their own credentials on this console. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("diversions.create");
  await rateLimit(`approve-ip:${clientIp(req)}`, 10, 60_000);
  const body = await parseBody(req, z.object({ email: z.string().email().max(120), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/).optional() }));
  return json(await approveDiversion(zId.parse((await ctx.params).id), body, user.id));
});
