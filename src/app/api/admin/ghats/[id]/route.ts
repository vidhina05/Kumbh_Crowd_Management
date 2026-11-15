import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { updateGhatOccupancy } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Manual crowd entry by staff. Stored with source "manual", time and who entered it — never shown as sensor data. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("ghats.update");
  const id = z.string().regex(/^[a-z0-9-]{2,40}$/).parse((await ctx.params).id);
  const { occupancy } = await parseBody(req, z.object({ occupancy: z.number().int().min(0).max(5_000_000) }));
  return json(await updateGhatOccupancy(user, id, occupancy));
});
