import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { verifyAadhaarQr } from "@/server/services/aadhaar";

/** The kiosk scanned an Aadhaar Secure QR. The server decodes it and checks UIDAI's signature. */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  await rateLimit(`aadhaar:${kiosk.id}`, 20, 60_000);
  const { qr } = await parseBody(req, z.object({ qr: z.string().min(10).max(12000) }));
  return json(await verifyAadhaarQr(qr, kiosk.id));
});
