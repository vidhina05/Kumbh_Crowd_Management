import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt, randomBytesArray } from "../crypto";
import { HttpError, badRequest, conflict } from "../http";
import { audit } from "../audit";
import { base32Encode, otpauthUri, verifyTotp } from "@/shared/totp";

/** Staff two-step sign-in with an authenticator app (TOTP). The secret is stored encrypted. */
export async function startMfaSetup(userId: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId));
  if (u.mfaEnabled) throw conflict("Two-step sign-in is already on.");
  const secret = base32Encode(randomBytesArray(20));
  await db.update(schema.adminUsers).set({ mfaSecretEnc: encrypt(secret) }).where(eq(schema.adminUsers.id, userId));
  return { secret, uri: otpauthUri(secret, u.email) };
}

export async function confirmMfaSetup(userId: string, code: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId));
  if (!u.mfaSecretEnc) throw badRequest("Start the setup first.");
  const step = verifyTotp(decrypt(u.mfaSecretEnc), code);
  if (step === null) throw new HttpError(400, "mfa_wrong", "That code is not right. Check the time on your phone and try again.");
  await db.update(schema.adminUsers).set({ mfaEnabled: true, mfaLastStep: step }).where(eq(schema.adminUsers.id, userId));
  await audit({ actorType: "admin", actorId: userId, action: "mfa.enable" });
  return { enabled: true };
}

export async function disableMfa(targetUserId: string, by: string) {
  const db = await getDb();
  await db.update(schema.adminUsers).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: 0 }).where(eq(schema.adminUsers.id, targetUserId));
  await audit({ actorType: "admin", actorId: by, action: "mfa.disable", entityType: "admin_user", entityId: targetUserId });
}

/** Checks a code and blocks reusing the same code twice (replay). */
export async function verifyTotpForUser(userId: string, code: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId));
  if (!u?.mfaEnabled || !u.mfaSecretEnc) return true;
  const step = verifyTotp(decrypt(u.mfaSecretEnc), code.trim());
  if (step === null || step <= u.mfaLastStep) {
    await audit({ actorType: "admin", actorId: userId, action: "mfa.failed" });
    throw new HttpError(401, "mfa_wrong", "That 6-digit code is not right, or it was already used. Wait for a new code.");
  }
  await db.update(schema.adminUsers).set({ mfaLastStep: step }).where(eq(schema.adminUsers.id, userId));
  return true;
}
