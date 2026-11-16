import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { env, integrations } from "@/server/env";
import { aadhaarStatus } from "@/server/services/aadhaar";

/** Integration status for the Settings page. Booleans and non-secret names only — never key values. */
export const GET = handler(async () => {
  const user = await requireUser(undefined, { allowMfaSetup: true });
  const e = env();
  const i = integrations();
  const aadhaar = await aadhaarStatus();
  return json({
    me: user,
    integrations: [
      { id: "sms", name: "SMS (MSG91)", connected: i.sms, detail: i.sms ? "Phone codes and messages are sent." : i.otpDevMode ? "Not connected — codes are shown on screen (demo/development only)." : "Not connected — phone codes can't be sent." },
      { id: "voice", name: "Voice in 22 languages (Bhashini)", connected: i.voice, detail: i.voice ? "Speech-to-text and read-aloud through Bhashini." : "Not connected — kiosks use the browser's own voices where available." },
      { id: "assistant", name: "Sahayak AI (Gemini)", connected: i.assistant, detail: i.assistant ? `Model ${e.GEMINI_MODEL}.` : "Not connected — Sahayak gives built-in answers calculated from live data, without AI." },
      { id: "aadhaar", name: "Aadhaar Secure QR", connected: aadhaar.uidai, detail: aadhaar.uidai ? "Card signatures are checked against UIDAI's certificate." : aadhaar.testCards ? "Only test cards are accepted (UIDAI certificate not added)." : "Off — add UIDAI's certificate to verify cards." },
      { id: "faces", name: "Face matching (on-device)", connected: true, detail: "Runs on the kiosk/console; only for families who opt in. No cloud service." },
      { id: "sensors", name: "Crowd sensors", connected: true, detail: i.simulator ? "Real sensors post to /api/sensors/ingest. The training simulator is ON — its numbers are labelled Simulated." : "Real sensors post to /api/sensors/ingest." },
      { id: "ratelimit", name: "Shared rate limits (Redis)", connected: Boolean(e.UPSTASH_REDIS_REST_URL), detail: e.UPSTASH_REDIS_REST_URL ? "Upstash Redis." : "In-memory per server (fine for one server)." },
    ],
    retentionHours: e.RETENTION_HOURS,
    mfaRequiredRoles: e.MFA_REQUIRED_ROLES.split(",").map((r) => r.trim()).filter(Boolean),
    demo: i.demo,
  });
});
