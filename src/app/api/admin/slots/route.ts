import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { listSlots } from "@/server/services/registration";
import { istDate } from "@/shared/time";

export const GET = handler(async (req: Request) => {
  await requireUser("overview.view");
  const { day } = parseQuery(req.url, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  const d = day ?? istDate();
  return json({ day: d, ghats: await listSlots(d) });
});
