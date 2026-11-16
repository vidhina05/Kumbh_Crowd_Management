import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { startOtp } from "@/server/services/otp";
import { phoneInput } from "@/shared/validation";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  await rateLimit(`otp-start:${kiosk.id}`, 20, 60_000);
  const { phone } = await parseBody(req, phoneInput);
  return json(await startOtp(phone, kiosk.id));
});
