# Basma Digital — SEO Remediation Phase 1 (Production Cleanup & URL Consolidation)

Scope: Task 1 (exclude backups from production), Task 2 (`/index.html → /` redirect), Task 3 (robots.txt left untouched), Task 4 (regression testing), Task 5 (this report). No deployment, commit, or push was performed.

## A. Exact files modified / created

| File | Action | Nature of change |
|---|---|---|
| `.vercelignore` | **Created** (did not exist before) | New file, 5 lines, listing the 5 backup paths |
| `vercel.json` | **Modified** | One key added: `"redirects"` array with a single rule. No other key touched. |

No other file in the repository was created, modified, or deleted. Nothing under `crm/`, `assets/`, any `.dc.html` page, `sitemap.xml`, `robots.txt`, `package.json`, or `.gitignore` was touched.

## B. Exact `.vercelignore` rules added

```
index.backup.html
index.preview.html
_seo_backup_20260805/
_i18n_backup_20260806/
_crm_backup_20260806/
```

These are gitignore-syntax rules (the format `.vercelignore` uses). Trailing `/` restricts a rule to matching a directory (and everything inside it) rather than a same-named file, so `_crm_backup_20260806/` cannot accidentally match anything else.

## C. Exact `vercel.json` redirect added

```json
"redirects": [
  { "source": "/index.html", "destination": "/", "permanent": true }
]
```

Inserted as a new top-level key, directly after `"trailingSlash": false` and before `"functions"`. `permanent: true` → HTTP 308 (per Vercel's documented redirect object definition). No other existing key (`outputDirectory`, `cleanUrls`, `trailingSlash`, `functions`, `headers`) was altered.

Full resulting file:

```json
{"outputDirectory": ".",
  "cleanUrls": false,
  "trailingSlash": false,
  "redirects": [
    { "source": "/index.html", "destination": "/", "permanent": true }
  ],
  "functions": {
    "api/chat.js": {
      "maxDuration": 30
    }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

Confirmed valid JSON (`JSON.parse` succeeds).

## D. Confirmation: local backup files were NOT deleted

Verified after implementation — all 5 targets still physically present on disk:

```
_crm_backup_20260806/   (3 files: .env.example, package.json, vercel.json)
_i18n_backup_20260806/  (22 files)
_seo_backup_20260805/   (9 files)
index.backup.html
index.preview.html
```

`.vercelignore` only affects what gets **uploaded to Vercel** at deploy time — it has no effect on the local filesystem. Nothing was passed to `rm`, `unlink`, or any delete operation at any point in this phase.

## E. Confirmation: real `/crm/` was NOT excluded

- `crm/*.html` — 20 files confirmed present and not matched by any `.vercelignore` rule.
- Programmatically verified every file under `crm/` against the new `.vercelignore` patterns using the same `ignore` library semantics Vercel's tooling is built on: **0 matches**.
- The backup directory `_crm_backup_20260806/` is a distinct, differently-named path (it contains only `.env.example`, `package.json`, `vercel.json` — a config-only snapshot, not a copy of the CRM app) and cannot be confused with `/crm/` by the ignore rules, which match on exact path prefixes.
- The new redirect's `source` is the literal, non-wildcarded string `/index.html`, which matches only that exact path. It does **not** match `/crm/index.html` (a different full path) — confirmed both by inspecting Vercel's exact-path matching behavior and by checking that `crm/index.html` exists on disk as its own distinct file, unaffected by the rule.

## F. Test results (16-point regression checklist)

All 16 items verified programmatically after the changes were made:

1. **All 19 public pages exist** — confirmed (`index.html` + 18 `.dc.html` pages), none missing.
2. **No public page accidentally excluded** — confirmed; ran every one of the 19 pages through the new `.vercelignore` patterns, zero matches.
3. **`/crm/` still exists and works** — 20 `crm/*.html` files present, none ignored, no CRM file touched.
4. **CRM files not modified** — confirmed via mtime check; no file under `crm/` was written to during this phase.
5–7. **Arabic / English / Spanish** — `assets/i18n.js` was never opened for editing this phase (mtime unchanged from before this session); the redirect and ignore rules operate purely at the HTTP/deployment layer and don't touch the i18n engine, so language behavior is unaffected.
8. **Language persistence / navigation (`?lang=`)** — Vercel's documented redirect behavior forwards the incoming query string to the destination by default when the destination doesn't define its own query string (confirmed against Vercel's own knowledge base: *"By default, all query strings that are found in the source path will be passed to the destination path"*). Since `destination: "/"` carries no query string of its own, a request to `/index.html?lang=en` will 308-redirect to `/?lang=en`, and `/index.html?lang=es` to `/?lang=es` — the `?lang=` system is preserved. Hash fragments (e.g. `#hero`) are never sent to the server at all and are preserved automatically by the browser through any redirect, standard across all browsers.
9. **GA4 tag exactly once per public page** — verified programmatically across all 19 pages: `G-9Z7D1YFF79` appears exactly twice per page (once in the `gtag.js` script `src` URL, once in the `gtag('config', ...)` call) — i.e. one tag, no duplication, on every page.
10. **`assets/analytics.js` still loads** — the `<script src="assets/analytics.js"></script>` tag is present on all 19 pages; file itself untouched.
11. **Contact form code unchanged** — `assets/contact-submit.js` not modified this phase (mtime predates this session).
12. **Booking code unchanged** — `assets/booking-widget.js` not modified this phase (mtime predates this session).
13. **`sitemap.xml` still contains exactly the intended 19 URLs** — confirmed by parsing the file: 19 `<loc>` entries, matching the expected set (`/` + the 18 named pages), file itself untouched.
14. **`robots.txt` remains valid** — untouched; still `User-agent: *` / `Allow: /` / `Sitemap:` line, no `Disallow` rules added (per Task 3).
15. **No internal links break** — every non-home page's `href="index.html"` / `href="index.html#hero"` link is a *relative* link that resolves to the absolute path `/index.html` when clicked from any top-level page. The new redirect rule matches that exact path and forwards to `/`, preserving any trailing hash. No link text was changed, so this was verified as safe without needing to rewrite any of the ~70 existing internal link instances.
16. **No production asset accidentally ignored** — the complete list of every path matched by the new `.vercelignore` was enumerated and consists *only* of files inside the 5 named backup targets (`index.backup.html`, `index.preview.html`, and the contents of the three `_..._backup_...` directories). Nothing else in the 243-file repository is matched.

Additionally, `node scripts/validate.js` (the repo's own existing build/validate script, which does a filesystem-existence check including `index.html`) was re-run after the changes and still passes — expected, since the redirect only affects HTTP routing to that path, not the physical file's presence on disk, which is unchanged.

## G. Risks discovered

- **Low risk, documented for awareness only:** two items outside the scope you defined were noticed during the file inventory and were **not touched**: a `previews/` directory and a `.preview-server.cjs` file at the repo root. Neither was in your Task 1 removal list, so both were left exactly as-is. Flagging in case you want them assessed in a future phase.
- **No risk found** with the redirect itself — Vercel's own documentation confirms 308 redirects preserve query strings by default and that `source` matching is exact-path (not prefix) when no wildcard is used, so `/crm/index.html` is unaffected.
- One nuance worth knowing: this redirect will add one extra network hop (a 308 response, cached by the browser after the first visit) for the handful of internal nav/footer/mobile-logo links that still point at `index.html#hero` rather than `/`. This was in scope only as a safety check per your instructions ("inspect internal links... to make sure nothing depends on index.html directly"), not a request to rewrite those links — so they were left unchanged. If you'd like, a future low-risk follow-up could update those ~70 relative links to point straight at `/` to skip the redirect hop entirely; not done here since it wasn't requested.

## H. Git diff summary

This working directory is **not a git repository** (no `.git` folder present; `git status` returns "fatal: not a git repository"). There is therefore no git diff to produce. The two effective file-level changes for this phase are fully captured verbatim in sections A–C above (one new file, one one-key addition to an existing file).

## I. Confirmation nothing was deployed

Confirmed. No `vercel`, `vercel --prod`, or `npx vercel` command of any kind was run at any point in this phase.

## J. Confirmation nothing was committed or pushed

Confirmed. No `git commit` or `git push` was run — and as noted in section H, there is no git repository here for such a command to act on in the first place.

---

**Stopping here per your instruction.** Nothing has been deployed or pushed. Ready for your review before you run the production deployment yourself.
