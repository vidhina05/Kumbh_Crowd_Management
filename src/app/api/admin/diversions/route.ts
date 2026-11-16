import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createDiversion, listDiversions } from "@/server/services/diversions";

export const GET = handler(async () => {
  await requireUser("batches.view");
  return json({ diversions: await listDiversions() });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("diversions.create");
  const input = await parseBody(req, z.object({ fromGhatId: z.string().max(40), toGhatId: z.string().max(40), slotIds: z.array(z.string().uuid()).min(1).max(12), reason: z.string().trim().max(300).default("") }));
  return json(await createDiversion(input, user), 201);
});
