import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { divertableBatches, targetOptions } from "@/server/services/diversions";
import { istDate } from "@/shared/time";

/** Step 1: batches at a ghat that haven't started. */
export const GET = handler(async (req: Request) => {
  await requireUser("diversions.create");
  const { ghat, day } = parseQuery(req.url, z.object({ ghat: z.string().max(40), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  return json({ batches: await divertableBatches(ghat, day ?? istDate()) });
});

/** Step 2: what each other ghat would look like with these batches. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  await requireUser("diversions.create");
  const { fromGhatId, slotIds } = await parseBody(req, z.object({ fromGhatId: z.string().max(40), slotIds: z.array(z.string().uuid()).max(12) }));
  return json(await targetOptions(fromGhatId, slotIds));
});
