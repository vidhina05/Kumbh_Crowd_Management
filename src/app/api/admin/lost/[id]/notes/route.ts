import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { addNote, listNotes } from "@/server/services/cases";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  await requireUser("lost.view");
  return json({ notes: await listNotes("lost", zId.parse((await ctx.params).id)) });
});

export const POST = handler(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const user = await requireUser("lost.update");
  const { note } = await parseBody(req, z.object({ note: z.string().trim().min(1).max(1000) }));
  return json(await addNote(user, "lost", zId.parse((await ctx.params).id), note), 201);
});
