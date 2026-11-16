import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { batchPlan } from "@/server/services/diversions";
import { istDate } from "@/shared/time";

export const GET = handler(async (req: Request) => {
  await requireUser("batches.view");
  const { day } = parseQuery(req.url, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  return json(await batchPlan(day ?? istDate()));
});
