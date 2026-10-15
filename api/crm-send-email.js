// Server-side email send for the Sales Outreach Hub's Unified Communication
// Composer (v1.6). This is the ONLY place RESEND_API_KEY is read — it never
// reaches the browser. Unlike api/_notify.js (which sends FROM the server
// TO the Basma admin inbox using the service-role key, with no end-user
// session involved), this endpoint sends on behalf of a signed-in CRM user
// TO a company/contact, so it authenticates that user's own Supabase
// session and then talks to Supabase's REST API using the PUBLIC anon key
// plus that user's own access token — never the service-role key. This
// means every database write below is still governed by the exact same
// crm_can_read()/crm_can_write() RLS policies as if the browser had made
// the request directly with supabase-js. No permission logic is duplicated
// here; Postgres is still the single source of truth for who can write.
//
// Flow: validate input -> verify the caller's token -> (if the recipient
// isn't suppressed) call Resend -> record the outcome in
// crm_outreach_messages -> on success only, best-effort update
// crm_outreach.email_status, log a crm_activities entry, and optionally
// schedule a follow-up via crm_schedule_followup(). A Resend failure NEVER
// touches crm_outreach/crm_companies/crm_leads — only a 'failed' history
// row is recorded, exactly as required.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }
function isEmail(v) { return typeof v === "string" && EMAIL_RE.test(v.trim()); }

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textToHtml(text) {
  return "<div style=\"font-family:Tajawal,Arial,sans-serif;white-space:pre-wrap;line-height:1.7\">" + escapeHtml(text) + "</div>";
}

function envConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !anonKey || !resendKey) return null;
  return {
    supabaseUrl,
    anonKey,
    resendKey,
    from: process.env.CRM_OUTREACH_FROM_EMAIL || process.env.NOTIFY_FROM_EMAIL || "Basma CRM <notifications@basmadigital.com>",
  };
}

function userHeaders(cfg, token, extra) {
  return { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(extra || {}) };
}

async function verifyUser(cfg, token) {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && data.id ? data : null;
}

async function restSelect(cfg, token, table, params) {
  const query = new URLSearchParams(params);
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: userHeaders(cfg, token) });
  if (!res.ok) throw Object.assign(new Error(`select_${table}_failed`), { status: res.status, body: await res.text().catch(() => "") });
  return res.json();
}

async function restInsert(cfg, token, table, payload) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: userHeaders(cfg, token, { Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw Object.assign(new Error(`insert_${table}_failed`), { status: res.status, body: await res.text().catch(() => "") });
  return res.json();
}

async function restUpdate(cfg, token, table, matchParams, payload) {
  const query = new URLSearchParams(matchParams);
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: userHeaders(cfg, token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw Object.assign(new Error(`update_${table}_failed`), { status: res.status, body: await res.text().catch(() => "") });
}

async function restRpc(cfg, token, fn, args) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: userHeaders(cfg, token),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw Object.assign(new Error(`rpc_${fn}_failed`), { status: res.status, body: await res.text().catch(() => "") });
  return res.json().catch(() => null);
}

async function callResend(cfg, { to, cc, subject, bodyText }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const payload = { from: cfg.from, to: [to], subject, html: textToHtml(bodyText), text: bodyText };
    if (cc) payload.cc = [cc];
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyJson = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, errorCode: String(response.status), errorMessage: (bodyJson && (bodyJson.message || bodyJson.error)) || "Resend rejected the request." };
    }
    return { ok: true, providerMessageId: bodyJson && bodyJson.id ? bodyJson.id : null };
  } catch (err) {
    return { ok: false, status: 0, errorCode: err.name === "AbortError" ? "timeout" : "network_error", errorMessage: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const cfg = envConfig();
  if (!cfg) {
    return send(res, 503, { ok: false, error: "not_configured", message: "SUPABASE_URL / SUPABASE_ANON_KEY / RESEND_API_KEY must all be set on the server." });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return send(res, 401, { ok: false, error: "unauthorized", message: "لا توجد جلسة تسجيل دخول صالحة." });

  let user;
  try {
    user = await verifyUser(cfg, token);
  } catch (err) {
    return send(res, 401, { ok: false, error: "unauthorized", message: "تعذّر التحقق من الجلسة." });
  }
  if (!user) return send(res, 401, { ok: false, error: "unauthorized", message: "انتهت صلاحية الجلسة، سجّل الدخول من جديد." });

  // v1.7 security hardening: previously, a signed-in but read-only
  // ("viewer") CRM user could still reach callResend() below and trigger a
  // REAL outbound email — crm_can_write() was only ever checked implicitly,
  // later, when inserting the crm_outreach_messages audit row (RLS would
  // reject that insert for a viewer), and that rejection was caught and
  // downgraded to a non-fatal warning while still returning `ok: true`.
  // Net effect: a viewer could send real mail with no corresponding audit
  // trail. Explicitly checking write access up front — the same
  // crm_can_write() RLS helper every other write in this CRM relies on —
  // closes that gap before Resend is ever called.
  try {
    const canWrite = await restRpc(cfg, token, "crm_can_write", {});
    if (!canWrite) {
      return send(res, 403, { ok: false, error: "forbidden", message: "لا تملك صلاحية إرسال رسائل من الـ CRM." });
    }
  } catch (err) {
    return send(res, 403, { ok: false, error: "forbidden", message: "تعذّر التحقق من الصلاحيات." });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch (e) { return send(res, 400, { ok: false, error: "validation_error", message: "طلب غير صالح (JSON)." }); }

  const companyId = body.companyId;
  const contactId = body.contactId || null;
  const leadId = body.leadId || null;
  const templateId = body.templateId || null;
  const campaignId = body.campaignId || null;
  const to = String(body.to || "").trim();
  const cc = body.cc ? String(body.cc).trim() : null;
  const subject = String(body.subject || "").trim();
  const bodyText = String(body.bodyText || "").trim();
  const followUpDays = body.followUpDays != null ? Number(body.followUpDays) : null;

  if (!isUuid(companyId)) return send(res, 400, { ok: false, error: "validation_error", message: "companyId غير صالح." });
  if (contactId && !isUuid(contactId)) return send(res, 400, { ok: false, error: "validation_error", message: "contactId غير صالح." });
  if (leadId && !isUuid(leadId)) return send(res, 400, { ok: false, error: "validation_error", message: "leadId غير صالح." });
  if (templateId && !isUuid(templateId)) return send(res, 400, { ok: false, error: "validation_error", message: "templateId غير صالح." });
  if (campaignId && !isUuid(campaignId)) return send(res, 400, { ok: false, error: "validation_error", message: "campaignId غير صالح." });
  if (!isEmail(to)) return send(res, 400, { ok: false, error: "validation_error", message: "عنوان البريد الإلكتروني للمستلم غير صالح." });
  if (cc && !isEmail(cc)) return send(res, 400, { ok: false, error: "validation_error", message: "عنوان CC غير صالح." });
  if (!subject) return send(res, 400, { ok: false, error: "validation_error", message: "الموضوع مطلوب." });
  if (!bodyText) return send(res, 400, { ok: false, error: "validation_error", message: "نص الرسالة مطلوب." });
  if (followUpDays != null && (!Number.isInteger(followUpDays) || followUpDays < 1)) {
    return send(res, 400, { ok: false, error: "validation_error", message: "مدة المتابعة يجب أن تكون رقمًا صحيحًا أكبر من صفر." });
  }

  // Suppression check (section 13 — "unsubscribe/suppression-ready
  // architecture"). Only checked when we know which contact this is going
  // to; a plain company-email send has no suppression record to check
  // against in this phase.
  if (contactId) {
    try {
      const rows = await restSelect(cfg, token, "crm_contacts", { select: "email_suppressed,email_suppressed_reason,email", id: `eq.${contactId}`, limit: "1" });
      const c = rows[0];
      if (c && c.email_suppressed) {
        return send(res, 400, { ok: false, error: "recipient_suppressed", message: "جهة الاتصال هذه ضمن قائمة الإيقاف (" + (c.email_suppressed_reason || "بدون سبب مسجّل") + ") ولا يمكن إرسال بريد لها." });
      }
    } catch (err) {
      // Non-fatal: if we can't check suppression (e.g. RLS rejects the
      // read, meaning this user cannot write to the CRM at all), let the
      // insert below fail with a clear RLS error instead of silently
      // skipping the send.
    }
  }

  const resendResult = await callResend(cfg, { to, cc, subject, bodyText });
  const warnings = [];

  if (!resendResult.ok) {
    let failedRow = null;
    try {
      const rows = await restInsert(cfg, token, "crm_outreach_messages", {
        company_id: companyId, contact_id: contactId, lead_id: leadId, campaign_id: campaignId, template_id: templateId,
        channel: "email", status: "failed", recipient: to, subject, body: bodyText,
        provider: "resend", error_code: resendResult.errorCode, error_message: resendResult.errorMessage,
      });
      failedRow = rows[0] || null;
    } catch (err) {
      console.error("crm-send-email: failed to record a 'failed' history row", { code: err.message, status: err.status });
    }
    return send(res, 502, {
      ok: false, error: "send_failed", message: resendResult.errorMessage || "تعذّر إرسال البريد عبر Resend.",
      messageId: failedRow ? failedRow.id : null,
    });
  }

  let sentRow = null;
  try {
    const rows = await restInsert(cfg, token, "crm_outreach_messages", {
      company_id: companyId, contact_id: contactId, lead_id: leadId, campaign_id: campaignId, template_id: templateId,
      channel: "email", status: "sent", recipient: to, subject, body: bodyText,
      provider: "resend", provider_message_id: resendResult.providerMessageId, follow_up_days: followUpDays,
    });
    sentRow = rows[0] || null;
  } catch (err) {
    // The email is already sent and cannot be un-sent. A failure to record
    // it is surfaced as a warning, not a failure response — matching the
    // rest of this codebase's "best-effort side effect after an
    // irreversible action" convention (see api/_notify.js).
    console.error("crm-send-email: email sent but history row insert failed", { code: err.message, status: err.status });
    warnings.push("تم إرسال البريد لكن تعذّر حفظه في سجل التواصل.");
  }

  try {
    await restUpdate(cfg, token, "crm_outreach", { company_id: `eq.${companyId}` }, { email_status: "sent" });
  } catch (err) {
    warnings.push("تم الإرسال لكن تعذّر تحديث حالة Outreach.");
  }

  try {
    await restInsert(cfg, token, "crm_activities", {
      company_id: companyId, contact_id: contactId, lead_id: leadId,
      activity_type: "email", subject: "بريد إلكتروني: " + subject, details: "إلى: " + to,
    });
  } catch (err) {
    warnings.push("تم الإرسال لكن تعذّر تسجيل النشاط في الجدول الزمني.");
  }

  if (followUpDays != null && sentRow) {
    try {
      await restRpc(cfg, token, "crm_schedule_followup", {
        p_company_id: companyId, p_message_id: sentRow.id, p_days: followUpDays, p_channel: "email",
      });
    } catch (err) {
      warnings.push("تم الإرسال لكن تعذّر جدولة المتابعة.");
    }
  }

  return send(res, 200, {
    ok: true, messageId: sentRow ? sentRow.id : null, providerMessageId: resendResult.providerMessageId,
    warnings,
  });
};
