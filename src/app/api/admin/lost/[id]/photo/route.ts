import { handler, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { lostCasePhoto } from "@/server/services/cases";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser("lost.view");
  const bytes = await lostCasePhoto(user, zId.parse((await ctx.params).id));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, private", "Content-Disposition": "inline" },
  });
});
