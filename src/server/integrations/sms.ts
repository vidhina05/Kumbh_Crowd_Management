import "server-only";
import { env } from "../env";

/**
 * SMS sending. Only MSG91 is implemented (common Indian DLT-registered provider).
 * With SMS_PROVIDER=none nothing is sent: the kiosk shows that SMS isn't connected, and
 * (development only) OTP_DEV_MODE=true shows the code on screen, clearly labelled.
 */
export type SmsResult = { sent: true } | { sent: false; reason: "not_configured" | "provider_error" };

export async function sendOtpSms(phoneE164: string, code: string): Promise<SmsResult> {
  const e = env();
  if (e.SMS_PROVIDER === "none") return { sent: false, reason: "not_configured" };
  try {
    // MSG91 OTP API v5. The template (registered on DLT) must contain the ##OTP## variable.
    const res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: e.MSG91_AUTH_KEY! },
      body: JSON.stringify({ template_id: e.MSG91_TEMPLATE_ID, mobile: phoneE164.replace("+", ""), otp: code }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { sent: false, reason: "provider_error" };
    return { sent: true };
  } catch {
    return { sent: false, reason: "provider_error" };
  }
}
