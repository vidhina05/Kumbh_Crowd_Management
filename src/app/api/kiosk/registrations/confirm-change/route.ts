import { handler, json } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { findMyRegistration } from "@/server/services/registration";
import { confirmDiversionForFamily } from "@/server/services/diversions";

/** The family saw that their batch moved ghat ("I've seen the change"). */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id);
  const pass = await findMyRegistration(claims.ph);
  await confirmDiversionForFamily(pass.familyId);
  return json({ ok: true });
});
