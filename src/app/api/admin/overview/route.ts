import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { overview } from "@/server/services/overview";

export const GET = handler(async () => {
  await requireUser("overview.view");
  return json(await overview());
});
