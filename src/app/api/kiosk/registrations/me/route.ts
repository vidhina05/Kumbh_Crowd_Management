import { handler, json } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { findMyRegistration } from "@/server/services/registration";

export const GET = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id);
  return json(await findMyRegistration(claims.ph));
});
