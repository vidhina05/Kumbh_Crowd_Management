import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { findByFace } from "@/server/services/faces";

/** "Find me by face" — only families who opted in; also needs the last 4 phone digits. */
export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const { template, last4 } = await parseBody(req, z.object({ template: z.string().min(100).max(8000), last4: z.string().regex(/^\d{4}$/) }));
  return json(await findByFace(kiosk.id, template, last4));
});
