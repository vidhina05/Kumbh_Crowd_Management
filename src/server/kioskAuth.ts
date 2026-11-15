import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { safeEqual, sha256, verifyToken } from "./crypto";
import { HttpError, unauthorized } from "./http";
import { rateLimit } from "./ratelimit";

/**
 * Every kiosk is provisioned by a super admin, who gets a one-time device token.
 * The kiosk sends it on each request (X-Kiosk-Id + X-Kiosk-Token). Only its hash is stored.
 * A kiosk token can NEVER reach admin endpoints — those need an admin session cookie.
 */
export async function requireKiosk(req: Request) {
  const id = req.headers.get("x-kiosk-id") ?? "";
  const token = req.headers.get("x-kiosk-token") ?? "";
  if (!id || !token || id.length > 32 || token.length > 128) throw unauthorized("This kiosk is not set up. Ask staff to set it up.");
  rateLimit(`kiosk:${id}`, 240, 60_000);
  const db = await getDb();
  const [k] = await db.select().from(schema.kiosks).where(eq(schema.kiosks.id, id));
  if (!k || !k.active || !safeEqual(k.tokenHash, sha256(token))) throw unauthorized("This kiosk is not set up. Ask staff to set it up.");
  return k;
}

export type PilgrimClaims = { ph: string; k: string }; // phone lookup hash, kiosk id

export const PILGRIM_TOKEN_MINUTES = 20;

export function requirePilgrim(req: Request, kioskId: string): PilgrimClaims {
  const claims = verifyToken<PilgrimClaims>(req.headers.get("x-pilgrim-token"));
  if (!claims || claims.k !== kioskId) throw new HttpError(401, "pilgrim_session", "Your session ended. Please verify your phone again.");
  return claims;
}
