/**
 * Languages offered on the kiosk: the 22 languages of the Eighth Schedule, English, and Bhojpuri
 * (spoken by a large share of Prayagraj pilgrims). Order = how they appear on the welcome screen.
 * - `bhashini`: code used by the Bhashini speech and translation APIs.
 * - `speech`: BCP-47 tag for the browser's speech voices and recognition.
 * - `voiceFallback`: browser voices that can read this script well enough when no voice exists for the language itself
 *   (e.g. a Hindi voice reads Maithili or Sanskrit Devanagari). Used only when Bhashini isn't configured.
 */
export const LANGUAGES = [
  { code: "hi", short: "हिं", native: "हिन्दी", english: "Hindi", bhashini: "hi", speech: "hi-IN", script: "Deva", rtl: false, voiceFallback: [] },
  { code: "en", short: "EN", native: "English", english: "English", bhashini: "en", speech: "en-IN", script: "Latn", rtl: false, voiceFallback: ["en-GB", "en-US"] },
  { code: "bho", short: "भो", native: "भोजपुरी", english: "Bhojpuri", bhashini: "bho", speech: "hi-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "bn", short: "বাং", native: "বাংলা", english: "Bengali", bhashini: "bn", speech: "bn-IN", script: "Beng", rtl: false, voiceFallback: ["bn-BD"] },
  { code: "mr", short: "मरा", native: "मराठी", english: "Marathi", bhashini: "mr", speech: "mr-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "gu", short: "ગુજ", native: "ગુજરાતી", english: "Gujarati", bhashini: "gu", speech: "gu-IN", script: "Gujr", rtl: false, voiceFallback: [] },
  { code: "ta", short: "தமி", native: "தமிழ்", english: "Tamil", bhashini: "ta", speech: "ta-IN", script: "Taml", rtl: false, voiceFallback: [] },
  { code: "te", short: "తెలు", native: "తెలుగు", english: "Telugu", bhashini: "te", speech: "te-IN", script: "Telu", rtl: false, voiceFallback: [] },
  { code: "or", short: "ଓଡ଼ି", native: "ଓଡ଼ିଆ", english: "Odia", bhashini: "or", speech: "or-IN", script: "Orya", rtl: false, voiceFallback: [] },
  { code: "kn", short: "ಕನ್ನ", native: "ಕನ್ನಡ", english: "Kannada", bhashini: "kn", speech: "kn-IN", script: "Knda", rtl: false, voiceFallback: [] },
  { code: "ur", short: "اردو", native: "اردو", english: "Urdu", bhashini: "ur", speech: "ur-IN", script: "Arab", rtl: true, voiceFallback: ["ur-PK"] },
  { code: "ml", short: "മല", native: "മലയാളം", english: "Malayalam", bhashini: "ml", speech: "ml-IN", script: "Mlym", rtl: false, voiceFallback: [] },
  { code: "pa", short: "ਪੰਜਾ", native: "ਪੰਜਾਬੀ", english: "Punjabi", bhashini: "pa", speech: "pa-IN", script: "Guru", rtl: false, voiceFallback: [] },
  { code: "as", short: "অস", native: "অসমীয়া", english: "Assamese", bhashini: "as", speech: "as-IN", script: "Beng", rtl: false, voiceFallback: ["bn-IN"] },
  { code: "mai", short: "मै", native: "मैथिली", english: "Maithili", bhashini: "mai", speech: "mai-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "ne", short: "ने", native: "नेपाली", english: "Nepali", bhashini: "ne", speech: "ne-NP", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "sa", short: "सं", native: "संस्कृतम्", english: "Sanskrit", bhashini: "sa", speech: "sa-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "kok", short: "कों", native: "कोंकणी", english: "Konkani", bhashini: "gom", speech: "kok-IN", script: "Deva", rtl: false, voiceFallback: ["mr-IN", "hi-IN"] },
  { code: "doi", short: "डो", native: "डोगरी", english: "Dogri", bhashini: "doi", speech: "doi-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "brx", short: "बड़", native: "बड़ो", english: "Bodo", bhashini: "brx", speech: "brx-IN", script: "Deva", rtl: false, voiceFallback: ["hi-IN"] },
  { code: "ks", short: "کٲ", native: "کٲشُر", english: "Kashmiri", bhashini: "ks", speech: "ks-IN", script: "Arab", rtl: true, voiceFallback: ["ur-IN", "ur-PK"] },
  { code: "sd", short: "سن", native: "سنڌي", english: "Sindhi", bhashini: "sd", speech: "sd-IN", script: "Arab", rtl: true, voiceFallback: ["ur-IN", "ur-PK"] },
  { code: "mni", short: "ꯃꯩ", native: "ꯃꯩꯇꯩꯂꯣꯟ", english: "Manipuri", bhashini: "mni", speech: "mni-IN", script: "Mtei", rtl: false, voiceFallback: [] },
  { code: "sat", short: "ᱥᱟ", native: "ᱥᱟᱱᱛᱟᱲᱤ", english: "Santali", bhashini: "sat", speech: "sat-IN", script: "Olck", rtl: false, voiceFallback: [] },
] as const;

export type LangCode = (typeof LANGUAGES)[number]["code"];
export const LANG_CODES = LANGUAGES.map((l) => l.code) as unknown as [LangCode, ...LangCode[]];

export function isLang(v: unknown): v is LangCode {
  return typeof v === "string" && (LANG_CODES as readonly string[]).includes(v);
}
