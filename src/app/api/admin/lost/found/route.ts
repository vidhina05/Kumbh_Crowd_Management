import { z } from "zod";
import { assertSameOrigin, handler, json, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth";
import { createFoundCase } from "@/server/services/cases";

/** A volunteer found someone who is lost (no report yet): open a case so the family can be traced. */
export const POST = handler(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser("lost.update");
  const input = await parseBody(req, z.object({ description: z.string().trim().min(3).max(500), foundLocation: z.string().trim().min(2).max(200), age: z.number().int().min(0).max(120).optional(), name: z.string().trim().max(80).optional() }));
  return json(await createFoundCase(user, input), 201);
});
