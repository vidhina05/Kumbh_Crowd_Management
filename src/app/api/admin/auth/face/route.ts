import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, handler, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { faceSignIn, sessionCookie } from "@/server/auth";

/** Sign-in step 2: face template made on this console (no image), with on-device liveness scores. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`signin-face:${clientIp(req)}`, 10, 60_000);
  const b = await parseBody(req, z.object({ loginToken: z.string().min(10).max(600), template: z.string().min(100).max(8000), real: z.number().min(0).max(1), live: z.number().min(0).max(1) }));
  const result = await faceSignIn(b.loginToken, b.template, { real: b.real, live: b.live });
  if (result.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: result.mfaToken });
  const res = NextResponse.json({ user: result.user });
  res.cookies.set(sessionCookie(result.token));
  return res;
});
