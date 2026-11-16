"use client";
import { BASE_PATH, IS_DEMO, withBase } from "@/shared/base";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import "./kiosk.css";
import { ApiError, clearCreds, flushOutbox, kioskFetch, loadCreds, queue, saveCreds, type KioskCreds } from "./api";
import { browserVoiceFor, canListen, listen, speak, voiceErrorKey, stopSpeaking, voicesReady, type SpokenWith } from "./voice";
import { CameraCapture, Dialog, Icon, Keypad, MicButton } from "./ui";
import { answerByVoice } from "./voiceAnswer";
import { AadhaarScan, FaceCapture, templateFromPhoto, type AadhaarResult } from "./Identity";
import { QrScanner } from "@/shared/client/QrScanner";
import { translator, type DictKey } from "@/i18n";
import { LANGUAGES, type LangCode } from "@/shared/languages";
import { RELATIONS } from "@/shared/validation";
import { addDays } from "@/shared/time";

const APP_VERSION = "0.1.0";
const IDLE_SECONDS = 60;
const IDLE_GRACE = 20;
const PASS_RESET_SECONDS = 45;

type Level = "calm" | "moderate" | "busy" | "very_busy";
type Config = {
  kiosk: { id: string; name: string; location: string };
  integrations: { sms: boolean; otpDevMode: boolean; voice: boolean; assistant: boolean; aadhaar?: boolean; aadhaarTestCards?: boolean; demo?: boolean };
  today: string;
  alerts: { id: string; severity: string; title: string; message: string; translations?: Record<string, { title: string; message: string }> }[];
  ghats: { id: string; name: string; nameHi: string; percent: number; level: Level; source: string; updatedMinutesAgo: number | null }[];
};
type SlotGhat = {
  id: string; name: string; nameHi: string; gate: string; walkNote: string;
  crowd: { percent: number; level: Level; source: string; updatedMinutesAgo: number | null };
  slots: { id: string; start: string; end: string; batchNo: number; left: number }[];
};
type Pass = {
  passCode: string; leaderName: string; phoneLast4: string; meetingPoint: string; slotChangesLeft: number;
  slot: { id: string; day: string; start: string; end: string; batchNo: number };
  ghat: { id: string; name: string; nameHi: string; gate: string; walkNote: string };
  members: { name: string; age: number; relation: string; needs: string[]; isLeader: boolean; hasBand: boolean }[];
  replaces?: string;
  diversion?: { code: string; fromGhat: string; confirmed: boolean } | null;
};
type MemberDraft = { key: number; name: string; age: string; relation: (typeof RELATIONS)[number]; wheelchair: boolean; photo?: string; face?: string; faceState?: "working" | "ok" | "bad"; gender?: "M" | "F" | "T" };
type Screen =
  | "setup" | "welcome" | "consent" | "identify" | "aadhaar" | "aadhaarPhone" | "phone" | "otp" | "family" | "slot" | "review" | "pass"
  | "findHow" | "findPass" | "findFace" | "allLangs"
  | "help" | "helpSent" | "lost" | "lostSent" | "findView" | "changeDone";
type Flow = "register" | "find";

const STEP_OF: Partial<Record<Screen, number>> = { welcome: 1, consent: 2, identify: 3, aadhaar: 3, aadhaarPhone: 3, phone: 3, otp: 3, family: 4, slot: 5, review: 5, pass: 6 };
const uid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const istNowHHMM = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);
const needsBand = (age: number, leader: boolean) => leader || age < 12 || age >= 65;

export default function KioskApp() {
  const [creds, setCreds] = useState<KioskCreds | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [online, setOnline] = useState(true);
  const [screen, setScreen] = useState<Screen>("welcome");
  const [flow, setFlow] = useState<Flow>("register");
  const [lang, setLang] = useState<LangCode>("hi");
  const t = useMemo(() => translator(lang), [lang]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [langDialog, setLangDialog] = useState(false);

  // Registration state (cleared on every reset)
  const [photoConsent, setPhotoConsent] = useState(false);
  const [faceConsent, setFaceConsent] = useState(false);
  const [aadhaar, setAadhaar] = useState<AadhaarResult | null>(null);
  const [findPassCode, setFindPassCode] = useState("");
  const [last4, setLast4] = useState("");
  const [faceTpl, setFaceTpl] = useState<string | null>(null);
  const [divSeen, setDivSeen] = useState(false);
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; last4: string; devCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const [pilgrimToken, setPilgrimToken] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [editing, setEditing] = useState<MemberDraft | null>(null);
  const [homeTown, setHomeTown] = useState("");
  const [day, setDay] = useState<string>("");
  const [slotData, setSlotData] = useState<SlotGhat[] | null>(null);
  const [chosen, setChosen] = useState<{ ghat: SlotGhat; slot: SlotGhat["slots"][number] } | null>(null);
  const [pass, setPass] = useState<Pass | null>(null);
  const [qr, setQr] = useState<string>("");
  const [helpType, setHelpType] = useState<DictKey | null>(null);
  const [helpText, setHelpText] = useState("");
  const [caseResult, setCaseResult] = useState<{ code?: string; queued?: boolean; name?: string } | null>(null);
  const [lost, setLost] = useState({ personName: "", age: "", description: "", lastSeen: "", reporterName: "", reporterPhone: "" });
  const [speaking, setSpeaking] = useState(false);
  const [autoRead, setAutoRead] = useState(true);
  const [voiceUsed, setVoiceUsed] = useState<SpokenWith | null>(null);
  const [voicesLoaded, setVoicesLoaded] = useState(-1); // -1 until mounted, so server and first client render match
  const [hearing, setHearing] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const hearingRef = useRef(false);
  const talkBack = useRef(false);
  const silent = useRef(0);
  const hearRef = useRef<((auto?: boolean) => Promise<void>) | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    void voicesReady().then((v) => setVoicesLoaded(v.length));
    const mark = () => { touched.current = true; };
    addEventListener("pointerdown", mark, { once: true });
    return () => removeEventListener("pointerdown", mark);
  }, []);
  useEffect(() => {
    const L = LANGUAGES.find((l) => l.code === lang)!;
    document.documentElement.lang = lang;
    document.documentElement.dir = L.rtl ? "rtl" : "ltr";
  }, [lang]);

  // ---------- Device setup, heartbeat, config, offline outbox ----------
  useEffect(() => {
    const c = loadCreds();
    setCreds(c);
    setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light");
    if (!c && IS_DEMO) {
      // Demo build: this browser is kiosk K-17 of the in-browser backend.
      const iv = setInterval(() => {
        const api = (window as unknown as { __demoApi?: { info: () => { kiosk: KioskCreds } } }).__demoApi;
        if (!api) return;
        clearInterval(iv);
        const k = api.info().kiosk;
        saveCreds(k);
        setCreds(k);
      }, 200);
      return () => clearInterval(iv);
    }
    if (!c || new URLSearchParams(location.search).get("setup") === "1") setScreen("setup");
    setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light");
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); void flushOutbox(); };
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);

  const refreshConfig = useCallback(async () => {
    if (!creds) return;
    try {
      setConfig(await kioskFetch<Config>("/api/kiosk/config", { creds }));
      setOnline(true);
    } catch (e) {
      if (e instanceof ApiError && e.offline) setOnline(false);
      if (e instanceof ApiError && e.status === 401) setScreen("setup");
    }
  }, [creds]);

  useEffect(() => {
    if (!creds) return;
    void refreshConfig();
    const beat = () => kioskFetch("/api/kiosk/heartbeat", { body: { version: APP_VERSION }, creds }).then(() => setOnline(true)).catch((e) => e instanceof ApiError && e.offline && setOnline(false));
    void beat();
    void flushOutbox();
    const a = setInterval(beat, 30_000);
    const b = setInterval(refreshConfig, 60_000);
    const c = setInterval(() => void flushOutbox(), 30_000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [creds, refreshConfig]);

  // ---------- Reset & idle ----------
  const reset = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
    setScreen("welcome"); setFlow("register"); setLang("hi"); setError(null); setBusy(false);
    setPhotoConsent(false); setFaceConsent(false); setAadhaar(null); setFindPassCode(""); setLast4(""); setFaceTpl(null); setDivSeen(false); setPhone(""); setChallenge(null); setCode(""); setPilgrimToken(null);
    setMembers([]); setEditing(null); setHomeTown(""); setDay(""); setSlotData(null); setChosen(null);
    setPass(null); setQr(""); setHelpType(null); setHelpText(""); setCaseResult(null);
    setLost({ personName: "", age: "", description: "", lastSeen: "", reporterName: "", reporterPhone: "" });
    setLangDialog(false); setHeard(null); setVoiceUsed(null);
  }, []);

  const lastActive = useRef(Date.now());
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const [passLeft, setPassLeft] = useState(PASS_RESET_SECONDS);
  useEffect(() => {
    const bump = () => { lastActive.current = Date.now(); setIdleLeft(null); };
    const evs = ["pointerdown", "keydown", "touchstart"] as const;
    evs.forEach((e) => addEventListener(e, bump, { passive: true }));
    return () => evs.forEach((e) => removeEventListener(e, bump));
  }, []);
  useEffect(() => {
    const iv = setInterval(() => {
      if (screen === "setup") return;
      const dirty = screen !== "welcome" || lang !== "hi";
      if (!dirty) return;
      const idle = (Date.now() - lastActive.current) / 1000;
      if (screen === "pass" || screen === "changeDone") return; // the pass screen has its own countdown
      if (idle >= IDLE_SECONDS + IDLE_GRACE) reset();
      else if (idle >= IDLE_SECONDS) setIdleLeft(Math.ceil(IDLE_SECONDS + IDLE_GRACE - idle));
    }, 1000);
    return () => clearInterval(iv);
  }, [screen, lang, reset]);
  useEffect(() => {
    if (screen !== "pass" && screen !== "changeDone") return;
    setPassLeft(PASS_RESET_SECONDS);
    const iv = setInterval(() => setPassLeft((s) => { if (s <= 1) { reset(); return PASS_RESET_SECONDS; } return s - 1; }), 1000);
    return () => clearInterval(iv);
  }, [screen, reset]);

  useEffect(() => { stopSpeaking(); setSpeaking(false); setError(null); }, [screen]);

  useEffect(() => {
    if (pass) void QRCode.toDataURL(pass.passCode, { margin: 1, width: 264, errorCorrectionLevel: "M" }).then(setQr);
  }, [pass]);

  // ---------- Helpers ----------
  const go = (s: Screen) => { setScreen(s); lastActive.current = Date.now(); };
  const errorText = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t("errGeneric");
    if (e.offline) return t("offline");
    switch (e.code) {
      case "conflict": return e.extra.reason === "already_registered" ? t("errAlready") : t("errGeneric");
      case "sms_not_configured": return t("errSmsOff");
      case "otp_wrong": return t("errOtpWrong");
      case "otp_expired": case "otp_invalid": case "otp_locked": return t("errOtpExpired");
      case "slot_full": return t("errSlotFull");
      case "rate_limited": return t("errTooMany");
      case "not_found": return t("errNotFound");
      case "pilgrim_session": return t("errOtpExpired");
      case "face_no_match": return t("findFaceNone");
      case "aadhaar_invalid": case "aadhaar_signature": case "aadhaar_off": return t("aadhaarBad");
      default: return lang === "en" ? e.message : t("errGeneric");
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const langInfo = LANGUAGES.find((l) => l.code === lang)!;
  const serverVoice = Boolean(config?.integrations.voice);
  const [canHear, setCanHear] = useState(false);
  useEffect(() => setCanHear(canListen(serverVoice)), [serverVoice]);
  const voiceAvailable = serverVoice || (voicesLoaded >= 0 && typeof window !== "undefined" && Boolean(browserVoiceFor(lang)));
  // Ghat names exist in English and Hindi; Devanagari-script languages get the Hindi name, everyone else the English one.
  const ghatName = (g: { name: string; nameHi: string }) => (langInfo.script === "Deva" ? g.nameHi || g.name : g.name);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage unavailable */ }
    setTheme(next);
  };

  // ---------- Actions ----------
  const sendOtp = () => run(async () => {
    const r = await kioskFetch<{ challengeId: string; phoneLast4: string; devCode?: string }>("/api/kiosk/otp/start", { body: { phone } });
    setChallenge({ id: r.challengeId, last4: r.phoneLast4, devCode: r.devCode });
    setCode("");
    go("otp");
  });

  const checkOtp = () => run(async () => {
    if (!challenge) return;
    const r = await kioskFetch<{ pilgrimToken: string }>("/api/kiosk/otp/verify", { body: { challengeId: challenge.id, code } });
    setPilgrimToken(r.pilgrimToken);
    if (flow === "find") {
      setPass(await kioskFetch<Pass>("/api/kiosk/registrations/me", { pilgrimToken: r.pilgrimToken }));
      go("findView");
    } else {
      startFamily();
    }
  });

  const startFamily = (prefill?: AadhaarResult["person"]) => {
    if (!members.length) {
      const leader: MemberDraft = { key: Date.now(), name: prefill?.name ?? "", age: prefill?.age != null ? String(prefill.age) : "", relation: "other", wheelchair: false, gender: prefill?.gender ?? undefined };
      setMembers([leader]);
      setEditing(leader);
    }
    go("family");
  };

  const attachAadhaarPhone = () => run(async () => {
    if (!aadhaar) return;
    const r = await kioskFetch<{ pilgrimToken: string; phoneLast4: string }>("/api/kiosk/aadhaar/phone", { body: { phone }, headers: { "X-Aadhaar-Token": aadhaar.aadhaarToken } });
    setPilgrimToken(r.pilgrimToken);
    startFamily(aadhaar.person);
  });

  const openFound = async (token: string) => {
    setPilgrimToken(token);
    setPass(await kioskFetch<Pass>("/api/kiosk/registrations/me", { pilgrimToken: token }));
    setDivSeen(false);
    go("findView");
  };
  const findByPass = () => run(async () => {
    const r = await kioskFetch<{ pilgrimToken: string }>("/api/kiosk/find/pass", { body: { passCode: findPassCode.trim().toUpperCase(), last4 } });
    await openFound(r.pilgrimToken);
  });
  const findByFace = () => run(async () => {
    if (!faceTpl) return;
    const r = await kioskFetch<{ pilgrimToken: string }>("/api/kiosk/find/face", { body: { template: faceTpl, last4 } });
    await openFound(r.pilgrimToken);
  });
  const confirmDiversion = () => run(async () => {
    await kioskFetch("/api/kiosk/registrations/confirm-change", { body: {}, pilgrimToken });
    setPass((p) => (p && p.diversion ? { ...p, diversion: { ...p.diversion, confirmed: true } } : p));
    setDivSeen(true);
  });

  const loadSlots = (d: string) => run(async () => {
    setDay(d);
    setChosen(null);
    const r = await kioskFetch<{ ghats: SlotGhat[] }>(`/api/kiosk/slots?day=${d}`);
    setSlotData(r.ghats.sort((a, b) => a.crowd.percent - b.crowd.percent));
  });

  const book = () => run(async () => {
    if (!chosen) return;
    const body = {
      language: lang,
      consent: { version: "2026-01", accepted: true, photo: photoConsent, face: faceConsent },
      homeTown,
      slotId: chosen.slot.id,
      members: members.map((m, i) => ({
        name: m.name.trim(),
        age: Number(m.age),
        relation: i === 0 ? "self" : m.relation,
        needs: m.wheelchair ? ["wheelchair"] : [],
        ...(photoConsent && m.photo && Number(m.age) < 12 ? { photo: m.photo } : {}),
        ...(faceConsent && m.face ? { face: m.face } : {}),
        ...(m.gender ? { gender: m.gender } : {}),
      })),
    };
    setPass(await kioskFetch<Pass>("/api/kiosk/registrations", { body, pilgrimToken }));
    setMembers((ms) => ms.map((m) => ({ ...m, photo: undefined, face: undefined }))); // drop photos and face data from memory once sent
    go("pass");
  });

  const changeSlotConfirm = () => run(async () => {
    if (!chosen) return;
    setPass(await kioskFetch<Pass>("/api/kiosk/registrations/change-slot", { body: { slotId: chosen.slot.id }, pilgrimToken }));
    go("changeDone");
  });

  const sendHelp = () => run(async () => {
    if (!helpType) return;
    const type = helpType.replace("help_", "") as "medical" | "lost_person" | "wheelchair" | "language" | "other";
    const body = { type, description: helpText.trim(), passCode: pass?.passCode, clientRequestId: uid() };
    try {
      const r = await kioskFetch<{ code: string }>("/api/kiosk/help", { body });
      setCaseResult({ code: r.code });
    } catch (e) {
      if (e instanceof ApiError && (e.offline || e.status >= 500)) { queue("/api/kiosk/help", body); setCaseResult({ queued: true }); }
      else throw e;
    }
    go("helpSent");
  });

  const sendLost = () => run(async () => {
    const body = {
      personName: lost.personName.trim(),
      age: lost.age ? Number(lost.age) : undefined,
      description: lost.description.trim(),
      lastSeen: lost.lastSeen.trim(),
      reporterName: lost.reporterName.trim(),
      reporterPhone: lost.reporterPhone.trim() || undefined,
      clientRequestId: uid(),
    };
    try {
      const r = await kioskFetch<{ code: string }>("/api/kiosk/lost", { body, pilgrimToken });
      setCaseResult({ code: r.code, name: body.personName });
    } catch (e) {
      if (e instanceof ApiError && (e.offline || e.status >= 500)) { queue("/api/kiosk/lost", body); setCaseResult({ queued: true, name: body.personName }); }
      else throw e;
    }
    go("lostSent");
  });

  // ---------- Guide pane text per screen ----------
  const guide: { title: string; body: string } = (() => {
    switch (screen) {
      case "welcome": return { title: t("welcomeTitle"), body: t("welcomeBody") };
      case "consent": return { title: t("consentTitle"), body: t("consentBody") };
      case "identify": return { title: t("idTitle"), body: t("idBody") };
      case "aadhaar": return { title: t("aadhaarTitle"), body: t("aadhaarBody") };
      case "aadhaarPhone": return { title: t("aadhaarPhoneTitle"), body: t("aadhaarPhoneBody") };
      case "findHow": return { title: t("findHowTitle"), body: t("findHowBody") };
      case "allLangs": return { title: t("welcomeTitle"), body: t("allLanguagesBody") };
      case "findPass": return { title: t("findPassTitle"), body: t("findPassBody") };
      case "findFace": return { title: t("findFaceTitle"), body: t("findFaceBody") };
      case "phone": return { title: flow === "find" ? t("findTitle") : t("phoneTitle"), body: flow === "find" ? t("findBody") : t("phoneBody") };
      case "otp": return { title: t("otpTitle"), body: t("otpBody", { last4: challenge?.last4 ?? "" }) };
      case "family": return { title: t("familyTitle"), body: t("familyBody") };
      case "slot": return { title: t("slotTitle"), body: t("slotBody") };
      case "review": return { title: t("reviewTitle"), body: t("reviewBody") };
      case "pass": case "changeDone": return { title: t("passTitle"), body: config?.integrations.sms ? t("passBodySms", { last4: pass?.phoneLast4 ?? "" }) : t("passBody") };
      case "help": return { title: t("helpTitle"), body: t("helpBody") };
      case "helpSent": return { title: t("helpSent"), body: caseResult?.queued ? t("helpQueued") : t("helpSentBody", { code: caseResult?.code ?? "" }) };
      case "lost": return { title: t("lostTitle"), body: t("lostBody") };
      case "lostSent": return { title: t("lostSent", { name: caseResult?.name ?? "" }), body: caseResult?.queued ? t("helpQueued") : t("lostSentBody", { code: caseResult?.code ?? "" }) };
      case "findView": return pass?.diversion && !pass.diversion.confirmed ? { title: t("divertedTitle"), body: t("divertedBody", { from: pass.diversion.fromGhat, to: ghatName(pass.ghat), time: `${pass.slot.start}–${pass.slot.end}` }) } : { title: t("yourRegistration"), body: pass && pass.slotChangesLeft > 0 ? t("changesLeft") : t("noChangesLeft") };
      default: return { title: "", body: "" };
    }
  })();

  const readAloud = async (force = false) => {
    if (speaking && !force) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    const r = await speak(`${guide.title}. ${guide.body}`, lang, serverVoice, () => {
      setSpeaking(false);
      if (talkBack.current) setTimeout(() => void hearRef.current?.(true), 300);
    });
    setVoiceUsed(r);
    if (r.how === "none") setSpeaking(false);
  };
  // Read each screen aloud in the chosen language (after the first touch; browsers block sound before that).
  const guideText = `${guide.title}|${guide.body}`;
  useEffect(() => {
    if (!autoRead || !touched.current || screen === "setup") return;
    const id = setTimeout(() => void readAloud(true), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideText, lang, autoRead]);
  const hearCommand = async (auto = false) => {
    if (hearingRef.current) return;
    hearingRef.current = true;
    setError(null);
    if (!auto) talkBack.current = true; // after one tap, the kiosk listens for an answer each time it finishes speaking
    try {
      setHearing(true); stopSpeaking(); setSpeaking(false);
      const l = await listen(lang, serverVoice);
      const said = (await l.result).trim();
      const alts = said.toLowerCase().split(" | ").map((a) => a.trim()).filter(Boolean);
      setHeard(alts[0] || null);
      if (!alts.length) {
        silent.current += 1;
        if (silent.current >= 2) talkBack.current = false; // nobody answering: stop opening the mic
        return;
      }
      silent.current = 0;
      const hit = LANGUAGES.find((L) => alts.some((a) => a.includes(L.native.toLowerCase()) || a.includes(L.english.toLowerCase())));
      if (hit && hit.code !== lang && (screen === "welcome" || screen === "allLangs")) { setLang(hit.code); return; }
      const root = document.querySelector<HTMLElement>(".k-body");
      const r = root ? await answerByVoice(root, alts) : { kind: "none" as const };
      if (r.kind === "none") {
        if (alts.some((a) => /help|madad|मदद|सहायता|সাহায্য|உதவி|సహాయం|ਮਦਦ|મદદ|ಸಹಾಯ|സഹായം|ମଦଦ|مدد/.test(a))) go("help");
        else setError(t("voiceNoMatch", { text: alts[0] }));
      }
    } catch (e) {
      talkBack.current = false;
      setError(t(voiceErrorKey(e)));
    } finally { hearingRef.current = false; setHearing(false); }
  };
  hearRef.current = hearCommand;

  if (screen === "setup") return <Setup onDone={(c) => { saveCreds(c); setCreds(c); history.replaceState(null, "", withBase("/kiosk/")); reset(); }} current={creds} />;

  const step = STEP_OF[screen];
  const inRegistration = flow === "register" && step !== undefined;
  const people = members.length;
  const bands = members.filter((m, i) => needsBand(Number(m.age) || 0, i === 0)).length;
  const membersValid = members.length > 0 && members.every((m) => m.name.trim() && m.age !== "" && Number(m.age) >= 0 && Number(m.age) <= 120);

  return (
    <div className="k-root" lang={lang}>
      {/* ---------- Top app bar ---------- */}
      <header className="k-top">
        <div className="k-brand">
          <div className="k-logo"><Icon name="waves" /></div>
          <div>
            <b>{t("brand")}</b>
            <small>{t("kioskLabel", { id: config?.kiosk.id ?? creds?.id ?? "" })}</small>
          </div>
        </div>
        <div className="k-spacer" />
        {inRegistration && step && <StepBar step={step} t={t} />}
        <div className="k-spacer" />
        {voicesLoaded >= 0 && canListen(serverVoice) && (
          <button className={`k-listen${hearing ? " on" : ""}`} onClick={() => void hearCommand()} aria-pressed={hearing} title={heard ? t("heardYou", { text: heard }) : t("micOff")}>
            <span className="dot" /><Icon name="mic" size="sm" />{(screen === "welcome" || screen === "allLangs" || hearing) && <span>{hearing ? t("listeningSay") : t("micOff")}</span>}
          </button>
        )}
        <button className="k-round" onClick={() => { if (autoRead) { stopSpeaking(); setSpeaking(false); } setAutoRead((a) => !a); }} aria-pressed={autoRead} aria-label={autoRead ? t("mute") : t("unmute")} title={autoRead ? t("mute") : t("unmute")}>
          <Icon name={autoRead ? "volume_up" : "volume_off"} />
        </button>
        <div className="k-themeseg" role="radiogroup" aria-label={`${t("themeLight")} / ${t("themeDark")}`}>
          <button role="radio" aria-checked={theme === "light"} aria-label={t("themeLight")} onClick={() => theme !== "light" && toggleTheme()}><Icon name="light_mode" size="sm" /></button>
          <button role="radio" aria-checked={theme === "dark"} aria-label={t("themeDark")} onClick={() => theme !== "dark" && toggleTheme()}><Icon name="dark_mode" size="sm" /></button>
        </div>
        <div className="k-seg" role="group" aria-label={t("chooseLanguage")}>
          <button aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">EN</button>
          <button aria-pressed={lang !== "en"} onClick={() => setLang(lang === "en" ? "hi" : lang)} lang={lang === "en" ? "hi" : lang}>
            {lang === "en" ? "हिं" : langInfo.short}
          </button>
          <button onClick={() => (screen === "welcome" ? go("allLangs") : setLangDialog(true))} aria-label={t("chooseLanguage")}><Icon name="translate" /></button>
        </div>
        <button className="btn btn-filled small" onClick={() => go("help")} style={{ height: 48 }}>
          <Icon name="support_agent" /> {t("help")}
        </button>
      </header>

      {/* ---------- Status strip: offline + live alerts ---------- */}
      <div className="k-alerts" aria-live="polite">
        {!online && <div className="banner warn"><Icon name="cloud_off" /> {t("offline")}</div>}
        {config?.alerts.slice(0, 2).map((a) => {
          const tr = a.translations?.[lang];
          return (
            <div key={a.id} className={`banner ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}`} lang={tr ? lang : undefined}>
              <Icon name={a.severity === "critical" ? "error" : "campaign"} /> <b>{tr?.title || a.title}</b> {tr?.message || a.message}
            </div>
          );
        })}
      </div>

      <main className="k-body">
        {/* ---------- Guide pane ---------- */}
        <section className="glass k-guide" aria-labelledby="guide-title">
          {screen === "welcome" || screen === "allLangs" ? (
            <>
              <h1 id="guide-title" className="k-hello"><span>{t("greeting")}</span>{t("welcomeTitle")}</h1>
              <p>{t("welcomeBody")}</p>
              <div className="k-badges">
                <span><Icon name="smartphone" size="sm" /> {t("badgeNoPhone")}</span>
                <span><Icon name="record_voice_over" size="sm" /> {t("badgeLanguage")}</span>
                <span><Icon name="currency_rupee" size="sm" /> {t("badgeFree")}</span>
              </div>
              <img className="k-art" src={`${BASE_PATH}/art/dwar.png`} alt="" />
            </>
          ) : (
            <>
              {(step && inRegistration) ? <div className="k-stepno">{screen === "pass" ? t("allDone") : t("stepOf", { n: step })}</div> : null}
              <h1 id="guide-title">{guide.title}</h1>
              <p>{guide.body}</p>
            </>
          )}
          {screen === "aadhaar" && <div className="k-cardart" aria-hidden="true"><Icon name="badge" size="lg" /><Icon name="arrow_downward" /></div>}
          {screen === "family" && (
            <div className="k-infos">
              <div><span className="ic"><Icon name="child_care" size="sm" /></span><span><b>{t("kidsTitle")}</b><small>{t("kidsBody")}</small></span></div>
              <div><span className="ic"><Icon name="elderly" size="sm" /></span><span><b>{t("eldersTitle")}</b><small>{t("eldersBody")}</small></span></div>
              <div><span className="ic"><Icon name="accessible" size="sm" /></span><span><b>{t("wheelTitle")}</b><small>{t("wheelBody")}</small></span></div>
            </div>
          )}
          {screen === "slot" && config?.today && (
            <div className="k-days" role="radiogroup" aria-label={t("day")}>
              <small>{t("day")}</small>
              {[0, 1, 2].map((i) => addDays(config.today, i)).map((d) => (
                <button key={d} role="radio" aria-checked={d === day} onClick={() => void loadSlots(d)} disabled={busy}>
                  <span>{dayLabel(d, config.today, t)}</span>
                </button>
              ))}
            </div>
          )}
          {(screen === "pass" || screen === "changeDone") && pass?.meetingPoint && (
            <>
              <div className="k-infos"><div><span className="ic"><Icon name="flag" size="sm" /></span><span><b>{t("separatedTitle")}</b><small>{t("meetingPoint", { place: pass.meetingPoint })}</small></span></div></div>
              <img className="k-art sm" src={`${BASE_PATH}/art/dwar.png`} alt="" />
            </>
          )}
          {voicesLoaded < 0 && !serverVoice ? <div style={{ marginTop: "auto" }} /> : voiceAvailable ? (
            <button className={`k-voice${speaking ? " speaking" : ""}`} onClick={() => void readAloud()} aria-pressed={speaking} aria-label={speaking ? t("stopReading") : t("readAloud")}>
              <span className="orb"><Icon name={speaking ? "graphic_eq" : "volume_up"} /></span>
              <span className="tx"><b>{speaking ? t("readingAloud") : t("tapToHear")}</b><span className="t">{guide.body}</span>{voiceUsed?.how === "browser" && !voiceUsed.exact && <small>{t("voiceVia", { name: voiceUsed.voiceName ?? "" })}</small>}</span>
              <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
            </button>
          ) : (
            <div className="k-novoice"><Icon name="volume_off" size="sm" /> {t("voiceNone", { lang: langInfo.native })}</div>
          )}
        </section>

        {/* ---------- Action pane ---------- */}
        <section className="glass k-action" aria-live="polite">
          <div className="k-scroll">
            {hearing && <div className="banner" role="status"><Icon name="mic" /> {t("listeningSay")}</div>}
            {!hearing && heard && !error && <div className="banner good" role="status"><Icon name="hearing" /> {t("heardYou", { text: heard })}</div>}
            {error && <div className="banner bad" role="alert"><Icon name="error" /> {error}</div>}

            {screen === "welcome" && (
              <>
                <h2>{t("chooseLanguage")}</h2>
                <p className="muted" style={{ margin: "-8px 0 0" }}>{t("chooseLanguageHint")}</p>
                <div className="k-lang-grid">
                  {[...LANGUAGES.slice(0, 7), LANGUAGES.slice(7).find((l) => l.code === lang) ?? LANGUAGES[7]].map((l) => (
                    <button key={l.code} className="k-option" aria-pressed={lang === l.code} onClick={() => setLang(l.code)} lang={l.code} dir={l.rtl ? "rtl" : undefined}>
                      <b>{l.native}</b>
                      <small>{l.english}</small>
                    </button>
                  ))}
                  <button className="k-option" onClick={() => go("allLangs")}>
                    <b>{t("moreLanguages", { n: LANGUAGES.length - 8 })}</b>
                    <small>{LANGUAGES.slice(8, 11).map((l) => l.english).join(", ")}…</small>
                  </button>
                </div>
                <CrowdPanel config={config} t={t} ghatName={ghatName} />
              </>
            )}

            {screen === "allLangs" && (
              <>
                <h2>{t("allLanguagesTitle", { n: LANGUAGES.length })}</h2>
                <p className="muted" style={{ margin: "-8px 0 0" }}>{t("allLanguagesBody")}</p>
                <div className="k-lang-grid">
                  {LANGUAGES.map((l) => (
                    <button key={l.code} className="k-option" aria-pressed={lang === l.code} onClick={() => setLang(l.code)} lang={l.code} dir={l.rtl ? "rtl" : undefined}>
                      <b>{l.native}</b>
                      <small>{l.english}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {screen === "consent" && (
              <>
                <ul className="k-list">
                  <li><Icon name="smartphone" /> {t("consentWhat1")}</li>
                  <li><Icon name="groups" /> {t("consentWhat2")}</li>
                  <li><Icon name="photo_camera" /> {t("consentWhat3")}</li>
                  <li><Icon name="lock" /> {t("consentWho")}</li>
                  <li><Icon name="auto_delete" /> {t("consentDelete")}</li>
                </ul>
                <label className="k-check">
                  <input type="checkbox" checked={photoConsent} onChange={(e) => setPhotoConsent(e.target.checked)} />
                  <span>{t("consentPhoto")}</span>
                </label>
                <label className="k-check">
                  <input type="checkbox" checked={faceConsent} onChange={(e) => setFaceConsent(e.target.checked)} />
                  <span><Icon name="face" size="sm" /> {t("consentFace")}</span>
                </label>
                <p className="muted" style={{ margin: 0 }}>{t("consentDecline")}</p>
              </>
            )}

            {screen === "identify" && (
              <div className="k-lang-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                <button className="k-option" onClick={() => { setAadhaar(null); go("aadhaar"); }} disabled={config?.integrations.aadhaar === false}>
                  <Icon name="qr_code_scanner" size="lg" /><b style={{ fontSize: 20 }}>{t("idAadhaar")}</b><small>{t("idAadhaarHint")}</small>
                </button>
                <button className="k-option" onClick={() => go("phone")}>
                  <Icon name="smartphone" size="lg" /><b style={{ fontSize: 20 }}>{t("idPhone")}</b><small>{t("idPhoneHint")}</small>
                </button>
              </div>
            )}

            {screen === "aadhaar" && (
              <>
                <h2>{t("waitingForCard")}</h2>
                <AadhaarScan t={t} testCards={Boolean(config?.integrations.aadhaarTestCards)} onError={(m) => setError(m === "offline" ? t("offline") : m)}
                  onVerified={(r) => { setAadhaar(r); setError(null); go("aadhaarPhone"); }} />
                <div className="k-alt">
                  <button className="btn btn-outlined" onClick={() => go("phone")}><Icon name="dialpad" /> {t("noAadhaar")}</button>
                  <button className="btn btn-text" onClick={() => go("help")}><Icon name="support_agent" /> {t("askVolunteer")}</button>
                </div>
              </>
            )}

            {screen === "aadhaarPhone" && aadhaar && (
              <div style={{ display: "grid", gap: 16, maxWidth: 440 }}>
                <div className="banner good" role="status"><Icon name="verified" /> {t("aadhaarOk", { name: aadhaar.person.name, age: aadhaar.person.age ?? "—" })} · ••••{aadhaar.person.last4}{aadhaar.verifiedBy === "test" ? ` · ${t("aadhaarTest")}` : aadhaar.verifiedBy === "unchecked" ? ` · ${t("aadhaarUnchecked")}` : ""}</div>
                <div className="field">
                  <label htmlFor="aphone">{t("phoneLabel")}</label>
                  <input id="aphone" className="input mono" inputMode="numeric" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="98765 43210" />
                </div>
                <Keypad value={phone} onChange={setPhone} max={10} t={t} onDone={phone.length === 10 ? attachAadhaarPhone : undefined} />
              </div>
            )}

            {screen === "findHow" && (
              <div className="k-lang-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <button className="k-option" onClick={() => go("phone")}><Icon name="sms" size="lg" /><b style={{ fontSize: 18 }}>{t("findByPhone")}</b></button>
                <button className="k-option" onClick={() => { setFindPassCode(""); setLast4(""); go("findPass"); }}><Icon name="qr_code_scanner" size="lg" /><b style={{ fontSize: 18 }}>{t("findByPass")}</b></button>
                <button className="k-option" onClick={() => { setFaceTpl(null); setLast4(""); go("findFace"); }}><Icon name="face" size="lg" /><b style={{ fontSize: 18 }}>{t("findByFace")}</b></button>
              </div>
            )}

            {screen === "findPass" && (
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "start" }}>
                <div style={{ display: "grid", gap: 12 }}>
                  {!findPassCode ? <QrScanner label={t("findPassTitle")} onResult={(txt) => setFindPassCode(txt.trim().toUpperCase().slice(0, 20))} /> : <div className="banner good"><Icon name="qr_code_2" /> <span className="mono">{findPassCode}</span></div>}
                  <div className="field">
                    <label htmlFor="pcode">{t("passNumber")}</label>
                    <input id="pcode" className="input mono" autoComplete="off" value={findPassCode} maxLength={20} onChange={(e) => setFindPassCode(e.target.value.toUpperCase())} placeholder="KMB-…" />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="field"><label htmlFor="l4">{t("last4Label")}</label><input id="l4" className="input mono" inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ fontSize: 24, letterSpacing: 10 }} /></div>
                  <Keypad value={last4} onChange={setLast4} max={4} t={t} onDone={last4.length === 4 && findPassCode.length >= 5 ? findByPass : undefined} />
                </div>
              </div>
            )}

            {screen === "findFace" && (
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "start" }}>
                {!faceTpl ? <FaceCapture t={t} onError={setError} onTemplate={(tp) => { setError(null); setFaceTpl(tp); }} /> : <div className="banner good"><Icon name="face" /> {t("faceSaved")} <button className="btn btn-text small" onClick={() => setFaceTpl(null)}>{t("retakePhoto")}</button></div>}
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="field"><label htmlFor="l4f">{t("last4Label")}</label><input id="l4f" className="input mono" inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ fontSize: 24, letterSpacing: 10 }} /></div>
                  <Keypad value={last4} onChange={setLast4} max={4} t={t} onDone={last4.length === 4 && faceTpl ? findByFace : undefined} />
                </div>
              </div>
            )}

            {screen === "phone" && (
              <div style={{ display: "grid", gap: 16, maxWidth: 440 }}>
                <div className="field">
                  <label htmlFor="phone">{t("phoneLabel")}</label>
                  <input id="phone" className="input mono" inputMode="numeric" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="98765 43210" aria-describedby="phone-hint" />
                  <span className="help" id="phone-hint">{t("phoneHint")}</span>
                </div>
                <Keypad value={phone} onChange={setPhone} max={10} t={t} onDone={phone.length === 10 ? sendOtp : undefined} />
              </div>
            )}

            {screen === "otp" && (
              <div style={{ display: "grid", gap: 16, maxWidth: 440 }}>
                {challenge?.devCode && <div className="banner info"><Icon name="info" /> {t("devCode", { code: challenge.devCode })}</div>}
                <div className="field">
                  <label htmlFor="otp">{t("otpLabel")}</label>
                  <input id="otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ fontSize: 28, letterSpacing: 12 }} />
                </div>
                <Keypad value={code} onChange={setCode} max={4} t={t} onDone={code.length === 4 ? checkOtp : undefined} />
                <button className="btn btn-text" onClick={sendOtp} disabled={busy}><Icon name="refresh" /> {t("resend")}</button>
              </div>
            )}

            {screen === "family" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <h2 style={{ flex: 1 }}>{t("familyCount", { n: t("peopleN", { n: people }) })}</h2>
                  <button className="btn btn-tonal small" disabled={members.length >= 12 || Boolean(editing)} onClick={() => { const m: MemberDraft = { key: Date.now(), name: "", age: "", relation: "spouse", wheelchair: false }; setMembers((ms) => [...ms, m]); setEditing(m); }}>
                    <Icon name="person_add" /> {t("addMember")}
                  </button>
                </div>
                {members.map((m, i) =>
                  editing?.key === m.key ? (
                    <MemberForm key={m.key} m={editing} leader={i === 0} t={t} lang={lang} voice={canHear} serverVoice={serverVoice} photoAllowed={photoConsent} faceAllowed={faceConsent}
                      onChange={setEditing}
                      onSave={(next) => { setMembers((ms) => ms.map((x) => (x.key === next.key ? next : x))); setEditing(null); }}
                      onRemove={i === 0 ? undefined : () => { setMembers((ms) => ms.filter((x) => x.key !== m.key)); setEditing(null); }}
                      onError={setError} />
                  ) : (
                    <div className="k-row" key={m.key}>
                      <div className="k-avatar">{m.photo ? <img src={m.photo} alt="" /> : (m.name.trim()[0] ?? "?").toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <b style={{ fontSize: 16 }}>{m.name || "—"}</b>
                        <div className="muted">{m.age} · {i === 0 ? t("you") : t(`rel_${m.relation}` as DictKey)}</div>
                      </div>
                      {Number(m.age) >= 65 && <span className="chip warn"><span className="dot" /> {t("member_over65")}</span>}
                      {Number(m.age) < 12 && m.age !== "" && <span className="chip good"><span className="dot" /> {t("member_child")}{m.photo ? ` · ${t("photoTaken")}` : ""}</span>}
                      {m.wheelchair && <span className="chip warn"><span className="dot" /> {t("needsWheelchair")}</span>}
                      {faceConsent && m.face && <span className="chip good"><Icon name="face" size="sm" /> {t("faceSaved")}</span>}
                      <span className={`chip ${needsBand(Number(m.age) || 0, i === 0) ? "good" : ""}`}><Icon name={needsBand(Number(m.age) || 0, i === 0) ? "watch" : "remove"} size="sm" /> {needsBand(Number(m.age) || 0, i === 0) ? t("bandYes") : t("bandNo")}</span>
                      <button className="icon-btn" onClick={() => setEditing(m)} aria-label={`${t("editMember")} ${m.name}`} disabled={Boolean(editing)}><Icon name="edit" /></button>
                    </div>
                  ),
                )}
                <div className="field" style={{ maxWidth: 440 }}>
                  <label htmlFor="town">{t("homeTown")}</label>
                  <input id="town" className="input" value={homeTown} maxLength={80} onChange={(e) => setHomeTown(e.target.value)} />
                </div>
              </>
            )}

            {screen === "slot" && (
              <SlotPicker t={t} lang={lang} today={config?.today ?? ""} day={day} data={slotData} people={flow === "find" ? pass?.members.length ?? 1 : people} chosen={chosen} onChoose={setChosen} busy={busy} ghatName={ghatName} wheelchairName={flow === "register" ? members.find((m) => m.wheelchair)?.name : pass?.members.find((m) => m.needs.includes("wheelchair"))?.name} />
            )}

            {screen === "review" && chosen && (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="k-row"><Icon name="location_on" /><div><b>{ghatName(chosen.ghat)}</b> · {chosen.ghat.gate}<div className="muted">{chosen.ghat.walkNote}</div></div></div>
                <div className="k-row"><Icon name="schedule" /><div><b>{dayLabel(day, config?.today ?? "", t)}</b> · {chosen.slot.start}–{chosen.slot.end}</div></div>
                <div className="k-row"><Icon name="groups" /><div><b>{t("peopleN", { n: people })}</b> · {members.map((m) => m.name).join(", ")}</div></div>
                <div className="k-row"><Icon name="watch" /><div><b>{t("bandsN", { n: bands })}</b></div></div>
              </div>
            )}

            {screen === "findView" && pass?.diversion && (
              pass.diversion.confirmed ? (
                <div className="banner good" role="status"><Icon name="check_circle" /> {divSeen ? t("divertedThanks") : `${t("divertedTitle")} · ${pass.diversion.fromGhat} → ${ghatName(pass.ghat)}`}</div>
              ) : (
                <div className="banner warn" role="alert" style={{ alignItems: "center" }}>
                  <Icon name="alt_route" />
                  <span style={{ flex: 1 }}><b>{t("divertedTitle")}</b><br />{t("divertedBody", { from: pass.diversion.fromGhat, to: ghatName(pass.ghat), time: `${pass.slot.start}–${pass.slot.end}` })}</span>
                  <button className="btn btn-filled" disabled={busy} onClick={confirmDiversion}><Icon name="done_all" /> {t("divertedSeen")}</button>
                </div>
              )
            )}
            {(screen === "pass" || screen === "changeDone" || screen === "findView") && pass && (
              <PassView pass={pass} qr={qr} t={t} lang={lang} today={config?.today ?? ""} />
            )}

            {screen === "help" && (
              <>
                <div className="k-lang-grid">
                  {(["help_medical", "help_lost_person", "help_wheelchair", "help_language", "help_other"] as DictKey[]).map((k) => (
                    <button key={k} className="k-option" aria-pressed={helpType === k} onClick={() => (k === "help_lost_person" ? go("lost") : setHelpType(k))}>
                      <Icon name={{ help_medical: "medical_services", help_lost_person: "person_search", help_wheelchair: "accessible", help_language: "translate", help_other: "support_agent" }[k as string] ?? "help"} />
                      <b style={{ fontSize: 17 }}>{t(k)}</b>
                    </button>
                  ))}
                </div>
                {helpType && (
                  <div className="field">
                    <label htmlFor="help-text">{t("helpDetails")}</label>
                    <textarea id="help-text" className="input" maxLength={500} value={helpText} onChange={(e) => setHelpText(e.target.value)} />
                    {canHear && <div><MicButton lang={lang} t={t} voice={serverVoice} onText={(s) => setHelpText((v) => (v ? `${v} ${s}` : s))} onError={setError} /></div>}
                  </div>
                )}
              </>
            )}

            {screen === "lost" && (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                {([["personName", "lostName", "text"], ["age", "lostAge", "numeric"], ["description", "lostDesc", "text"], ["lastSeen", "lostSeen", "text"], ["reporterName", "reporterName", "text"], ["reporterPhone", "reporterPhone", "numeric"]] as const).map(([f, label, mode]) => (
                  <div className="field" key={f} style={f === "description" || f === "lastSeen" ? { gridColumn: "1 / -1" } : undefined}>
                    <label htmlFor={`lost-${f}`}>{t(label)}</label>
                    <input id={`lost-${f}`} className="input" inputMode={mode} value={lost[f]} maxLength={f === "description" ? 500 : 120}
                      onChange={(e) => setLost((s) => ({ ...s, [f]: mode === "numeric" ? e.target.value.replace(/\D/g, "").slice(0, f === "age" ? 3 : 10) : e.target.value }))} />
                    {canHear && mode === "text" && <div><MicButton lang={lang} t={t} voice={serverVoice} onText={(s) => setLost((v) => ({ ...v, [f]: s }))} onError={setError} /></div>}
                  </div>
                ))}
              </div>
            )}

            {(screen === "helpSent" || screen === "lostSent") && (
              <div style={{ display: "grid", placeItems: "center", gap: 16, padding: 24, textAlign: "center" }}>
                <div style={{ width: 96, height: 96, borderRadius: "50%", display: "grid", placeItems: "center", background: caseResult?.queued ? "var(--warning-container)" : "var(--success-container)", color: caseResult?.queued ? "var(--warning)" : "var(--success)" }}>
                  <Icon name={caseResult?.queued ? "schedule_send" : "check_circle"} size="lg" />
                </div>
                {caseResult?.code && <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{caseResult.code}</div>}
                <p style={{ fontSize: 18, maxWidth: 520, margin: 0 }}>{guide.body}</p>
              </div>
            )}
          </div>

          {/* ---------- Footer actions ---------- */}
          <footer className="k-footer">
            {screen === "welcome" && (
              <>
                <button className="btn btn-tonal" onClick={() => { setFlow("find"); go("findHow"); }}><Icon name="person_search" /> {t("findMe")}</button>
                <button className="btn btn-filled" onClick={() => { setFlow("register"); go("consent"); }} lang={lang}><Icon name="arrow_forward" /> {t("continueIn", { lang: langInfo.native })}</button>
              </>
            )}
            {screen === "consent" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("welcome")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={() => go(config?.integrations.aadhaar === false ? "phone" : "aadhaar")}><Icon name="check" /> {t("consentAgree")}</button>
              </>
            )}
            {screen === "phone" && (
              <>
                <button className="btn btn-tonal" onClick={() => go(flow === "find" ? "findHow" : config?.integrations.aadhaar === false ? "consent" : "aadhaar")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={sendOtp} disabled={phone.length !== 10 || busy}><Icon name="sms" /> {t("sendCode")}</button>
              </>
            )}
            {screen === "identify" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("consent")}><Icon name="arrow_back" /> {t("back")}</button>
                <span />
              </>
            )}
            {screen === "aadhaar" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("consent")}><Icon name="arrow_back" /> {t("back")}</button>
                <span />
              </>
            )}
            {screen === "aadhaarPhone" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("aadhaar")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={attachAadhaarPhone} disabled={phone.length !== 10 || busy}><Icon name="arrow_forward" /> {t("next")}</button>
              </>
            )}
            {screen === "findHow" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("welcome")}><Icon name="arrow_back" /> {t("back")}</button>
                <span />
              </>
            )}
            {screen === "allLangs" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("welcome")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={() => { setFlow("register"); go("consent"); }} lang={lang}><Icon name="arrow_forward" /> {t("continueIn", { lang: langInfo.native })}</button>
              </>
            )}
            {screen === "findPass" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("findHow")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={findByPass} disabled={last4.length !== 4 || findPassCode.trim().length < 5 || busy}><Icon name="search" /> {t("next")}</button>
              </>
            )}
            {screen === "findFace" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("findHow")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={findByFace} disabled={last4.length !== 4 || !faceTpl || busy}><Icon name="search" /> {t("next")}</button>
              </>
            )}
            {screen === "otp" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("phone")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" onClick={checkOtp} disabled={code.length !== 4 || busy}><Icon name="verified" /> {t("checkCode")}</button>
              </>
            )}
            {screen === "family" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("welcome")}><Icon name="close" /> {t("startOver")}</button>
                <button className="btn btn-filled" disabled={!membersValid || Boolean(editing)} onClick={() => { go("slot"); void loadSlots(config?.today ?? day); }}><Icon name="arrow_forward" /> {t("chooseSlot")}</button>
              </>
            )}
            {screen === "slot" && (
              <>
                <button className="btn btn-tonal" onClick={() => go(flow === "find" ? "findView" : "family")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" disabled={!chosen || busy} onClick={() => (flow === "find" ? changeSlotConfirm() : go("review"))}>
                  <Icon name="event" /> {chosen ? (flow === "find" ? t("confirmBook", { time: chosen.slot.start, ghat: ghatName(chosen.ghat) }) : t("bookAt", { time: chosen.slot.start, ghat: ghatName(chosen.ghat) })) : t("next")}
                </button>
              </>
            )}
            {screen === "review" && chosen && (
              <>
                <button className="btn btn-tonal" onClick={() => go("slot")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" disabled={busy} onClick={book}><Icon name="event_available" /> {t("confirmBook", { time: chosen.slot.start, ghat: ghatName(chosen.ghat) })}</button>
              </>
            )}
            {(screen === "pass" || screen === "changeDone") && (
              <>
                <button className="btn btn-outlined" onClick={() => print()}><Icon name="print" /> {t("printAgain")}</button>
                <span className="muted">{t("resetIn", { s: passLeft })}</span>
                <button className="btn btn-filled" onClick={reset}><Icon name="done" /> {t("done")}</button>
              </>
            )}
            {screen === "findView" && pass && (
              <>
                <button className="btn btn-tonal" onClick={reset}><Icon name="close" /> {t("done")}</button>
                <button className="btn btn-filled" disabled={pass.slotChangesLeft <= 0} onClick={() => { go("slot"); void loadSlots(config?.today ?? pass.slot.day); }}><Icon name="edit_calendar" /> {t("changeSlot")}</button>
              </>
            )}
            {screen === "help" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("welcome")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled" disabled={!helpType || busy} onClick={sendHelp}><Icon name="support_agent" /> {t("sendHelp")}</button>
              </>
            )}
            {screen === "lost" && (
              <>
                <button className="btn btn-tonal" onClick={() => go("help")}><Icon name="arrow_back" /> {t("back")}</button>
                <button className="btn btn-filled btn-danger" disabled={busy || !lost.personName.trim() || lost.description.trim().length < 3 || lost.lastSeen.trim().length < 2 || !lost.reporterName.trim()} onClick={sendLost}>
                  <Icon name="person_search" /> {t("startSearch")}
                </button>
              </>
            )}
            {(screen === "helpSent" || screen === "lostSent") && (
              <>
                <span />
                <button className="btn btn-filled" onClick={reset}><Icon name="done" /> {t("done")}</button>
              </>
            )}
          </footer>
        </section>
      </main>

      {idleLeft !== null && (
        <Dialog title={t("idleTitle")} icon="timer" actions={<><button className="btn btn-text" onClick={reset}>{t("startOver")}</button><button className="btn btn-filled" onClick={() => { lastActive.current = Date.now(); setIdleLeft(null); }}>{t("imHere")}</button></>}>
          {t("idleBody", { s: idleLeft })}
        </Dialog>
      )}
      {langDialog && (
        <Dialog title={t("chooseLanguage")} icon="translate" actions={<button className="btn btn-text" onClick={() => setLangDialog(false)}>{t("cancel")}</button>}>
          <div className="k-lang-grid" style={{ marginTop: 8 }}>
            {LANGUAGES.map((l) => (
              <button key={l.code} className="k-option" aria-pressed={lang === l.code} onClick={() => { setLang(l.code); setLangDialog(false); }} lang={l.code}>
                <b style={{ fontSize: 17 }}>{l.native}</b><small>{l.english}</small>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function StepBar({ step, t }: { step: number; t: (k: DictKey, v?: Record<string, string | number>) => string }) {
  const names: DictKey[] = ["stepLanguage", "stepConsent", "stepIdentify", "stepFamily", "stepSlot", "stepPass"];
  return (
    <nav className="k-steps" aria-label={t("stepOf", { n: step })}>
      {names.map((n, i) => (
        <span key={n} style={{ display: "contents" }}>
          {i > 0 && <span className="k-step-sep" aria-hidden="true" />}
          {i + 1 < step && <span className="k-step done" aria-label={`${t(n)} ✓`}><Icon name="check" size="sm" /></span>}
          {i + 1 === step && <span className="k-step current" aria-current="step"><i>{i + 1}</i>{t(n)}</span>}
          {i + 1 > step && <span className="k-step" aria-label={t(n)}>{i + 1}</span>}
        </span>
      ))}
    </nav>
  );
}

function levelKey(l: Level): DictKey {
  return l;
}

function CrowdPanel({ config, t, ghatName }: { config: Config | null; t: (k: DictKey, v?: Record<string, string | number>) => string; ghatName: (g: { name: string; nameHi: string }) => string }) {
  if (!config) return null;
  return (
    <div className="k-live">
      <div className="k-live-head"><span className="dot" /><b>{t("liveAtMela")}</b></div>
      <div className="k-crowd">
        {[...config.ghats].sort((a, b) => Number(a.updatedMinutesAgo === null) - Number(b.updatedMinutesAgo === null)).slice(0, 4).map((g) => (
          <div className="tile" key={g.id}>
            <div style={{ fontSize: 13 }}>{ghatName(g)}</div>
            {g.updatedMinutesAgo === null ? (
              <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("noCrowdData")}</div>
            ) : (
              <>
                <div className={`pct level-${g.level}`}>{g.percent}%</div>
                <div className="bar"><i className={`level-${g.level}-bg`} style={{ width: `${Math.min(100, g.percent)}%` }} /></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t(levelKey(g.level))} · {t("updatedByStaff", { m: g.updatedMinutesAgo })}</div>
              </>
            )}
          </div>
        ))}
      </div>
      <small className="muted">{t("calmestSuggest")}</small>
    </div>
  );
}

function dayLabel(day: string, today: string, t: (k: DictKey) => string) {
  if (day === today) return t("today");
  if (today && day === addDays(today, 1)) return t("tomorrow");
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function SlotPicker({ t, lang, today, day, data, people, chosen, onChoose, busy, ghatName, wheelchairName }: {
  t: (k: DictKey, v?: Record<string, string | number>) => string; lang: LangCode; today: string; day: string;
  data: SlotGhat[] | null; people: number; chosen: { ghat: SlotGhat; slot: SlotGhat["slots"][number] } | null;
  onChoose: (c: { ghat: SlotGhat; slot: SlotGhat["slots"][number] }) => void; busy: boolean; ghatName: (g: { name: string; nameHi: string }) => string; wheelchairName?: string;
}) {
  const now = istNowHHMM();
  const steps = (g: SlotGhat) => /steps/i.test(g.walkNote) && !/no steps/i.test(g.walkNote);
  const ghats = (data ?? []).map((g) => ({ g, slots: g.slots.filter((s) => !(day === today && s.start <= now)) }))
    .sort((a, b) => (wheelchairName ? Number(steps(a.g)) - Number(steps(b.g)) : 0) || a.g.crowd.percent - b.g.crowd.percent);
  const sel = chosen ? ghats.find((x) => x.g.id === chosen.ghat.id) : null;
  const dayText = today ? (lang === "en" ? dayLabel(day, today, t).toLowerCase() : dayLabel(day, today, t)) : "";
  return (
    <>
      <h2>{t("ghatsOn", { day: dayText })}</h2>
      {busy && !data && <p className="muted">…</p>}
      <div className="k-ghats" role="radiogroup" aria-label={t("slotTitle")}>
        {ghats.map(({ g, slots }) => {
          const first = slots.find((s) => s.left >= people);
          const on = chosen?.ghat.id === g.id;
          const level = g.crowd.level === "calm" ? "good" : g.crowd.level === "moderate" ? "warn" : "bad";
          return (
            <div key={g.id} className={`k-ghat${on ? " on" : ""}`}>
              <button role="radio" aria-checked={on} disabled={!first} onClick={() => first && onChoose({ ghat: g, slot: on && chosen ? chosen.slot : first })}>
                <span className="radio" aria-hidden="true" />
                <span className="t">
                  <b>{ghatName(g)}</b>
                  <small>{first ? `${first.start}–${first.end}` : t("noSlots")} · {t("gate")} {g.gate.replace(/\D/g, "") || g.gate} · {g.walkNote}</small>
                  {g.crowd.updatedMinutesAgo !== null && <span className="bar"><i className={`level-${g.crowd.level}-bg`} style={{ width: `${Math.min(100, g.crowd.percent)}%` }} /></span>}
                </span>
                {g.crowd.updatedMinutesAgo !== null && <span className={`chip ${level}`}><span className="dot" /> {t(levelKey(g.crowd.level))}</span>}
                {g.crowd.updatedMinutesAgo !== null && <span className={`pct level-${g.crowd.level}`}>{g.crowd.percent}%</span>}
              </button>
              {on && slots.length > 1 && (
                <div className="k-slot-times" role="radiogroup" aria-label={t("otherTimes")}>
                  {slots.slice(0, 10).map((s) => {
                    const ok = s.left >= people;
                    return (
                      <button key={s.id} className="k-time" role="radio" aria-checked={chosen?.slot.id === s.id} disabled={!ok} onClick={() => onChoose({ ghat: g, slot: s })}>
                        <b>{s.start}</b>
                        <small>{ok ? t("placesLeft", { n: s.left }) : t("full")}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {wheelchairName && <p className="muted k-note"><Icon name="accessible" size="sm" /> {t("wheelchairFirst", { name: wheelchairName })}</p>}
      {sel && sel.g.crowd.updatedMinutesAgo !== null && (
        <div className="k-liveview">
          <div className="pic" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)` }}><span className="you">{ghatName(sel.g)}</span></div>
          <div><div className="k-live-head"><span className="dot" /><b>{t("liveView", { ghat: ghatName(sel.g) })}</b></div><div className={`big level-${sel.g.crowd.level}`}>{sel.g.crowd.percent}%</div><small className="muted">{t("fullNow")} · {sel.g.walkNote} · {sel.g.gate}</small></div>
        </div>
      )}
    </>
  );
}

function PassView({ pass, qr, t, lang, today }: { pass: Pass; qr: string; t: (k: DictKey, v?: Record<string, string | number>) => string; lang: LangCode; today: string }) {
  const ghat = LANGUAGES.find((l) => l.code === lang)?.script === "Deva" ? pass.ghat.nameHi || pass.ghat.name : pass.ghat.name;
  const gateNo = pass.ghat.gate.replace(/\D/g, "") || pass.ghat.gate;
  const bands = pass.members.filter((m) => m.hasBand);
  // Slot start in IST → minutes from now.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(iv); }, []);
  const startMs = Date.parse(`${pass.slot.day}T${pass.slot.start}:00+05:30`);
  const mins = Math.max(0, Math.round((startMs - now) / 60_000));
  const unit = (n: number, u: "hour" | "minute") => { try { return new Intl.NumberFormat(`${lang}-IN`, { style: "unit", unit: u, unitDisplay: "short" }).format(n); } catch { return `${n} ${u === "hour" ? "h" : "min"}`; } };
  const leave = new Date(startMs - 30 * 60_000).toLocaleTimeString(lang === "en" ? "en-IN" : `${lang}-IN`, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return (
    <div className="printable k-passwrap">
      <div className="k-pass">
        <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
          <span className="muted mono" style={{ fontSize: 13 }}>{pass.replaces ? t("newPass", { code: pass.passCode }) : t("passLabel", { code: pass.passCode })}</span>
          {pass.replaces && <span className="chip warn" style={{ width: "fit-content" }}>{t("replaces", { code: pass.replaces })}</span>}
          <b style={{ fontSize: 26, fontWeight: 400 }}>{ghat} · {t("gate")} {gateNo}</b>
          <span style={{ fontSize: 17 }}>{dayLabel(pass.slot.day, today, t)} · {pass.slot.start}–{pass.slot.end}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <span className="chip good"><span className="dot" /> {t("peopleN", { n: pass.members.length })}</span>
            {pass.members.some((m) => m.needs.includes("wheelchair")) && <span className="chip warn"><span className="dot" /> {t("needsWheelchair")}</span>}
            {pass.meetingPoint && <span className="chip"><span className="dot" /> {pass.meetingPoint}</span>}
          </div>
        </div>
        <div className="k-gate"><small>{t("gate")}</small><b>{gateNo}</b></div>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img className="qr" src={qr} alt={`QR ${pass.passCode}`} />}
          <span className="mono" style={{ fontSize: 13 }}>{pass.passCode}</span>
        </div>
      </div>
      <div className="k-row k-bands"><span className="ic"><Icon name="watch" /></span><div><b>{t("bandsN", { n: bands.length })}</b>{bands.length > 0 && <> · {bands.map((m) => m.name.split(" ")[0]).join(", ")}</>}<div className="muted">{t("bandsBody")}</div></div></div>
      {startMs > now && (
        <div className="k-liveview">
          <div className="pic" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)` }}><span className="you">{ghat} · {t("gate")} {gateNo}</span></div>
          <div>
            <small className="muted">{t("slotStartsIn")}</small>
            <div className="big" style={{ color: "var(--primary)" }}>{mins >= 60 ? `${unit(Math.floor(mins / 60), "hour")} ${unit(mins % 60, "minute")}` : unit(mins, "minute")}</div>
            <small className="muted">{t("leaveBy", { time: leave })}</small>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberForm({ m, leader, t, lang, voice, serverVoice, photoAllowed, faceAllowed, onChange, onSave, onRemove, onError }: {
  m: MemberDraft; leader: boolean; t: (k: DictKey, v?: Record<string, string | number>) => string; lang: LangCode; voice: boolean; serverVoice: boolean; photoAllowed: boolean; faceAllowed: boolean;
  onChange: (m: MemberDraft) => void; onSave: (m: MemberDraft) => void; onRemove?: () => void; onError: (s: string) => void;
}) {
  const [touched, setTouched] = useState(false);
  const nameOk = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(m.name.trim());
  const ageNum = Number(m.age);
  const ageOk = m.age !== "" && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120;
  const isChild = ageOk && ageNum < 12;
  return (
    <div className="card" style={{ display: "grid", gap: 14, borderColor: "var(--primary)" }}>
      <b>{leader ? t("you") : t("addMember")}</b>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor={`n-${m.key}`}>{t("name")}</label>
          <input id={`n-${m.key}`} className="input" value={m.name} maxLength={80} aria-invalid={touched && !nameOk} onChange={(e) => onChange({ ...m, name: e.target.value })} autoFocus />
          {touched && !nameOk && <span className="err">{t("required")}</span>}
          {voice && <div><MicButton lang={lang} t={t} voice={serverVoice} onText={(s) => onChange({ ...m, name: s })} onError={onError} /></div>}
        </div>
        <div className="field">
          <label htmlFor={`a-${m.key}`}>{t("age")}</label>
          <input id={`a-${m.key}`} className="input" inputMode="numeric" value={m.age} aria-invalid={touched && !ageOk} onChange={(e) => onChange({ ...m, age: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
          {touched && !ageOk && <span className="err">{t("ageInvalid")}</span>}
        </div>
      </div>
      {!leader && (
        <div className="field">
          <label htmlFor={`r-${m.key}`}>{t("relation")}</label>
          <select id={`r-${m.key}`} className="input" value={m.relation} onChange={(e) => onChange({ ...m, relation: e.target.value as MemberDraft["relation"] })}>
            {RELATIONS.filter((r) => r !== "self").map((r) => <option key={r} value={r}>{t(`rel_${r}` as DictKey)}</option>)}
          </select>
        </div>
      )}
      <label className="k-check">
        <input type="checkbox" checked={m.wheelchair} onChange={(e) => onChange({ ...m, wheelchair: e.target.checked })} />
        <span><Icon name="accessible" size="sm" /> {t("needsWheelchair")}</span>
      </label>
      {((photoAllowed && isChild) || faceAllowed) && (
        <div style={{ display: "grid", gap: 6 }}>
          {faceAllowed && !(photoAllowed && isChild) && <span className="muted" style={{ fontSize: 13 }}>{t("photoForFace")}</span>}
          <CameraCapture t={t} existing={m.photo} onPhoto={(p) => {
            if (!p) { onChange({ ...m, photo: undefined, face: undefined, faceState: undefined }); return; }
            if (!faceAllowed) { onChange({ ...m, photo: p }); return; }
            const next = { ...m, photo: p, face: undefined, faceState: "working" as const };
            onChange(next);
            void templateFromPhoto(p).then((face) => onChange({ ...next, face: face ?? undefined, faceState: face ? "ok" : "bad" }));
          }} />
          {m.faceState === "working" && <span className="chip" role="status"><Icon name="hourglass_top" size="sm" /> {t("faceWorking")}</span>}
          {m.faceState === "ok" && <span className="chip good" role="status"><Icon name="face" size="sm" /> {t("faceSaved")}</span>}
          {m.faceState === "bad" && <span className="chip warn" role="alert"><Icon name="warning" size="sm" /> {t("faceRetake")}</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onRemove && <button className="btn small btn-text" onClick={onRemove}><Icon name="delete" /> {t("removeMember")}</button>}
        <button className="btn small btn-filled" onClick={() => { setTouched(true); if (nameOk && ageOk && m.faceState !== "working") onSave({ ...m, name: m.name.trim(), photo: (photoAllowed && isChild) || faceAllowed ? m.photo : undefined }); }}>
          <Icon name="check" /> {t("saveMember")}
        </button>
      </div>
    </div>
  );
}

// ---------- Staff setup screen (English only) ----------
function Setup({ onDone, current }: { onDone: (c: KioskCreds) => void; current: KioskCreds | null }) {
  const [id, setId] = useState(current?.id ?? "");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = { id: id.trim(), token: token.trim() };
      await kioskFetch("/api/kiosk/config", { creds: c });
      onDone(c);
    } catch (e) {
      setMsg(e instanceof ApiError && e.offline ? "No connection to the server. Check the network and try again." : "That kiosk ID and token don't match. Ask a super admin for a new token (Admin → Kiosks).");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }} className="k-root">
      <div className="glass" style={{ padding: 32, width: "min(520px, 100%)", display: "grid", gap: 16 }}>
        <h1 style={{ margin: 0, fontWeight: 400 }}>Set up this kiosk</h1>
        <p className="muted" style={{ margin: 0 }}>For staff. Enter the kiosk ID and the device token shown once in Admin → Kiosks. The token is stored only on this device.</p>
        <div className="field"><label htmlFor="kid">Kiosk ID</label><input id="kid" className="input" value={id} placeholder="K-17" onChange={(e) => setId(e.target.value)} /></div>
        <div className="field"><label htmlFor="ktok">Device token</label><input id="ktok" className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></div>
        {msg && <div className="banner bad" role="alert">{msg}</div>}
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
          {current ? <button className="btn btn-text" onClick={() => { clearCreds(); location.reload(); }}>Remove setup</button> : <span />}
          <button className="btn btn-filled" disabled={!id || !token || busy} onClick={test}>Check and save</button>
        </div>
      </div>
    </main>
  );
}
