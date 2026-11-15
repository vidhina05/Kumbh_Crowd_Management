# AI, languages, kiosk and camera: decisions

Each AI feature is here because it solves a specific problem. None of them is needed for the core flow: a family can register, get help and be found with all of them switched off.

## Final stack

| Need | Choice | Why this one | Key needed? | Cost |
|---|---|---|---|---|
| Speech-to-text, text-to-speech, translation in Indian languages | **Bhashini** (MeitY) | Built for 22 Indian languages, Government of India service, free, data stays with an Indian government platform | Yes (free registration) | Free |
| Fallback voice | Browser speech synthesis | Works offline on devices that have the language's voice | No | Free |
| Control-room assistant (Sahayak) | **Google Gemini 2.5 Flash** | Fast, cheap, good at short summaries | Yes | Free tier for testing; paid about $0.30 per million input / $2.50 per million output tokens |
| Database | **Postgres on Neon** | Standard SQL, works with any host, free tier for development | Connection string | Free tier; paid usage-based |
| Hosting | **Vercel** | Deploys from GitHub, preview links, cron | Account | Hobby free (non-commercial only); Pro $20/seat/month |
| SMS codes | **MSG91** | Indian provider, DLT-registered routes | Yes + DLT template | About ₹0.15–0.25 per OTP |
| Maps | None yet | The design uses static aerial images; live maps aren't needed for the core flow | — | — |
| Face detection / verification | Not built (see below) | — | — | — |

### Options considered

| | Bhashini | Google Cloud Speech + Translate | Azure AI Speech | Browser only |
|---|---|---|---|---|
| Indian languages | 22 (ASR, TTS, translation) | Many, quality varies | Many, strong neural voices | Depends on the device |
| Cost | Free | Paid per minute/character after a free allowance | Paid per minute/character | Free |
| Data residency | Indian government platform | Google regions | Azure regions (India available) | On device |
| Verdict | **Chosen** for a government Mela | Good fallback if Bhashini latency is too high | Good fallback for voice quality | Fallback only |

| | Gemini 2.5 Flash | OpenAI | Self-hosted open model |
|---|---|---|---|
| Fit | Short, factual summaries of a JSON snapshot | Similar | Needs GPU servers on site |
| Cost | Lowest of the hosted options | Higher | Hardware + operations |
| Verdict | **Chosen** | Possible swap (one file: `src/server/integrations/gemini.ts`) | Later, if data must never leave the premises |

## The AI features and the problems they solve

| Feature | Problem it solves | How it works | Data it sees | Status |
|---|---|---|---|---|
| Read aloud | Many pilgrims can't read the screen, or can't read their own script | Bhashini TTS for the current screen's guide text; browser voice as fallback | The on-screen text only | Built, needs key |
| Voice typing | Typing names in Indian scripts on a touch screen is slow | Microphone → 16 kHz WAV → Bhashini ASR → text in the field | Short audio clip, processed and discarded, never stored | Built, needs key |
| Sahayak | Control-room staff need quick answers across many screens ("which ghat has room?") | Gemini gets an aggregate snapshot: ghat percentages with source and age, open-case counts, active alerts, kiosk counts | **No names, phones or photos** | Built, needs key |
| Translation of staff alerts | Alerts typed in one language must reach pilgrims in theirs | Bhashini translation (function exists in `bhashini.ts`) | Alert text | Recommended next step |
| Crowd forecasting | Staff only see the current count | Needs real sensor or camera-count data first | — | Not built: no reliable data source yet |
| Voice language selection ("say your language") | Choosing a language before you can read the screen | Needs language identification before ASR; not reliable enough yet | — | Not built; the language buttons show each name in its own script |

## Multi-language design

- **10 kiosk languages:** Hindi, English, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi. Bhashini covers 22 languages, so Odia, Assamese, Urdu and Maithili can be added by translating `src/i18n/en.ts`.
- The language is chosen first. It can be switched on any screen from the top bar, and the screen keeps its state.
- Every script has a bundled Noto font, so nothing depends on fonts installed on the kiosk.
- Missing keys fall back to English, and a test checks that every translation keeps its `{placeholders}`.
- **English is the reviewed source. The other 9 languages are complete drafts that must be reviewed by native speakers before launch.**
- Speech errors: voice typing fills the field but never submits; the pilgrim sees the text and can correct it or retype it.

## Kiosk resilience

| Situation | What happens |
|---|---|
| Internet drops | Banner on screen; help and missing-person requests are saved on the kiosk and sent automatically when the connection returns (no duplicates). Registration needs a connection, because seats are shared, so the pilgrim is directed to a volunteer. |
| Voice service down or not configured | Read aloud falls back to the browser voice, otherwise "Voice is not available"; everything still works by touch |
| SMS not configured | Kiosk says it can't send codes and points to a volunteer |
| Pilgrim walks away | After 60 s of no touch: "Are you still there?" with 20 s to answer, then everything is cleared (including photos in memory) |
| After the pass | Screen resets itself after 45 s |
| Camera denied or missing | "The camera isn't available", and registration continues without a photo |
| Kiosk stolen or replaced | Super admin disables it or issues a new token in Admin → Kiosks |

## Face recognition

**Decision: not built.** The kiosk takes a photo of a child only if the parent ticks a separate consent box. The photo is encrypted, shown to staff only while a lost-person case for that child is open (every view is logged), and deleted 48 hours after the bathing slot.

Why no face matching:
- **DPDP Act 2023:** biometric data needs specific, informed consent, data minimisation and purpose limitation. Matching every face at a Mela against a database is close to surveillance, and the consent of the person being matched (often a child) is hard to obtain.
- **Accuracy at scale:** with crores of pilgrims, even a 0.1% false-match rate produces thousands of wrong matches. That's a real risk of handing a child to the wrong adult.
- **It's not needed for the core job:** wristbands, the pass number, the phone number and staff with a photo already reunite families.

If the Mela authority decides it wants **consent-based face verification** (1:1, "is this the registered child?", not 1:N search), the safest architecture is:
1. Run detection and embedding on the kiosk or a local edge server (e.g. MediaPipe Face Detector, an open face-embedding model), never a cloud API.
2. Store only an encrypted embedding, never a searchable gallery, and delete it with the family's data.
3. Use it only inside an open lost-child case, with a staff member confirming every match.
4. Keep the existing alternatives (pass QR, phone number, wristband ID, staff).
5. Get a Data Protection Impact Assessment and legal sign-off before go-live.

AWS Rekognition and similar cloud services are **not recommended**: children's biometric data would leave India-controlled infrastructure, and per-image pricing grows with crowd size.

## Costs

Rough monthly costs for a Mela month with ~200 kiosks, ~50 staff and ~5 lakh registrations. The free-tier pages are linked so you can check current prices.

| Item | Estimate | Notes |
|---|---|---|
| Vercel Pro | $20 per deploying seat + usage | [Hobby is non-commercial only](https://vercel.com/pricing) |
| Neon Postgres | $15–70 | [Usage-based](https://neon.com/pricing); free tier is too small for the event |
| SMS codes (MSG91) | ~₹75,000–1,25,000 for 5 lakh codes | ~₹0.15–0.25 per OTP + 18% GST; DLT registration needed |
| Bhashini | ₹0 | Free government service |
| Gemini | Under $10 | ~20 staff questions/hour × ~2k tokens each ≈ 15 M tokens/month at [$0.30 / $2.50 per million](https://ai.google.dev/gemini-api/docs/pricing) |
| Kiosk hardware, printers, wristbands | Not estimated | Outside this repository |
