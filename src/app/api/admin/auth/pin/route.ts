import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, handler, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { pinSignIn, sessionCookie } from "@/server/auth";

/** Sign-in step 2 alternative: the staff PIN/password for the staff ID from step 1. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`login-ip:${clientIp(req)}`, 10, 60_000);
  const b = await parseBody(req, z.object({ loginToken: z.string().min(10).max(600), password: z.string().min(1).max(200) }));
  const result = await pinSignIn(b.loginToken, b.password);
  if (result.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: result.mfaToken });
  const res = NextResponse.json({ user: result.user });
  res.cookies.set(sessionCookie(result.token));
  return res;
});
