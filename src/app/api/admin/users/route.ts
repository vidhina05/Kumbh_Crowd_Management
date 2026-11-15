import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createUser, listUsers } from "@/server/services/admin";
import { ROLES } from "@/shared/rbac";

export const GET = handler(async () => {
  await requireUser("users.manage");
  return json({ users: await listUsers() });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("users.manage");
  const input = await parseBody(
    req,
    z.object({ email: z.string().email().max(120), name: z.string().trim().min(2).max(80), role: z.enum(ROLES), password: z.string().min(12).max(200) }),
  );
  return json(await createUser(user, input), 201);
});
