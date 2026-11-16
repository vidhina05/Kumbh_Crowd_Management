/**
 * Browser replacement for src/server/db/index.ts, used only by the GitHub Pages build.
 * Same Postgres engine (PGlite = Postgres compiled to WebAssembly), same migrations and schema,
 * stored in this browser's IndexedDB. PGliteWorker elects one tab as leader, so a kiosk tab and an
 * admin tab open side by side share one database safely.
 */
import { drizzle } from "drizzle-orm/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import * as schema from "@/server/db/schema";
import { MIGRATIONS } from "./migrations.generated";

type DB = ReturnType<typeof drizzle<typeof schema>>;
type Raw = { exec: (sql: string) => Promise<unknown>; query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

let pending: Promise<{ db: DB; raw: Raw }> | null = null;

export const DEMO_DB_NAME = "idb://sangam-seva-demo";

async function create(): Promise<{ db: DB; raw: Raw }> {
  const workerUrl = new URL("./pg-worker.js", import.meta.url);
  const client = await PGliteWorker.create(new Worker(workerUrl, { type: "module", name: "sangam-db" }), { dataDir: DEMO_DB_NAME });
  const db = drizzle(client as never, { schema }) as unknown as DB;
  const raw: Raw = {
    exec: (s) => client.exec(s),
    query: async (s, p) => ({ rows: (await client.query(s, p)).rows as Record<string, unknown>[] }),
  };
  await migrate(raw);
  return { db, raw };
}

export async function getConn() {
  pending ??= create();
  return pending;
}

export async function getDb(): Promise<DB> {
  return (await getConn()).db;
}

export async function migrate(raw: Raw): Promise<string[]> {
  await raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await raw.query("SELECT name FROM schema_migrations")).rows.map((r) => String(r.name)));
  const applied: string[] = [];
  for (const [name, sqlText] of MIGRATIONS) {
    if (done.has(name)) continue;
    await raw.exec(`BEGIN;\n${sqlText}\nINSERT INTO schema_migrations (name) VALUES ('${name.replace(/'/g, "")}') ON CONFLICT DO NOTHING;\nCOMMIT;`);
    applied.push(name);
  }
  return applied;
}

export { schema };
