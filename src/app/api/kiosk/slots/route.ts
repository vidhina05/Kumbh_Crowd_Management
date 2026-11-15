import { z } from "zod";
import { badRequest, handler, json, parseQuery } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { listSlots } from "@/server/services/registration";
import { addDays, istDate } from "@/shared/time";

export const GET = handler(async (req: Request) => {
  await requireKiosk(req);
  const { day } = parseQuery(req.url, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  const today = istDate();
  const d = day ?? today;
  if (d < today || d > addDays(today, 7)) throw badRequest("Bookings are open for today and the next 7 days.");
  return json({ day: d, ghats: await listSlots(d) });
});
