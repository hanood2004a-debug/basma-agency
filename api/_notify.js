// Shared admin-notification module — CRM v1.1 Phase 1.
//
// Sends a transactional email to the Basma admin inbox whenever a Lead or
// Booking is created, via Resend's REST API (POST https://api.resend.com/emails).
// No SDK — a plain fetch() call, matching every other integration in this
// project (Supabase, Gemini). RESEND_API_KEY lives only in process.env on
// the server; it is never sent to, or reachable from, the browser.
//
// Called from three places:
//   - api/contact-lead.js   (Website Contact Form -> new Lead)
//   - api/book-appointment.js (Website Booking -> new Booking)
//   - api/notify-lead.js    (manual Lead creation in crm/leads.html)
//
// Non-blocking by contract: every exported function only ever returns a
// { ok, skipped? } result object and NEVER throws. Callers can await it
// without a try/catch and are guaranteed the Lead/Booking save is never
// affected by a notification failure.
const { serverConfig, supabaseHeaders } = require("./appointments.js").helpers;

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 8000;

function notifyConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    from: process.env.NOTIFY_FROM_EMAIL || "Basma CRM <notifications@basmadigital.com>",
    to: process.env.NOTIFY_ADMIN_EMAIL || "basmadigital.ps@gmail.com",
  };
}

function siteUrl() {
  return String(process.env.SITE_URL || "https://www.basmadigital.com").replace(/\/$/, "");
}

function leadLink(leadId) {
  return `${siteUrl()}/crm/lead-details.html?id=${encodeURIComponent(leadId)}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function row(label, value) {
  if (!value) return "";
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(value)}</td></tr>`;
}

async function restGet(config, table, params) {
  // Supports array values so a caller can express two conditions on the
  // same column (e.g. scheduled_at: ["gte.<x>", "lte.<y>"]) as PostgREST
  // requires — a plain object can only hold one value per key, so a
  // straight `new URLSearchParams(params)` would silently produce a
  // single, invalid combined value instead of two repeated query params.
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else query.append(key, value);
  });
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, { headers: supabaseHeaders(config) });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_LOOKUP_FAILED`), { status: response.status });
  return response.json();
}

async function restInsert(config, table, payload) {
  const response = await fetch(`${config.url}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders(config, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_INSERT_FAILED`), { status: response.status });
  return response.json();
}

// Batch PATCH by id list — e.g. stamping reminder_sent_at on every task/
// meeting included in one digest email in a single round-trip, instead of
// N sequential per-row updates.
async function restUpdateByIds(config, table, ids, payload) {
  if (!ids || !ids.length) return;
  const idList = ids.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(`${config.url}/rest/v1/${table}?id=in.(${idList})`, {
    method: "PATCH",
    headers: supabaseHeaders(config, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_UPDATE_FAILED`), { status: response.status });
}

// Duplicate-prevention: a crm_activities row with activity_type='email' and
// this exact marker subject means the email was already sent for this
// event. No schema change needed — reuses the existing table exactly like
// CRM-AUTO-FOLLOWUP-TASKS.sql's title-pattern marker convention.
async function alreadyNotified(config, leadId, marker) {
  const rows = await restGet(config, "crm_activities", {
    select: "id",
    lead_id: `eq.${leadId}`,
    activity_type: "eq.email",
    subject: `eq.${marker}`,
    limit: "1",
  });
  return rows.length > 0;
}

async function markNotified(config, leadId, companyId, contactId, marker) {
  await restInsert(config, "crm_activities", {
    lead_id: leadId,
    company_id: companyId || null,
    contact_id: contactId || null,
    activity_type: "email",
    subject: marker,
  });
}

async function sendEmail({ subject, html, text }) {
  const cfg = notifyConfig();
  if (!cfg) {
    console.error("Notify: RESEND_API_KEY is not configured — admin email skipped", { subject });
    return { ok: false, skipped: "not_configured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject, html, text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyPreview = await response.text().catch(() => "");
      console.error("Notify: Resend API rejected the request", { status: response.status, bodyPreview: bodyPreview.slice(0, 200) });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("Notify: could not reach Resend", { name: err.name, message: err.message });
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

async function notifyNewLead(fields) {
  const { leadId, leadTitle, name, email, phone, company, service, source, companyId, contactId } = fields;
  const config = serverConfig();
  if (!config) return { ok: false, skipped: "supabase_not_configured" };

  const marker = "تم إرسال إشعار بريدي للمسؤول: Lead جديد";
  try {
    if (await alreadyNotified(config, leadId, marker)) return { ok: true, skipped: "duplicate" };
  } catch (err) {
    console.error("Notify: dedup check failed for new-lead email, sending anyway", { code: err.message });
  }

  const link = leadLink(leadId);
  const html = `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto">
      <h2 style="margin:0 0 6px">Lead جديد في Basma CRM</h2>
      <p style="color:#6b7280;margin:0 0 16px">${escapeHtml(leadTitle)}</p>
      <table style="border-collapse:collapse;width:100%">
        ${row("الاسم", name)}
        ${row("البريد الإلكتروني", email)}
        ${row("الهاتف", phone)}
        ${row("الشركة", company)}
        ${row("الخدمة المطلوبة", service)}
        ${row("المصدر", source)}
      </table>
      <p style="margin-top:20px"><a href="${link}" style="background:#c9a98d;color:#1d3a4a;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:700;display:inline-block">فتح في CRM</a></p>
    </div>`;
  const text = `Lead جديد: ${leadTitle}\nالاسم: ${name || "-"}\nالبريد: ${email || "-"}\nالهاتف: ${phone || "-"}\nالشركة: ${company || "-"}\nالخدمة: ${service || "-"}\nالمصدر: ${source || "-"}\nرابط CRM: ${link}`;

  const result = await sendEmail({ subject: `Lead جديد: ${leadTitle}`, html, text });
  if (result.ok) {
    try {
      await markNotified(config, leadId, companyId, contactId, marker);
    } catch (err) {
      console.error("Notify: failed to record new-lead notification marker", { code: err.message, leadId });
    }
  }
  return result;
}

async function notifyNewBooking(fields) {
  const {
    leadId, name, email, phone, company, service,
    appointmentDate, appointmentTime, bookingReference,
    companyId, contactId,
  } = fields;
  const config = serverConfig();
  if (!config) return { ok: false, skipped: "supabase_not_configured" };

  const marker = `تم إرسال إشعار بريدي للمسؤول: حجز ${bookingReference}`;
  if (leadId) {
    try {
      if (await alreadyNotified(config, leadId, marker)) return { ok: true, skipped: "duplicate" };
    } catch (err) {
      console.error("Notify: dedup check failed for new-booking email, sending anyway", { code: err.message, bookingReference });
    }
  }

  const link = leadId ? leadLink(leadId) : `${siteUrl()}/crm/meetings.html`;
  const html = `
    <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:0 auto">
      <h2 style="margin:0 0 6px">حجز استشارة جديد</h2>
      <p style="color:#6b7280;margin:0 0 16px">رقم الحجز: ${escapeHtml(bookingReference)}</p>
      <table style="border-collapse:collapse;width:100%">
        ${row("الاسم", name)}
        ${row("البريد الإلكتروني", email)}
        ${row("الهاتف", phone)}
        ${row("الشركة", company)}
        ${row("الخدمة المطلوبة", service)}
        ${row("تاريخ الموعد", appointmentDate)}
        ${row("وقت الموعد", appointmentTime)}
      </table>
      <p style="margin-top:20px"><a href="${link}" style="background:#c9a98d;color:#1d3a4a;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:700;display:inline-block">فتح في CRM</a></p>
    </div>`;
  const text = `حجز استشارة جديد — رقم: ${bookingReference}\nالاسم: ${name || "-"}\nالبريد: ${email || "-"}\nالهاتف: ${phone || "-"}\nالشركة: ${company || "-"}\nالخدمة: ${service || "-"}\nالتاريخ: ${appointmentDate || "-"}\nالوقت: ${appointmentTime || "-"}\nرابط CRM: ${link}`;

  const result = await sendEmail({ subject: `حجز استشارة جديد — ${bookingReference}`, html, text });
  if (result.ok && leadId) {
    try {
      await markNotified(config, leadId, companyId, contactId, marker);
    } catch (err) {
      console.error("Notify: failed to record new-booking notification marker", { code: err.message, bookingReference });
    }
  }
  return result;
}

// ----------------------------------------------------------------------
// CRM v1.2 Phase 7 — follow-up reminder emails (overdue task, meeting
// reminder). Rewritten in v1.7 (production hardening pass) to fix two
// bugs discovered in production:
//
//   1. MASS EMAIL FLOOD: the original version sent one separate Resend
//      email PER overdue task / upcoming meeting. When many follow-up
//      tasks became overdue around the same time (e.g. from a bulk CSV
//      import that had auto-created Leads — see crm_import_batch's v1.7
//      fix), this produced dozens of near-simultaneous emails to the
//      internal admin inbox. Fixed by sending ONE digest email per run
//      listing every qualifying item, instead of one email per item.
//
//   2. RAW UUID IN TIMELINE: the old dedup marker was a crm_activities row
//      with subject text containing the raw task/meeting UUID (e.g.
//      "تم إرسال تذكير بريدي: مهمة متأخرة 645c1a36-..."), and
//      crm_activities feeds the Lead Details timeline directly — so that
//      raw UUID was rendered straight to users. Fixed by moving dedup to
//      two new, purely internal columns — crm_tasks.reminder_sent_at and
//      crm_meetings.reminder_sent_at (added in
//      CRM-PRODUCTION-HARDENING-V1.7.sql) — and no longer writing
//      anything to crm_activities for this event type at all. Nothing
//      about a reminder email is ever shown on the Lead Details timeline
//      now, which is arguably more correct anyway (a reminder is an
//      internal ops event, not something that happened with the lead).
//
// WHY THIS RUNS FROM A CLIENT-TRIGGERED ENDPOINT INSTEAD OF A CRON JOB:
// a true cron (Vercel Cron / pg_cron) needs a deployment or an extra DB
// extension, both out of scope while "no deploy" is in effect. Instead,
// crm/assets/crm-client.js calls GET /api/notify-followups once per CRM
// page load (fire-and-forget, same pattern as the in-app notification
// refresh). This is a disclosed limitation, not true real-time: reminders
// go out whenever a CRM user is next active, not on a fixed clock. See
// the v1.7 report for the honest write-up of this trade-off.
//
// Idempotency: every task/meeting fetched in a run (up to DIGEST_FETCH_CAP)
// gets reminder_sent_at stamped in one batch UPDATE, but ONLY after the
// single digest email send succeeds — so a Resend outage never silently
// "uses up" an item's one reminder. Once stamped, that item can never
// trigger another reminder (the query only ever selects
// reminder_sent_at IS NULL), matching "the same task must not generate
// the same reminder repeatedly".
const DIGEST_FETCH_CAP = 50;
const DIGEST_DISPLAY_CAP = 20;

function digestListHtml(items, renderRow) {
  const shown = items.slice(0, DIGEST_DISPLAY_CAP);
  const remaining = items.length - shown.length;
  const rows = shown.map(renderRow).join("");
  const moreLine = remaining > 0
    ? `<p style="color:#6b7280;margin:12px 0 0">+ ${remaining} عنصر إضافي — افتح CRM لعرض القائمة الكاملة.</p>`
    : "";
  return `<table style="border-collapse:collapse;width:100%">${rows}</table>${moreLine}`;
}

function digestListText(items, renderLine) {
  const shown = items.slice(0, DIGEST_DISPLAY_CAP);
  const remaining = items.length - shown.length;
  const lines = shown.map(renderLine).join("\n");
  return remaining > 0 ? `${lines}\n+ ${remaining} عنصر إضافي — افتح CRM لعرض القائمة الكاملة.` : lines;
}

async function notifyOverdueFollowUps() {
  const config = serverConfig();
  if (!config) return { ok: false, skipped: "supabase_not_configured" };
  try {
    const tasks = await restGet(config, "crm_tasks", {
      select: "id,title,lead_id,company_id,due_at,priority",
      status: "not.in.(completed,cancelled)",
      due_at: `lt.${new Date().toISOString()}`,
      lead_id: "not.is.null",
      reminder_sent_at: "is.null",
      order: "due_at.asc",
      limit: String(DIGEST_FETCH_CAP),
    });
    if (!tasks.length) return { ok: true, checked: 0, sent: 0 };

    // Batch-fetch the leads for human-readable titles (never show a raw
    // task/lead UUID to a human — same principle CRM-v1.1 already applies
    // to the in-app notification center).
    const leadIds = [...new Set(tasks.map((t) => t.lead_id))];
    const leadRows = leadIds.length
      ? await restGet(config, "crm_leads", { select: "id,title", id: `in.(${leadIds.join(",")})` })
      : [];
    const leadTitleById = new Map(leadRows.map((l) => [l.id, l.title]));

    const items = tasks.map((t) => ({
      title: t.title,
      leadTitle: leadTitleById.get(t.lead_id) || "Lead",
      dueAt: t.due_at,
      priority: t.priority,
      link: leadLink(t.lead_id),
    }));

    const html = `
      <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;text-align:right;max-width:560px;margin:0 auto">
        <h2 style="margin:0 0 6px">مهام متابعة متأخرة (${items.length})</h2>
        <p style="color:#6b7280;margin:0 0 16px">يوجد ${items.length} مهمة متابعة تجاوزت موعد استحقاقها وتحتاج انتباهك.</p>
        ${digestListHtml(items, (it) => `<tr>
          <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">${escapeHtml(new Date(it.dueAt).toLocaleDateString("ar-EG"))}</td>
          <td style="padding:6px 0"><a href="${it.link}" style="color:#1d3a4a;text-decoration:none;font-weight:600">${escapeHtml(it.leadTitle)}</a> — ${escapeHtml(it.title)}</td>
        </tr>`)}
        <p style="margin-top:20px"><a href="${siteUrl()}/crm/tasks.html" style="background:#c9a98d;color:#1d3a4a;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:700;display:inline-block">فتح المهام في CRM</a></p>
      </div>`;
    const text = `مهام متابعة متأخرة (${items.length}):\n` +
      digestListText(items, (it) => `- [${it.leadTitle}] ${it.title} — استحق في ${it.dueAt} — ${it.link}`) +
      `\n\nفتح المهام في CRM: ${siteUrl()}/crm/tasks.html`;

    const result = await sendEmail({ subject: `تذكير: ${items.length} مهمة متابعة متأخرة`, html, text });
    if (result.ok) {
      try {
        await restUpdateByIds(config, "crm_tasks", tasks.map((t) => t.id), { reminder_sent_at: new Date().toISOString() });
      } catch (err) {
        console.error("Notify: failed to stamp reminder_sent_at on overdue tasks — they may be re-included next run", { code: err.message });
      }
      return { ok: true, checked: tasks.length, sent: tasks.length };
    }
    return { ok: true, checked: tasks.length, sent: 0 };
  } catch (err) {
    console.error("Notify: overdue-task query failed", { code: err.message });
    return { ok: false, checked: 0, sent: 0 };
  }
}

async function notifyMeetingReminders() {
  const config = serverConfig();
  if (!config) return { ok: false, skipped: "supabase_not_configured" };
  try {
    const nowIso = new Date().toISOString();
    const in24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const meetings = await restGet(config, "crm_meetings", {
      select: "id,title,lead_id,company_id,scheduled_at,meeting_type",
      status: "eq.scheduled",
      scheduled_at: [`gte.${nowIso}`, `lte.${in24hIso}`],
      lead_id: "not.is.null",
      reminder_sent_at: "is.null",
      order: "scheduled_at.asc",
      limit: String(DIGEST_FETCH_CAP),
    });
    if (!meetings.length) return { ok: true, checked: 0, sent: 0 };

    const leadIds = [...new Set(meetings.map((m) => m.lead_id))];
    const leadRows = leadIds.length
      ? await restGet(config, "crm_leads", { select: "id,title", id: `in.(${leadIds.join(",")})` })
      : [];
    const leadTitleById = new Map(leadRows.map((l) => [l.id, l.title]));

    const items = meetings.map((m) => ({
      title: m.title,
      leadTitle: leadTitleById.get(m.lead_id) || "Lead",
      scheduledAt: m.scheduled_at,
      link: leadLink(m.lead_id),
    }));

    const html = `
      <div style="font-family:Tajawal,Arial,sans-serif;direction:rtl;text-align:right;max-width:560px;margin:0 auto">
        <h2 style="margin:0 0 6px">اجتماعات خلال 24 ساعة (${items.length})</h2>
        <p style="color:#6b7280;margin:0 0 16px">يوجد ${items.length} اجتماع مجدول خلال الـ 24 ساعة القادمة.</p>
        ${digestListHtml(items, (it) => `<tr>
          <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">${escapeHtml(new Date(it.scheduledAt).toLocaleString("ar-EG"))}</td>
          <td style="padding:6px 0"><a href="${it.link}" style="color:#1d3a4a;text-decoration:none;font-weight:600">${escapeHtml(it.leadTitle)}</a> — ${escapeHtml(it.title)}</td>
        </tr>`)}
        <p style="margin-top:20px"><a href="${siteUrl()}/crm/meetings.html" style="background:#c9a98d;color:#1d3a4a;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:700;display:inline-block">فتح الاجتماعات في CRM</a></p>
      </div>`;
    const text = `اجتماعات خلال 24 ساعة (${items.length}):\n` +
      digestListText(items, (it) => `- [${it.leadTitle}] ${it.title} — ${it.scheduledAt} — ${it.link}`) +
      `\n\nفتح الاجتماعات في CRM: ${siteUrl()}/crm/meetings.html`;

    const result = await sendEmail({ subject: `تذكير: ${items.length} اجتماع خلال 24 ساعة`, html, text });
    if (result.ok) {
      try {
        await restUpdateByIds(config, "crm_meetings", meetings.map((m) => m.id), { reminder_sent_at: new Date().toISOString() });
      } catch (err) {
        console.error("Notify: failed to stamp reminder_sent_at on meetings — they may be re-included next run", { code: err.message });
      }
      return { ok: true, checked: meetings.length, sent: meetings.length };
    }
    return { ok: true, checked: meetings.length, sent: 0 };
  } catch (err) {
    console.error("Notify: meeting-reminder query failed", { code: err.message });
    return { ok: false, checked: 0, sent: 0 };
  }
}

async function runFollowUpReminders() {
  const [overdue, meetings] = await Promise.all([notifyOverdueFollowUps(), notifyMeetingReminders()]);
  return { overdue, meetings };
}

module.exports = { notifyNewLead, notifyNewBooking, runFollowUpReminders };
