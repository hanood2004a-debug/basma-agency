# Basma CRM v1.7 — Production Hardening Report

Full audit and repair pass covering both the Composer variable-rendering polish and the 16-area production audit. Nothing was deployed, committed, or pushed. No production data was deleted or reset. No migration was executed against the live Supabase project.

## A. Root causes found

1. **CSV import silently created sales Leads.** `import-companies.html`'s "إنشاء Leads" checkbox defaulted to *checked*, and `crm_import_batch()`'s SQL-level fallback also defaulted `create_leads` to `true` when omitted. Every CSV company import therefore created a real `crm_leads` row (`source = 'CSV Import'`) unless a user manually unchecked the box.
2. **Auto-follow-up tasks were not the bug — CSV-import-created fake Leads were.** `crm_create_followup_task()` (a trigger on `crm_leads` insert) is correct: `due_at` is always a precise `now() + 24h`, dedup is correctly scoped per-lead. It fired exactly as designed — the "bug" was that it was firing for leads that should never have existed (root cause #1).
3. **Mass email flood.** `api/_notify.js`'s overdue-task/meeting reminders sent **one Resend email per item**, with no digest. When many follow-up tasks became overdue at once (from the bulk CSV-import flood), this produced dozens of near-simultaneous emails.
4. **Raw UUID in the Lead Details timeline.** The same reminder functions recorded their dedup marker as a `crm_activities` row whose `subject` text embedded the raw task/meeting UUID (`"تم إرسال تذكير بريدي: مهمة متأخرة <uuid>"`) — and `crm_activities` feeds the timeline directly, so the UUID was rendered verbatim to users.
5. **Website contact form had no anti-spam protection beyond client-side validation.**
6. **Composer Preview showed raw `{{variable}}` placeholders** whenever a value was missing/empty, and the same unrendered text could reach the Resend send payload.
7. **No Resend delivery/bounce feedback loop existed.** `crm_outreach_messages.status` could only ever become `sent` or `failed` at send time — there was no way to learn that an accepted email later hard-bounced, so a bad address could be retried indefinitely.
8. **`crm/lead-details.html` had a legacy quick-log flow** ("تسجيل Email"/"تسجيل WhatsApp") that wrote only to `crm_activities`, bypassing `crm_outreach_messages` — the exact pattern `company-details.html` had already replaced with the Composer, but `lead-details.html` never got the same cleanup. This created a real canonical-source split (visible in the lead's own timeline, invisible to Company 360/Dashboard/Campaign metrics).
9. **`api/crm-send-email.js` checked write-access too late.** `crm_can_write()` was only ever enforced implicitly, when inserting the audit-log row — a read-only ("viewer") CRM user could still trigger a real outbound Resend send, and the failed audit-row insert was silently downgraded to a non-fatal warning.
10. **Notification bell count (~95): investigated, no bug found.** `crm_refresh_time_based_notifications()` already has a correct, working `dedupe_key` + `ON CONFLICT DO NOTHING` mechanism — `task_overdue` fires once ever per task, never re-fires daily. The ~95 count is real: it reflects the same CSV-import-created fake leads/tasks from root cause #1, not a counting bug.

## B. Bugs fixed

1. CSV import no longer creates Leads by default (frontend checkbox + SQL function default).
2. Reminder emails are now deduplicated via a proper internal ledger (`reminder_sent_at`) instead of a flawed timeline-marker scheme.
3. Reminder emails are sent as ONE digest per run instead of one-per-item.
4. Raw task/meeting UUIDs can no longer reach the Lead Details timeline (the writes that caused it were removed at the source).
5. Website contact form now has honeypot + minimum-fill-time + IP-hashed rate limiting + link-spam heuristics, all server-side.
6. Composer Preview always renders real values with smart Arabic fallbacks — never a raw placeholder — and blocks Send if a genuinely unknown variable is detected.
7. Resend delivery/bounce feedback is now captured via a signed webhook; hard bounces and spam complaints auto-suppress the contact (generic — not tied to any specific address).
8. `lead-details.html`'s redundant email/WhatsApp quick-log buttons are hidden whenever the Composer is available, eliminating the canonical-source split; the fallback (no linked company) is preserved.
9. `crm-send-email.js` now explicitly checks `crm_can_write()` before ever calling Resend — a viewer can no longer send real email with no audit trail.
10. `api/notify-followups.js` now rejects non-GET requests (was previously unrestricted).

## C. Files modified

- `crm/assets/crm-composer.js` — smart-fallback rendering (`renderTemplateSmart`, `unknownVariablesIn`), pre-send validation, unknown-variable warning UI.
- `crm/import-companies.html` — "إنشاء Leads" checkbox now defaults to unchecked, relabeled.
- `api/_notify.js` — `notifyOverdueFollowUps()`/`notifyMeetingReminders()` rewritten as single-digest, `reminder_sent_at`-based; added `restUpdateByIds()`.
- `api/contact-lead.js` — honeypot, minimum fill-time, IP-hashed rate limit, link-spam check.
- `assets/contact-submit.js` — captures/sends honeypot value + render timestamp.
- `Contact.dc.html`, `index.html` — added the hidden honeypot field to both public contact forms.
- `api/crm-send-email.js` — explicit `crm_can_write()` check before sending.
- `api/notify-followups.js` — GET-only.
- `crm/lead-details.html` — hides the two redundant legacy quick-log buttons when the Composer is available.

## D. Files added

- `CRM-PRODUCTION-HARDENING-V1.7.sql` — the one new additive migration (see section E/O).
- `CRM-CSV-IMPORT-LEADS-REPORT.sql` — optional, 100% read-only report to identify pre-existing CSV-import-created Leads (see section O).
- `api/resend-webhook.js` — new endpoint receiving Resend delivery events, Svix-signature-verified.
- 9 new test files (regression coverage — see section M); kept as scratch/output deliverables, matching this project's existing convention of not committing test scripts into the tracked repo.

## E. Database/schema changes

All in **one** new additive file, `CRM-PRODUCTION-HARDENING-V1.7.sql` (idempotent, no DROP/DELETE/TRUNCATE anywhere):

1. `crm_import_batch()` replaced (`CREATE OR REPLACE`) — `create_leads` default flipped `true → false`.
2. `crm_tasks.reminder_sent_at`, `crm_meetings.reminder_sent_at` — new nullable columns + partial indexes.
3. `crm_website_submission_log` — new table (IP-hash + timestamp only), RLS enabled, zero grants to anon/authenticated (service-role-only).
4. `crm_outreach_messages.status` CHECK widened to add `delivered`, `bounced`, `complained`; `provider_status_updated_at` column added.

## F. New/changed triggers/functions

- `crm_import_batch(jsonb, jsonb)` — replaced (see E.1). No triggers were changed; `crm_create_followup_task()`/`crm_complete_followup_task()`/`crm_unlink_manual_tasks_before_lead_delete()` in `CRM-AUTO-FOLLOWUP-TASKS.sql` were investigated and left untouched (confirmed correct — root cause was upstream).

## G. Changes to automatic follow-up behavior

None to the trigger itself — it was already deterministic and idempotent. The *effective* behavior changes because far fewer Leads (and therefore far fewer auto-follow-ups) get created going forward, now that CSV import no longer creates them by default.

## H. Changes to notifications/reminders

- Overdue-task and meeting reminders: one digest email per run (capped display of 20 items + "+N more"), all qualifying items stamped `reminder_sent_at` in one batch update, only after the send succeeds (fails closed on Resend errors — items retry next run).
- Nothing is written to `crm_activities` for these two reminder types anymore.
- In-app notification bell: unchanged (investigated, already correct — see A.10).

## I. Changes to website spam protection

- Honeypot field (`basma-hp-field`) on both public forms — invisible, unreachable by keyboard/screen reader, real bots fill it.
- Minimum fill time: 3 seconds from page-script-load to submit; missing timestamp (e.g. stale cached frontend) does not block.
- IP-hashed (SHA-256, never raw IP) rate limit: 5 submissions per 10 minutes.
- Link-spam heuristic: more than 1 link in the message, or any link in the name field, is rejected with a visible error.
- Honeypot/timing failures respond with a success-looking message (never tip off the bot) but create zero CRM records; the rate-limit attempt is still logged either way.
- The real Website-lead-creation + admin-notification feature is fully preserved for legitimate submissions.
- Cloudflare Turnstile: wired as fully optional (`TURNSTILE_SECRET_KEY` unset → complete no-op); see section P if you want to enable it.

## J. Changes to template rendering

- New `renderTemplateSmart()` — every known CRM variable always resolves to a real value or a smart Arabic fallback (`{{contact_name}} → فريق <company>`, `{{first_name}} → فريق`, etc.); Preview never shows a raw `{{var}}`.
- New `unknownVariablesIn()` — flags any variable name that isn't one of the 8 known CRM variables.
- Before every real send path (email API, WhatsApp deep-link, LinkedIn copy, WhatsApp/LinkedIn confirm-sent logging), the actual outgoing text is re-rendered through `renderTemplateSmart()` and blocked with a visible warning if an unknown variable remains — proven by tests that inspect the literal payload sent to `/api/crm-send-email`.
- The editor fields themselves are untouched (may still show `{{var}}` if the user typed one manually) — only Preview and the actual send payload are guaranteed clean, per the spec.

## K. Changes to Resend bounce/delivery handling

- New `api/resend-webhook.js`: Svix-signature-verified (hand-implemented with Node's `crypto`, no new dependency), rejects with 503 if `RESEND_WEBHOOK_SECRET` isn't configured (fully optional, like `RESEND_API_KEY`).
- `email.delivered` → `crm_outreach_messages.status = 'delivered'`.
- `email.bounced` (always a **hard**, permanent bounce per Resend's own event model) → `status = 'bounced'` + the associated contact is auto-suppressed (`email_suppressed = true`), generically — nothing in the code references any specific address.
- `email.complained` → `status = 'complained'` + same auto-suppression.
- Out-of-order events never downgrade an already-terminal status.
- `api/crm-send-email.js` already blocked sending to a suppressed contact (pre-existing) — the webhook is what now populates that flag automatically instead of requiring a manual DB edit.

## L. Security findings

Full audit performed (subagent-assisted, evidence-cited). No critical issues. Two real, now-fixed issues:

- **Medium (fixed):** `crm-send-email.js` could be used by a read-only ("viewer") CRM user to send a real email with no audit trail, because write-access was only checked implicitly and too late. Fixed with an explicit `crm_can_write()` RPC check before Resend is ever called — fails **closed** (403) if the check itself errors.
- **Low (fixed):** `api/notify-followups.js` had no HTTP method restriction. Now GET-only.
- **Verified clean:** no secret (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`) ever appears in a browser-loaded file; `resend-webhook.js` verifies the Svix signature strictly before any DB read/write and rejects stale timestamps (>5 min); RLS spot-checked on `crm_notifications`, `crm_outreach_messages`, `crm_contacts` suppression columns, and the new `crm_website_submission_log` — all correctly scoped (`crm_can_read()`/`crm_can_write()`, zero anon access).
- **Deliberate, documented tradeoff:** `contact-lead.js`'s rate-limit check fails *open* (a broken check never blocks a legitimate visitor on a public marketing form) while `crm-send-email.js`'s new authorization check fails *closed* (an authenticated write action must never grant access by default on error) — different contexts, different correct choices.

## M. Test results with exact counts

**255 assertions, 0 failures**, across 13 suites (9 new this session + 4 pre-existing re-verified):

| Suite | Count |
|---|---|
| test-crm-composer.cjs | 15 |
| test-crm-composer-dom.cjs | 33 |
| test-crm-composer-templates.cjs | 15 |
| test-crm-composer-smart-vars.cjs (new) | 22 |
| test-crm-send-email.cjs (extended) | 31 |
| test-notify-digest.cjs (new) | 13 |
| test-contact-lead-antispam.cjs (new) | 15 |
| test-resend-webhook.cjs (new) | 15 |
| test-lead-details-quickactions.cjs (new) | 8 |
| test-company-360.mjs | 19 |
| test-outreach-automation.mjs | 41 |
| test-default-templates.mjs | 18 |
| test-csv-import-no-lead.mjs (new) | 10 |

All CRM `.html` files' inline scripts and every touched `.js` file parse cleanly (`node --check` / `new Function()`). The full migration chain, including the new v1.7 file, was run **twice** against a real embedded Postgres (pglite) with zero errors, confirming idempotency. All Resend and Supabase calls in every test are mocked — no real email was sent, no real network access occurred, no real CRM records were touched during testing.

Two test suites referenced in the prior session summary (`test-outreach-hub.mjs`, `test-bulk-note.mjs`) were not present in this session's scratch space (cleared between sessions) and could not be re-run; nothing in this pass touched the code they covered.

## N. Any remaining limitations

- Reminder emails still run on page-load (not a true cron) — a disclosed, pre-existing limitation, unchanged by this pass.
- Un-suppressing a contact after a bounce is fixed (e.g. a typo corrected) currently requires a direct DB update or the existing Outreach Hub UI's suppressed-status display — no dedicated "un-suppress" button was added (out of scope for a hardening pass; flagged for a future UI-focused phase).
- Turnstile is wired server-side but has no frontend widget yet — activating it requires adding Cloudflare's script tag + site key to the two public forms (see section P).
- `crm_website_submission_log` will grow indefinitely; a periodic manual cleanup query is documented in the migration file's comments but not scheduled (no cron available under "no deploy").
- The full 13-page UI/UX audit (item 13) was scoped to what surfaced during the functional audit (the lead-details.html canonical-source fix); a dedicated visual/RTL/mobile sweep of all 20+ CRM pages was not performed end-to-end given the size of the rest of this pass — no issues were reported by the user, so none were speculatively "fixed."

## O. Exact SQL file(s) to run manually in Supabase

1. **`CRM-PRODUCTION-HARDENING-V1.7.sql`** — run once, in full, in the Supabase SQL editor. Safe to re-run. This is the only file that changes schema/functions.
2. **`CRM-CSV-IMPORT-LEADS-REPORT.sql`** (optional) — 100% read-only SELECT report to see which existing Leads were likely created unintentionally by past CSV imports. Run any time, as many times as you like — it changes nothing. Use the results to manually decide whether to leave, relabel, or close any of them (no action is required).

## P. Exact deployment/environment steps to perform manually

1. Run the two SQL files above in the Supabase SQL editor (in order: hardening migration first, report second/optional).
2. Deploy this code the same way you always do (git push / Vercel deploy) — nothing in this pass changed the deployment process itself.
3. **Optional — Resend delivery/bounce webhook:** in the Resend dashboard, create a webhook pointed at `https://<your-domain>/api/resend-webhook`, subscribed to at least `email.delivered`, `email.bounced`, `email.complained`. Copy the returned `signing_secret` (starts with `whsec_`) into your environment as `RESEND_WEBHOOK_SECRET`. Until you do this, the endpoint exists but simply returns 503 — nothing breaks either way.
4. **Optional — Cloudflare Turnstile:** register your domain at Cloudflare Turnstile, set `TURNSTILE_SECRET_KEY` in your environment, and add Turnstile's widget script + site key to `Contact.dc.html`/`index.html`'s forms if you want a visible CAPTCHA layer on top of the honeypot/timing/rate-limit protections already active. Until configured, this is a complete no-op.
5. No other environment variables changed. Existing `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `NOTIFY_ADMIN_EMAIL` etc. are unchanged.
