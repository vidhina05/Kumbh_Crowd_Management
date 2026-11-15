import { z } from "zod";
import { handler, json, parseBody } from "@/server/http";
import { requireKiosk } from "@/server/kioskAuth";
import { rateLimit } from "@/server/ratelimit";
import { speechToText } from "@/server/integrations/bhashini";
import { LANGUAGES } from "@/shared/languages";

// ≤ ~20 s of 16 kHz mono 16-bit WAV, base64-encoded. Audio is processed and discarded, never stored.
const input = z.object({ audio: z.string().max(1_000_000).regex(/^[A-Za-z0-9+/=]+$/), lang: z.enum(LANGUAGES.map((l) => l.bhashini) as [string, ...string[]]) });

export const POST = handler(async (req: Request) => {
  const kiosk = await requireKiosk(req);
  rateLimit(`asr:${kiosk.id}`, 30, 60_000);
  const { audio, lang } = await parseBody(req, input);
  return json({ text: await speechToText(audio, lang) });
});
