import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { listAudit } from "@/server/services/admin";

export const GET = handler(async () => {
  await requireUser("audit.view");
  return json({ entries: await listAudit(300) });
});
