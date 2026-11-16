/**
 * In-browser backend for the GitHub Pages build.
 *
 * The SAME route handlers as the server (src/app/api/**) run here, against the same Postgres schema
 * (PGlite in IndexedDB). The page's fetch() for /api/* is answered by this module instead of the network.
 * Data stays in this browser. Only used when the site is built with scripts/build-pages.mjs.
 */
import { Buffer } from "buffer";
import { setRequestContext, type CookieJar } from "./context";
import { NextResponse } from "./shims/next-server";
import { ROUTES } from "./routes.generated";

declare global {
  interface Window {
    __demoReady?: (api: DemoApi) => void;
    __demoApi?: DemoApi;
  }
}
export type DemoApi = { handle: (req: Request) => Promise<Response>; info: () => DemoInfo; reset: () => Promise<void> };
export type DemoInfo = { kiosk: { id: string; token: string }; staff: { email: string; name: string; role: string }[]; password: string };

const BASE = (globalThis as { __BASE_PATH__?: string }).__BASE_PATH__ ?? "";
const KEYS_KEY = "sangam.demo.keys.v1";
const COOKIES_KEY = "sangam.demo.cookies.v1";

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function demoKeys() {
  try {
    const k = JSON.parse(localStorage.getItem(KEYS_KEY) ?? "null");
    if (k?.enc && k?.hmac && k?.session && k?.cron && k?.kiosk) return k as Record<string, string>;
  } catch {
    /* fall through */
  }
  const r = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  const k = { enc: b64(r(32)), hmac: b64(r(32)), session: b64(r(32)), cron: b64(r(24)), kiosk: Buffer.from(r(24)).toString("hex") };
  localStorage.setItem(KEYS_KEY, JSON.stringify(k));
  return k;
}

const keys = demoKeys();
(globalThis as unknown as { process: { env: Record<string, string> } }).process = {
  env: {
    NODE_ENV: "production",
    DEMO_MODE: "true",
    DATABASE_URL: "pglite://browser",
    DATA_ENCRYPTION_KEY: keys.enc,
    LOOKUP_HMAC_KEY: keys.hmac,
    SESSION_SECRET: keys.session,
    CRON_SECRET: keys.cron,
    OTP_DEV_MODE: "true",
    SMS_PROVIDER: "none",
    AADHAAR_ALLOW_TEST_CARDS: "true",
    SENSOR_SIMULATOR: "true",
    MFA_REQUIRED_ROLES: "",
    RETENTION_HOURS: "48",
  },
};

// ---------- Cookies (the browser can't take Set-Cookie from a page script, so the jar lives here) ----------
function loadJar(): CookieJar {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(COOKIES_KEY) ?? "{}")));
  } catch {
    return new Map();
  }
}
function saveJar(jar: CookieJar) {
  localStorage.setItem(COOKIES_KEY, JSON.stringify(Object.fromEntries(jar)));
}

// ---------- Routing ----------
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const compiled = ROUTES.map((r) => {
  const names: string[] = [];
  const re = new RegExp(
    "^" +
      r.path
        .split("/")
        .map((seg) => {
          const m = seg.match(/^\[(\w+)\]$/);
          if (m) {
            names.push(m[1]);
            return "([^/]+)";
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/") +
      "$",
  );
  return { re, names, mod: r.mod as Record<string, Handler>, static: !r.path.includes("[") };
});
// Static paths win over dynamic ones (e.g. /lost/found before /lost/[id]).
compiled.sort((a, b) => Number(b.static) - Number(a.static));

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function handle(input: Request): Promise<Response> {
  return serial(async () => {
    await ready;
    const url = new URL(input.url);
    let path = url.pathname;
    if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
    path = path.replace(/\/$/, "");
    for (const r of compiled) {
      const m = path.match(r.re);
      if (!m) continue;
      const fn = r.mod[input.method.toUpperCase()];
      if (!fn) return Response.json({ error: { code: "method_not_allowed", message: "Method not allowed." } }, { status: 405 });
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const headers = new Headers(input.headers);
      headers.set("origin", location.origin);
      headers.set("host", location.host);
      headers.set("x-forwarded-for", "127.0.0.1");
      const body = ["GET", "HEAD"].includes(input.method.toUpperCase()) ? undefined : await input.arrayBuffer();
      const req = new Request(url.toString(), { method: input.method, headers, body });
      // Browsers strip "forbidden" headers (origin, host) from a Request; give the handler the full set.
      Object.defineProperty(req, "headers", { value: headers });
      const jar = loadJar();
      setRequestContext({ cookies: jar });
      const res = await fn(req, { params: Promise.resolve(params) });
      // Store changes in IndexedDB before answering, so a page change right after can't lose them.
      const { flushToDisk } = await import("./db-browser");
      if (["GET", "HEAD"].includes(input.method.toUpperCase())) void flushToDisk().catch(() => undefined);
      else await flushToDisk();
      if (res instanceof NextResponse && res.setCookies.length) {
        for (const c of res.setCookies) {
          if (!c.value || c.maxAge === 0) jar.delete(c.name);
          else jar.set(c.name, c.value);
        }
        saveJar(jar);
      }
      return res;
    }
    return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  });
}

// ---------- Start: database, demo data, then tell the page we're ready ----------
async function start() {
  const { getConn } = await import("@/server/db");
  await getConn();
  const { isSeeded, seedDemo } = await import("@/server/demoSeed");
  // Only one tab seeds: a Web Lock makes the others wait.
  await navigator.locks.request("sangam-demo-seed", async () => {
    if (!(await isSeeded())) await seedDemo(keys.kiosk);
  });
}

const ready = start();

async function reset() {
  localStorage.removeItem(KEYS_KEY);
  localStorage.removeItem(COOKIES_KEY);
  localStorage.removeItem("kiosk.creds");
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("/pglite/sangam-seva-demo");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

async function info(): Promise<DemoInfo> {
  const { DEMO_PASSWORD, DEMO_STAFF } = await import("@/server/demoSeed");
  return { kiosk: { id: "K-17", token: keys.kiosk }, staff: DEMO_STAFF.map((s) => ({ ...s })), password: DEMO_PASSWORD };
}

let cachedInfo: DemoInfo | null = null;
void info().then((i) => (cachedInfo = i));

ready
  .then(async () => {
    cachedInfo ??= await info();
    const api: DemoApi = { handle, info: () => cachedInfo!, reset };
    window.__demoApi = api;
    window.__demoReady?.(api);
  })
  .catch((e) => {
    console.error("[demo] backend failed to start", e);
    document.dispatchEvent(new CustomEvent("demo-backend-error", { detail: String(e?.message ?? e) }));
  });
