import { en, type Dict, type DictKey } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { gu } from "./gu";
import { bn } from "./bn";
import { ta } from "./ta";
import { te } from "./te";
import { kn } from "./kn";
import { ml } from "./ml";
import { pa } from "./pa";
import type { LangCode } from "@/shared/languages";

const dicts: Record<LangCode, Partial<Dict>> = { en, hi, mr, gu, bn, ta, te, kn, ml, pa };

/** Languages whose text has been reviewed by a native speaker. All others are drafts that need native review before launch. */
export const REVIEWED: LangCode[] = ["en"];

export type T = (key: DictKey, vars?: Record<string, string | number>) => string;

export function translator(lang: LangCode): T {
  const d = dicts[lang] ?? en;
  return (key, vars) => {
    let s = (d[key] ?? en[key] ?? key) as string;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export type { DictKey };
