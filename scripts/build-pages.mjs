/**
 * Builds the static GitHub Pages site: the Next.js UI (static export) plus the in-browser backend.
 *   BASE_PATH=/Kumbh_Crowd_Management node scripts/build-pages.mjs
 * Output: ./out
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const BASE = process.env.BASE_PATH ?? "/Kumbh_Crowd_Management";
const demoOut = path.join(root, ".demo-build");
rmSync(demoOut, { recursive: true, force: true });
mkdirSync(demoOut, { recursive: true });

execSync("node scripts/gen-demo.mjs", { cwd: root, stdio: "inherit" });
const only = process.argv.includes("--backend-only");

const shim = (p) => path.join(root, "src/demo/shims", p);
const swapDb = {
  name: "swap-server-db",
  setup(b) {
    b.onLoad({ filter: /src[\\/]server[\\/]db[\\/]index\.ts$/ }, () => ({
      contents: `export * from ${JSON.stringify(path.join(root, "src/demo/db-browser.ts"))};`,
      loader: "ts",
    }));
  },
};
const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_RUNTIME": '""' },
  alias: {
    "next/server": shim("next-server.ts"),
    "next/headers": shim("next-headers.ts"),
    "server-only": shim("empty.ts"),
    "node:crypto": shim("node-crypto.ts"),
    crypto: shim("node-crypto.ts"),
    "node:fs": shim("empty.ts"),
    "node:path": shim("empty.ts"),
    postgres: shim("empty.ts"),
  },
  inject: [shim("buffer-global.ts")],
  // PGlite has Node-only branches behind dynamic imports; they never run in a browser.
  external: ["node:module", "node:url", "node:fs/promises", "node:os", "node:worker_threads", "node:child_process", "node:util", "node:stream", "node:zlib"],
  plugins: [swapDb],
  tsconfig: path.join(root, "tsconfig.json"),
};

await build({ ...common, entryPoints: [path.join(root, "src/demo/backend.ts")], outfile: path.join(demoOut, "backend.js") });
await build({ ...common, entryPoints: [path.join(root, "src/demo/pg-worker.ts")], outfile: path.join(demoOut, "pg-worker.js") });
const pgDist = path.join(root, "node_modules/@electric-sql/pglite/dist");
for (const f of ["pglite.wasm", "pglite.data", "initdb.wasm"]) copyFileSync(path.join(pgDist, f), path.join(demoOut, f));

if (only) process.exit(0);

// Static export of the UI. API route handlers can't be exported, so they're moved aside for this build only.
const api = path.join(root, "src/app/api");
const apiAside = path.join(root, ".api-aside");
const proxy = path.join(root, "src/proxy.ts");
const proxyAside = path.join(root, ".proxy-aside.ts");
renameSync(api, apiAside);
if (existsSync(proxy)) renameSync(proxy, proxyAside); // per-request CSP needs a server; Pages has none
try {
  execSync("npx next build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PAGES_BUILD: "1", NEXT_PUBLIC_DEMO: "1", NEXT_PUBLIC_BASE_PATH: BASE },
  });
} finally {
  renameSync(apiAside, api);
  if (existsSync(proxyAside)) renameSync(proxyAside, proxy);
}
const out = path.join(root, "out");
cpSync(demoOut, path.join(out, "demo"), { recursive: true });
writeFileSync(path.join(out, ".nojekyll"), "");
if (existsSync(path.join(out, "404.html")) === false) copyFileSync(path.join(out, "index.html"), path.join(out, "404.html"));
console.log("Pages build ready in ./out:", readdirSync(out).join(", "));
