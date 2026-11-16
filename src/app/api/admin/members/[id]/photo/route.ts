import { handler, zId } from "@/server/http";
import { requireUser } from "@/server/auth";
import { memberPhoto } from "@/server/services/faces";

type Ctx = { params: Promise<{ id: string }> };

/** A face-match candidate's photo, for staff to compare by eye. Every view is logged. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser("faces.search");
  const bytes = await memberPhoto(zId.parse((await ctx.params).id), user.id);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, private" } });
});
