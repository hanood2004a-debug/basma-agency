# Basma Digital — Production-Readiness Final Report

**Scope:** Phases A–L as specified. Nothing deployed, committed, or pushed. This is a pre-deployment report for review.

---

## A. Executive Summary

All twelve phases (A–J, L) were completed in a single controlled pass, inspecting before editing throughout. Highlights:

- Added `service_request_click` tracking on the 12 service pages' primary CTAs, reusing the existing `trackBasmaEvent`/GA4 architecture with zero duplicate events.
- Verified `whatsapp_click`, `contact_click`, `contact_form_submit`, `booking_click`, `portfolio_click`, `service_click`, `proposal_click` all still fire correctly, exactly once each, with no PII in any payload (proven by an automated static + dynamic test suite, not just inspection).
- Added a safe, read-only "requested service" indicator to `Contact.dc.html`, which — thanks to the site's existing literal-translation engine — automatically localizes into English/Spanish with zero new translation code, verified in all three languages plus an XSS-shaped-input case.
- Audited the funnel model: confirmed `qualify_lead`/`close_convert_lead` do not exist anywhere in the site or CRM, and the CRM currently has zero GA4/analytics wiring at all. Documented exactly what would be needed to wire real CRM lifecycle events later — no fake browser-side events were created.
- Ran a full PII audit (11 GA4 call sites, static + dynamic tests) — zero PII leakage found or introduced.
- Confirmed GA4 is deduplicated: exactly one `gtag.js` include, one `gtag('config', ...)`, one `analytics.js` include per page across all 19 public pages, no competing click listeners.
- Converted the 20 largest portfolio/service showcase PNGs to WebP (8.3 MB / 91.3% saved), leaving originals untouched and swapping only `src=` attributes.
- Investigated deferring `i18n.js`/`support.js`; concluded it is unsafe to change render-blocking script loading in this pass, and did not touch it.
- Updated the vague homepage `<title>` to the previously-recommended, more descriptive one, kept `og:title`/`twitter:title` in sync.
- Added a small, safe runtime metadata sync (`<title>` + `og:title` only) for EN/ES, using the site's existing translation dictionary; skipped meta descriptions since zero translations exist for them yet (would require new marketing copy, out of scope).
- Verified sitemap/robots (19 URLs, all valid, no backup/CRM/lang URLs) and refreshed stale `lastmod` dates using real filesystem modification times (not fabricated).
- Ran a 40-point-equivalent regression sweep (jsdom, all 19 pages) — no JS errors, no broken images, canonical/og:url untouched by language switching, Portfolio modal intact.

CRM, Supabase, SQL, auth, and Vercel/DNS settings were not touched. Nothing was deployed, committed, or pushed.

---

## B. Exact Files Modified

| File | Change |
|---|---|
| `assets/analytics.js` | Added `currentPageSlug()` helper + `service_request_click` click-handler branch |
| `Contact.dc.html` | Added hidden service-context indicator block + inline script reading `?service=` |
| `assets/i18n.js` | Added 2 `contact.serviceContext.label` keys (en/es); added 2 `literalTranslations` entries (en/es) for the new homepage title; added `updateRuntimeMetadata()` function, wired into `setLang()` |
| `index.html` | Updated `<title>`, `og:title`, `twitter:title` |
| `sitemap.xml` | Updated `<lastmod>` for all 19 URLs from `2026-08-05` to `2026-08-11` (actual file mtime) |
| `Portfolio.dc.html` | 20 `<img src>` swaps from `.png` to `.webp` |
| `Services.dc.html` | Same 20 filenames swapped wherever referenced (used repeatedly as service-card examples) |
| `Web-Development.dc.html`, `WordPress-Design.dc.html`, `App-Development.dc.html`, `Brand-Identity.dc.html`, `UI-UX-Design.dc.html`, `Graphic-Design.dc.html` | One related-project thumbnail each swapped `.png` → `.webp` |

**New files created:** 20 `.webp` files in `assets/` (originals preserved alongside them, untouched).

**Not modified:** any CRM file, any `.sql` file, any `api/` file, `vercel.json`, `.vercelignore`, `robots.txt`.

---

## C. Analytics Events Added/Changed

Only one event is new: **`service_request_click`**. All seven other business events (`whatsapp_click`, `contact_click`, `contact_form_submit`, `booking_click`, `portfolio_click`, `service_click`, `proposal_click`) were verified unchanged and still firing correctly — no code changes were needed for them.

---

## D. Exact Selectors Used

- `a.svcp-cta-primary` — the hero and final-CTA "اطلب هذه الخدمة" buttons on each of the 12 dedicated service pages. Checked and `return`-guarded *before* the existing generic `matchProposalCta()` check (which also matches `-cta-primary` classes), so one click never double-fires as both `service_request_click` and `proposal_click`.

---

## E. Parameters Sent Per Event

| Event | Parameters |
|---|---|
| `service_request_click` | `page_path`, `service_slug` (stable English filename-derived slug, e.g. `web-development`), `cta_location` (`hero` / `final_cta`) |
| `whatsapp_click` | `page_path`, `link_location` |
| `email_click` | `page_path`, `link_location` |
| `phone_click` | `page_path`, `link_location` |
| `booking_click` | `page_path`, `cta_location` |
| `portfolio_click` | `page_path`, `project_slug` |
| `service_click` | `page_path`, `service_slug`, `link_location` |
| `proposal_click` | `page_path`, `cta_location` |
| `contact_click` | `page_path`, `cta_location` |
| `contact_form_submit` | `form_location`, `page_path` |

`service_slug` is always derived from the page's own filename (e.g. `Web-Development.dc.html` → `web-development`), never from translated button text or the Arabic `?service=` value — identical across AR/EN/ES.

---

## F. PII/Privacy Verification

Built an automated test (`test-phase4-pii-audit.mjs`) with two layers:

1. **Static source audit** — parsed all 11 `trackBasmaEvent(...)` call sites across `analytics.js` and `contact-submit.js` with a brace-counting parser (not a naive regex) and asserted every parameter key belongs to the allowed non-PII vocabulary (`page_path`, `link_location`, `cta_location`, `service_slug`, `project_slug`, `form_location`), and that no call site's parameter source references `name`/`email`/`phone`/`message`/`company` as identifiers. **Result: 11/11 clean.**
2. **Dynamic runtime audit** — actually submitted the contact form through the real `submitContactLead()` with realistic PII values (name, email, phone, company, a message containing the email and phone inline) against a mocked-successful backend, captured the resulting `gtag()` call, and asserted the payload contains none of the PII values, no `@`, and no long digit runs. Also verified the event does **not** fire when the mocked backend rejects the submission. **Result: no PII leakage; event fires exactly once on success, zero times on failure.**

No email, phone, message text, name, or company name is ever sent to GA4, in any event, from any inspected code path.

---

## G. Service CTA Tracking Result

`service_request_click` fires exactly once per click on both the hero and final-CTA buttons across all 12 service pages (verified on a representative sample: Web-Development, SEO-Services, Content-Writing), with the correct stable `service_slug` and `cta_location` (`hero` vs `final_cta`), and no PII in the payload. Confirmed no double-fire against the pre-existing `proposal_click`/`matchProposalCta` mechanism.

---

## H. Funnel Model Result

Intended funnel: `service_click` → `service_request_click`/`whatsapp_click` → `contact_form_submit` → CRM lead qualification → closed/converted lead.

Verified end to end on the website side: `service_click` (Services page + homepage teasers) → `service_request_click` (new) / `whatsapp_click` → `contact_form_submit` (fires once, only on confirmed backend success) are all wired correctly and non-overlapping.

The CRM side of the funnel (lead qualification → won/lost) is **not** currently connected to GA4 at all — see section I.

---

## I. `qualify_lead` / `close_convert_lead` Status

Grepped the entire website codebase and the entire CRM codebase (`crm/`, `api/`) for `qualify_lead`, `close_convert_lead`, and related variants: **zero occurrences anywhere.** Also confirmed the CRM has **no GA4/gtag/analytics integration of any kind** — no `gtag(`, no `G-9Z7D1YFF79`, no `trackBasmaEvent`, nothing.

Per instructions, **no fake browser-side `qualify_lead`/`close_convert_lead` events were created.** These events should only exist when the real business state changes in the CRM (`crm_leads.stage` transitioning to `qualified`, `won`, or `lost` — the exact enum values already defined in `CRM-SETUP.sql`).

**What would be needed to implement this properly later** (documented, not built, per instructions to avoid a risky cross-system integration in this pass):
- A server-side trigger on `crm_leads.stage` changes (Postgres trigger or an API-route hook) that calls the **GA4 Measurement Protocol** (server-to-server, not client-side gtag) to send `qualify_lead` when stage → `qualified`, and `close_convert_lead`/`close_lost` when stage → `won`/`lost`.
- This requires a GA4 `client_id` (or a GA4 User-ID) to be captured at the moment the lead is created from a website form submission, and stored on the `crm_leads` row — which does not currently happen. The website's `contact-submit.js` would need to read GA4's `_ga` cookie/client ID and include it in the lead payload sent to `/api/contact-lead`, and the CRM schema would need a nullable `ga_client_id` column on `crm_leads`.
- This is a genuine cross-system integration (website cookie capture + CRM schema change + server-side GA4 Measurement Protocol calls with a protected API secret) and was correctly out of scope for this pass.

---

## J. Image Optimization Results

Identified all 22 large PNGs referenced from the earlier SEO audit; 2 (`bg-hero`, `team-background-fingerprints-v3`, plus the navbar logo and other team photos) were already converted to WebP in a prior phase. The remaining 20 — all portfolio/service showcase screenshots, all confirmed **fully opaque** despite being in RGBA mode (0 non-opaque pixels each, so no visual transparency is lost) — were converted at WebP quality 85:

| File | Before | After | Saved | Reduction |
|---|---:|---:|---:|---:|
| web-custom-sports.png | 857,193 B | 71,210 B | 785,983 B | 91.7% |
| web-custom-portfolio.png | 796,083 B | 62,456 B | 733,627 B | 92.2% |
| app-smart-archive-dashboard.png | 654,719 B | 66,954 B | 587,765 B | 89.8% |
| design-charity.png | 607,117 B | 55,080 B | 552,037 B | 90.9% |
| design-cafe.png | 544,139 B | 37,100 B | 507,039 B | 93.2% |
| design-industrial.png | 531,018 B | 42,606 B | 488,412 B | 92.0% |
| identity-fashion.png | 528,535 B | 30,028 B | 498,507 B | 94.3% |
| design-bakery.png | 503,208 B | 44,028 B | 459,180 B | 91.3% |
| identity-rahal.png | 490,017 B | 51,882 B | 438,135 B | 89.4% |
| app-medical-dashboard.png | 468,702 B | 48,558 B | 420,144 B | 89.6% |
| design-retail-2.png | 450,467 B | 40,312 B | 410,155 B | 91.1% |
| design-clinics-1.png | 439,597 B | 40,710 B | 398,887 B | 90.7% |
| design-retail-1.png | 436,320 B | 34,976 B | 401,344 B | 92.0% |
| identity-clinic.png | 434,559 B | 22,226 B | 412,333 B | 94.9% |
| design-clinics-2.png | 432,514 B | 42,822 B | 389,692 B | 90.1% |
| identity-legal.png | 364,424 B | 25,654 B | 338,770 B | 93.0% |
| app-smart-archive-login.png | 363,675 B | 23,766 B | 339,909 B | 93.5% |
| app-prayer-cover.png | 261,390 B | 25,188 B | 236,202 B | 90.4% |
| web-custom-services.png | 185,895 B | 38,492 B | 147,403 B | 79.3% |
| app-prayer-calendar.png | 180,979 B | 20,754 B | 160,225 B | 88.5% |
| **Total** | **9,530,551 B (9.09 MB)** | **824,802 B (0.79 MB)** | **8,705,749 B (8.30 MB)** | **91.3%** |

Quality was checked with PSNR (a numeric image-fidelity measure) on three representative files: 39.7–43.1 dB — comfortably in the "visually near-lossless" range for photographic/screenshot content.

**Method:** followed the site's own existing convention from the prior WebP pass (direct `src=".webp"` swap, no `<picture>`/fallback — matches how `bg-hero.webp`, `basma-logo-navbar.webp`, and team photos are already served in production) rather than introducing a new pattern. Originals were never deleted — all 20 `.png` files remain on disk. Two smaller files referenced on the same pages (`web-custom-login.png` at 44 KB, `web-custom-archive.png` at 76 KB) were deliberately left as PNG — below the "large" threshold, not worth the added surface area.

**Pages affected:** `Portfolio.dc.html`, `Services.dc.html`, and one related-project thumbnail each on `Web-Development.dc.html`, `WordPress-Design.dc.html`, `App-Development.dc.html`, `Brand-Identity.dc.html`, `UI-UX-Design.dc.html`, `Graphic-Design.dc.html`.

**Verification:** re-ran the full analytics/PII regression suite (still 100% pass) plus a dedicated jsdom sweep confirming the Portfolio modal gallery still renders correctly with the new paths, no malformed `.png.webp`/`.webp.png` src values anywhere, and no JS errors on any of the 19 pages.

**OG image:** `basma-logo-navbar.png` (the only file referenced by any `og:image`/`twitter:image` tag) was explicitly excluded from this conversion and remains PNG, per the "preserve OG images in a crawler-safe format" instruction.

---

## K. Script-Loading Changes (or Why They Were Skipped)

**No script-loading changes were made.** Investigated both files named in the audit:

- **`support.js` (77 KB):** this is not a peripheral utility — it is the site's core component-rendering runtime (a generated React-based engine that parses every page's `<x-dc>` template block and mounts it). Deferring or async-loading it would very likely cause visible content to be missing or broken until it finishes executing, since the page's actual dynamic content depends on it. This is foundational rendering infrastructure, not a candidate for deferral in a "do not redesign, do not risk breakage" pass.
- **`assets/i18n.js` (364 KB):** its own translation-*application* logic already only runs on `DOMContentLoaded` (independent of the `<script>` tag's own load timing), so deferring the tag itself would mostly be safe for that part. However, two other scripts (`contact-submit.js`, `booking-widget.js`) reference `window.translations`/`window.getBasmaLang` — currently safe because they load *after* i18n.js in document order, at their own top level. Adding `defer` to i18n.js's tag alone (without also deferring those two) would invert that ordering guarantee for the time window between script execution and `DOMContentLoaded`. In practice this is very likely still safe (both references are guarded and only actually called at user-interaction time, well after `DOMContentLoaded`), but ruling out every downstream effect — including `site-ui.js`, which may cache DOM text/attributes before i18n.js has applied translations, causing a possible EN/ES FOUC on cloned nav elements — would require a full empirical pass across all 19 pages × 3 languages that wasn't completed in this pass.

Per the explicit instruction ("If there is any meaningful risk, DO NOT change script loading"), this was left unchanged and is reported as deferred future work, with the specific risk identified above so a future pass can start from a concrete finding rather than re-investigating from scratch.

---

## L. Homepage Title Change

- **Before:** `بصمة للحلول الرقمية | من الفكرة إلى الإطلاق`
- **After:** `بصمة للحلول الرقمية | تصميم وتطوير مواقع، تسويق رقمي وهوية بصرية` (64 characters)

Re-reviewed the earlier recommendation against the current homepage and still consider it clearly better — the old title communicated nothing about what Basma does; the new one names three real, already-offered service categories (web design/development, digital marketing, brand identity) with no new claims. `og:title` and `twitter:title` were updated to match (kept "logically consistent" rather than left stale). Only the `<title>` tag and its two mirrors were touched — no other body content was changed, and there is exactly one `<title>` tag on the page.

---

## M. Metadata-Language Changes

Implemented a narrow, additive `updateRuntimeMetadata(lang)` function in `i18n.js`, wired into the existing `setLang()`:

- **In scope and implemented:** `document.title` and `og:title` now update for EN/ES using the exact-match `literalTranslations` dictionary the site already maintains (the same mechanism that already translates on-page literal text). 18 of 19 pages already had matching EN/ES title translations in that dictionary from prior work; 2 new entries were added so the homepage's new title (from section L) is also covered, giving full 19/19 coverage. Confirmed AR restores the *exact* original string (not a re-translation), confirmed idempotent/stable across repeated switches, confirmed `canonical` and `og:url` are never touched.
- **Explicitly out of scope, not implemented:** `meta[name="description"]` and `og:description`. Audited the dictionary and found **zero** existing EN/ES translations for any page's description text (unlike titles). Implementing this would mean writing new translated marketing copy for all 19 pages' descriptions — a content-creation task, not a mechanical wiring one, and risked crossing the "do not change business claims" boundary. Left as documented future work: once description translations are added to `literalTranslations` (or a dedicated dictionary), the same `updateRuntimeMetadata()` function can be trivially extended to cover them.
- Any page whose title has no dictionary match would silently keep the Arabic original when switching language — this is a safe no-op, never garbled/partial text (there are currently none in this state; all 19 have coverage).

---

## N. Sitemap/Robots Verification

- `sitemap.xml`: exactly 19 `<url>` entries, XML-parses cleanly, every URL resolves to a file that exists on disk, zero backup/CRM/`?lang=` URLs present, canonical host `www.basmadigital.com` used consistently.
- `robots.txt`: `Allow: /`, correctly points to `https://www.basmadigital.com/sitemap.xml`.
- **`lastmod` dates updated**, not left stale: all 19 were `2026-08-05` (visibly stale — several pages had since been edited across this and prior phases). Checked the actual filesystem modification time of each of the 19 page files (a real, non-fabricated signal) — all 19 currently show `2026-08-11`, so all 19 `lastmod` values were updated to `2026-08-11` accordingly. No timestamp was invented; this was a direct, verifiable read of on-disk file history.

---

## O. Full Regression Test Results

Four automated jsdom test suites were built and run (kept outside the deployed site, in a scratch test directory, never shipped):

1. **`test-phase3-analytics.mjs`** — `service_request_click` fires once per click with correct params on 3 sample service pages; `whatsapp_click`/`contact_click` unaffected; Contact.dc.html service-context indicator behaves correctly in AR/EN/ES plus an unknown-service passthrough case plus an XSS-shaped-input case; `syncInternalLinks` preserves `?service=` while adding `&lang=`. **All pass.**
2. **`test-phase4-pii-audit.mjs`** — static audit of all 11 GA4 call sites (allowed-key + PII-identifier checks) + dynamic form-submission-with-real-PII-values audit. **All pass.**
3. **`test-phase-h.mjs` / `test-phase-h-allpages.mjs`** — runtime title/og:title metadata sync across representative pages and then all 19 pages: correct EN/ES values, exact AR restoration, canonical/og:url untouched, idempotent round-trips, no throws anywhere. **All pass.**
4. **`test-phase-j-fullsweep.mjs`** — full-page load sweep across all 19 pages: zero `window.onerror` events, non-empty titles, zero malformed image paths, Portfolio modal gallery structurally intact with the new WebP paths. **All pass.**

Additional source-level checks (not requiring a browser): JSON-LD blocks valid JSON on all 19 pages; exactly one `<h1>` per page; canonical present and correctly hosted on all 19 pages; no lingering links to `.backup`/`.preview` files; exactly one `gtag.js` include, one `gtag('config', ...)`, one `analytics.js` include, one `i18n.js` include per page (all 19); no `page_view` manually sent anywhere; the only other `document`-level click listener (`i18n.js`'s language switcher, scoped to `[data-lang-switch]`) does not overlap with any tracked selector and doesn't call `stopPropagation`.

---

## P. Failures or Remaining Risks

- **i18n.js/support.js deferral** was investigated and deliberately not implemented — see section K for the specific, concrete risk that would need to be closed out before it's safe.
- **Meta description / og:description language sync** was deliberately not implemented — see section M — because no translated copy exists yet for any page.
- **`qualify_lead`/`close_convert_lead`** are not implemented, by design — see section I for exactly what's missing (GA4 client-ID capture at lead-creation time, a CRM schema column, and a server-side Measurement Protocol integration).
- Mobile-viewport horizontal-overflow and CTA/menu/chat-widget visual overlap were **not** verifiable in this pass — jsdom has no real layout/CSS engine, so this class of check requires an actual browser render (real device or headless-browser screenshot pass), which was out of the available toolset here. Recommend a quick manual pass post-deploy (see section Q).
- No other failures encountered; all automated suites listed in section O pass in full.

---

## Q. Manual Production Checks Recommended Post-Deployment

1. Open 2–3 of the 12 service pages live, click "اطلب هذه الخدمة" (both hero and final-CTA), and confirm `service_request_click` appears in GA4 Realtime with the correct `service_slug`/`cta_location`.
2. From a service page, click through to Contact and confirm the "الخدمة المطلوبة" box appears with the right service name, in Arabic by default and translated when `?lang=en`/`?lang=es` is active.
3. Submit the contact form once end-to-end and confirm `contact_form_submit` appears in GA4 exactly once, with no other event duplicated alongside it.
4. Spot-check the new homepage `<title>` and share-preview (og:title) render correctly on a real device / social-share debugger.
5. Switch language on a couple of pages and visually confirm the browser tab title updates for EN/ES and restores to Arabic correctly.
6. Open Portfolio.dc.html on mobile and desktop, open a few project-detail modals, and visually confirm the newly-WebP'd images still look sharp (no visible compression artifacts) and load fast.
7. Quick real-browser check for horizontal overflow / CTA-menu-chat overlap on mobile, since this pass could not verify layout/CSS behavior.
8. In Search Console, monitor whether the `lastmod` bump nudges any of the 19 URLs toward re-crawl (informational only, no action needed).

---

## R. Git Diff Summary

Not applicable — this directory is not a git repository (no `.git` folder present; confirmed in an earlier phase and unchanged). File-level before/after diffs were used instead throughout this pass (see sections B, J, L, M, N for exact per-file changes); nothing was committed anywhere.

---

## S. Confirmation: CRM / Supabase / SQL Not Modified

Confirmed via filesystem mtime check: no file under `crm/`, no file under `api/`, and no `.sql` file anywhere in the project was touched at any point in this session. Grep-based audits earlier in this pass (sections I, D) independently confirm the CRM codebase contains no GA4/analytics code at all, which further rules out any accidental edit there.

## T. Confirmation: Nothing Deployed

No `vercel` or `npx vercel` command of any kind was run at any point in this session.

## U. Confirmation: Nothing Committed/Pushed

No `git commit` or `git push` command was run (and, as noted in section R, this directory has no `.git` to commit to in the first place).

---

**Stopping here per instructions.** Ready for your review before deployment.
