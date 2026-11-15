import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt, lookupHash, randomDigits, signToken } from "../crypto";
import { HttpError, badRequest, tooMany, unavailable } from "../http";
import { sendOtpSms } from "../integrations/sms";
import { env } from "../env";
import { PILGRIM_TOKEN_MINUTES } from "../kioskAuth";

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_10_MIN = 3;

/** Indian mobile numbers only: 10 digits starting 6–9, with optional +91 / 0 prefix. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) throw badRequest("Enter a 10-digit mobile number.", { field: "phone" });
  return `+91${digits}`;
}

export async function startOtp(phoneInput: string, kioskId: string) {
  const phone = normalisePhone(phoneInput);
  const phoneHash = lookupHash(phone);
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.otpChallenges)
    .where(and(eq(schema.otpChallenges.phoneHash, phoneHash), gt(schema.otpChallenges.createdAt, new Date(Date.now() - 10 * 60_000))));
  if (n >= MAX_SENDS_PER_10_MIN) throw tooMany("We already sent 3 codes to this number. Please wait 10 minutes, or ask a volunteer.");

  const e = env();
  const devMode = e.OTP_DEV_MODE === "true";
  if (e.SMS_PROVIDER === "none" && !devMode) {
    throw unavailable("sms_not_configured", "We can't send phone codes right now. A volunteer can register you.");
  }

  const code = randomDigits(4);
  const [row] = await db
    .insert(schema.otpChallenges)
    .values({ phoneHash, phoneEnc: encrypt(phone), codeHash: "pending", kioskId, expiresAt: new Date(Date.now() + OTP_TTL_MS) })
    .returning({ id: schema.otpChallenges.id });
  await db.update(schema.otpChallenges).set({ codeHash: lookupHash(`${row.id}:${code}`) }).where(eq(schema.otpChallenges.id, row.id));

  const sms = await sendOtpSms(phone, code);
  return {
    challengeId: row.id,
    phoneLast4: phone.slice(-4),
    sms: sms.sent ? "sent" : sms.reason,
    // Development only: shown on screen with a "SMS not connected" label. Refused in production by env().
    devCode: devMode && !sms.sent ? code : undefined,
  } as const;
}

export async function verifyOtp(challengeId: string, code: string, kioskId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.otpChallenges).where(eq(schema.otpChallenges.id, challengeId));
  if (!c || c.consumedAt || c.kioskId !== kioskId) throw new HttpError(400, "otp_invalid", "That code has expired. Please ask for a new one.");
  if (c.expiresAt < new Date()) throw new HttpError(400, "otp_expired", "That code has expired. Please ask for a new one.");
  if (c.attempts >= MAX_ATTEMPTS) throw new HttpError(400, "otp_locked", "Too many wrong codes. Please ask for a new one.");
  if (lookupHash(`${c.id}:${code}`) !== c.codeHash) {
    await db.update(schema.otpChallenges).set({ attempts: c.attempts + 1 }).where(eq(schema.otpChallenges.id, c.id));
    const left = MAX_ATTEMPTS - c.attempts - 1;
    throw new HttpError(400, "otp_wrong", `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`, { triesLeft: left });
  }
  await db.update(schema.otpChallenges).set({ consumedAt: new Date() }).where(eq(schema.otpChallenges.id, c.id));
  const phone = decrypt(c.phoneEnc);
  const token = signToken({ ph: c.phoneHash, k: kioskId, c: c.id }, PILGRIM_TOKEN_MINUTES * 60);
  return { pilgrimToken: token, phoneLast4: phone.slice(-4), expiresInMinutes: PILGRIM_TOKEN_MINUTES };
}

/** The encrypted phone for a verified pilgrim session (used to create the registration). */
export async function phoneForChallenge(challengeId: string): Promise<{ phoneEnc: string; phoneHash: string; last4: string }> {
  const db = await getDb();
  const [c] = await db.select().from(schema.otpChallenges).where(eq(schema.otpChallenges.id, challengeId));
  if (!c || !c.consumedAt) throw new HttpError(401, "pilgrim_session", "Your session ended. Please verify your phone again.");
  return { phoneEnc: c.phoneEnc, phoneHash: c.phoneHash, last4: decrypt(c.phoneEnc).slice(-4) };
}
