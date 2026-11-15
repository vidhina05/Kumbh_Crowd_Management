import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { kioskHeartbeat } from "@/server/services/admin";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const { version } = await parseBody(req, z.object({ version: z.string().max(32).default("unknown") }));
  await kioskHeartbeat(kiosk.id, version);
  return json({ ok: true, serverTime: new Date().toISOString() });
});
