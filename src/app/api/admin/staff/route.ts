import { handler, json, forbidden } from "@/server/http";
import { requireUser } from "@/server/auth";
import { staffDirectory } from "@/server/services/admin";
import { can } from "@/shared/rbac";

/** Names and roles of active staff, for "Assign to". */
export const GET = handler(async () => {
  const user = await requireUser();
  if (!can(user.role, "help.update") && !can(user.role, "lost.update")) throw forbidden();
  return json({ staff: await staffDirectory() });
});
