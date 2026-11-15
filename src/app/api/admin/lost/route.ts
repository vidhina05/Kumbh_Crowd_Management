import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { listLost } from "@/server/services/cases";

export const GET = handler(async (req: Request) => {
  await requireUser("lost.view");
  const f = parseQuery(req.url, z.object({ status: z.enum(["active", "open", "searching", "found", "reunited", "closed"]).optional(), q: z.string().max(60).optional() }));
  return json({ cases: await listLost(f) });
});
