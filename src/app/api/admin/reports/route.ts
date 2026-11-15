import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { reports } from "@/server/services/overview";

export const GET = handler(async () => {
  await requireUser("reports.view");
  return json(await reports());
});
