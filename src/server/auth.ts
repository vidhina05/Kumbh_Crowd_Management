import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "./db";
import { randomToken, sha256, signToken, verifyToken } from "./crypto";
import { HttpError, forbidden, unauthorized } from "./http";
import { can, type Permission, type Role } from "@/shared/rbac";
import { audit } from "./audit";
import { env, mfaRequiredFor } from "./env";
import { verifyTotpForUser } from "./services/mfa";

export const SESSION_COOKIE = "sc_session";
const SESSION_HOURS = 10; // one shift
const IDLE_MINUTES = 30; // automatic sign-out after inactivity
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type AdminUser = { id: string; email: string; name: string; role: Role; staffCode: string; faceEnrolled: boolean; mfaEnabled: boolean; mfaSetupRequired: boolean };

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

type LoginResult = { token: string; user: AdminUser; mfaRequired?: false } | { mfaRequired: true; mfaToken: string };

/** Staff sign in with their work email or their staff ID (e.g. KMB-ADM-1186). */
async function findStaff(identifier: string) {
  const db = await getDb();
  const id = identifier.trim();
  const [u] = await db.select().from(schema.adminUsers).where(id.includes("@") ? eq(schema.adminUsers.email, id.toLowerCase()) : eq(schema.adminUsers.staffCode, id.toUpperCase()));
  return u;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const db = await getDb();
  const u = await findStaff(email);
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
  await db.update(schema.adminUsers).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.id, u.id));
  if (u.mfaEnabled) {
    // Password was right; the session is only created after the 6-digit code (see completeMfaLogin).
    return { mfaRequired: true, mfaToken: signToken({ mfa: u.id, p: "login" }, 5 * 60) };
  }
  return createSession(u);
}

/** Second step of sign-in for staff with two-step sign-in on. */
export async function completeMfaLogin(mfaToken: string, code: string) {
  const claims = verifyToken<{ mfa: string; p: string }>(mfaToken);
  if (!claims || claims.p !== "login") throw new HttpError(401, "mfa_expired", "Sign-in took too long. Enter your password again.");
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, claims.mfa));
  if (!u || !u.active) throw BAD_LOGIN();
  await verifyTotpForUser(u.id, code);
  return createSession(u);
}

async function createSession(u: typeof schema.adminUsers.$inferSelect) {
  const db = await getDb();
  await db.update(schema.adminUsers).set({ lastLoginAt: new Date() }).where(eq(schema.adminUsers.id, u.id));
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ id: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) });
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())); // housekeeping
  await audit({ actorType: "admin", actorId: u.id, action: "auth.login" });
  return { token, user: toUser(u) };
}

function toUser(u: typeof schema.adminUsers.$inferSelect): AdminUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role, staffCode: u.staffCode, faceEnrolled: Boolean(u.faceTemplateEnc), mfaEnabled: u.mfaEnabled, mfaSetupRequired: !u.mfaEnabled && mfaRequiredFor(u.role) };
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
  return toUser(row.u);
}

export async function currentUser(): Promise<AdminUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** Use at the top of every admin API handler. Checks the session AND the permission on the server. */
export async function requireUser(permission?: Permission, opts: { allowMfaSetup?: boolean } = {}): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  if (user.mfaSetupRequired && !opts.allowMfaSetup) {
    throw new HttpError(403, "mfa_setup_required", "Your role must use two-step sign-in. Set it up in Settings first.");
  }
  if (permission && !can(user.role, permission)) throw forbidden();
  return user;
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}


// ---------- Staff ID → face scan sign-in (Figma: Admin / 01 Sign in → 02 Verify identity) ----------
const FACE_MAX_FAILED = 3;

/** Step 1: the staff ID. Says who is signing in and which ways are available. Rate-limited per IP by the route. */
export async function startSignIn(identifier: string) {
  const u = await findStaff(identifier);
  if (!u || !u.active) throw new HttpError(404, "unknown_staff", "We don't know that staff ID. Check the back of your control-room card.");
  return {
    loginToken: signToken({ st: u.id, p: "start" }, 5 * 60),
    name: u.name,
    role: u.role as Role,
    staffCode: u.staffCode,
    face: Boolean(u.faceTemplateEnc) && u.faceFailed < FACE_MAX_FAILED,
    faceTriesLeft: Math.max(0, FACE_MAX_FAILED - u.faceFailed),
    code: u.mfaEnabled,
  };
}

function startClaims(loginToken: string) {
  const c = verifyToken<{ st: string; p: string }>(loginToken);
  if (!c || c.p !== "start") throw new HttpError(401, "signin_expired", "Sign-in took too long. Enter your staff ID again.");
  return c;
}

/**
 * Step 2: face scan. The console turns the camera frame into a face template (no image is sent) and reports
 * the on-device anti-spoofing and liveness scores; the server compares with the enrolled template.
 * Three misses lock face sign-in until the staff member signs in another way.
 */
export async function faceSignIn(loginToken: string, templateB64: string, scores: { real: number; live: number }): Promise<LoginResult> {
  const { parseTemplate, similarity, STRONG_MATCH } = await import("./services/faces");
  const { decrypt } = await import("./crypto");
  const c = startClaims(loginToken);
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, c.st));
  if (!u || !u.active || !u.faceTemplateEnc) throw new HttpError(400, "no_face", "Face sign-in isn't set up for this staff ID. Use your PIN.");
  if (u.faceFailed >= FACE_MAX_FAILED) throw new HttpError(423, "face_locked", "Face sign-in is paused after 3 tries. Use your PIN or one-time code.");
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, "locked", "This account is locked for a few minutes. Ask a super admin.");
  const score = similarity(parseTemplate(templateB64), parseTemplate(decrypt(u.faceTemplateEnc)));
  const realEnough = scores.real >= 0.4 && scores.live >= 0.4;
  if (score < STRONG_MATCH || !realEnough) {
    await db.update(schema.adminUsers).set({ faceFailed: u.faceFailed + 1 }).where(eq(schema.adminUsers.id, u.id));
    await audit({ actorType: "admin", actorId: u.id, action: "auth.face_failed", details: { reason: realEnough ? "no_match" : "liveness" } });
    const left = FACE_MAX_FAILED - u.faceFailed - 1;
    throw new HttpError(401, "face_no_match", realEnough ? (left > 0 ? `That didn't match. ${left} more ${left === 1 ? "try" : "tries"}, then use your PIN.` : "That didn't match. Use your PIN or one-time code.") : "Please look at the camera yourself (not a photo or screen).");
  }
  await db.update(schema.adminUsers).set({ faceFailed: 0, failedLogins: 0 }).where(eq(schema.adminUsers.id, u.id));
  await audit({ actorType: "admin", actorId: u.id, action: "auth.face_ok", details: { score: Math.round(score * 100) } });
  if (u.mfaEnabled && mfaRequiredFor(u.role)) return { mfaRequired: true, mfaToken: signToken({ mfa: u.id, p: "login" }, 5 * 60) };
  return createSession(u);
}

/** Step 2 alternative: the staff PIN/password for the staff ID from step 1. */
export async function pinSignIn(loginToken: string, password: string) {
  const c = startClaims(loginToken);
  const db = await getDb();
  const [u] = await db.select({ email: schema.adminUsers.email }).from(schema.adminUsers).where(eq(schema.adminUsers.id, c.st));
  if (!u) throw BAD_LOGIN();
  const r = await login(u.email, password);
  if (!("mfaRequired" in r && r.mfaRequired)) await db.update(schema.adminUsers).set({ faceFailed: 0 }).where(eq(schema.adminUsers.id, c.st));
  return r;
}

/** Settings: opt in to face sign-in with a template made on this console. */
export async function enrollStaffFace(userId: string, templateB64: string) {
  const { parseTemplate, encryptTemplate } = await import("./services/faces");
  parseTemplate(templateB64);
  const db = await getDb();
  await db.update(schema.adminUsers).set({ faceTemplateEnc: encryptTemplate(templateB64), faceEnrolledAt: new Date(), faceFailed: 0 }).where(eq(schema.adminUsers.id, userId));
  await audit({ actorType: "admin", actorId: userId, action: "auth.face_enrolled" });
}

export async function removeStaffFace(userId: string, by: string) {
  const db = await getDb();
  await db.update(schema.adminUsers).set({ faceTemplateEnc: null, faceEnrolledAt: null, faceFailed: 0 }).where(eq(schema.adminUsers.id, userId));
  await audit({ actorType: "admin", actorId: by, action: "auth.face_removed", entityType: "admin_user", entityId: userId });
}
