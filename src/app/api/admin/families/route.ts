import { z } from "zod";
import { handler, json, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth";
import { searchFamilies } from "@/server/services/overview";

export const GET = handler(async (req: Request) => {
  await requireUser("families.view");
  const { q } = parseQuery(req.url, z.object({ q: z.string().max(60).default("") }));
  return json({ families: await searchFamilies(q) });
});
