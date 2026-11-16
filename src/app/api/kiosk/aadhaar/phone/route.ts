import { handler, json, parseBody } from "@/server/http";
import { requireAadhaar, requireKiosk } from "@/server/kioskAuth";
import { attachPhoneToAadhaar } from "@/server/services/aadhaar";
import { phoneInput } from "@/shared/validation";

/** After an Aadhaar check: the phone number for the SMS pass (not code-verified; identity came from the card). */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requireAadhaar(req, kiosk.id);
  const { phone } = await parseBody(req, phoneInput);
  return json(await attachPhoneToAadhaar(claims, phone));
});
