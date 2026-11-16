/**
 * Command-line scripts (migrate, seed) don't get Next.js's automatic .env loading, so read .env here when it
 * exists. Values already set in the environment (for example on Vercel) win; nothing is printed.
 */
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* unreadable file: fall back to the real environment */
    }
  }
}
