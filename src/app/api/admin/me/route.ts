import { handler, json } from "@/server/http";
import { requireUser } from "@/server/auth";
import { integrations } from "@/server/env";

export const GET = handler(async () => {
  const user = await requireUser();
  return json({ user, integrations: integrations() });
});
