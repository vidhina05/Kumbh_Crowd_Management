import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { textToSpeech } from "@/server/integrations/bhashini";
import { LANGUAGES } from "@/shared/languages";

const input = z.object({ text: z.string().trim().min(1).max(600), lang: z.enum(LANGUAGES.map((l) => l.bhashini) as [string, ...string[]]) });

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  rateLimit(`tts:${kiosk.id}`, 60, 60_000);
  const { text, lang } = await parseBody(req, input);
  return json({ audio: await textToSpeech(text, lang), format: "wav" });
});
