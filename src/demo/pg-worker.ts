/// <reference lib="webworker" />
// Database worker for the in-browser build: one PGlite (Postgres in WebAssembly) per browser profile.
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

// The IndexedDB file layer checks for files that don't exist yet on first start. Emscripten reports that as
// an "ErrnoError" (no such file) which is expected and handled inside PGlite; keep it out of the page's error log.
self.addEventListener("error", (e) => {
  const err = (e as ErrorEvent).error as { name?: string; errno?: number } | undefined;
  if (err?.name === "ErrnoError" || (e as ErrorEvent).message?.includes("ErrnoError")) {
    e.preventDefault();
    console.debug("[demo db] file-system check:", err?.errno);
  }
});
self.addEventListener("unhandledrejection", (e) => {
  const err = (e as PromiseRejectionEvent).reason as { name?: string } | undefined;
  if (err?.name === "ErrnoError") e.preventDefault();
});

void worker({
  async init(options) {
    return new PGlite({ dataDir: options.dataDir, relaxedDurability: true });
  },
});
