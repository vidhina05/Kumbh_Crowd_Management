import { describe, expect, it } from "vitest";
import { DICTS, translator } from "@/i18n";
import { en } from "@/i18n/en";
import { LANGUAGES } from "@/shared/languages";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("kiosk translations", () => {
  it("has a dictionary for every offered language", () => {
    for (const l of LANGUAGES) expect(DICTS[l.code], l.code).toBeTruthy();
    expect(LANGUAGES.length).toBe(24);
  });
  for (const l of LANGUAGES) {
    it(`${l.english}: every key translated, placeholders intact`, () => {
      const d = DICTS[l.code] as Record<string, string>;
      for (const k of Object.keys(en) as (keyof typeof en)[]) {
        expect(typeof d[k], `${l.code}.${k}`).toBe("string");
        expect(d[k].trim().length, `${l.code}.${k} empty`).toBeGreaterThan(0);
        expect(vars(d[k]), `${l.code}.${k} placeholders`).toBe(vars(en[k]));
      }
    });
  }
  it("fills placeholders", () => {
    expect(translator("ta")("stepOf", { n: 3 })).toContain("3");
    expect(translator("ur")("bookAt", { time: "6:15", ghat: "X" })).toMatch(/6:15.*X|X.*6:15/);
  });
});
