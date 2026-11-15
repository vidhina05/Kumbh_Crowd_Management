#!/usr/bin/env node
/**
 * Pre-commit / CI secret check. Scans files Git would commit (tracked + untracked, respecting .gitignore)
 * for common credential patterns and for forbidden files. Exits 1 on any finding.
 * Never prints the secret itself — only the file, line and kind.
 *
 *   npm run lint:secrets
 *
 * This complements (doesn't replace) GitHub secret scanning and Gitleaks in CI.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@/i],
  ["MongoDB URL with password", /mongodb(\+srv)?:\/\/[^:\s/]+:[^@\s]{6,}@/i],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["OpenAI / Anthropic key", /\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,})/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Assigned secret", /\b(DATA_ENCRYPTION_KEY|LOOKUP_HMAC_KEY|SESSION_SECRET|CRON_SECRET|GEMINI_API_KEY|BHASHINI_API_KEY|MSG91_AUTH_KEY|SEED_ADMIN_PASSWORD)\s*=\s*["']?[A-Za-z0-9+/=_-]{16,}/],
];
const FORBIDDEN_FILES = [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, /\.pem$/, /\.key$/, /service-account.*\.json$/i, /\.(sqlite3?|db|dump)$/, /(^|\/)\.data\//];
const SKIP = [/^node_modules\//, /^\.next\//, /package-lock\.json$/, /\.(png|jpg|jpeg|gif|webp|woff2?|ico)$/, /^scripts\/check-secrets\.mjs$/];

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const findings = [];
for (const f of files) {
  if (SKIP.some((r) => r.test(f))) continue;
  if (FORBIDDEN_FILES.some((r) => r.test(f))) { findings.push(`${f}: file type must never be committed`); continue; }
  let text;
  try { if (statSync(f).size > 2_000_000) continue; text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const [kind, re] of PATTERNS) {
      if (re.test(line) && !/placeholder|example|your-|replace-with|<[^>]+>|\$\{|process\.env/i.test(line)) findings.push(`${f}:${i + 1}: possible ${kind}`);
    }
  });
}
if (findings.length) {
  console.error(`Secret check FAILED (${findings.length}):\n  ${findings.join("\n  ")}\nRemove the secret, rotate it if it was ever shared, and use environment variables.`);
  process.exit(1);
}
console.log(`Secret check passed: ${files.length} files scanned, no secrets or forbidden files.`);
