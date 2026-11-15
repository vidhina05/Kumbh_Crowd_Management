import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "./db";
import { randomToken, sha256 } from "./crypto";
import { HttpError, forbidden, unauthorized } from "./http";
import { can, type Permission, type Role } from "@/shared/rbac";
import { audit } from "./audit";
import { env } from "./env";

export const SESSION_COOKIE = "sc_session";
const SESSION_HOURS = 10; // one shift
const IDLE_MINUTES = 30; // automatic sign-out after inactivity
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type AdminUser = { id: string; email: string; name: string; role: Role };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  return null;
}

/** Same response for unknown email and wrong password, so attackers can't discover accounts. */
let dummyHash: string | null = null;
const BAD_LOGIN = () => new HttpError(401, "invalid_login", "Email or password is not right.");

export async function login(email: string, password: string): Promise<{ token: string; user: AdminUser }> {
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email.toLowerCase().trim()));
  if (!u) {
    dummyHash ??= await bcrypt.hash("not-a-real-password", 12);
    await bcrypt.compare(password, dummyHash); // equalise timing with a real check
    throw BAD_LOGIN();
  }
  if (!u.active) throw BAD_LOGIN();
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    throw new HttpError(423, "locked", `Too many wrong passwords. Try again after ${u.lockedUntil.toISOString().slice(11, 16)} UTC, or ask a super admin.`);
  }
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    const failed = u.failedLogins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await db.update(schema.adminUsers).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock }).where(eq(schema.adminUsers.id, u.id));
    await audit({ actorType: "admin", actorId: u.id, action: lock ? "auth.locked" : "auth.failed" });
    throw BAD_LOGIN();
  }
  await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.adminUsers.id, u.id));
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ id: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) });
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())); // housekeeping
  await audit({ actorType: "admin", actorId: u.id, action: "auth.login" });
  return { token, user: { id: u.id, email: u.email, name: u.name, role: u.role as Role } };
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  };
}

export async function userFromToken(token: string | undefined): Promise<AdminUser | null> {
  if (!token) return null;
  const db = await getDb();
  const id = sha256(token);
  const rows = await db
    .select({ s: schema.sessions, u: schema.adminUsers })
    .from(schema.sessions)
    .innerJoin(schema.adminUsers, eq(schema.sessions.userId, schema.adminUsers.id))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())));
  const row = rows[0];
  if (!row || !row.u.active) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > IDLE_MINUTES * 60_000) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }
  if (Date.now() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, id));
  }
  return { id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role as Role };
}

export async function currentUser(): Promise<AdminUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** Use at the top of every admin API handler. Checks the session AND the permission on the server. */
export async function requireUser(permission?: Permission): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  if (permission && !can(user.role, permission)) throw forbidden();
  return user;
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}
