import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { askGemini } from "@/server/integrations/gemini";
import { assistantSnapshot } from "@/server/services/overview";
import { audit } from "@/server/audit";
import { integrations } from "@/server/env";
import { builtinAnswer } from "@/server/services/builtinAssistant";

export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("assistant.use");
  await rateLimit(`assistant:${user.id}`, 12, 60_000);
  const { question } = await parseBody(req, z.object({ question: z.string().trim().min(3).max(400) }));
  const snapshot = await assistantSnapshot();
  await audit({ actorType: "admin", actorId: user.id, action: "assistant.ask" });
  if (!integrations().assistant) {
    const b = await builtinAnswer(question);
    return json({ answer: b.answer, basedOn: snapshot.now, mode: "builtin" });
  }
  try {
    return json({ answer: await askGemini(question, snapshot), basedOn: snapshot.now, mode: "gemini" });
  } catch {
    const b = await builtinAnswer(question);
    return json({ answer: b.answer, basedOn: snapshot.now, mode: "builtin", note: "Gemini didn't answer, so this is a built-in answer." });
  }
});
