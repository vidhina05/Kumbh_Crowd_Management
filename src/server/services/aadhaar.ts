import "server-only";
import { getDb, schema } from "../db";
import { encrypt, lookupHash, signToken } from "../crypto";
import { HttpError, unavailable } from "../http";
import { env } from "../env";
import { audit } from "../audit";
import { AadhaarQrError, ageFromYear, importAadhaarKey, makeTestCardQr, parseAadhaarQr, verifyAadhaarSignature } from "@/shared/aadhaar";
import { PILGRIM_TOKEN_MINUTES } from "../kioskAuth";
import { normalisePhone } from "./otp";

/**
 * Aadhaar Secure QR at the kiosk.
 * - The signature is checked against UIDAI's public certificate (AADHAAR_UIDAI_CERT_PEM).
 * - Test cards (signed with a local test key) are accepted only when AADHAAR_ALLOW_TEST_CARDS=true,
 *   and are always shown as "Test card".
 * - We store only a keyed hash of the reference id, the last 4 digits, the name, age and gender.
 */
type Keys = { uidai: CryptoKey | null; test: { publicKey: CryptoKey; privateKey: CryptoKey } | null };
let keys: Promise<Keys> | null = null;

async function loadKeys(): Promise<Keys> {
  const e = env();
  let uidai: CryptoKey | null = null;
  if (e.AADHAAR_UIDAI_CERT_PEM) {
    try {
      uidai = await importAadhaarKey(e.AADHAAR_UIDAI_CERT_PEM.replace(/\\n/g, "\n"));
    } catch {
      console.error("[aadhaar] AADHAAR_UIDAI_CERT_PEM could not be read — Aadhaar QR verification is off");
    }
  }
  let test: Keys["test"] = null;
  if (e.AADHAAR_ALLOW_TEST_CARDS === "true") {
    test = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    )) as { publicKey: CryptoKey; privateKey: CryptoKey };
  }
  return { uidai, test };
}

export async function aadhaarStatus() {
  keys ??= loadKeys();
  const k = await keys;
  return { uidai: Boolean(k.uidai), testCards: Boolean(k.test) };
}

export async function verifyAadhaarQr(qrText: string, kioskId: string) {
  keys ??= loadKeys();
  const k = await keys;
  if (!k.uidai && !k.test) throw unavailable("aadhaar_not_configured", "Aadhaar scanning is not set up on this kiosk yet. Please use your phone number.");
  let qr;
  try {
    qr = await parseAadhaarQr(qrText);
  } catch (e) {
    if (e instanceof AadhaarQrError) throw new HttpError(400, `aadhaar_${e.code}`, e.message);
    throw e;
  }
  let verifiedBy: "uidai" | "test" | "unchecked" | null = null;
  if (k.uidai && (await verifyAadhaarSignature(qr, k.uidai))) verifiedBy = "uidai";
  else if (k.test && (await verifyAadhaarSignature(qr, k.test.publicKey))) verifiedBy = "test";
  // In-browser demo only (no UIDAI certificate can be bundled there): a real card that decodes correctly is accepted
  // and clearly labelled "signature not checked". A real deployment never takes this branch: DEMO_MODE can't be set
  // on a server (env.ts refuses to start), so without AADHAAR_UIDAI_CERT_PEM real cards are refused.
  else if (!k.uidai && env().DEMO_MODE === "true") verifiedBy = "unchecked";
  if (!verifiedBy) {
    await audit({ actorType: "kiosk", actorId: kioskId, action: "aadhaar.signature_failed" });
    throw new HttpError(400, "aadhaar_signature", "This card's QR code could not be verified. Please use your phone number, or ask a volunteer.");
  }
  const refHash = lookupHash(`aadhaar:${qr.referenceId}`);
  const token = signToken({ ar: refHash, k: kioskId, a4: qr.last4 }, PILGRIM_TOKEN_MINUTES * 60);
  await audit({ actorType: "kiosk", actorId: kioskId, action: "aadhaar.verified", details: { by: verifiedBy, version: qr.version } });
  return {
    aadhaarToken: token,
    verifiedBy,
    person: { name: qr.name, age: ageFromYear(qr.yearOfBirth), gender: qr.gender, last4: qr.last4, state: qr.state },
  };
}

/**
 * After an Aadhaar check, the family still gives a phone number for the SMS pass. It isn't verified by
 * a code (identity was verified by the card), so it's stored with phone_verified = false.
 */
export async function attachPhoneToAadhaar(claims: { ar: string; a4: string; k: string }, phoneInput: string) {
  const phone = normalisePhone(phoneInput);
  const db = await getDb();
  const [c] = await db
    .insert(schema.otpChallenges)
    .values({ phoneHash: lookupHash(phone), phoneEnc: encrypt(phone), codeHash: "aadhaar", kioskId: claims.k, expiresAt: new Date(Date.now() + 30 * 60_000), consumedAt: new Date() })
    .returning({ id: schema.otpChallenges.id });
  const pilgrimToken = signToken({ ph: lookupHash(phone), k: claims.k, c: c.id, ar: claims.ar, a4: claims.a4 }, PILGRIM_TOKEN_MINUTES * 60);
  return { pilgrimToken, phoneLast4: phone.slice(-4) };
}

/** Staging/demo only: a signed test card for trying the scanner without a real Aadhaar. */
export async function testCard(variant: number) {
  keys ??= loadKeys();
  const k = await keys;
  if (!k.test) throw unavailable("test_cards_off", "Test cards are switched off on this server.");
  const people = [
    { name: "Ramesh Sharma", dob: "12-03-1972", gender: "M" as const, last4: "7731", state: "Uttar Pradesh", district: "Varanasi", pincode: "221001" },
    { name: "Sunita Verma", dob: "04-11-1985", gender: "F" as const, last4: "4208", state: "Madhya Pradesh", district: "Indore", pincode: "452001" },
    { name: "Mohan Lal Yadav", dob: "1951", gender: "M" as const, last4: "1186", state: "Bihar", district: "Patna", pincode: "800001" },
  ];
  const p = people[Math.abs(variant) % people.length];
  return { qr: await makeTestCardQr(k.test.privateKey, p), label: `Test card · ${p.name}` };
}
