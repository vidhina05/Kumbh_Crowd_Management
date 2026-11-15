import { handler, json, unauthorized } from "@/server/http";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { runRetention } from "@/server/services/admin";

/** Deletes personal data past its retention date. Called hourly by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export const GET = handler(async (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env().CRON_SECRET}`)) throw unauthorized("Not allowed.");
  return json(await runRetention());
});
