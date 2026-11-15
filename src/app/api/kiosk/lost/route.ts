import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { verifyToken } from "@/server/crypto";
import { createLostCase } from "@/server/services/cases";
import { lostInput } from "@/shared/validation";

/** Reporting a missing person never requires phone verification — speed matters more. If the reporter did verify, we link their family. */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const input = await parseBody(req, lostInput);
  const claims = verifyToken<{ ph: string; k: string }>(req.headers.get("x-pilgrim-token"));
  const phoneHash = claims && claims.k === kiosk.id ? claims.ph : undefined;
  return json(await createLostCase(input, kiosk, phoneHash), 201);
});
