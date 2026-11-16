// Copies the on-device face / person models into public/models (served as static files). Run before dev/build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "node_modules/@vladmandic/human/models");
const dst = path.join(root, "public/models");
mkdirSync(dst, { recursive: true });
const MODELS = ["blazeface", "facemesh", "faceres", "antispoof", "liveness"];
for (const m of MODELS) for (const ext of [".json", ".bin"]) {
  const f = m + ext;
  if (!existsSync(path.join(src, f))) throw new Error(`model missing: ${f}`);
  copyFileSync(path.join(src, f), path.join(dst, f));
}
// The browser build of the library itself, loaded at runtime only on pages that need it.
mkdirSync(path.join(root, "public/vendor"), { recursive: true });
copyFileSync(path.join(root, "node_modules/@vladmandic/human/dist/human.esm.js"), path.join(root, "public/vendor/human.esm.js"));
console.log(`models: copied ${MODELS.length} models to public/models`);
