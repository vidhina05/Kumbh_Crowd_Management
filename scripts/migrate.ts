/**
 * Applies migrations/*.sql in order. Safe to run on every deploy (already-applied files are skipped).
 *   npm run db:migrate
 */
import { getConn, migrate } from "../src/server/db";

async function main() {
  const { raw } = await getConn();
  const applied = await migrate(raw);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
