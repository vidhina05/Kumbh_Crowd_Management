import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { createHelpRequest } from "@/server/services/cases";
import { helpInput } from "@/shared/validation";

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  const input = await parseBody(req, helpInput);
  return json(await createHelpRequest(input, kiosk), 201);
});
