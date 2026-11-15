# Security and privacy review

Scope: this repository as built (the GitHub repository was empty before this work, so there was no earlier code or Git history to audit). Reviewed against the OWASP Top 10 (2021), OWASP API Security Top 10 (2023) and India's Digital Personal Data Protection Act 2023.

Automated checks run on the final code:

| Check | Result |
|---|---|
| `npm audit` | 0 known vulnerabilities |
| `npm run lint:secrets` (custom pattern scanner on every committable file) | Passed |
| `detect-secrets` 1.5 (Yelp) | 5 hits, all reviewed as false positives: a script name, a documentation example, a code-alphabet constant, and fake test-only passwords |
| Git history | One local commit, made only after these checks passed |
| Unit + API tests | 34 passed, including access-control, CSRF, lockout, SSRF and data-leak tests |
| Browser journeys | 27 passed, including security headers and a role that is blocked from staff management |

**Limits of this review.** Gitleaks and CodeQL couldn't run in the build environment; both are set up to run in GitHub Actions (`.github/workflows/ci.yml`). There was no penetration test or load test. The Bhashini, Gemini and MSG91 integrations weren't exercised against the live services. Passing automated checks doesn't make the system "secure"; it means no known issue remains open.

## Findings and fixes

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | A database query inside the booking transaction used a second connection, which could hang the server under load | **Fixed**: pass-code lookup now uses the transaction; covered by tests |
| 2 | Medium | The voice integration would call whatever callback URL the Bhashini config response returned (SSRF) | **Fixed**: only `https://*.bhashini.gov.in`; unit test with a cloud-metadata URL |
| 3 | Medium | Photos were only checked by their declared type | **Fixed**: bytes must have JPEG start/end markers; served only as `image/jpeg` with `nosniff` |
| 4 | Medium | Free text in closed help requests was kept forever | **Fixed**: cleared by the retention job after `RETENTION_HOURS` |
| 5 | Medium | A missing-person report from an unverified reporter couldn't be linked to the family's registration | **Fixed**: staff can link by pass number; the link is audited |
| 6 | Medium | CSP allows `'unsafe-inline'` scripts (needed for Next.js inline bootstrapping and the theme script) | **Open**: move to nonce-based CSP via `proxy.ts` before launch |
| 7 | Medium | No multi-factor sign-in for staff | **Open**: add TOTP for super admins and operations before launch |
| 8 | Low | Rate limits are per server instance (in memory) | **Open**: add Upstash Redis when running several instances. Login lockout and OTP limits are already in the database |
| 9 | Low | The kiosk device token is kept in the kiosk browser's `localStorage` | **Accepted**: kiosks run in locked kiosk mode; tokens can be rotated or disabled from Admin → Kiosks; CSP limits script injection |
| 10 | Low | 4-digit OTP | **Accepted**: 5 tries per code, 3 codes per number per 10 minutes, so about 15 guesses per 10 minutes (0.15%) |
| 11 | Info | Staff can only reset passwords through a super admin (no email reset) | By design for a closed control room |

## How each OWASP risk is handled

| Risk | Control in this code |
|---|---|
| A01 Broken access control / API1 BOLA / API5 function-level auth | Every admin route calls `requireUser(permission)` on the server; medical staff are limited to medical requests; kiosk routes need a device token; pilgrim actions need a signed, kiosk-bound, 20-minute token; a kiosk token can't reach admin routes (tested) |
| A02 Cryptographic failures | Phones and photos AES-256-GCM with a per-record IV; lookups use keyed HMAC-SHA256; bcrypt (cost 12) for passwords; session tokens stored as SHA-256; HSTS |
| A03 Injection | Drizzle ORM parameterises every query; all input validated with zod (types, lengths, allowed values, Unicode-letter names); React escapes output; no `eval` |
| A04 Insecure design | Atomic seat booking (no overbooking under concurrency); status transitions enforced on the server; idempotent kiosk requests; integrations fail closed and say so |
| A05 Security misconfiguration | Strict headers (CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy limiting camera and mic to our own pages, COOP); `x-powered-by` removed; `/api/*` not cached; generic error messages |
| A06 Vulnerable components | `npm audit` clean; Dependabot weekly; major upgrades reviewed by hand; `drizzle-kit` removed because of a vulnerable dev dependency |
| A07 Identification and authentication failures | Same message for unknown email and wrong password, with equal timing; lockout after 5 failures for 15 min; IP and account rate limits; 30-minute idle and 10-hour absolute session expiry; sessions revoked on role change, deactivation or password reset |
| A08 Software and data integrity | Lockfile committed; CI runs `npm ci`; migrations are plain SQL in Git |
| A09 Logging and monitoring | Append-only audit log of sign-ins, failures, lockouts, every change, every photo view and Sahayak use, with no personal data; `/api/health` for uptime checks |
| A10 SSRF | Only fixed outbound hosts (Bhashini, Gemini, MSG91); Bhashini callback host checked |
| CSRF | Admin cookie is `HttpOnly; Secure; SameSite=Strict`, and every admin change checks `Origin` against `Host` (tested) |
| API4 Resource consumption | Body size limit 1.5 MB; photo 300 KB; audio ~20 s; rate limits on login, OTP, voice, assistant and per kiosk |
| API3 Excessive data exposure | Responses never include encrypted fields, hashes, tokens or full phone numbers (tested) |

## Personal and biometric data (DPDP Act 2023)

| Principle | How the system meets it |
|---|---|
| Notice and consent | The consent screen lists what is collected, who sees it and when it's deleted, in the pilgrim's language. Photo consent is a separate, unticked box. Consent version and time are stored. |
| Purpose limitation | Data is used only to manage slots and reunite families. Sahayak never receives personal data. |
| Data minimisation | Name, age, relation, needs and phone only. No Aadhaar number, no address, no face embeddings. Photos only for children under 12, only with consent. |
| Storage limitation | Deleted 48 h after the bathing slot (configurable); closed lost-person and help cases are blanked after the same period; OTP records deleted after 24 h. |
| Security safeguards | Encryption at rest, access by role, logged photo access, TLS in transit. |
| Children's data | Photos of children only with the parent's consent, viewable only for an open lost-child case. No tracking, no profiling. |
| Rights | Staff can find a family by phone digits or pass number to answer access or erasure requests. A self-service erasure button is a recommended next step. |
| Alternatives | Registration is never required for help. Phone verification can be done by a volunteer. No face recognition is used anywhere. |

Before launch: a Data Protection Impact Assessment, a named grievance officer, and review of the consent text by the Mela authority's legal team.

## Secrets and configuration

- All secrets come from environment variables, validated at startup. A missing or weak value stops the app with a message that names the variable, never its value.
- `.env*` files are git-ignored except `.env.example`, which holds placeholders only.
- The app refuses to start in production with `OTP_DEV_MODE=true` or an embedded database.
- Use different secrets for development, preview and production (Vercel supports separate values per environment).
- `DATA_ENCRYPTION_KEY` can't be rotated in place yet. Keep a secure backup; losing it makes stored phones and photos unreadable. Key rotation (re-encrypting with a key ID) is a recommended next step.

## GitHub settings to turn on (repository owner)

1. Settings → Code security: **Secret scanning** and **Push protection** on; **Dependabot alerts** and **security updates** on.
2. Settings → Branches: protect `main`. Require a pull request, require the `CI / test` and `CI / codeql` checks, block force pushes.
3. Settings → Actions → General: workflow permissions **Read repository contents**.
4. Keep deployment secrets only in Vercel (or GitHub Secrets); never in workflow files.
5. Gitleaks Action is free for personal accounts; organisation accounts need a free `GITLEAKS_LICENSE` secret.

## Pre-push checklist

- [x] No API keys, passwords, tokens or private keys in the code (`npm run lint:secrets`, `detect-secrets`)
- [x] No real `.env` files; `.env.example` has placeholders only
- [x] No personal data, photos, database files or logs committed (`.data/`, screenshots and logs are git-ignored)
- [x] `.gitignore` covers secrets, builds, local databases and test output
- [x] Dependencies checked (`npm audit`: 0)
- [x] Authentication, roles and admin permissions tested
- [x] API endpoints reviewed for data exposure
- [x] Git history checked: one local commit, made after the checks above
- [ ] GitHub repository security settings (owner action, see above)
- [ ] Nonce-based CSP and staff MFA (open findings 6 and 7)
- [ ] Native-speaker review of translations; legal review of consent text
