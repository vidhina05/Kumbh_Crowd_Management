import { en, type Dict, type DictKey } from "./en";
import { hi } from "./hi";
import { bho } from "./bho";
import { bn } from "./bn";
import { mr } from "./mr";
import { gu } from "./gu";
import { ta } from "./ta";
import { te } from "./te";
import { or } from "./or";
import { kn } from "./kn";
import { ur } from "./ur";
import { ml } from "./ml";
import { pa } from "./pa";
import { as } from "./as";
import { mai } from "./mai";
import { ne } from "./ne";
import { sa } from "./sa";
import { kok } from "./kok";
import { doi } from "./doi";
import { brx } from "./brx";
import { ks } from "./ks";
import { sd } from "./sd";
import { mni } from "./mni";
import { sat } from "./sat";
import type { LangCode } from "@/shared/languages";

/** Every kiosk language has a complete dictionary (the type enforces it), so no screen falls back to English. */
export const DICTS: Record<LangCode, Dict> = { en, hi, bho, bn, mr, gu, ta, te, or, kn, ur, ml, pa, as, mai, ne, sa, kok, doi, brx, ks, sd, mni, sat };

/** Languages whose text has been reviewed by a native speaker. All others are drafts that need native review before launch. */
export const REVIEWED: LangCode[] = ["en"];

export type T = (key: DictKey, vars?: Record<string, string | number>) => string;

export function translator(lang: LangCode): T {
  const d = DICTS[lang] ?? en;
  return (key, vars) => {
    let s = (d[key] ?? en[key] ?? key) as string;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export type { Dict, DictKey };
