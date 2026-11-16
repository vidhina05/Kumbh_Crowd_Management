"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminT } from "@/admin/i18n";
import type { Live } from "@/admin/types";

export type Prefs = { density: "desk" | "compact"; reduceMotion: boolean; criticalRing: boolean; helpSound: boolean };
const DEFAULTS: Prefs = { density: "desk", reduceMotion: false, criticalRing: true, helpSound: true };
const KEY = "admin.prefs";

function apply(p: Prefs) {
  const d = document.documentElement.dataset;
  d.density = p.density;
  if (p.reduceMotion) d.motion = "reduce"; else delete d.motion;
}

/** Display and sound preferences for this browser. Stored locally; nothing is sent to the server. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    let p = DEFAULTS;
    try { p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* ignore */ }
    if (!localStorage.getItem(KEY) && matchMedia("(prefers-reduced-motion: reduce)").matches) p = { ...p, reduceMotion: true };
    setPrefs(p); apply(p);
  }, []);
  const set = useCallback((patch: Partial<Prefs>) => setPrefs((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    apply(next);
    return next;
  }), []);
  return [prefs, set] as const;
}

let ctx: AudioContext | null = null;
/** Short tones made with Web Audio, so no sound files are needed. */
export function playTone(kind: "ring" | "chime") {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const notes = kind === "ring" ? [880, 660, 880, 660] : [660, 990];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      const t = ctx!.currentTime + i * (kind === "ring" ? 0.22 : 0.16);
      o.type = kind === "ring" ? "square" : "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "ring" ? 0.12 : 0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.22);
    });
  } catch { /* audio not available */ }
}

/** Rings when something new turns critical; chimes when a new help request arrives. */
export function useLiveSounds(live: Live | null, prefs: Prefs) {
  const prev = useRef<{ crit: Set<string>; help: number } | null>(null);
  useEffect(() => {
    if (!live) return;
    const crit = new Set([...live.ghats.filter((g) => g.percent >= g.safeLimitPct).map((g) => `g:${g.id}`), ...live.alerts.filter((a) => a.severity === "critical").map((a) => `a:${a.id}`)]);
    const help = live.help.open;
    const p = prev.current;
    if (p) {
      if (prefs.criticalRing && [...crit].some((c) => !p.crit.has(c))) playTone("ring");
      else if (prefs.helpSound && help > p.help) playTone("chime");
    }
    prev.current = { crit, help };
  }, [live, prefs.criticalRing, prefs.helpSound]);
}

/** Figma "Admin / Settings" side sheet. */
export function SettingsSheet({ name, prefs, set, onClose }: { name: string; prefs: Prefs; set: (p: Partial<Prefs>) => void; onClose: () => void }) {
  const { lang, setLang } = useAdminT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k); ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const seg = (label: string, value: string, opts: [string, string][], on: (v: string) => void) => (
    <div className="st-seg" role="radiogroup" aria-label={label}>{opts.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} onClick={() => on(v)}>{l}</button>)}</div>
  );
  const sw = (label: string, on: boolean, flip: () => void) => (
    <button role="switch" aria-checked={on} aria-label={label} className="st-switch" onClick={flip}><span className="handle" /></button>
  );
  const row = (icon: string, title: string, sub: string, ctl: React.ReactNode) => (
    <div className="st-row"><span className="icon">{icon}</span><span className="t"><b>{title}</b><small>{sub}</small></span>{ctl}</div>
  );
  return (
    <>
      <div className="a-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="st-sheet" role="dialog" aria-modal="true" aria-labelledby="st-h" ref={ref}>
        <div className="st-head"><div><h2 id="st-h">Settings</h2><small>{name} · Sangam Control</small></div><button className="icon-btn" onClick={onClose} aria-label="Close settings"><span className="icon">close</span></button></div>
        <h3>Display</h3>
        {row("translate", "Interface language", "Alerts stay in every language", seg("Interface language", lang, [["en", "English"], ["hi", "हिन्दी"]], (v) => setLang(v as "en" | "hi")))}
        {row("density_medium", "Density", "Compact fits about 30% more rows", seg("Density", prefs.density, [["desk", "Desk"], ["compact", "Compact"]], (v) => set({ density: v as Prefs["density"] })))}
        {row("motion_photos_off", "Reduce motion", "Fades only, no moving lines", sw("Reduce motion", prefs.reduceMotion, () => set({ reduceMotion: !prefs.reduceMotion })))}
        <h3>Alerts</h3>
        {row("notifications_active", "Critical alerts ring", "Rings when a ghat crosses its safe limit", sw("Critical alerts ring", prefs.criticalRing, () => { set({ criticalRing: !prefs.criticalRing }); if (!prefs.criticalRing) playTone("ring"); }))}
        {row("volume_up", "Sound for help requests", "Soft chime", sw("Sound for help requests", prefs.helpSound, () => { set({ helpSound: !prefs.helpSound }); if (!prefs.helpSound) playTone("chime"); }))}
        <h3>Keyboard</h3>
        <div className="st-keys">
          {[["/", "Search"], ["N", "Notifications"], ["S", "Ask Sahayak"], ["Esc", "Close a panel"]].map(([k, l]) => <div key={k}><kbd>{k}</kbd>{l}</div>)}
        </div>
        <Link href="/admin/settings" className="btn btn-outlined" onClick={onClose}><span className="icon sm">shield_person</span>Password, two-step code and face sign-in</Link>
      </div>
    </>
  );
}
