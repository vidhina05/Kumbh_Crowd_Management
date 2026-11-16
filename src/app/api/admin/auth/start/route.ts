import { z } from "zod";
import { assertSameOrigin, clientIp, handler, json, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { startSignIn } from "@/server/auth";

/** Sign-in step 1: staff ID (or work email). */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`signin-start:${clientIp(req)}`, 15, 60_000);
  const { staffId } = await parseBody(req, z.object({ staffId: z.string().trim().min(3).max(120) }));
  return json(await startSignIn(staffId));
});
