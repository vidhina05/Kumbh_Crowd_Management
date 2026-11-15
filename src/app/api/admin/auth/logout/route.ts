import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, handler } from "@/server/http";
import { SESSION_COOKIE, logout } from "@/server/auth";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
});
