/** Languages offered on the kiosk. `bhashini` = ISO 639 code used by the Bhashini speech and translation APIs. */
export const LANGUAGES = [
  { code: "hi", short: "हिं", native: "हिन्दी", english: "Hindi", bhashini: "hi", speech: "hi-IN" },
  { code: "en", short: "EN", native: "English", english: "English", bhashini: "en", speech: "en-IN" },
  { code: "mr", short: "मरा", native: "मराठी", english: "Marathi", bhashini: "mr", speech: "mr-IN" },
  { code: "gu", short: "ગુજ", native: "ગુજરાતી", english: "Gujarati", bhashini: "gu", speech: "gu-IN" },
  { code: "bn", short: "বাং", native: "বাংলা", english: "Bengali", bhashini: "bn", speech: "bn-IN" },
  { code: "ta", short: "தமி", native: "தமிழ்", english: "Tamil", bhashini: "ta", speech: "ta-IN" },
  { code: "te", short: "తెలు", native: "తెలుగు", english: "Telugu", bhashini: "te", speech: "te-IN" },
  { code: "kn", short: "ಕನ್ನ", native: "ಕನ್ನಡ", english: "Kannada", bhashini: "kn", speech: "kn-IN" },
  { code: "ml", short: "മല", native: "മലയാളം", english: "Malayalam", bhashini: "ml", speech: "ml-IN" },
  { code: "pa", short: "ਪੰਜਾ", native: "ਪੰਜਾਬੀ", english: "Punjabi", bhashini: "pa", speech: "pa-IN" },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];
export const LANG_CODES = LANGUAGES.map((l) => l.code) as unknown as [LangCode, ...LangCode[]];

export function isLang(v: unknown): v is LangCode {
  return typeof v === "string" && (LANG_CODES as readonly string[]).includes(v);
}
