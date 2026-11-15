import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { setKioskActive } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("kiosks.manage");
  const id = z.string().regex(/^K-\d{1,4}$/).parse((await ctx.params).id);
  const { active } = await parseBody(req, z.object({ active: z.boolean() }));
  await setKioskActive(user, id, active);
  return json({ ok: true });
});
