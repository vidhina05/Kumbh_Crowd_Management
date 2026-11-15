import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createKiosk, listKiosks } from "@/server/services/admin";

export const GET = handler(async () => {
  await requireUser("kiosks.view");
  return json({ kiosks: await listKiosks() });
});

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("kiosks.manage");
  const input = await parseBody(
    req,
    z.object({ id: z.string().regex(/^K-\d{1,4}$/, "Use the form K-17"), name: z.string().trim().min(2).max(60), location: z.string().trim().min(2).max(120) }),
  );
  return json(await createKiosk(user, input), 201);
});
