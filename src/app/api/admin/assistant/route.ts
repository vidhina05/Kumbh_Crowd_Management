import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { askGemini } from "@/server/integrations/gemini";
import { assistantSnapshot } from "@/server/services/overview";
import { audit } from "@/server/audit";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("assistant.use");
  rateLimit(`assistant:${user.id}`, 12, 60_000);
  const { question } = await parseBody(req, z.object({ question: z.string().trim().min(3).max(400) }));
  const snapshot = await assistantSnapshot();
  const answer = await askGemini(question, snapshot);
  await audit({ actorType: "admin", actorId: user.id, action: "assistant.ask" });
  return json({ answer, basedOn: snapshot.now });
});
