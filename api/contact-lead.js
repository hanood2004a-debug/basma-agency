// Public Contact form → Basma CRM lead capture.
//
// Every valid submission from Contact.dc.html / index.html creates (or
// reuses) a crm_contacts row, optionally a crm_companies row, and a
// crm_leads row tagged source="Website" — plus a crm_activities note
// holding the visitor's message. Runs server-side only, using
// SUPABASE_SERVICE_ROLE_KEY (never exposed to the browser). Never touches
// RLS-restricted CRM UI code.
//
// v1.7 production hardening pass — anti-spam (audit item #5). This form is,
// by design, public and unauthenticated, so it must defend itself:
//   1. Honeypot: a hidden field ("hp") real users never see or fill; a
//      non-empty value is a near-certain bot signal.
//   2. Minimum realistic fill time ("ts", ms since the page's script
//      loaded): rejects submissions that arrive faster than a human could
//      plausibly have read the form and typed an answer.
//   3. IP-hashed rate limiting: crm_website_submission_log (new, v1.7
//      migration) caps how many submissions one IP can make in a rolling
//      window — this is what actually stops a bot that rotates through
//      random names/emails to dodge the existing per-email dedupe below.
//   4. Input sanity checks: a message stuffed with multiple links is a
//      classic spam signature and is rejected with a normal validation
//      error (kept visible, unlike 1/2, since this check has a small
//      false-positive risk and a legitimate visitor deserves a chance to
//      edit their message rather than being silently dropped).
//   5. Optional Cloudflare Turnstile: only activates if TURNSTILE_SECRET_KEY
//      is set in the environment — completely inert (zero behavior change)
//      until Basma chooses to configure it, matching this project's
//      existing "optional integration, graceful no-op when unconfigured"
//      convention (see RESEND_API_KEY / notifyConfig()).
//
// None of this touches the legitimate-enquiry path: a real visitor filling
// out the form normally sails through every one of these checks.
const { notifyNewLead } = require("./_notify.js");
const crypto = require("crypto");

const MAX_BODY_BYTES = 6000;
const DEDUPE_WINDOW_HOURS = 24; // avoid a second open "Website" lead for the
// same contact within this window (e.g. accidental double-submit); a later,
// genuinely new inquiry still gets its own fresh lead.

const MIN_FILL_MS = 3000; // faster than this since the form's script loaded
// is treated as non-human. Deliberately low (3s) to keep false positives on
// genuine fast typists effectively at zero.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_PER_WINDOW = 5; // a real visitor essentially never
// submits this contact form more than a handful of times in ten minutes.
const MAX_LINKS_IN_MESSAGE = 1; // one link is a plausible legitimate
// reference (e.g. "here's my current site: ..."); several is a classic
// spam-bot signature.

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function config() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function headers(settings, extra = {}) {
  return { apikey: settings.key, Authorization: `Bearer ${settings.key}`, ...extra };
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return null;
  var stripped = String(value).split("").filter(function (ch) {
    var code = ch.charCodeAt(0);
    return code > 31 && code !== 127;
  }).join("");
  var cleaned = stripped.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function restGet(settings, table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${settings.url}/rest/v1/${table}?${query}`, { headers: headers(settings) });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_LOOKUP_FAILED`), { status: response.status });
  return response.json();
}

async function restInsert(settings, table, payload) {
  const response = await fetch(`${settings.url}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(settings, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_INSERT_FAILED`), { status: response.status });
  const rows = await response.json();
  return rows[0];
}

async function findOrCreateCompany(settings, name) {
  if (!name) return null;
  const existing = await restGet(settings, "crm_companies", { select: "id", name: `ilike.${name}`, limit: "1" });
  if (existing[0]) return existing[0];
  return restInsert(settings, "crm_companies", { name });
}

async function findOrCreateContact(settings, { name, email, phone, companyId }) {
  const existing = await restGet(settings, "crm_contacts", { select: "id,company_id", email: `ilike.${email}`, limit: "1" });
  if (existing[0]) return existing[0];
  return restInsert(settings, "crm_contacts", {
    full_name: name,
    email,
    phone: phone || null,
    company_id: companyId || null,
  });
}

async function findRecentOpenWebsiteLead(settings, contactId) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const rows = await restGet(settings, "crm_leads", {
    select: "id",
    contact_id: `eq.${contactId}`,
    status: "eq.open",
    source: "eq.Website",
    created_at: `gte.${since}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] || null;
}

// ----------------------------------------------------------------------
// Anti-spam helpers (v1.7).
// ----------------------------------------------------------------------

function clientIp(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function hashIp(ip) {
  // Never store the raw IP — only a one-way hash, purely for rate-limit
  // counting. Not reversible, not useful for anything beyond "have I seen
  // this many requests from whoever this is, recently".
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

async function logSubmissionAttempt(settings, ipHash) {
  try {
    await restInsert(settings, "crm_website_submission_log", { ip_hash: ipHash });
  } catch (err) {
    // Never let a logging failure block a legitimate submission.
    console.error("Contact-lead: rate-limit log insert failed (continuing)", { code: err.message });
  }
}

async function isRateLimited(settings, ipHash) {
  try {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const rows = await restGet(settings, "crm_website_submission_log", {
      select: "id",
      ip_hash: `eq.${ipHash}`,
      created_at: `gte.${since}`,
      limit: String(RATE_LIMIT_MAX_PER_WINDOW + 1),
    });
    return rows.length > RATE_LIMIT_MAX_PER_WINDOW;
  } catch (err) {
    // Fail OPEN: a broken rate-limit check must never block a legitimate
    // visitor from reaching a human at Basma.
    console.error("Contact-lead: rate-limit check failed (allowing request)", { code: err.message });
    return false;
  }
}

function countLinks(value) {
  const matches = String(value || "").match(/https?:\/\/|www\./gi);
  return matches ? matches.length : 0;
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { enabled: false, ok: true }; // fully optional, opt-in
  if (!token) return { enabled: true, ok: false };
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { enabled: true, ok: !!data.success };
  } catch (err) {
    console.error("Contact-lead: Turnstile verification request failed", { code: err.message });
    // Fail OPEN here too — a Cloudflare outage must not take down the
    // entire contact form; Turnstile is one extra optional layer, not the
    // only line of defense (honeypot/timing/rate-limit still apply).
    return { enabled: true, ok: true };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const settings = config();
  if (!settings) return send(res, 503, { error: "الخدمة غير متاحة حاليًا." });

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "طريقة الطلب غير مسموحة." });
    }

    const rawLength = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
    if (rawLength > MAX_BODY_BYTES) return send(res, 413, { error: "حجم الطلب أكبر من المسموح." });

    // ------------------------------------------------------------------
    // Anti-spam gate (v1.7). Runs BEFORE any DB writes for the lead itself
    // (cheap checks first), but the rate-limit attempt is logged for every
    // request that reaches this point, successful or not, so a flood of
    // even clearly-invalid submissions still counts against the sender's
    // budget instead of resetting it for free.
    // ------------------------------------------------------------------
    const ip = clientIp(req);
    const ipHash = hashIp(ip);
    await logSubmissionAttempt(settings, ipHash);
    if (await isRateLimited(settings, ipHash)) {
      return send(res, 429, { error: "الرجاء الانتظار قليلاً قبل إرسال طلب آخر." });
    }

    const honeypot = typeof req.body?.hp === "string" ? req.body.hp.trim() : "";
    if (honeypot) {
      // Bot signal: a hidden field no human ever sees or fills. Respond as
      // if it succeeded (never tip off the bot that it was caught, never
      // create a CRM record) and log server-side only.
      console.warn("Contact-lead: honeypot triggered, submission discarded", { ipHash });
      return send(res, 201, { success: true, message: "شكرًا لك، تم استلام طلبك وسنعود إليك قريبًا." });
    }

    const renderedAt = Number(req.body?.ts);
    if (Number.isFinite(renderedAt) && renderedAt > 0) {
      const elapsed = Date.now() - renderedAt;
      if (elapsed >= 0 && elapsed < MIN_FILL_MS) {
        console.warn("Contact-lead: submission arrived faster than humanly plausible, discarded", { ipHash, elapsedMs: elapsed });
        return send(res, 201, { success: true, message: "شكرًا لك، تم استلام طلبك وسنعود إليك قريبًا." });
      }
    }

    const turnstileResult = await verifyTurnstile(req.body?.turnstileToken, ip);
    if (turnstileResult.enabled && !turnstileResult.ok) {
      return send(res, 400, { error: "تعذّر التحقق من أنك لست روبوتًا. حدّث الصفحة وحاول مرة أخرى." });
    }

    const name = cleanText(req.body?.name, 80);
    const email = cleanText(req.body?.email, 120);
    const phone = cleanText(req.body?.phone, 30);
    const company = cleanText(req.body?.company, 120);
    const service = cleanText(req.body?.service, 120);
    const message = cleanText(req.body?.message, 2000);

    if (!name || name.length < 2) return send(res, 400, { error: "الاسم مطلوب." });
    if (!email || !isValidEmail(email)) return send(res, 400, { error: "الرجاء إدخال بريد إلكتروني صالح." });
    if (!service) return send(res, 400, { error: "الرجاء اختيار الخدمة المطلوبة." });
    if (!message || message.length < 5) return send(res, 400, { error: "الرجاء كتابة تفاصيل طلبك." });
    if (phone && !/^[0-9+\s()-]{6,30}$/.test(phone)) return send(res, 400, { error: "رقم هاتف غير صالح." });
    if (countLinks(message) > MAX_LINKS_IN_MESSAGE || countLinks(name) > 0) {
      return send(res, 400, { error: "الرجاء إزالة الروابط من الرسالة والمحاولة مرة أخرى، أو تواصل معنا مباشرة عبر واتساب." });
    }

    const companyRow = await findOrCreateCompany(settings, company);
    const contactRow = await findOrCreateContact(settings, {
      name,
      email,
      phone,
      companyId: companyRow ? companyRow.id : null,
    });
    const contactCompanyId = companyRow ? companyRow.id : contactRow.company_id || null;

    const existingLead = await findRecentOpenWebsiteLead(settings, contactRow.id);
    let leadId;
    if (existingLead) {
      leadId = existingLead.id;
    } else {
      const leadRow = await restInsert(settings, "crm_leads", {
        title: `${name} — ${service}`,
        source: "Website",
        service_interest: service,
        contact_id: contactRow.id,
        company_id: contactCompanyId,
      });
      leadId = leadRow.id;

      // Admin email notification — only for a genuinely NEW lead (never on
      // the reused/duplicate-window branch above). Never allowed to affect
      // this request's outcome: awaited only so it actually completes
      // before the function may be frozen, but its result is discarded.
      try {
        await notifyNewLead({
          leadId,
          leadTitle: leadRow.title,
          name,
          email,
          phone,
          company,
          service,
          source: "Website",
          companyId: contactCompanyId,
          contactId: contactRow.id,
        });
      } catch (notifyError) {
        console.error("Contact-lead: admin notification failed", { code: notifyError.message, leadId });
      }
    }

    await restInsert(settings, "crm_activities", {
      lead_id: leadId,
      contact_id: contactRow.id,
      company_id: contactCompanyId,
      activity_type: "note",
      subject: existingLead ? "رسالة جديدة من نموذج التواصل" : "طلب جديد من نموذج التواصل",
      details: message,
    });

    return send(res, 201, { success: true, message: "شكرًا لك، تم استلام طلبك وسنعود إليك قريبًا." });
  } catch (error) {
    console.error("Contact-lead API error", { code: error.message, status: error.status || 500 });
    return send(res, 500, { error: "تعذّر إرسال طلبك حاليًا. حاول مرة أخرى لاحقًا أو تواصل معنا عبر واتساب." });
  }
};
