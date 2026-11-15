import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Personal data (phone numbers, photos) is encrypted at rest with AES-256-GCM.
 * Lookups use a keyed HMAC, so the database never holds a plain or simply-hashed phone number.
 */
const key = () => Buffer.from(env().DATA_ENCRYPTION_KEY, "base64");
const hmacKey = () => Buffer.from(env().LOOKUP_HMAC_KEY, "base64");

export function encrypt(plain: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(".");
}

export function decryptToBuffer(token: string): Buffer {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
}

export function decrypt(token: string): string {
  return decryptToBuffer(token).toString("utf8");
}

export function lookupHash(value: string): string {
  return createHmac("sha256", hmacKey()).update(value).digest("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}

/** Short-lived signed token for a pilgrim's kiosk session (after phone verification). */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", Buffer.from(env().SESSION_SECRET, "base64")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", Buffer.from(env().SESSION_SECRET, "base64")).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
