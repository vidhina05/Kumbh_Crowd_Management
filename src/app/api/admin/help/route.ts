import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { listHelp } from "@/server/services/cases";
import { HELP_TYPES } from "@/shared/validation";

export const GET = handler(async (req: Request) => {
  await requireUser("help.view");
  const f = parseQuery(
    req.url,
    z.object({ status: z.enum(["active", "open", "assigned", "in_progress", "resolved", "cancelled"]).optional(), type: z.enum(HELP_TYPES).optional() }),
  );
  return json({ requests: await listHelp(f) });
});
