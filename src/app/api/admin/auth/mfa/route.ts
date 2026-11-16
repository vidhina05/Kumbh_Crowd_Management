import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, handler, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { completeMfaLogin, sessionCookie } from "@/server/auth";

/** Second step of staff sign-in: the 6-digit code from the authenticator app. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`mfa-ip:${clientIp(req)}`, 10, 60_000);
  const { mfaToken, code } = await parseBody(req, z.object({ mfaToken: z.string().min(10).max(600), code: z.string().regex(/^\d{6}$/) }));
  const { token, user } = await completeMfaLogin(mfaToken, code);
  const res = NextResponse.json({ user });
  res.cookies.set(sessionCookie(token));
  return res;
});
