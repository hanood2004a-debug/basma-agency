# Basma Digital — SEO & Indexability Audit
**Scope:** www.basmadigital.com — 19 live public pages. Audit-only, read-only. No files edited, nothing deployed, nothing committed (confirmed in Section U).
**Method:** direct inspection of the actual repository source for all 19 pages + `assets/*.js`, cross-checked against live production via HTTP fetch and a real Chromium browser (redirect chains, rendered DOM, response headers, JSON-LD parsing). Every finding below is tied to a specific file, URL, or observed response — nothing here is generic advice or assumed.

---

## A. Executive summary

The site is technically healthier than a typical small-agency site: canonical tags are correct and self-referencing on all 19 pages, host/protocol redirects (http→https, non-www→www) work correctly, robots.txt is clean and permissive, JSON-LD structured data is present, valid, and consistent across every page (Service, FAQPage, BreadcrumbList, Organization, WebSite — all parse as valid JSON, all NAP data matches across pages), image alt text is descriptive everywhere (zero missing/empty alt), heading hierarchy is clean (no skipped levels, exactly one H1 per page), and mobile fixed-UI elements (chat widget, bottom nav) are engineered to not overlap.

The real problems are: (1) **three legacy/backup files and three entire backup directories are live on production**, unblocked by robots.txt, one with no canonical/noindex protection at all; (2) **`?lang=` query-parameter translations are invisible to Google** — title, meta description, and og:title never change with the language switcher, so English/Spanish visitors from search will see Arabic snippets, and (3) **the 12 service pages carry the same ~200 words of unique body content each and never cross-link to one another**, which is a real thin-content/topical-authority gap, not a crawlability one.

Nothing found here blocks indexing of the 19 real pages. The issues are duplicate-content hygiene, metadata localization, and content depth — not "Google can't crawl this."

## B. Exact number of live public pages

**19**, matching `sitemap.xml` exactly: `/` (index.html) + 18 `*.dc.html` pages. Confirmed three ways: file inventory, sitemap `<loc>` count (19), and live fetch of every one (all return HTTP 200).

Full list: `/`, About.dc.html, App-Development.dc.html, Brand-Identity.dc.html, Contact.dc.html, Content-Writing.dc.html, Digital-Marketing.dc.html, Graphic-Design.dc.html, Motion-Graphics.dc.html, Partners.dc.html, Portfolio.dc.html, SEO-Services.dc.html, Services.dc.html, Social-Media-Management.dc.html, Team.dc.html, UI-UX-Design.dc.html, Video-Editing.dc.html, Web-Development.dc.html, WordPress-Design.dc.html.

## C. Critical indexability findings

1. **`index.backup.html` is live on production, 200 OK, zero indexing protection.** No `<link rel="canonical">`, no `<meta name="robots">`. It's a near-duplicate of the homepage. Verified via direct fetch of `https://www.basmadigital.com/index.backup.html`.
2. **`index.preview.html` is live, 200 OK**, but *does* self-canonicalize to `https://www.basmadigital.com/`. Duplicate-content risk is mitigated by the canonical tag, but the URL itself is still crawlable and not noindexed.
3. **Three backup directories are live and fully crawlable**: `/_seo_backup_20260805/`, `/_i18n_backup_20260806/`, `/_crm_backup_20260806/`. Verified by fetching `https://www.basmadigital.com/_seo_backup_20260805/index.html` — it returned 200 with a full duplicate homepage, internal links pointing to `_seo_backup_20260805/About.dc.html` etc. (meaning the *entire* backup subtree is link-connected and crawlable), and — like the working homepage — a self-canonical to `https://www.basmadigital.com/`. Root cause: `vercel.json` has `"outputDirectory": "."` with no `.vercelignore` and no route exclusions, so anything in the repo gets deployed and served as a static file.
4. **`نواة الشركة.dc.html`** (legacy Arabic-named duplicate) is live, 200 OK, but correctly carries `<meta name="robots" content="noindex,follow">` — this one is *not* a problem, included here only for completeness of the inventory.
5. The 19 real pages themselves are cleanly indexable: 200 OK, no `X-Robots-Tag` header, no blocking `<meta name="robots">`, correct self-referencing canonical, reachable from a single consistent host (`https://www.basmadigital.com`).
6. `/crm/*` returns 200 but every page carries `<meta name="robots" content="noindex,nofollow">` (verified on `/crm/`, `/crm/index.html`, `/crm/companies.html`) — CRM is not going to get indexed. This is correct even though robots.txt doesn't also `Disallow: /crm/` (see Section E for why that's actually the right call).

## D. Sitemap findings

`sitemap.xml` itself is technically clean: valid XML declaration (`UTF-8`), correct namespace (`http://www.sitemaps.org/schemas/sitemap/0.9`), no BOM, 19 `<url>` blocks, 19 `<loc>`, 19 `<lastmod>` — no orphaned tags, no duplicate URLs, no `?lang=` variants included, no legacy/backup pages included. Served with `Content-Type: application/xml`, reachable directly, not blocked by robots.txt.

**On the "Couldn't fetch" status:** I found no technical defect in the file that would explain a rejection — it's well-formed, small (3,076 bytes), and correctly declared in robots.txt. I cannot see Search Console's own crawl logs from here, so I can't state the cause with certainty, but nothing in the file, its headers, or its accessibility explains a fetch failure. This is most consistent with a transient GSC-side timing issue (e.g., GSC attempting the fetch before DNS/TLS had fully propagated after a recent deploy) rather than an ongoing problem. Recommend resubmitting from Search Console now that the file has been confirmed reachable.

Two real (minor) issues:
- Every `<lastmod>` is a static `2026-08-05`, but multiple pages (e.g. `Contact.dc.html`, `index.html`) have since been modified (confirmed via file mtimes from this session's own work) — the sitemap's `lastmod` values no longer reflect actual change history. Low-impact (Google treats it as a hint), but worth knowing it's not wired to real content changes.
- `changefreq`/`priority` values look hand-set and reasonable (home=1.0, services/portfolio=0.9, contact=0.8, etc.) — not wrong, just noting Google has explicitly deprioritized these fields in ranking/crawl-budget decisions for years, so they're cosmetic at this point.

## E. Robots.txt findings

```
User-agent: *
Allow: /

Sitemap: https://www.basmadigital.com/sitemap.xml
```
File exists, returns 200, `Content-Type: text/plain`. Fully permissive — no path is disallowed, including `/crm/`, `/api/`, and the exposed backup paths from Section C. This is not automatically wrong: CRM pages already carry their own `noindex,nofollow` meta tag, which is the *more correct* mechanism (a robots.txt `Disallow` would actually prevent Google from ever crawling far enough to see the `noindex` tag, which can paradoxically leave a bare URL indexed with no snippet). `/api/*` routes return 405 on GET and aren't linked anywhere, so they're not a real crawl target either.

The one thing robots.txt does **not** currently do that would help: it has no `Disallow` for the backup paths identified in Section C (`/index.backup.html`, `/index.preview.html`, `/_seo_backup_20260805/`, `/_i18n_backup_20260806/`, `/_crm_backup_20260806/`). Since those pages don't have noindex tags either (except the Arabic legacy file), robots.txt is currently the only lever available to keep them out of the index short of deleting/moving them.

## F. Canonical / duplicate URL findings

Verified live, in a real browser, with redirects actually followed:

| Variant | Behavior |
|---|---|
| `http://www.basmadigital.com/` | 301→ `https://www.basmadigital.com/` ✅ |
| `https://basmadigital.com/` (non-www) | redirects → `https://www.basmadigital.com/` ✅ |
| `http://basmadigital.com/` | redirects → `https://www.basmadigital.com/` ✅ |
| `https://www.basmadigital.com/index.html` | **200, no redirect**, but `<link rel="canonical" href="https://www.basmadigital.com/">` correctly points to `/`. Non-self-referencing canonical, which Google generally honors, but it's a soft fix, not a hard redirect — link equity isn't consolidated the way a 301 would. |
| `https://www.basmadigital.com/About.dc.html/` (trailing slash) | redirects → `/About.dc.html` (no slash) ✅ — `vercel.json`'s `"trailingSlash": false` is working as configured |
| `https://www.basmadigital.com/?lang=en` (and `ar`/`es`) | 200, **canonical stays `https://www.basmadigital.com/`** on every language variant — confirmed by direct inspection |

**On the `?lang=` duplicate-indexing question specifically (Section 2's core ask):** the architecture is client-side-only — `?lang=` never changes server output or the canonical tag, it only triggers a JS-driven DOM/attribute rewrite after load. Because every `?lang=` variant self-canonicalizes back to the bare URL, Google is very unlikely to index `?lang=en`/`?lang=es` as separate pages — this is the correct, safe behavior for this architecture and **is why hreflang is not recommended**: hreflang exists to tell Google about separate indexable URLs per language, and this site deliberately doesn't have those (by design — one URL, three client-rendered language states). Adding hreflang here without indexable per-language URLs would be actively misleading to Google, not a fix.

The tradeoff, made visible by this same test: because the canonical always resolves to the one Arabic-default URL, **Google will essentially only ever index the Arabic rendering of each page.** The English/Spanish content is real and reachable by a human clicking the switcher, but there is currently no indexable, canonical URL that represents "this page in English" for Google to rank. That's a content-strategy tradeoff inherent to the current i18n architecture, not a bug — flagging it because it directly affects whether the English/Spanish content can ever appear in search results as-is.

## G. Title findings

All 19 titles pulled directly from source, verified live to match:

| Page | Title | Chars |
|---|---|---|
| `/` | بصمة للحلول الرقمية \| من الفكرة إلى الإطلاق | 43 |
| About.dc.html | من نحن \| بصمة للحلول الرقمية | 28 |
| App-Development.dc.html | تطوير تطبيقات وأنظمة إدارية \| بصمة للحلول الرقمية | 49 |
| Brand-Identity.dc.html | تصميم هوية بصرية للشركات \| بصمة للحلول الرقمية | 46 |
| Contact.dc.html | تواصل معنا \| بصمة للحلول الرقمية | 32 |
| Content-Writing.dc.html | كتابة محتوى احترافي بالعربية \| بصمة للحلول الرقمية | 50 |
| Digital-Marketing.dc.html | شركة تسويق رقمي في فلسطين والخليج \| بصمة للحلول الرقمية | 55 |
| Graphic-Design.dc.html | تصميم جرافيك وحملات إعلانية \| بصمة للحلول الرقمية | 49 |
| Motion-Graphics.dc.html | إنتاج موشن جرافيك \| بصمة للحلول الرقمية | 39 |
| Partners.dc.html | الشراكات \| بصمة للحلول الرقمية | 30 |
| Portfolio.dc.html | أعمالنا \| بصمة للحلول الرقمية | 29 |
| SEO-Services.dc.html | تحسين محركات البحث SEO \| بصمة للحلول الرقمية | 44 |
| Services.dc.html | خدماتنا الرقمية \| بصمة للحلول الرقمية | 37 |
| Social-Media-Management.dc.html | إدارة منصات التواصل الاجتماعي \| بصمة للحلول الرقمية | 51 |
| Team.dc.html | فريق العمل \| بصمة للحلول الرقمية | 32 |
| UI-UX-Design.dc.html | تصميم UI UX للمواقع والتطبيقات \| بصمة للحلول الرقمية | 52 |
| Video-Editing.dc.html | مونتاج فيديو احترافي \| بصمة للحلول الرقمية | 42 |
| Web-Development.dc.html | تطوير مواقع مخصصة في فلسطين والخليج \| بصمة للحلول الرقمية | 57 |
| WordPress-Design.dc.html | تصميم مواقع ووردبريس وواجهات Figma \| بصمة للحلول الرقمية | 56 |

- **Zero duplicate titles.** Every one is unique.
- **Zero missing titles.**
- Brand suffix (`| بصمة للحلول الرقمية`) is applied consistently on all 19 — good pattern, but it's always a *suffix*; some competitive service titles (Web-Development, Digital-Marketing) already push toward the 57-char range once the ~26-char suffix is included, leaving less room for the keyword-bearing part.
- All titles are within a safe length (under ~60 chars); none currently at real truncation risk in Arabic SERP rendering.
- **Weak commercial intent / generic:** the homepage title is pure brand tagline with no service keyword ("From idea to launch" — no mention of "web development agency," "digital agency in Palestine," etc.). For the single highest-authority URL on the site, this under-targets. `About.dc.html`, `Partners.dc.html`, `Team.dc.html` are appropriately generic for their (navigational/brand) intent — not a defect, just noting they carry no commercial keyword by design.
- Location modifiers ("في فلسطين والخليج" — *in Palestine and the Gulf*) appear on only 2 of 12 service pages (Web-Development, Digital-Marketing) — inconsistent application of a pattern that works well where it's used.

## H. Meta description findings

All 19 are present and unique (verified same pass as titles, zero duplicates, zero missing). Lengths range 76–127 characters — every one is comfortably under Google's ~155-160 char display budget, meaning **none will be truncated**, but several (Contact 76, Team 79, Video-Editing 79, About 76) are on the short side and under-use available snippet space that could otherwise carry a stronger call-to-action or differentiator. None read as generic boilerplate — each is specific to its page's actual content (verified by reading each against its page's H1/body copy). No duplicates found across any of the 19.

## I. Heading findings

Every one of the 19 pages has **exactly one `<h1>`** — zero missing, zero duplicated. H1 text is topically relevant to the page in all 19 cases (spot-checked against title/body copy). Heading level sequences were extracted in full document order for `index.html`, `Services.dc.html`, and `Web-Development.dc.html` (representative of the 12-page service template) — **no skipped levels** (never H1→H3 without an intervening H2) in any of the three. Given the 12 service subpages share an identical generated structure (near-identical file sizes, ~32–34KB each), this pattern is very likely consistent across all of them, though only 3 were checked directly line-by-line.

`H2`/`H3` volume is heavy on `index.html` (18 H2 / 29 H3) and `Portfolio.dc.html` (4 H2 / 29 H3 / 5 H4) — both are long single-page layouts with many templated repeating sections (service cards, team cards, portfolio cards each getting their own H3). Checked specifically for "headings used purely for styling" (e.g., a stat number wrapped in `<h2>` for font-size only): none found — stat numbers/step numbers use `<span>`, not heading tags; every heading tag found wraps genuine section/item titles.

Several service-page H1s are minimal — just the service name (e.g. `تطوير التطبيقات` = "App Development", `الهوية البصرية` = "Brand Identity") rather than a fuller value-proposition headline. Structurally correct and on-topic, just a missed keyword-richness opportunity (see Section R).

## J. Content / search-intent findings

| Page(s) | Intent |
|---|---|
| `/` | Brand / navigation hub |
| About.dc.html, Team.dc.html, Partners.dc.html | Informational / brand trust |
| Services.dc.html | Commercial investigation (service directory) |
| The 12 service subpages | Service / commercial (transactional-adjacent) |
| Portfolio.dc.html | Commercial investigation (proof/credibility) |
| Contact.dc.html | Transactional / contact |

**Thin content, quantified:** measured raw visible word count (tags/scripts/styles stripped) on all 12 service pages: range 273–313 words *including* the shared nav/footer/boilerplate text that's identical on every page (roughly 80–100 of those words). That leaves each service page with an estimated **~180–230 words of genuinely unique body content** — thin by the standards of pages meant to rank for commercial service terms. Structurally every one of the 12 follows the exact same template: hero one-liner → 4-column benefit grid (usually reused verbatim in wording pattern) → gallery → 3 FAQ items → CTA. This is a real content-depth and differentiation gap, not an indexability one — Google can crawl and index all 12 fine, but thin, structurally-identical pages are the classic setup for **cannibalization and low differentiation** between them.

**Cross-service overlap risk:** the 4-column "why choose this service" benefit blocks on different service pages read very similarly to each other (verified by reading App-Development.dc.html, Brand-Identity.dc.html, and Digital-Marketing.dc.html side-by-side — same structural pattern, generic trust-building phrasing repeated with only the service noun swapped). None of the 12 pages link to or reference any other service page's content (see Section K), so there's no internal topical differentiation signal either.

**Missing supporting sections** common to strong service pages and absent here on all 12: no pricing/process detail specific to that service (a generic 7-step "how we work" only exists on the homepage), no case-study/portfolio embed filtered to that specific service (Portfolio.dc.html is generic, not cross-linked — see Section K), no testimonials specific to the service.

No keyword-volume or demand claims are made anywhere in this report — this section is on-page structure/depth only, as instructed.

## K. Internal linking findings

Full link graph built from source (every `href="*.dc.html"` on every page):

- **Zero broken internal links** — every internal `.dc.html`/`index.html` target was checked against the actual filesystem; all resolve.
- **Zero orphan pages** in the strict sense — all 18 non-home pages are linked from at least one other live page.
- **But: the persistent site nav only contains 6 destinations** (About, Team, Services, Portfolio, Partners, Contact) — present identically on all 19 pages. The 12 individual service subpages are reachable **only** as outbound links from `Services.dc.html` (confirmed: `App-Development.dc.html`, `Brand-Identity.dc.html`, etc. each receive exactly one internal inbound link, from Services.dc.html's grid). No other page — not even other service pages, not Portfolio.dc.html — links to them.
- **Service pages never cross-link to each other.** A visitor reading Web-Development.dc.html has no path to WordPress-Design.dc.html or UI-UX-Design.dc.html without going back through Services.dc.html, despite these being obviously related services a real prospect would want to compare.
- **Portfolio.dc.html doesn't link to relevant service pages.** Portfolio cards (data-category="web"/"apps"/"design"/"identity"/"content") don't cross-reference the matching service page (e.g. a "web" category project doesn't link to Web-Development.dc.html).
- No links point to the legacy/backup files identified in Section C — those pages are unlinked from anywhere in the live site (they're only reachable by someone guessing/knowing the exact URL), which is good, but doesn't fully mitigate their exposure since nothing blocks a crawler from finding them independently.
- No relative-path errors found; the codebase consistently uses relative (not absolute-path) internal hrefs.
- `?lang=` preservation across internal navigation: confirmed working correctly (verified in a prior session's regression testing) — internal links get rewritten via `syncInternalLinks()` in `assets/i18n.js` to carry the active `?lang=` forward, and this doesn't touch `mailto:`/`tel:`/`wa.me` links or break hash fragments.
- CTA paths: WhatsApp (`wa.me/970592608998`), the nav "Contact Us" button, and the various "Request a Proposal"-pattern CTAs (`*-cta-primary`, `.svc-cta-btn`) all consistently terminate at either `Contact.dc.html` or the WhatsApp deep link — no dead-end or ambiguous CTA paths found.

## L. Image SEO findings

- **Alt text: zero missing, zero empty, across all 19 pages** (all `<img>` tags checked programmatically). Sampled alt text is genuinely descriptive (e.g. "لوحة تحكم نظام إدارة طبي" — "medical management system dashboard"), not generic filler — this is above-average quality for alt text.
- **Formats:** of 35 distinct images referenced across all public pages, 22 are PNG, 7 JPG/JPEG, only 3 WebP. The site *does* use WebP successfully elsewhere (hero background, nav logo, some team photos), so the pipeline supports it — it just hasn't been applied to the portfolio/service showcase images.
- **File size:** the 22 PNGs referenced range roughly 180KB–857KB each (`web-custom-sports.png` 857KB, `web-custom-portfolio.png` 796KB, `app-smart-archive-dashboard.png` 655KB, six `design-*`/`identity-*` images each 430–610KB). These are concentrated on `Portfolio.dc.html` and `Services.dc.html`. This is a real, source-verified page-weight issue.
- **Width/height & CLS risk — checked properly, not just via a flat grep:** raw attribute scan flagged missing `width`/`height` on images in `index.html`/`About.dc.html`/`Contact.dc.html`/`Partners.dc.html`/`Team.dc.html` (the small footer logo icon) and on 50 of 52 images in `Portfolio.dc.html`. Investigated each case specifically:
  - The footer logo icon has an inline `style="width:28px;height:28px"` on the pages that lack the HTML attribute — inline styles apply at the same time as HTML attributes, so real CLS risk is low. Polish-level inconsistency (some pages set both, some only the inline style).
  - `.team-avatar` images (Team.dc.html) lack HTML width/height but are fixed via CSS (`width:132px!important;height:132px!important;aspect-ratio:1/1`) — CLS is mitigated by CSS loaded in `<head>` before body paints.
  - Portfolio's 19 visible grid thumbnails (`.portfolio-cover img`) lack width/height attributes but their container has `aspect-ratio:16/10` reserved via CSS — this is actually the modern best-practice CLS mitigation technique, arguably better than static attributes.
  - The other ~31 width-less Portfolio images are inside the `.portfolio-extra` details panel, which is `hidden` by default and only shown inside a JS-opened modal — they don't affect initial-load layout at all.
  - **Net finding: real CLS risk from images is low across the board**, despite the raw attribute audit initially looking concerning — the CSS-level mitigations are legitimate. Reported both the raw finding and the mitigating context because the raw numbers alone would be misleading.
- **Lazy loading:** used inconsistently — present on service-page gallery images (`App-Development.dc.html` 5/8, `Web-Development.dc.html` 5/8, etc.) and roughly a third of Portfolio's images, but absent on `index.html`, `About.dc.html`, `Contact.dc.html`, `Partners.dc.html`, `Team.dc.html`'s images (mostly small/above-fold images where lazy-loading wouldn't help anyway, so this is low-impact).
- **Duplicate assets:** `web-custom-portfolio.png` and `web-custom-login.png` are each referenced twice within Portfolio.dc.html itself (once as a cover thumbnail, once inside the gallery modal) — expected/intentional reuse, not a defect.

## M. Structured-data findings

This is the strongest area of the site. All JSON-LD parsed programmatically with a real JSON parser — **100% valid JSON, zero syntax errors, across all 32 JSON-LD blocks on all 19 pages.**

Coverage:
- `/`: `ProfessionalService` (complete NAP: name, address, phone, email, `areaServed` for 8 countries, `sameAs` linking Instagram/Facebook/LinkedIn) + `WebSite`.
- `About.dc.html`, `Team.dc.html`: `AboutPage` with nested `Organization`.
- `Contact.dc.html`: `ContactPage` with nested `Organization`.
- `Partners.dc.html`: `WebPage` + `WebSite`.
- `Portfolio.dc.html`: `CollectionPage` + `ItemList`.
- `Services.dc.html`: `OfferCatalog` + `Organization` + `Service`/`Offer` entries.
- All 12 service subpages: `Service` (with matching `areaServed`) + `BreadcrumbList` (correct 3-level position sequencing: Home → Services → this page, URLs all resolve to real pages) + `FAQPage`.

Checked specifically for the things Google penalizes: **FAQ schema content was spot-checked against the visible on-page FAQ accordion text on Web-Development.dc.html — it matches verbatim**, so this isn't the "invisible/mismatched FAQ schema" problem Google has cracked down on. Organization `name`/`url` values are identical everywhere they appear (checked across `/`, About, Contact, and the nested `provider` in Web-Development's Service schema) — no conflicting NAP data. `LocalBusiness` isn't used verbatim, but `ProfessionalService` is a valid, more specific LocalBusiness subtype — not an error, just worth knowing if a stricter validator is used later. CRM pages carry no schema (correct — they're noindexed anyway).

No duplicate schema blocks of the same type on the same page found.

## N. Open Graph findings

`og:title`, `og:description`, `og:url`, `og:image`, and `twitter:card` are present on **all 19 pages**, zero missing. `og:url` correctly matches each page's own canonical URL (checked all 19, no mismatches, no cross-page duplication).

One real finding: **`og:image` is identical on all 19 pages** — always `assets/basma-logo-navbar.png` (the nav logo). Sharing a specific service page or the Portfolio page on social media will show the same generic logo image rather than a page-relevant visual, which is a missed opportunity for click-through on social shares — not broken (the image URL resolves fine), just undifferentiated. Using PNG rather than the available WebP variant for `og:image` specifically is likely intentional/correct, since some social-platform crawlers historically had inconsistent WebP support for link previews.

## O. Performance risks (source-level only — see caveat below)

**A) Source-level risks identified (not measured):**
- `assets/i18n.js` (271KB) and `support.js` (78KB) are loaded via plain `<script src="...">` in `<head>` with **no `defer`/`async`**, alongside `assets/site-ui.js`, `assets/analytics.js`, `assets/contact-submit.js`, `assets/booking-widget.js`, `image-slot.js` — all render-blocking. Given i18n.js's size, this is the single most impactful source-level finding for load performance. (`assets/feedback.js` and `assets/tech-bg.js` do correctly use `defer`.)
- 22 unoptimized PNG images (180KB–857KB each) referenced from Portfolio.dc.html and Services.dc.html, as detailed in Section L — real added page weight for any visitor who scrolls to those sections or opens the portfolio modal.
- Positive findings, for balance: the hero background image is `rel="preload" as="image" fetchpriority="high"` (correct LCP optimization); Google Fonts are preconnected (`fonts.googleapis.com`, `fonts.gstatic.com` with `crossorigin`); custom fonts use `font-display:swap` (avoids invisible-text-on-load); the chat widget's CSS/JS are lazy-injected at runtime rather than shipped in the initial HTML.

**B) Measured production data:** none. I did not run Lighthouse/PageSpeed/CrUX or any real performance-measurement tool against production, and I'm not going to state LCP/CLS/INP numbers — that would be fabricated. Everything in this section is a source-level risk assessment, not a measured score.

## P. Mobile SEO findings

- Viewport meta tag is byte-identical and correct (`width=device-width, initial-scale=1`) on all 19 pages — no missing/misconfigured viewport found.
- Below 768px, `site-ui.js` hides the desktop nav entirely and swaps in a fixed bottom nav (`.basma-bottom-nav`, `min-height:68px`, `z-index:99999`), with `body` padding-bottom set to `78px + safe-area-inset-bottom` to prevent that bar from covering page content — checked and confirmed the math (78px clearance > 68px bar height).
- The floating chat widget (`position:fixed`, `z-index:99998`) is repositioned on mobile specifically to sit above the bottom nav (`bottom: calc(72px + safe-area-inset-bottom)`, which clears the 68px-tall nav) — this is deliberate, working engineering, not an accident. No sticky-UI-obscuring-content issue found.
- The language switcher's mobile-specific markup (`.basma-mobile-lang`, inside the hamburger menu) is separate from the desktop dropdown and was already regression-tested working in a prior session.
- I did not find a horizontal-overflow or tiny-tap-target issue from source inspection, but this category (visual overflow, real rendered tap-target sizing) is best confirmed with an actual mobile viewport screenshot rather than source reading alone — flagging as unverified rather than claiming certainty either way.

## Q. Security / technical hygiene (SEO-relevant only)

- **No mixed content** — grepped every public HTML file and every JS asset for hardcoded `http://` resource references; none found. All resources load over HTTPS.
- **No broken HTTPS asset URLs** found in the pages checked.
- **Duplicate host variants:** none reachable — http/non-www all correctly redirect to the single canonical `https://www.basmadigital.com` host (Section F).
- **Publicly exposed backup/staging content:** yes — this is the same finding as Section C, restated here because it's also a technical-hygiene issue, not just an indexing one (`_seo_backup_20260805/`, `_i18n_backup_20260806/`, `_crm_backup_20260806/`, `index.backup.html`, `index.preview.html` are all live).
- **Server errors:** none encountered while checking all 19 pages plus the backup paths.
- **404 handling:** confirmed correct — a nonexistent URL returns a real HTTP 404 (verified via `fetch()`, not just the visual page), not a soft-404 or silent redirect.
- **404s referenced internally:** none found — every internal link target was checked to exist (Section K).

## R. Full prioritized issue list (P0–P3)

**P0 — none.** No finding in this audit blocks crawling or indexing of the 19 real public pages. Search Console readiness for the real site is not blocked by anything found here.

**P1 — high impact:**
1. **Backup directories/files publicly live and unblocked.** Affected: `/index.backup.html`, `/index.preview.html`, `/_seo_backup_20260805/*`, `/_i18n_backup_20260806/*`, `/_crm_backup_20260806/*`. Why it matters: duplicate-content exposure, wasted crawl budget, potential brand/confusion risk if a backup URL gets shared or indexed with stale content. Recommended fix: exclude these paths from deployment (`.vercelignore` or move them outside the deployed root) — that's the clean fix; if they must stay deployed for now, add explicit `Disallow` rules in `robots.txt` and/or `noindex` meta tags as an interim measure. Risk of changing: near-zero — these files aren't linked from anywhere live and aren't referenced by any script; removing them from deployment doesn't touch i18n, analytics, or CRM.
2. **Title/description/og:title never localize with `?lang=`.** Affected: all 19 pages, most visibly `/`. Why it matters: an English or Spanish-language visitor arriving via search will see an Arabic title/snippet, and any social share of an English-language session shows Arabic preview text. Recommended fix: would require either server-side/per-language static titles or a client-side `document.title` update inside the existing `setLang()`/`applyCurrentLanguage()` flow in `assets/i18n.js` — a real code change, out of scope for this audit-only pass. Risk: touches the i18n system directly, needs careful regression testing against the existing language-switcher test suite before shipping.
3. **12 service pages carry ~180–230 words of unique content each, near-identical structure, zero cross-linking.** Affected: all 12 `*-Design.dc.html`/`*-Marketing.dc.html` etc. pages. Why it matters: thin, structurally-repetitive commercial pages are the classic profile for weak rankings and internal cannibalization. Recommended fix: expand unique body content per service, add specific supporting sections (service-specific process/pricing framing, filtered portfolio examples), and add "related services" cross-links. Risk: pure content/HTML work, no risk to i18n/analytics/CRM if done carefully (just needs the same `data-i18n` tagging convention followed for translated strings).

**P2 — medium impact:**
4. **Unoptimized PNG images** (22 files, 180KB–857KB) on Portfolio.dc.html/Services.dc.html not converted to WebP despite the pipeline already supporting WebP elsewhere. Fix: batch-convert to WebP with PNG fallback or `<picture>`. Risk: none to site behavior, purely an asset swap — but should be visually spot-checked after conversion.
5. **Render-blocking `assets/i18n.js` (271KB) and `support.js` (78KB)** loaded synchronously in `<head>`. Fix: candidate for `defer`, but i18n.js's inline FOUC-prevention script and the delegated `[data-lang-switch]` click handler both depend on load-order assumptions — this needs careful testing against the existing language-switcher regression suite, not a blind `defer` add. Risk: real — this is exactly the kind of change that could silently break the i18n system if done without re-running that suite.
6. **`index.html` served without a redirect** (canonical-only fix, not a 301). Fix: add a redirect rule for `/index.html` → `/` in `vercel.json`. Risk: low, but must confirm it doesn't interfere with any internal link that intentionally targets `index.html#hero` etc.
7. **`og:image` identical across all 19 pages.** Fix: page-specific social images, at least for Portfolio and the top service pages. Risk: none.
8. **Sitemap `lastmod` values are stale** (static `2026-08-05`, doesn't reflect actual edits). Fix: regenerate at deploy time or update manually alongside content changes. Risk: none.
9. **Location-modifier keywords in titles used on only 2 of 12 service pages.** Fix: apply the same "in Palestine and the Gulf" pattern consistently where relevant. Risk: none (title-only change), but title changes were explicitly out of scope for this pass.

**P3 — polish:**
10. Several meta descriptions (76–79 chars) under-use available snippet space.
11. Homepage title is pure brand/tagline with no service keyword.
12. Minor width/height-attribute inconsistency on the footer logo icon (mitigated by inline style, low real risk).
13. Lazy-loading applied inconsistently across pages (mostly harmless since affected images are small/above-fold).
14. `ProfessionalService` used instead of bare `LocalBusiness` (valid, just worth knowing for any external schema linter).

## S. Recommended implementation order

1. Remove/exclude backup files and directories from deployment (P1 #1) — highest ratio of impact to effort, zero behavioral risk.
2. Decide on and implement `?lang=` metadata localization (P1 #2) — needs design discussion (server-side vs. client-side approach) before touching `i18n.js`.
3. Content expansion + cross-linking pass on the 12 service pages (P1 #3) — largest effort, highest long-term SEO value.
4. Image optimization (P2 #4) and script-loading review (P2 #5) — bundle together as a "performance pass," with #5 gated on rerunning the existing regression suites.
5. Remaining P2/P3 polish items as time allows.

## T. Exact files that would need editing in a future fix phase

- **Deployment config** (not a page file): `vercel.json` and/or a new `.vercelignore` — for P1 #1 and P2 #6.
- `robots.txt` — if the interim `Disallow` approach is chosen for P1 #1 instead of/alongside deployment exclusion.
- `assets/i18n.js` — for P1 #2 (title/meta localization) and, carefully, P2 #5 (script loading).
- All 12 service pages (`App-Development.dc.html`, `Brand-Identity.dc.html`, `Content-Writing.dc.html`, `Digital-Marketing.dc.html`, `Graphic-Design.dc.html`, `Motion-Graphics.dc.html`, `SEO-Services.dc.html`, `Social-Media-Management.dc.html`, `UI-UX-Design.dc.html`, `Video-Editing.dc.html`, `Web-Development.dc.html`, `WordPress-Design.dc.html`) — for P1 #3 (content expansion, cross-linking) and P2 #9 (title keywords).
- `Portfolio.dc.html` and the 12 service pages — for the "portfolio → related service" cross-linking specifically.
- Image assets under `assets/` (the 22 PNGs identified) — for P2 #4, plus whichever HTML files reference them.
- `sitemap.xml` — for P2 #8 (lastmod accuracy), ideally by regenerating rather than hand-editing.
- All 19 pages' `<meta property="og:image">` — for P2 #7, if page-specific social images are pursued.

None of these were touched in this session.

## U. Confirmation

**No files were modified. Nothing was deployed. Nothing was committed or pushed.** This was a read-only audit: local source inspection (Read/Grep/bash on the repository) plus read-only live checks against production (`fetch`/browser navigation, JSON parsing of existing schema, no form submissions, no state-changing requests). CRM pages, Supabase/SQL, the authentication system, GA4/analytics.js, and the i18n/language-switcher system were inspected only where directly relevant to this SEO audit and were not altered in any way.
