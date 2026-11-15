import { handler, json, parseBody } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { createRegistration } from "@/server/services/registration";
import { registrationInput } from "@/shared/validation";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id) as { ph: string; k: string; c: string };
  const input = await parseBody(req, registrationInput);
  return json(await createRegistration(input, kiosk.id, claims.c), 201);
});
