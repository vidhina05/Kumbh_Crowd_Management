import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, handler, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { login, sessionCookie } from "@/server/auth";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  rateLimit(`login-ip:${clientIp(req)}`, 10, 60_000);
  const { email, password } = await parseBody(req, z.object({ email: z.string().email().max(120), password: z.string().min(1).max(200) }));
  rateLimit(`login-user:${email.toLowerCase()}`, 10, 60_000);
  const { token, user } = await login(email, password);
  const res = NextResponse.json({ user });
  res.cookies.set(sessionCookie(token));
  return res;
});
