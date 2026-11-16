"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Control-room text in English and Hindi (the EN / हिं switch on the rail). */
const en = {
  sahayak: "Sahayak", overview: "Overview", families: "Families", batches: "Batches", alerts: "Alerts", help: "Help", lost: "Lost & found", reports: "Reports",
  command: "Command", liveMap: "Live map", view3d: "3D view", search: "Family, ghat or case", theme: "Theme", notifications: "Notifications",
  critical: "Critical", allClear: "All ghats within safe limits", myShiftReport: "My shift report", switchPost: "Switch command post", testOffline: "Test offline mode",
  testFailedSignIn: "Test a failed sign-in", settings: "Settings", castWall: "Cast to wall screen", signOut: "Sign out", adminTools: "Admin tools",
  kiosks: "Kiosks", sensors: "Sensors", staff: "Staff", activity: "Activity", diversions: "Diversions", shift: "Shift",
  needsYouNow: "Needs you now", sahayakProposes: "Sahayak proposes", divertN: "Divert {n} batches", viewGhat: "View ghat", otherGhats: "Other ghats", allN: "All {n}",
  pilgrimsInside: "Pilgrims inside", batchesDone: "Batches done", helpRequests: "Help requests", nextPeak: "Next peak", live: "Live", updated: "updated {t}",
  crowd: "Crowd", gates: "Gates", cameras: "Cameras", medical: "Medical", waterPoints: "Water points", lakh: "lakh", of: "of {n}", open: "open",
  onSchedule: "On schedule", overfull: "{n} over-full", lostMedical: "{lost} lost, {medical} medical", booked: "{n} booked", noPeak: "No more batches today",
  overLimit: "Over the safe limit of {limit}% and {trend}.", underLimit: "Below the safe limit of {limit}%. {trend}.", rising: "rising", steady: "steady", falling: "falling",
  fullIn: "Full in about {m} minutes.", allCalm: "Every ghat is below its safe limit.", nothingToDivert: "No batch needs to move right now.", sureN: "{n}% sure",
  planHolds: "Plan holds for {m} min", extraWalk: "Extra walk", simulated: "Simulated", sensorsLabel: "{n} sensors", noAlerts: "Nothing new.",
  needsAction: "Needs action", forInfo: "For info", searchNoResults: "No family, ghat or case matches “{q}”.", ghatsLabel: "Ghats", casesLabel: "Cases",
};
export type AdminKey = keyof typeof en;
const hi: Partial<Record<AdminKey, string>> = {
  sahayak: "सहायक", overview: "अवलोकन", families: "परिवार", batches: "बैच", alerts: "सूचनाएँ", help: "मदद", lost: "खोया-पाया", reports: "रिपोर्ट",
  command: "कमान", liveMap: "लाइव नक्शा", view3d: "3D दृश्य", search: "परिवार, घाट या केस", theme: "थीम", notifications: "सूचनाएँ",
  critical: "गंभीर", allClear: "सभी घाट सुरक्षित सीमा में", myShiftReport: "मेरी शिफ़्ट रिपोर्ट", switchPost: "कमान पोस्ट बदलें", testOffline: "ऑफ़लाइन मोड जाँचें",
  testFailedSignIn: "असफल साइन-इन जाँचें", settings: "सेटिंग्स", castWall: "दीवार स्क्रीन पर दिखाएँ", signOut: "साइन आउट", adminTools: "प्रशासन",
  kiosks: "कियोस्क", sensors: "सेंसर", staff: "कर्मचारी", activity: "गतिविधि", diversions: "डायवर्ज़न", shift: "शिफ़्ट",
  needsYouNow: "अभी आपकी ज़रूरत", sahayakProposes: "सहायक का सुझाव", divertN: "{n} बैच मोड़ें", viewGhat: "घाट देखें", otherGhats: "अन्य घाट", allN: "सभी {n}",
  pilgrimsInside: "अंदर श्रद्धालु", batchesDone: "बैच पूरे", helpRequests: "मदद अनुरोध", nextPeak: "अगली भीड़", live: "लाइव", updated: "{t} अपडेट",
  crowd: "भीड़", gates: "द्वार", cameras: "कैमरे", medical: "चिकित्सा", waterPoints: "पानी", lakh: "लाख", of: "{n} में से", open: "खुले",
  onSchedule: "समय पर", overfull: "{n} ज़्यादा भरे", lostMedical: "{lost} खोए, {medical} चिकित्सा", booked: "{n} बुक", noPeak: "आज और बैच नहीं",
  overLimit: "{limit}% की सुरक्षित सीमा से ऊपर, {trend}।", underLimit: "{limit}% की सुरक्षित सीमा से नीचे। {trend}।", rising: "बढ़ रही", steady: "स्थिर", falling: "घट रही",
  fullIn: "लगभग {m} मिनट में भर जाएगा।", allCalm: "हर घाट अपनी सुरक्षित सीमा से नीचे है।", nothingToDivert: "अभी किसी बैच को मोड़ने की ज़रूरत नहीं।", sureN: "{n}% भरोसा",
  planHolds: "योजना {m} मिनट मान्य", extraWalk: "अतिरिक्त पैदल", simulated: "सिम्युलेटेड", sensorsLabel: "{n} सेंसर", noAlerts: "कुछ नया नहीं।",
  needsAction: "कार्रवाई ज़रूरी", forInfo: "जानकारी", searchNoResults: "“{q}” से कोई परिवार, घाट या केस नहीं मिला।", ghatsLabel: "घाट", casesLabel: "केस",
};

type Lang = "en" | "hi";
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: AdminKey, v?: Record<string, string | number>) => string }>({ lang: "en", setLang: () => undefined, t: (k) => en[k] });

export function AdminI18n({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => { try { if (localStorage.getItem("admin.lang") === "hi") setLangState("hi"); } catch { /* storage off */ } }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem("admin.lang", l); } catch { /* storage off */ } }, []);
  const t = useCallback((k: AdminKey, v?: Record<string, string | number>) => {
    let s = (lang === "hi" ? hi[k] : undefined) ?? en[k];
    if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll(`{${a}}`, String(b));
    return s;
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
export const useAdminT = () => useContext(Ctx);
