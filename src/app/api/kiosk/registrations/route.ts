import { HttpError, handler, json, parseBody } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { createRegistration } from "@/server/services/registration";
import { registrationInput } from "@/shared/validation";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id) as { ph: string; k: string; c?: string; ar?: string; a4?: string };
  if (!claims.c) throw new HttpError(401, "pilgrim_session", "Please verify your phone or Aadhaar again.");
  const input = await parseBody(req, registrationInput);
  return json(await createRegistration(input, kiosk.id, { c: claims.c, ar: claims.ar, a4: claims.a4 }), 201);
});
