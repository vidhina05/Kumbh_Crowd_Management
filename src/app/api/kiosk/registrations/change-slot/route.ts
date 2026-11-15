import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk, requirePilgrim } from "@/server/kioskAuth";
import { changeSlot } from "@/server/services/registration";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const claims = requirePilgrim(req, kiosk.id);
  const { slotId } = await parseBody(req, z.object({ slotId: z.string().uuid() }));
  return json(await changeSlot(claims.ph, slotId, kiosk.id));
});
