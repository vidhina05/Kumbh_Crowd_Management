import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, handler, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { login, sessionCookie } from "@/server/auth";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`login-ip:${clientIp(req)}`, 10, 60_000);
  const { email, password } = await parseBody(req, z.object({ email: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) }));
  await rateLimit(`login-user:${email.toLowerCase()}`, 10, 60_000);
  const result = await login(email, password);
  if (result.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: result.mfaToken });
  const res = NextResponse.json({ user: result.user });
  res.cookies.set(sessionCookie(result.token));
  return res;
});
