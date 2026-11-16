import { z } from "zod";
import QRCode from "qrcode";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { confirmMfaSetup, startMfaSetup } from "@/server/services/mfa";

/** Start: returns the secret and a QR code to scan with an authenticator app. */
export const GET = handler(async () => {
  const user = await requireUser(undefined, { allowMfaSetup: true });
  const { secret, uri } = await startMfaSetup(user.id);
  return json({ secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

/** Confirm with the first 6-digit code. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(undefined, { allowMfaSetup: true });
  const { code } = await parseBody(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  return json(await confirmMfaSetup(user.id, code));
});
