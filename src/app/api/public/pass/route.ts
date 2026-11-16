import { z } from "zod";
import { clientIp, handler, json, parseBody } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { findByPass } from "@/server/services/registration";
import { confirmDiversionForFamily } from "@/server/services/diversions";

/**
 * Pilgrim's own phone: look up a pass with the pass number + last 4 phone digits (both are on the printed pass
 * and in the SMS). Shows the latest slot, including any change made by the control room.
 */
export const POST = handler(async (req: Request) => {
  await rateLimit(`public-pass:${clientIp(req)}`, 20, 60_000);
  const { passCode, last4, confirm } = await parseBody(req, z.object({ passCode: z.string().trim().min(5).max(20), last4: z.string().regex(/^\d{4}$/), confirm: z.boolean().default(false) }));
  const r = await findByPass(passCode, last4);
  if (confirm && r.diversion && !r.diversion.confirmed) {
    await confirmDiversionForFamily(r.pass.familyId);
    r.diversion.confirmed = true;
  }
  const { familyId: _f, ...pass } = r.pass;
  return json({ pass: { ...pass, members: pass.members.map(({ bandId: _b, ...m }) => m) }, diversion: r.diversion });
});
