import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { enrollStaffFace, removeStaffFace, requireUser } from "@/server/auth";

/** Opt in to face sign-in: a template made on this console from a live camera frame (never an image). */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(undefined, { allowMfaSetup: true });
  const { template } = await parseBody(req, z.object({ template: z.string().min(100).max(8000) }));
  await enrollStaffFace(user.id, template);
  return json({ ok: true });
});

export const DELETE = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser(undefined, { allowMfaSetup: true });
  await removeStaffFace(user.id, user.id);
  return json({ ok: true });
});
