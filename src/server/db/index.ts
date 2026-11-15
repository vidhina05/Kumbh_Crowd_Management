import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { env } from "../env";

/**
 * Database access.
 * - Production / staging: any Postgres (Neon, Supabase, RDS…) via DATABASE_URL.
 * - Local development and tests: an embedded Postgres (PGlite) — no install needed.
 *   DATABASE_URL unset → ./.data/pglite ; "pglite://memory" → in memory.
 */
type DB = ReturnType<typeof drizzlePg<typeof schema>>;

type Raw = { exec: (sql: string) => Promise<unknown>; query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const g = globalThis as unknown as { __kumbhDb?: { db: DB; raw: Raw } };

async function create(): Promise<{ db: DB; raw: Raw }> {
  const url = env().DATABASE_URL;
  if (!url || url.startsWith("pglite")) {
    const { PGlite } = await import("@electric-sql/pglite");
    let dataDir: string | undefined;
    if (url === "pglite://memory") dataDir = undefined;
    else {
      dataDir = path.resolve(process.cwd(), url?.replace(/^pglite:\/\//, "") || ".data/pglite");
      mkdirSync(dataDir, { recursive: true });
    }
    const client = new PGlite(dataDir);
    const db = drizzlePglite(client, { schema }) as unknown as DB;
    const raw: Raw = {
      exec: (s) => client.exec(s),
      query: async (s, p) => ({ rows: (await client.query(s, p)).rows as Record<string, unknown>[] }),
    };
    return { db, raw };
  }
  const client = postgres(url, { prepare: false, max: 5, ssl: url.includes("sslmode=disable") ? false : "require" });
  const db = drizzlePg(client, { schema });
  const raw: Raw = {
    exec: (s) => client.unsafe(s),
    query: async (s, p) => ({ rows: (await client.unsafe(s, (p ?? []) as never[])) as unknown as Record<string, unknown>[] }),
  };
  return { db, raw };
}

let pending: Promise<{ db: DB; raw: Raw }> | null = null;

export async function getDb(): Promise<DB> {
  return (await getConn()).db;
}

export async function getConn(): Promise<{ db: DB; raw: Raw }> {
  if (g.__kumbhDb) return g.__kumbhDb;
  if (!pending) {
    pending = create().then(async (conn) => {
      const url = env().DATABASE_URL;
      // Embedded databases migrate themselves; a real Postgres is migrated by `npm run db:migrate` at deploy.
      if (!url || url.startsWith("pglite")) await migrate(conn.raw);
      g.__kumbhDb = conn;
      return conn;
    });
  }
  return pending;
}

export async function migrate(raw: Raw): Promise<string[]> {
  await raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await raw.query("SELECT name FROM schema_migrations")).rows.map((r) => String(r.name)));
  const dir = path.resolve(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sqlText = readFileSync(path.join(dir, f), "utf8");
    await raw.exec(`BEGIN;\n${sqlText}\nINSERT INTO schema_migrations (name) VALUES ('${f.replace(/'/g, "")}');\nCOMMIT;`);
    applied.push(f);
  }
  return applied;
}

export { schema };
