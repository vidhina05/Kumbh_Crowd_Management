import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { sensorDetail, setSensorActive } from "@/server/services/sensors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("sensors.view");
  return json(await sensorDetail((await ctx.params).id));
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("sensors.manage");
  const { active } = await parseBody(req, z.object({ active: z.boolean() }));
  await setSensorActive((await ctx.params).id, active, user.id);
  return json({ ok: true });
});
