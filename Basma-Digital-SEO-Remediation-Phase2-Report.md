# Basma Digital — SEO Remediation Phase 2 (Service-Page Content, Intent, Linking & Conversion)

Scope: service-page content depth, search intent, internal linking, service differentiation, and commercial conversion quality across all 12 service pages. Nothing was deployed, committed, or pushed.

## A. Exact files modified

| File | Change |
|---|---|
| `App-Development.dc.html` | Content expanded, related-services + portfolio link section added, 1 new FAQ + JSON-LD entry, process steps differentiated |
| `Brand-Identity.dc.html` | Same pattern |
| `Content-Writing.dc.html` | Same pattern |
| `Digital-Marketing.dc.html` | Same pattern |
| `Graphic-Design.dc.html` | Same pattern |
| `Motion-Graphics.dc.html` | Same pattern |
| `SEO-Services.dc.html` | Same pattern |
| `Social-Media-Management.dc.html` | Same pattern |
| `UI-UX-Design.dc.html` | Same pattern |
| `Video-Editing.dc.html` | Same pattern |
| `Web-Development.dc.html` | Same pattern |
| `WordPress-Design.dc.html` | Same pattern |
| `assets/i18n.js` | 419 new translation keys added (× English + Spanish = 838 new dict entries), appended to the end of the existing `en` and `es` blocks. No existing key was modified or removed. |

No other file was touched. `Services.dc.html`, `Portfolio.dc.html`, `index.html`, `assets/analytics.js`, `assets/contact-submit.js`, `assets/booking-widget.js`, `assets/i18n.js`'s core logic (only new dict entries were appended), CRM, Supabase, SQL, API endpoints, `robots.txt`, `sitemap.xml`, `vercel.json`, `.vercelignore`, and all backup directories were **not modified**.

## B. Word count before/after (main content area, per service page)

| Page | Before | After | Added |
|---|---:|---:|---:|
| Web-Development | 262 | 460 | +198 |
| WordPress-Design | 266 | 439 | +173 |
| Brand-Identity | 259 | 439 | +180 |
| UI-UX-Design | 252 | 432 | +180 |
| SEO-Services | 257 | 428 | +171 |
| App-Development | 252 | 421 | +169 |
| Digital-Marketing | 254 | 410 | +156 |
| Content-Writing | 236 | 397 | +161 |
| Graphic-Design | 232 | 380 | +148 |
| Motion-Graphics | 228 | 374 | +146 |
| Video-Editing | 228 | 370 | +142 |
| Social-Media-Management | 237 | 370 | +133 |

These counts include the breadcrumb, hero eyebrow/CTA button labels, and includes-list, not just prose paragraphs — actual added prose is slightly lower per page. Honest note: four pages (Graphic-Design, Motion-Graphics, Video-Editing, Social-Media-Management) landed at 370–380 rather than the full 500–800 target. Their service scope is naturally more compact (a production/management service with fewer distinct sub-topics than, say, web development or WordPress), and I chose not to pad them with filler to hit a number, per your explicit instruction. Every page still fully answers all 9 required questions (what/who/problem/deliverables/process/benefit/why-Basma/related-services/next-action).

## C. Primary search intent per page

| Page | Primary intent | Commercial intent | Related Basma services | Portfolio category |
|---|---|---|---|---|
| Web-Development | تطوير مواقع مخصصة / شركة تصميم مواقع | High — direct build request | UI/UX, SEO, WordPress | web |
| WordPress-Design | تصميم موقع ووردبريس قابل للإدارة الذاتية | High | Web-Development, SEO, Content-Writing | web |
| UI-UX-Design | تصميم واجهات UI/UX وتجربة مستخدم | Medium-high (often pre-dev) | Web-Development, App-Development, Brand-Identity | web |
| App-Development | تطوير تطبيقات وأنظمة إدارية عربية | High | UI/UX, Web-Development | apps |
| Brand-Identity | تصميم هوية بصرية / شعار | High | Graphic-Design, Content-Writing | identity |
| Graphic-Design | تصميم جرافيك لمنشورات وحملات | Medium-high (often recurring) | Brand-Identity, Motion-Graphics, Social-Media-Management | design |
| Motion-Graphics | فيديو موشن جرافيك توضيحي | Medium | Video-Editing, Graphic-Design | design |
| Video-Editing | مونتاج فيديو احترافي | Medium | Motion-Graphics, Social-Media-Management | (visual production work, no dedicated portfolio category — worded generically, see Section F) |
| SEO-Services | تحسين محركات البحث SEO | High | Content-Writing, Web-Development, Digital-Marketing | content |
| Digital-Marketing | حملات تسويق رقمي وإدارة إعلانات | High | Social-Media-Management, Content-Writing, SEO | content |
| Social-Media-Management | إدارة منصات التواصل الاجتماعي | Medium-high (often recurring) | Digital-Marketing, Graphic-Design, Content-Writing | content |
| Content-Writing | كتابة محتوى ونصوص تسويقية | Medium | SEO, Digital-Marketing, Social-Media-Management | content |

No keyword-volume figures are claimed anywhere — none were available, and none were fabricated, per your instruction.

## D. Sections added to each page

Applied consistently but with page-specific content (not copy-pasted): expanded **"لمن هذه الخدمة؟"** (who) and **"المشكلة التي تحلها"** (problem) paragraphs from one sentence to two; a new **"لماذا [الخدمة] مع بصمة؟"** (why Basma) section explaining the specific approach for that service; the 5 process-step titles/descriptions were **rewritten to be service-specific** (previously identical, word-for-word, across all 12 pages — this was the clearest case of template sameness and is now fixed); a new **"خدمات ذات صلة"** (related services) section with 2–3 contextual internal links; a portfolio CTA line; and one additional, genuinely new FAQ item (with matching JSON-LD update). Not every page got identical section names — the FAQ questions and "why" framing differ by service, as instructed.

## E. Internal links added

| From page | Links to |
|---|---|
| Web-Development | UI-UX-Design, SEO-Services, WordPress-Design |
| WordPress-Design | Web-Development, SEO-Services, Content-Writing |
| UI-UX-Design | Web-Development, App-Development, Brand-Identity |
| App-Development | UI-UX-Design, Web-Development |
| Brand-Identity | Graphic-Design, Content-Writing |
| Graphic-Design | Brand-Identity, Motion-Graphics, Social-Media-Management |
| Motion-Graphics | Video-Editing, Graphic-Design |
| Video-Editing | Motion-Graphics, Social-Media-Management |
| SEO-Services | Content-Writing, Web-Development, Digital-Marketing |
| Digital-Marketing | Social-Media-Management, Content-Writing, SEO-Services |
| Social-Media-Management | Digital-Marketing, Graphic-Design, Content-Writing |
| Content-Writing | SEO-Services, Digital-Marketing, Social-Media-Management |

2–3 links per page (within your 2–4 target), each with descriptive Arabic anchor text (e.g. "تحسين محركات البحث SEO لموقعك", never "اضغط هنا"). Relationships are reciprocal where it made sense (e.g. Web-Development ↔ WordPress-Design ↔ SEO-Services form a natural cluster) rather than one-directional link farming. One deliberate deviation from your example list: I did not link every page back to itself's inverse in every direction — e.g. Brand-Identity only links out to 2 services (Graphic-Design, Content-Writing) rather than 3, because a third genuinely relevant option wasn't obvious without forcing it.

## F. Portfolio links added

Every one of the 12 service pages now has one contextual link to `Portfolio.dc.html` ("شاهد نماذج من أعمالنا…" / "استكشف أعمالنا…" phrasing, varied by page). I checked Portfolio.dc.html's actual `data-category` values first: `web` (3 projects), `apps` (3), `identity` (4), `design` (6, includes a motion graphics project), `content` (3, includes platform management, an SEO campaign, and content writing). Every category referenced from a service page is a category that genuinely has at least one real project behind it — nothing fabricated.

Two decisions worth flagging:
- **Video-Editing** has no dedicated portfolio category of its own (its closest relative, motion graphics, sits under `design`). I used the safe, non-specific wording you suggested ("استكشف أعمالنا في الإنتاج المرئي" / "Explore our visual production work") rather than claiming a video-editing-specific category that doesn't exist.
- I deliberately did **not** modify `Portfolio.dc.html` to add reverse links back to service pages. Your instructions made this conditional ("if it can be done safely... without changing its behavior"), and Portfolio.dc.html has its own filtering/modal JavaScript I'd need to touch. Given the one-directional service→portfolio links already satisfy the intent, I judged the added risk of touching Portfolio.dc.html's script wasn't justified for this phase. Flagging as a possible small follow-up, not done here.

## G. Translation keys added/changed

419 new keys added to `assets/i18n.js`, each with both an English and a Spanish value (838 new dictionary entries total, 0 removed, 0 modified). Naming follows the existing dot-namespace convention (`svc.<pagecode>.<section>.<field>`, e.g. `svc.webdev.why.body`), where `<pagecode>` is a short code per page (webdev, wp, uiux, app, brand, graphic, motion, video, seo, dm, smm, content).

Arabic values were **not** added as a separate dictionary — consistent with the site's existing architecture, Arabic is the literal HTML source text, captured automatically by `i18n.js`'s `data-i18n-ar` fallback mechanism the first time the page runs (exactly how `nav.home` / `footer.copyright` already worked before this phase).

One structural fix was necessary and is worth calling out: several FAQ `<summary>` elements contain a nested `<span class="svcp-faq-arrow">+</span>` for the "+" toggle icon. Applying `data-i18n` directly to `<summary>` would have caused `i18n.js` (which sets `.textContent`) to wipe out that nested span every time the language changed, silently breaking the FAQ "+" arrows in EN/ES. I caught this before it shipped and instead wrapped only the question text in its own `<span data-i18n="...">`, leaving the arrow span as an untouched sibling. Verified with an automated jsdom test (Section K) that the arrow survives a full ar→en→es→ar cycle on all 12 pages.

## H. Title/meta changes

**None.** I reviewed title, meta description, canonical, and Open Graph tags on all 12 pages and found them already specific and accurate (confirmed in the Phase 4 audit and re-checked here) — no change met the bar of "clear SEO or intent improvement," so per your instruction I left all of them untouched. Exactly one `<title>` and one canonical tag remain on each page.

## I. Structured-data changes

Each of the 12 pages' `FAQPage` JSON-LD gained exactly one new `Question`/`Answer` entry, matching the one new FAQ item added to the visible page. I verified programmatically (Section K) that on every page, the visible FAQ questions and the JSON-LD `mainEntity` questions are identical in count, order, and text — nothing drifted out of sync. The `Service` and `BreadcrumbList` JSON-LD blocks were not touched (no changes were needed there).

## J. CTA changes

The existing contact/proposal/WhatsApp architecture was preserved exactly — no second conversion system was introduced. What changed is *context*, not mechanics: each page now has a "related services" block with its own soft CTA into `Portfolio.dc.html`, using class `svcp-cta-secondary` (the same secondary-button style already used elsewhere), so it's visually consistent but distinct from the primary "اطلب هذه الخدمة" buttons. No new prices, guarantees, client counts, turnaround-time promises, or certifications were introduced anywhere — I scanned all 12 pages' new content for this class of claim and found none.

## K. Test results

Ran four layers of testing after implementation, all against the live modified files:

1. **Static/structural checks (Node script)** across all 12 service pages + 19 public pages + `assets/i18n.js` + CRM + `sitemap.xml`/`robots.txt`/`vercel.json`/`.vercelignore`: exactly one `<h1>` per service page ✓; every `FAQPage` JSON-LD entry matches its visible FAQ text and order exactly ✓; every JSON-LD block parses as valid JSON ✓; no broken internal links (every `.dc.html`/`index.html` href resolves to a real file) ✓; every `data-i18n` key used on any of the 12 pages exists in both the English and Spanish dictionaries — zero missing keys ✓; GA4 tag present exactly once and `assets/analytics.js` loaded exactly once on every page, unchanged ✓; `#basmaCtaBtn` and the WhatsApp link selectors analytics.js depends on are intact on every page ✓; `assets/i18n.js` parses with no syntax errors ✓; CRM still has exactly 20 `.html` files ✓; `sitemap.xml` still has exactly 19 URLs ✓; `robots.txt` still has no `Disallow` rules ✓; `.vercelignore` still has its 5 original rules ✓; `vercel.json`'s `/index.html → /` redirect is still intact ✓.
2. **Live jsdom rendering, English** — loaded each of the 12 modified pages with the real `assets/i18n.js` executing, switched to `?lang=en`: no raw `data-i18n` keys ever rendered as visible text (i.e. every key resolved) ✓; every page's FAQ "+" arrow spans survived intact ✓; `html[lang]`/`[dir]` correctly flipped to `en`/`ltr` ✓; the new "why" section correctly showed English (not leftover Arabic) ✓; related-service links kept their `href` ✓. All 12 pages passed.
3. **Live jsdom rendering, Spanish** — same battery, `?lang=es`. All 12 pages passed.
4. **Full language cycle test** — loaded each page fresh (Arabic default), called the real `setLang()` through `en → es → ar`, and confirmed the "why" section's text returned to byte-identical Arabic, FAQ arrows remained uncorrupted, and `html[lang]`/`[dir]` returned to `ar`/`rtl`. All 12 pages passed — this specifically validates the `data-i18n-ar` fallback mechanism works correctly for all the new content, not just the pre-existing nav/footer strings.

Additional targeted checks: confirmed analytics event selectors are unaffected by the new links — the new "related services" and portfolio links use classes/hrefs that don't collide with any tracked category in `assets/analytics.js`'s click handler (they simply go untracked, exactly like the site's existing untracked internal nav links — no double-counting, no interference). One narrow edge case is worth noting: `SEO-Services.dc.html` is the one related-service link target whose filename happens to contain the substring `Services.dc.html`, which `analytics.js`'s home-page-teaser matcher also checks — I traced the logic and confirmed it falls through without firing any event for this link (same "intentionally not tracked" behavior the code already documents for plain Services-page links), so this is a functionally harmless edge case, not a bug.

Confirmed by direct comparison: `assets/contact-submit.js`, `assets/booking-widget.js`, and `assets/analytics.js` files themselves were never opened for writing this phase (only `assets/i18n.js` was edited, and only by appending new dictionary keys).

## L. Any remaining SEO issues

Carried over from the Phase 4 audit and not addressed in this phase (out of scope): performance/render-blocking items, and the homepage title (see Section M). Within this phase's scope, one soft judgment call: four pages (Graphic-Design, Motion-Graphics, Video-Editing, Social-Media-Management) sit at 370–380 words rather than 500+ — see Section B for why I didn't pad them. If you'd like these pushed further, the most honest way to add real length would be a short "Deliverables" or a slightly larger FAQ (2 more questions) rather than restating existing points in different words.

## M. Homepage title recommendation

Current: **"بصمة للحلول الرقمية | من الفكرة إلى الإطلاق"** — brand-forward but doesn't describe what Basma actually does.

Recommended: **"بصمة للحلول الرقمية | تصميم وتطوير مواقع، تسويق رقمي وهوية بصرية"**
(Basma Digital Solutions | Web design & development, digital marketing and brand identity)

Rationale: it keeps the brand name first (consistency, no loss of brand equity), and replaces the vague tagline with the three service categories a searcher is most likely typing around (web development, digital marketing, brand identity) — matching the site's actual meta description and its highest-intent service pages. This is a recommendation only; **`index.html`'s title was not modified.**

## N. Git diff summary

This directory is still not a git repository (confirmed again this phase — no `.git` folder present). There is no git diff to produce. All effective changes are fully enumerated in Sections A, D–G, I, and J above.

## O. Confirmation CRM/Supabase/SQL were untouched

Confirmed. No file under `crm/` was opened for writing. No `.sql` file was touched. No Supabase configuration, API endpoint (`api/*.js`), `assets/analytics.js`, `assets/contact-submit.js`, `assets/booking-widget.js`, GA4 install, `robots.txt`, `sitemap.xml`, `vercel.json`, `.vercelignore`, or backup directory was modified. `crm/*.html` file count verified unchanged at 20 (Section K).

## P. Confirmation nothing was deployed

Confirmed. No `vercel`, `vercel --prod`, or `npx vercel` command was run at any point.

## Q. Confirmation nothing was committed/pushed

Confirmed. No `git commit` or `git push` was run — and as noted in Section N, there's no git repository here for such a command to act on.

---

**Stopping here per your instruction.** Ready for your review before you deploy.
