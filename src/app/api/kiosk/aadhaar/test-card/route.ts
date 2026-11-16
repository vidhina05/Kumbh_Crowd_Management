import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { testCard } from "@/server/services/aadhaar";

/** Staging/demo only (AADHAAR_ALLOW_TEST_CARDS=true): a signed test card to try the scanner. */
export const GET = handler(async (req: Request) => {
  await requireKiosk(req);
  const { n } = parseQuery(req.url, z.object({ n: z.coerce.number().int().min(0).max(10).default(0) }));
  return json(await testCard(n));
});
