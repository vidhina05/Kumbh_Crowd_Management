import "server-only";
import { asc, desc, eq, lt, and, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { randomToken, sha256 } from "../crypto";
import { HttpError, badRequest, conflict, notFound } from "../http";
import { audit } from "../audit";
import { hashPassword, passwordProblems, type AdminUser } from "../auth";
import type { Role } from "@/shared/rbac";
import { env } from "../env";

// ---------- Ghats (manual crowd entry) ----------
export async function updateGhatOccupancy(user: AdminUser, id: string, occupancy: number) {
  const db = await getDb();
  const [g] = await db.select().from(schema.ghats).where(eq(schema.ghats.id, id));
  if (!g) throw notFound();
  if (occupancy > g.capacity * 2) throw badRequest("That number is more than twice the ghat's capacity. Please check it.");
  const [row] = await db
    .update(schema.ghats)
    .set({ occupancy, occupancySource: "manual", occupancyUpdatedAt: new Date(), occupancyUpdatedBy: user.id })
    .where(eq(schema.ghats.id, id))
    .returning();
  await audit({ actorType: "admin", actorId: user.id, action: "ghat.occupancy", entityType: "ghat", entityId: id, details: { from: g.occupancy, to: occupancy } });
  return row;
}

// ---------- Alerts ----------
export async function listAlerts(status?: "active" | "resolved") {
  const db = await getDb();
  return db
    .select({ a: schema.alerts, by: schema.adminUsers.name })
    .from(schema.alerts)
    .leftJoin(schema.adminUsers, eq(schema.alerts.createdBy, schema.adminUsers.id))
    .where(status ? eq(schema.alerts.status, status) : undefined)
    .orderBy(desc(schema.alerts.createdAt))
    .limit(100)
    .then((rows) => rows.map((r) => ({ ...r.a, createdByName: r.by })));
}

export async function createAlert(user: AdminUser, input: { severity: string; title: string; message: string; ghatId?: string | null; audience: string }) {
  const db = await getDb();
  if (input.ghatId) {
    const [g] = await db.select({ id: schema.ghats.id }).from(schema.ghats).where(eq(schema.ghats.id, input.ghatId));
    if (!g) throw badRequest("Unknown ghat.");
  }
  const [row] = await db
    .insert(schema.alerts)
    .values({ severity: input.severity, title: input.title, message: input.message, ghatId: input.ghatId ?? null, audience: input.audience, createdBy: user.id })
    .returning();
  await audit({ actorType: "admin", actorId: user.id, action: "alert.create", entityType: "alert", entityId: row.id, details: { severity: input.severity, audience: input.audience } });
  return row;
}

export async function resolveAlert(user: AdminUser, id: string) {
  const db = await getDb();
  const [row] = await db
    .update(schema.alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: user.id })
    .where(and(eq(schema.alerts.id, id), eq(schema.alerts.status, "active")))
    .returning();
  if (!row) throw notFound("That alert is not active.");
  await audit({ actorType: "admin", actorId: user.id, action: "alert.resolve", entityType: "alert", entityId: id });
  return row;
}

/** Alerts a kiosk may show to pilgrims. */
export async function kioskAlerts() {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.alerts.id, severity: schema.alerts.severity, title: schema.alerts.title, message: schema.alerts.message, ghatId: schema.alerts.ghatId, audience: schema.alerts.audience })
    .from(schema.alerts)
    .where(eq(schema.alerts.status, "active"))
    .orderBy(desc(schema.alerts.createdAt));
  return rows.filter((a) => a.audience !== "staff").map(({ audience: _a, ...rest }) => rest);
}

// ---------- Kiosks ----------
export async function listKiosks() {
  const db = await getDb();
  const ks = await db.select().from(schema.kiosks).orderBy(asc(schema.kiosks.id));
  const counts = await db
    .select({ kiosk: schema.families.kioskId, n: sql<number>`count(*)::int` })
    .from(schema.families)
    .where(sql`${schema.families.createdAt} > now() - interval '24 hours'`)
    .groupBy(schema.families.kioskId);
  return ks.map(({ tokenHash: _t, ...k }) => ({
    ...k,
    online: Boolean(k.active && k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < 90_000),
    registrations24h: counts.find((c) => c.kiosk === k.id)?.n ?? 0,
  }));
}

/** Creates a kiosk and returns its device token ONCE. Only the hash is stored. */
export async function createKiosk(user: AdminUser, input: { id: string; name: string; location: string }) {
  const db = await getDb();
  const token = randomToken(32);
  try {
    await db.insert(schema.kiosks).values({ id: input.id, name: input.name, location: input.location, tokenHash: sha256(token) });
  } catch {
    throw conflict("A kiosk with that ID already exists.");
  }
  await audit({ actorType: "admin", actorId: user.id, action: "kiosk.create", entityType: "kiosk", entityId: input.id });
  return { id: input.id, token };
}

export async function rotateKioskToken(user: AdminUser, id: string) {
  const db = await getDb();
  const token = randomToken(32);
  const [row] = await db.update(schema.kiosks).set({ tokenHash: sha256(token) }).where(eq(schema.kiosks.id, id)).returning({ id: schema.kiosks.id });
  if (!row) throw notFound();
  await audit({ actorType: "admin", actorId: user.id, action: "kiosk.rotate_token", entityType: "kiosk", entityId: id });
  return { id, token };
}

export async function setKioskActive(user: AdminUser, id: string, active: boolean) {
  const db = await getDb();
  const [row] = await db.update(schema.kiosks).set({ active }).where(eq(schema.kiosks.id, id)).returning({ id: schema.kiosks.id });
  if (!row) throw notFound();
  await audit({ actorType: "admin", actorId: user.id, action: active ? "kiosk.enable" : "kiosk.disable", entityType: "kiosk", entityId: id });
}

export async function kioskHeartbeat(id: string, version: string) {
  const db = await getDb();
  await db.update(schema.kiosks).set({ lastSeenAt: new Date(), lastSeenVersion: version.slice(0, 32) }).where(eq(schema.kiosks.id, id));
}

// ---------- Users ----------
export async function listUsers() {
  const db = await getDb();
  const rows = await db.select().from(schema.adminUsers).orderBy(asc(schema.adminUsers.name));
  return rows.map(({ passwordHash: _p, ...u }) => u);
}

export async function staffDirectory() {
  const db = await getDb();
  return db
    .select({ id: schema.adminUsers.id, name: schema.adminUsers.name, role: schema.adminUsers.role })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.active, true))
    .orderBy(asc(schema.adminUsers.name));
}

export async function createUser(actor: AdminUser, input: { email: string; name: string; role: Role; password: string }) {
  const problem = passwordProblems(input.password);
  if (problem) throw badRequest(problem, { field: "password" });
  const db = await getDb();
  try {
    const [u] = await db
      .insert(schema.adminUsers)
      .values({ email: input.email.toLowerCase(), name: input.name, role: input.role, passwordHash: await hashPassword(input.password) })
      .returning({ id: schema.adminUsers.id });
    await audit({ actorType: "admin", actorId: actor.id, action: "user.create", entityType: "user", entityId: u.id, details: { role: input.role } });
    return u;
  } catch {
    throw conflict("Someone already uses that email.");
  }
}

export async function updateUser(actor: AdminUser, id: string, patch: { role?: Role; active?: boolean; password?: string }) {
  const db = await getDb();
  if (id === actor.id && (patch.active === false || (patch.role && patch.role !== "super_admin"))) {
    throw new HttpError(409, "self_lockout", "You can't remove your own super admin access. Ask another super admin.");
  }
  const set: Partial<typeof schema.adminUsers.$inferInsert> = {};
  if (patch.role) set.role = patch.role;
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.password) {
    const problem = passwordProblems(patch.password);
    if (problem) throw badRequest(problem, { field: "password" });
    set.passwordHash = await hashPassword(patch.password);
    set.failedLogins = 0;
    set.lockedUntil = null;
  }
  const [u] = await db.update(schema.adminUsers).set(set).where(eq(schema.adminUsers.id, id)).returning({ id: schema.adminUsers.id });
  if (!u) throw notFound();
  // Role change, deactivation or password reset ends their sessions.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
  await audit({ actorType: "admin", actorId: actor.id, action: "user.update", entityType: "user", entityId: id, details: { role: patch.role, active: patch.active, passwordReset: Boolean(patch.password) } });
}

// ---------- Audit ----------
export async function listAudit(limit = 200) {
  const db = await getDb();
  return db
    .select({ a: schema.auditLog, name: schema.adminUsers.name })
    .from(schema.auditLog)
    .leftJoin(schema.adminUsers, sql`${schema.auditLog.actorType} = 'admin' and ${schema.auditLog.actorId} = ${schema.adminUsers.id}::text`)
    .orderBy(desc(schema.auditLog.id))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ ...r.a, actorName: r.name })));
}

// ---------- Retention (DPDP: keep personal data only as long as needed) ----------
export async function runRetention() {
  const db = await getDb();
  const now = new Date();
  const families = await db.delete(schema.families).where(lt(schema.families.deleteAfter, now)).returning({ id: schema.families.id });
  const cutoff = new Date(now.getTime() - env().RETENTION_HOURS * 3600_000);
  const lost = await db
    .update(schema.lostCases)
    .set({ reporterPhoneEnc: null, reporterName: "", description: "", personName: "(removed)" })
    .where(and(lt(schema.lostCases.closedAt, cutoff), isNotNull(schema.lostCases.closedAt), sql`${schema.lostCases.personName} <> '(removed)'`))
    .returning({ id: schema.lostCases.id });
  const help = await db
    .update(schema.helpRequests)
    .set({ description: "", location: "" })
    .where(and(inArray(schema.helpRequests.status, ["resolved", "cancelled"]), lt(schema.helpRequests.updatedAt, cutoff), sql`${schema.helpRequests.description} <> ''`))
    .returning({ id: schema.helpRequests.id });
  const otps = await db.delete(schema.otpChallenges).where(lt(schema.otpChallenges.createdAt, new Date(now.getTime() - 24 * 3600_000))).returning({ id: schema.otpChallenges.id });
  const sessions = await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).returning({ id: schema.sessions.id });
  const result = { familiesDeleted: families.length, lostCasesAnonymised: lost.length, helpRequestsCleared: help.length, otpChallengesDeleted: otps.length, sessionsDeleted: sessions.length };
  await audit({ actorType: "system", action: "retention.run", details: result });
  return result;
}
