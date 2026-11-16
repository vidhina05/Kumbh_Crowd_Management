import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk, PILGRIM_TOKEN_MINUTES } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { findByPass } from "@/server/services/registration";
import { signToken } from "@/server/crypto";
import { audit } from "@/server/audit";

/** Scan the pass QR (or type the pass number) + last 4 phone digits. */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  await rateLimit(`find-pass:${kiosk.id}`, 20, 60_000);
  const { passCode, last4 } = await parseBody(req, z.object({ passCode: z.string().trim().min(5).max(20), last4: z.string().regex(/^\d{4}$/) }));
  const r = await findByPass(passCode, last4);
  await audit({ actorType: "kiosk", actorId: kiosk.id, action: "find.pass", entityType: "family", entityId: r.pass.familyId });
  return json({ pilgrimToken: signToken({ ph: r.phoneHash, k: kiosk.id, f: r.pass.familyId }, PILGRIM_TOKEN_MINUTES * 60) });
});
