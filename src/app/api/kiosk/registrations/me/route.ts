import { handler, json } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { findMyRegistration, pendingDiversion } from "@/server/services/registration";

export const GET = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id);
  const pass = await findMyRegistration(claims.ph);
  return json({ ...pass, diversion: await pendingDiversion(pass.familyId) });
});
