// CRM v1.2 Phase 7 — thin endpoint that triggers the follow-up reminder
// emails (overdue task, meeting within 24h). Called by crm/assets/crm-client.js
// once per CRM page load (fire-and-forget, no request body, no auth payload —
// mirrors api/notify-lead.js). All the real logic, dedup, and safe-failure
// behavior lives in api/_notify.js's runFollowUpReminders(); this file's only
// job is to invoke it and always answer 200, since it is a best-effort
// background task that must never surface as an error in the CRM UI.
const { runFollowUpReminders } = require("./_notify.js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // v1.7 security hardening: restrict to GET (this endpoint never reads a
  // request body and has nothing to "create"). Still unauthenticated by
  // design — crm-client.js fires this from any signed-in CRM page, and the
  // underlying work is idempotent/dedup-guarded in api/_notify.js either
  // way — but there is no reason to accept any other HTTP method.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  try {
    const result = await runFollowUpReminders();
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("notify-followups API error", { code: err.message });
    return res.status(200).json({ ok: false });
  }
};
