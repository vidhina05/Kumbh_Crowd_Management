"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "@/admin/admin.css";
import "./login.css";
import { AdminApiError, api } from "@/admin/client";
import { BASE_PATH, IS_DEMO } from "@/shared/base";
import { ROLE_LABELS, type Role } from "@/shared/rbac";
import { faceEngine, faceTemplate } from "@/shared/client/face";

type Start = { loginToken: string; name: string; role: Role; staffCode: string; face: boolean; faceTriesLeft: number; code: boolean };
type Step = "id" | "face" | "pin" | "code" | "post";
type DemoInfo = { staff: { email: string; name: string; role: string }[]; password: string };
const POSTS = ["Sangam Control", "Sector 4 Post", "Arail Post", "Mobile unit"];
const T = {
  en: { guide: "Guide", millions: "the millions", safely: "safely to Sangam.", intro: "One control room for the Maha Kumbh. Every ghat, gate and family on a single live map.", signIn: "Sign in to your shift", staffId: "Staff ID", staffHint: "On the back of your control-room card", faceBtn: "Continue with face scan", pinBtn: "Use a security key or staff PIN", continue: "Continue", hold: "Hold still,", how: "How it works", look: "Look at the camera", lookSub: "About 3 seconds. Stay still in good light.", match: "We match your face to your staff ID", matchSub: "The image is checked on this device and never stored.", didnt: "Didn't match?", didntSub: "You get 2 more tries, then use your security key or PIN.", signingAs: "Signing in as", oneTime: "Use a one-time code", back: "Back", pin: "Staff PIN or password", morning: "Morning,", afternoon: "Afternoon,", evening: "Evening,", workingFrom: "Working from", start: "Start shift", since: "Since you left", onShift: "On shift with you", locked: "Locked out? Call the control desk on 1920", encrypted: "Encrypted link to Mela HQ", logged: "Every action is logged to your staff ID", theme: "Theme", liveGhats: "ghats live", signToView: "Live · sign in to view" },
  hi: { guide: "मार्गदर्शन", millions: "लाखों श्रद्धालुओं का", safely: "सुरक्षित संगम तक।", intro: "महाकुंभ के लिए एक नियंत्रण कक्ष। हर घाट, द्वार और परिवार एक लाइव नक्शे पर।", signIn: "अपनी शिफ़्ट में साइन इन करें", staffId: "स्टाफ़ आईडी", staffHint: "आपके कंट्रोल-रूम कार्ड के पीछे", faceBtn: "चेहरा स्कैन से आगे बढ़ें", pinBtn: "सुरक्षा कुंजी या स्टाफ़ पिन", continue: "आगे बढ़ें", hold: "स्थिर रहें,", how: "यह कैसे काम करता है", look: "कैमरे की ओर देखें", lookSub: "लगभग 3 सेकंड। अच्छी रोशनी में स्थिर रहें।", match: "हम आपका चेहरा आपकी स्टाफ़ आईडी से मिलाते हैं", matchSub: "छवि इसी डिवाइस पर जाँची जाती है और कभी सहेजी नहीं जाती।", didnt: "मेल नहीं हुआ?", didntSub: "2 और प्रयास, फिर सुरक्षा कुंजी या पिन।", signingAs: "साइन इन कर रहे हैं", oneTime: "वन-टाइम कोड का उपयोग करें", back: "वापस", pin: "स्टाफ़ पिन या पासवर्ड", morning: "सुप्रभात,", afternoon: "नमस्ते,", evening: "शुभ संध्या,", workingFrom: "कहाँ से काम", start: "शिफ़्ट शुरू करें", since: "आपके जाने के बाद", onShift: "आपके साथ शिफ़्ट पर", locked: "लॉक हो गए? कंट्रोल डेस्क 1920 पर कॉल करें", encrypted: "मेला मुख्यालय से एन्क्रिप्टेड लिंक", logged: "हर कार्रवाई आपकी स्टाफ़ आईडी से दर्ज", theme: "थीम", liveGhats: "घाट लाइव", signToView: "लाइव · देखने के लिए साइन इन" },
};

function shiftNow() {
  const ist = new Date(Date.now() + 330 * 60_000);
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (m >= 330 && m < 810) return { n: 2, range: "05:30 to 13:30" };
  if (m >= 810 && m < 1290) return { n: 3, range: "13:30 to 21:30" };
  return { n: 1, range: "21:30 to 05:30" };
}

export default function SignIn() {
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "hi">("en");
  const t = T[lang];
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [step, setStep] = useState<Step>("id");
  const [staffId, setStaffId] = useState("");
  const [who, setWho] = useState<Start | null>(null);
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "light" | "dark") ?? "light");
    try { if (localStorage.getItem("admin.lang") === "hi") setLang("hi"); } catch { /* ignore */ }
    void fetch(`${BASE_PATH}/api/health`).then((r) => setHealth(r.ok)).catch(() => setHealth(false));
    if (!IS_DEMO) return;
    const w = window as unknown as { __demoApi?: { info: () => DemoInfo } };
    const iv = setInterval(() => { if (w.__demoApi) { setDemo(w.__demoApi.info()); clearInterval(iv); setHealth(true); } }, 200);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3500); return () => clearTimeout(id); }, [toast]);
  const toggleTheme = () => { const n = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = n; try { localStorage.setItem("theme", n); } catch { /* ignore */ } setTheme(n); };
  const chooseLang = (l: "en" | "hi") => { setLang(l); try { localStorage.setItem("admin.lang", l); } catch { /* ignore */ } };

  const afterSession = useCallback(async () => {
    try {
      const me = await api<{ user: { role: Role } }>("/api/admin/me");
      const cur = await api<{ shift: unknown }>("/api/admin/shifts/current").catch(() => ({ shift: true }));
      if (!cur.shift && me.user) { setStep("post"); return; }
    } catch { /* fall through */ }
    const next = new URLSearchParams(location.search).get("next");
    router.replace(next && next.startsWith("/admin") && !next.startsWith("/admin/login") ? next : "/admin");
  }, [router]);

  const handleResult = async (r: { mfaRequired?: boolean; mfaToken?: string }) => {
    if (r.mfaRequired && r.mfaToken) { setMfaToken(r.mfaToken); setStep("code"); return; }
    await afterSession();
  };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed."); } finally { setBusy(false); } };

  const submitId = (e?: React.FormEvent, idOverride?: string) => { e?.preventDefault(); void run(async () => {
    const s = await api<Start>("/api/admin/auth/start", { body: { staffId: idOverride ?? staffId } });
    setWho(s);
    setStep(s.face ? "face" : "pin");
  }); };
  const submitPin = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await handleResult(await api("/api/admin/auth/pin", { body: { loginToken: who!.loginToken, password: pw } })); }); };
  const submitCode = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await api("/api/admin/auth/mfa", { body: { mfaToken, code } }); await afterSession(); }); };
  /** Demo only: sign straight in with the demo PIN, unless this person has turned on face sign-in. */
  const demoSignIn = (email: string) => { setStaffId(email); void run(async () => {
    const s = await api<Start>("/api/admin/auth/start", { body: { staffId: email } });
    setWho(s);
    if (s.face) { setStep("face"); return; }
    await handleResult(await api("/api/admin/auth/pin", { body: { loginToken: s.loginToken, password: demo!.password } }));
  }); };

  const firstName = who?.name.replace(/^Dr\.?\s+/, "").split(" ")[0] ?? "";
  const stepNo = step === "id" ? 1 : step === "post" ? 3 : 2;

  return (
    <div className={`li li-${step}`} lang={lang}>
      <div className="li-glow a" aria-hidden="true" /><div className="li-glow b" aria-hidden="true" />
      <header className="li-top">
        <div className="li-brand"><span className="logo"><span className="icon">waves</span></span><b>Sangam Command</b></div>
        {step !== "id" && step !== "post" && <button className="li-back" onClick={() => { setStep("id"); setErr(null); setPw(""); setCode(""); }}><span className="icon sm">arrow_back</span>{t.back}</button>}
        <div className="li-center">
          {step === "id" ? (
            <div className="li-status"><span className={`chip-dot${health === false ? " bad" : ""}`}><i />{health === false ? "Server unreachable" : "All systems live"}</span><span>Encrypted</span><span>12 ghats</span></div>
          ) : step === "post" ? (
            <div className="li-steps-line" aria-label="Step 3 of 3">{["Sign in", "Verify", "Start shift"].map((s, i) => <span key={s} className={i < 2 ? "done" : "now"}>{i < 2 ? "✓" : "●"} {s}</span>)}</div>
          ) : (
            <div className="li-stepper" aria-label={`Step ${stepNo} of 3`}>{["Staff ID", step === "pin" ? "PIN" : step === "code" ? "Code" : "Face scan", "Command post"].map((s, i) => <span key={s} aria-current={i + 1 === stepNo ? "step" : undefined}>{i + 1}&nbsp;&nbsp;{s}</span>)}</div>
          )}
        </div>
        <div className="li-actions">
          <div className="li-lang" role="group" aria-label="Language"><button aria-pressed={lang === "en"} onClick={() => chooseLang("en")}>EN</button><button aria-pressed={lang === "hi"} onClick={() => chooseLang("hi")} lang="hi">हिं</button></div>
          <button className="a-theme" onClick={toggleTheme} role="switch" aria-checked={theme === "dark"}><span>{t.theme}</span><span className="track"><span className="handle"><span className="icon sm">{theme === "dark" ? "dark_mode" : "light_mode"}</span></span></span></button>
        </div>
      </header>

      {(step === "id" || step === "post") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="li-hero" src={`${BASE_PATH}/art/dwar.png`} alt="Illustrated gateway of Mahakumbh Prayagraj at sunrise" />
      )}

      {step === "id" && (
        <>
          <section className="li-left">
            <h1><span className="g1">{t.guide}</span><br /><span className="g2">{t.millions}</span><br /><span className="g3">{t.safely}</span></h1>
            <p className="li-intro">{t.intro}</p>
            <div className="li-card">
              <h2>{t.signIn}</h2>
              {step === "id" && (
                <form onSubmit={submitId} className="li-form">
                  <label className="li-field">
                    <span className="icon">badge</span>
                    <span className="in"><small>{t.staffId}</small><input value={staffId} onChange={(e) => setStaffId(e.target.value)} autoComplete="username" placeholder="KMB-ADM-1186" required minLength={3} maxLength={120} aria-describedby="sid-hint" /></span>
                    {who && <span className="icon ok">check_circle</span>}
                  </label>
                  <small id="sid-hint" className="li-hint">{t.staffHint}</small>
                  {err && <div className="banner bad" role="alert" style={{ fontSize: 13 }}><span className="icon sm">error</span> {err}</div>}
                  <button className="btn btn-filled li-cta" disabled={busy || staffId.trim().length < 3}><span className="icon sm">north_east</span>{busy ? "…" : t.faceBtn}</button>
                  <button type="button" className="btn btn-text li-alt" disabled={busy || staffId.trim().length < 3} onClick={() => void run(async () => { const s = await api<Start>("/api/admin/auth/start", { body: { staffId } }); setWho(s); setStep("pin"); })}><span className="icon sm">key</span>{t.pinBtn}</button>
                </form>
              )}
            </div>
            {IS_DEMO && (
              <div className="li-demo" aria-label="Demo accounts">
                <b>Demo staff</b> · password <code>{demo?.password ?? "…"}</code>
                <div>{demo ? demo.staff.map((s) => <button key={s.email} type="button" onClick={() => demoSignIn(s.email)} disabled={busy} title={`${ROLE_LABELS[s.role as Role] ?? s.role} · ${s.email}`}>{s.name}</button>) : <span className="muted">Starting the demo database…</span>}</div>
              </div>
            )}
          </section>
          <aside className="li-right" aria-label="Live ghats">
            {["Sangam Ghat", "Arail Ghat", "Ram Ghat"].map((g, i) => (
              <button key={g} className={`li-ghat${i === 0 ? " on" : ""}`} onClick={() => setToast("Sign in to open the live ghat view.")}>
                <span className="thumb" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)`, backgroundPosition: ["62% 30%", "80% 70%", "20% 60%"][i] }} />
                <span className="txt"><b>{g}</b><small>{t.signToView}</small></span>
                <span className="icon">lock</span>
              </button>
            ))}
            <div className="li-pager"><span className="icon-btn"><span className="icon">arrow_back</span></span><span className="icon-btn"><span className="icon">arrow_forward</span></span><span>12 {t.liveGhats}</span></div>
          </aside>
          <footer className="li-foot"><span>{t.locked}</span><span>{t.encrypted}</span><span>{t.logged}</span></footer>
        </>
      )}

      {(step === "face" || step === "pin" || step === "code") && who && (
        <>
          <section className="li-left">
            <h1 className="li-hold"><span className="g1">{step === "face" ? t.hold : step === "code" ? "Enter the code," : "Your PIN,"}</span><br /><span className="g2">{firstName}</span></h1>
            <p className="li-intro">{step === "face" ? "Look at the camera above this screen. It takes about 3 seconds. We never store the image." : step === "code" ? "Open your authenticator app and type the 6-digit code for Sangam Command." : who.face ? "Use your staff PIN or password." : "Face sign-in isn't set up for this staff ID yet. Use your staff PIN or password. You can turn on face sign-in in Settings."}</p>
            {step === "face" && (
              <div className="li-how">
                <b>{t.how}</b>
                <div><span className="icon sm">photo_camera</span><span><b>{t.look}</b><small>{t.lookSub}</small></span></div>
                <div><span className="icon sm">verified_user</span><span><b>{t.match}</b><small>{t.matchSub}</small></span></div>
                <div><span className="icon sm">key</span><span><b>{t.didnt}</b><small>{t.didntSub}</small></span></div>
              </div>
            )}
          </section>
          <section className="li-scan-card">
            {step === "face" && <FaceScan who={who} onDone={(r) => void handleResult(r)} onFallback={() => setStep("pin")} />}
            {step === "pin" && (
              <form onSubmit={submitPin} className="li-form li-pin">
                <span className="icon lg" style={{ color: "var(--primary)" }}>key</span>
                <label className="li-field"><span className="icon">password</span><span className="in"><small>{t.pin}</small><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></span></label>
                {err && <div className="banner bad" role="alert" style={{ fontSize: 13 }}><span className="icon sm">error</span> {err}</div>}
                <button className="btn btn-filled li-cta" disabled={busy || !pw}>{busy ? "Checking…" : t.continue}</button>
                {who.face && <button type="button" className="btn btn-text" onClick={() => setStep("face")}><span className="icon sm">face</span>{t.faceBtn}</button>}
              </form>
            )}
            {step === "code" && (
              <form onSubmit={submitCode} className="li-form li-pin">
                <span className="icon lg" style={{ color: "var(--primary)" }}>pin</span>
                <label className="li-field"><span className="icon">dialpad</span><span className="in"><small>6-digit code</small><input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ letterSpacing: 8, fontSize: 22 }} /></span></label>
                {err && <div className="banner bad" role="alert" style={{ fontSize: 13 }}><span className="icon sm">error</span> {err}</div>}
                <button className="btn btn-filled li-cta" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Verify and sign in"}</button>
              </form>
            )}
          </section>
          <aside className="li-as">
            <small>{t.signingAs}</small>
            <div className="who"><span className="a-avatar">{initials(who.name)}</span><span><b>{who.name}</b><small>{ROLE_LABELS[who.role]}</small></span></div>
            <dl><dt>Staff ID</dt><dd className="mono">{who.staffCode}</dd><dt>Shift</dt><dd>Shift {shiftNow().n} · {shiftNow().range}</dd><dt>Post</dt><dd>Sangam Control</dd></dl>
          </aside>
          {step === "face" && who.code && <button className="li-onetime" onClick={() => setStep("pin")}><span className="icon sm">dialpad</span>{t.pinBtn}</button>}
        </>
      )}

      {step === "post" && <StartShift t={t} onStarted={() => router.replace("/admin")} />}
      {toast && <div className="li-toast" role="status">{toast}</div>}
    </div>
  );
}

const initials = (n: string) => n.replace(/^Dr\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function FaceScan({ who, onDone, onFallback }: { who: Start; onDone: (r: { mfaRequired?: boolean; mfaToken?: string }) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "looking" | "matching" | "error">("starting");
  const [msg, setMsg] = useState<string>("Starting the camera…");
  const [tries, setTries] = useState(who.faceTriesLeft);
  const busy = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, timer = 0;
    (async () => {
      try {
        const [s] = await Promise.all([navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false }), faceEngine()]);
        if (stop) return s.getTracks().forEach((x) => x.stop());
        stream = s; video.current!.srcObject = s; await video.current!.play();
        setState("looking"); setMsg(`Matching · ${who.staffCode}`);
        const good: { template: string; score: number; real: number; live: number }[] = [];
        let started = Date.now();
        const tick = async () => {
          if (stop || busy.current) return;
          const v = video.current;
          if (v && v.videoWidth) {
            const f = await faceTemplate(v);
            // Don't spend a try on a blurry or half-turned frame: gather a few clear frames over ~2 s and send the
            // one the anti-spoofing/liveness models trust most. If none look live, coach instead of failing.
            if (f.ok && f.score > 0.6) good.push(f);
            else if (!f.ok && good.length === 0) setMsg(f.message);
            const ready = good.length >= 4 || (good.length > 0 && Date.now() - started > 6000);
            if (!ready) { timer = window.setTimeout(() => void tick(), 350); return; }
            const best = good.sort((x, y) => y.real * y.live - x.real * x.live)[0];
            good.length = 0; started = Date.now();
            if (best.real < 0.4 || best.live < 0.4) { setMsg("Hold still and look straight at the camera, in front of a light."); timer = window.setTimeout(() => void tick(), 350); return; }
            {
              const f = best;
              busy.current = true; setState("matching");
              try {
                const r = await api<{ mfaRequired?: boolean; mfaToken?: string }>("/api/admin/auth/face", { body: { loginToken: who.loginToken, template: f.template, real: f.real, live: f.live } });
                onDone(r); return;
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "That didn't match.");
                setTries((n) => n - 1);
                setState("error");
                if (e instanceof AdminApiError && (e.code === "face_locked" || e.status === 423)) { setTimeout(onFallback, 1800); return; }
                await new Promise((r) => setTimeout(r, 2200));
                busy.current = false; setState("looking");
              }
            }
          }
          timer = window.setTimeout(() => void tick(), 500);
        };
        void tick();
      } catch { setState("error"); setMsg("The camera isn't available on this console. Use your PIN."); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((x) => x.stop()); };
  }, [who, onDone, onFallback]);

  return (
    <div className={`li-scan ${state}`}>
      <div className="ticks" aria-hidden="true">{Array.from({ length: 60 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 6}deg) translateY(-150px)` }} />)}</div>
      <div className="brk" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="lens"><video ref={video} playsInline muted aria-label="Camera: look here" /><span className="sweep" aria-hidden="true" /></div>
      <div className="cap mono" role="status" aria-live="polite">{msg}{state === "error" && tries > 0 ? ` · ${tries} left` : ""}</div>
      {state === "error" && <button className="btn btn-text" onClick={onFallback}><span className="icon sm">key</span>Use PIN instead</button>}
    </div>
  );
}

function StartShift({ t, onStarted }: { t: (typeof T)["en"]; onStarted: () => void }) {
  const [me, setMe] = useState<{ name: string } | null>(null);
  const [handover, setHandover] = useState<{ from: string; endedAt: string | null; notes: string | null } | null>(null);
  const [since, setSince] = useState<{ title: string; body: string; at: string }[]>([]);
  const [others, setOthers] = useState<string[]>([]);
  const [post, setPost] = useState(POSTS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void api<{ user: { name: string } }>("/api/admin/me").then((r) => setMe(r.user));
    void api<{ handover: typeof handover }>("/api/admin/shifts/current").then((r) => setHandover(r.handover)).catch(() => undefined);
    void api<{ alerts: { title: string; message: string; createdAt: string }[]; ghats: { name: string; percent: number; safeLimitPct: number; projection: { trend: string } }[]; onShift: string[]; now: string }>("/api/admin/live").then((l) => {
      const items = l.ghats.filter((g) => g.percent >= g.safeLimitPct - 10).map((g) => ({ title: `${g.name} at ${g.percent}%`, body: g.projection.trend === "rising" ? "Rising" : g.projection.trend === "falling" ? "Emptying" : "Steady", at: l.now }));
      for (const a of l.alerts) items.push({ title: a.title, body: a.message, at: new Date(a.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) });
      setSince(items.slice(0, 3)); setOthers(l.onShift);
    }).catch(() => undefined);
  }, []);
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  const greet = h < 12 ? t.morning : h < 17 ? t.afternoon : t.evening;
  const sh = shiftNow();
  const start = async () => { setBusy(true); setErr(null); try { await api("/api/admin/shifts/current", { body: { controlRoom: post } }); onStarted(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't start the shift."); setBusy(false); } };
  return (
    <>
      <section className="li-left">
        <h1 className="li-hold"><span className="g1">{greet}</span><br /><span className="g2">{me?.name.replace(/^Dr\.?\s+/, "").split(" ")[0] ?? ""}</span></h1>
        <p className="li-intro">{handover ? `${handover.from} handed over${handover.endedAt ? ` at ${new Date(handover.endedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}` : ""}${handover.notes ? `: “${handover.notes}”` : "."}` : "No handover notes for you. Here is what is happening now."}</p>
        <h2 className="li-shift">Shift {sh.n}</h2>
        <div className="li-post">
          <div className="time">{sh.range}</div>
          <small>{t.workingFrom}</small>
          <div className="chips" role="radiogroup" aria-label={t.workingFrom}>{POSTS.map((p) => <button key={p} role="radio" aria-checked={post === p} onClick={() => setPost(p)}>{post === p && <span className="icon sm">check</span>}{p}</button>)}</div>
        </div>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <button className="btn btn-filled li-cta" style={{ justifySelf: "start" }} onClick={start} disabled={busy}><span className="icon sm">north_east</span>{busy ? "Starting…" : t.start}</button>
      </section>
      <aside className="li-right li-since">
        <small>{t.since}</small>
        {since.length === 0 ? <div className="li-ghat"><span className="txt"><b>All quiet</b><small>No alerts and every ghat below its limit.</small></span></div> : since.map((s, i) => (
          <div key={i} className={`li-ghat${i === 0 ? " on" : ""}`}><span className="thumb" style={{ backgroundImage: `url(${BASE_PATH}/art/aerial-light.jpg)`, backgroundPosition: ["62% 30%", "30% 60%", "85% 75%"][i] }} /><span className="txt"><b>{s.title}</b><small>{s.body}</small></span><span className="mono" style={{ fontSize: 12 }}>{s.at}</span></div>
        ))}
        <div className="li-team"><small>{t.onShift}</small>{others.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>Nobody else has started a shift yet.</span> : others.map((n) => <div key={n}><span className="av">{initials(n)}</span>{n}</div>)}</div>
      </aside>
    </>
  );
}
