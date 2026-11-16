import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { caseMatches, searchForCase } from "@/server/services/faces";
import { photoDataUrl } from "@/shared/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("faces.search");
  return json({ matches: await caseMatches(zId.parse((await ctx.params).id)) });
});

/** Search registered, consenting families with a photo of a found person. Suggestions only. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("faces.search");
  const { template, photo } = await parseBody(req, z.object({ template: z.string().min(100).max(8000), photo: photoDataUrl.optional() }));
  return json({ matches: await searchForCase(zId.parse((await ctx.params).id), template, photo, user.id) });
});
