import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { verifyOtp } from "@/server/services/otp";
import { otpVerifyInput } from "@/shared/validation";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  await rateLimit(`otp-verify:${kiosk.id}`, 30, 60_000);
  const { challengeId, code } = await parseBody(req, otpVerifyInput);
  return json(await verifyOtp(challengeId, code, kiosk.id));
});
