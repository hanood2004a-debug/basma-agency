// Resend delivery-event webhook (v1.7 production hardening — audit item
// #7, "Email delivery / bounce handling").
//
// Resend calls this endpoint whenever something happens to an email AFTER
// it was accepted for sending: delivered to the recipient's mail server,
// permanently bounced, or reported as spam. Without this endpoint,
// crm_outreach_messages.status could never move past 'sent' — a hard
// bounce looked identical to a successfully delivered email anywhere in
// the CRM, and a known-bad address would be retried forever.
//
// SECURITY: webhook requests are unauthenticated HTTP POSTs from Resend's
// infrastructure — anyone who learns this URL could otherwise forge
// events. Every request is verified against RESEND_WEBHOOK_SECRET using
// Svix's standard webhook signature scheme (the same scheme Resend, Clerk,
// and many other providers use) — implemented here by hand with Node's
// built-in crypto module rather than pulling in the `svix` package, to
// keep this project's existing zero-runtime-dependency convention. If
// RESEND_WEBHOOK_SECRET is not set, this endpoint refuses every request
// with 503 rather than trusting anything unverified — fully optional,
// exactly like RESEND_API_KEY / TURNSTILE_SECRET_KEY elsewhere in this
// project: nothing breaks if Basma never configures a webhook, and this
// file does nothing until they do.
//
// GENERIC BY DESIGN: nothing in this file references any specific email
// address. Whatever address Resend reports as bounced/complained is looked
// up by provider_message_id -> crm_outreach_messages.contact_id, and THAT
// contact is suppressed — the exact same code path handles every address,
// forever, not just the one that happened to bounce during testing.
const crypto = require("crypto");

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function config() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function headers(settings, extra = {}) {
  return { apikey: settings.key, Authorization: `Bearer ${settings.key}`, "Content-Type": "application/json", ...extra };
}

async function restGet(settings, table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${settings.url}/rest/v1/${table}?${query}`, { headers: headers(settings) });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_LOOKUP_FAILED`), { status: response.status });
  return response.json();
}

async function restUpdate(settings, table, matchParams, payload) {
  const query = new URLSearchParams(matchParams);
  const response = await fetch(`${settings.url}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers(settings, { Prefer: "return=minimal" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_UPDATE_FAILED`), { status: response.status });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Standard Svix webhook signature verification (HMAC-SHA256 over
// "<id>.<timestamp>.<raw body>", base64-encoded, compared against every
// "v1,<sig>" entry in the svix-signature header). Also rejects requests
// whose timestamp is more than 5 minutes old/in the future, to close a
// replay window — matches Svix's own documented default tolerance.
function verifySvixSignature({ rawBody, svixId, svixTimestamp, svixSignature, secret }) {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;
  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) return false;

  let secretBytes;
  try {
    secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch (e) {
    return false;
  }
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent, "utf8").digest("base64");

  return svixSignature.split(" ").some((entry) => {
    const parts = entry.split(",");
    const provided = parts[1] || parts[0];
    if (!provided) return false;
    try {
      const a = Buffer.from(provided, "base64");
      const b = Buffer.from(expected, "base64");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) {
      return false;
    }
  });
}

// email.bounced from Resend IS ALWAYS a hard/permanent bounce — Resend
// reports temporary/soft delivery problems as a separate event
// (email.delivery_delayed) and only emits email.bounced once a message is
// permanently, unrecoverably undeliverable. So there is no "bounce type"
// field to branch on here; treating every email.bounced as suppress-worthy
// is the documented-correct behavior, not a simplification.
const STATUS_BY_EVENT_TYPE = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Optional integration: silent 503 (not a crash) until Basma
    // configures a webhook in the Resend dashboard and sets this env var.
    console.error("Resend webhook: RESEND_WEBHOOK_SECRET is not configured — refusing to process (cannot verify authenticity)");
    return send(res, 503, { ok: false, error: "not_configured" });
  }

  const settings = config();
  if (!settings) return send(res, 503, { ok: false, error: "not_configured" });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    return send(res, 400, { ok: false, error: "body_read_failed" });
  }

  const verified = verifySvixSignature({
    rawBody,
    svixId: req.headers["svix-id"],
    svixTimestamp: req.headers["svix-timestamp"],
    svixSignature: req.headers["svix-signature"],
    secret,
  });
  if (!verified) {
    console.error("Resend webhook: signature verification failed — request rejected");
    return send(res, 400, { ok: false, error: "invalid_signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return send(res, 400, { ok: false, error: "invalid_json" });
  }

  const newStatus = STATUS_BY_EVENT_TYPE[event && event.type];
  const emailId = event && event.data && event.data.email_id;

  // Always acknowledge 200 for event types we don't act on (opened,
  // clicked, delivery_delayed, domain.*, contact.*, etc.) — Resend retries
  // with backoff on anything but 200, and there is nothing wrong with an
  // event this endpoint simply doesn't need to react to.
  if (!newStatus || !emailId) {
    return send(res, 200, { ok: true, skipped: "unhandled_event_or_missing_email_id" });
  }

  try {
    const rows = await restGet(settings, "crm_outreach_messages", {
      select: "id,contact_id,status",
      provider_message_id: `eq.${emailId}`,
      limit: "1",
    });
    const message = rows[0];
    if (!message) {
      // A webhook can arrive for a message this CRM never recorded (e.g.
      // an email sent through the Resend dashboard directly, or a replay
      // after old test data was cleared) — acknowledge, do nothing.
      return send(res, 200, { ok: true, skipped: "message_not_found" });
    }

    // Never let a later, less-specific event downgrade a more terminal one
    // that already arrived out of order (webhooks are "at least once", not
    // strictly ordered). 'bounced'/'complained' are terminal; 'delivered'
    // should never overwrite them if it arrives late.
    if (message.status === "bounced" || message.status === "complained") {
      return send(res, 200, { ok: true, skipped: "already_terminal" });
    }

    await restUpdate(settings, "crm_outreach_messages", { id: `eq.${message.id}` }, {
      status: newStatus,
      provider_status_updated_at: new Date().toISOString(),
    });

    if ((newStatus === "bounced" || newStatus === "complained") && message.contact_id) {
      const reason = newStatus === "bounced" ? "ارتداد بريدي دائم (hard bounce) عبر Resend" : "بلاغ عن الرسالة كرسالة مزعجة (spam) عبر Resend";
      try {
        await restUpdate(settings, "crm_contacts", { id: `eq.${message.contact_id}` }, {
          email_suppressed: true,
          email_suppressed_reason: reason,
        });
      } catch (err) {
        console.error("Resend webhook: failed to suppress contact after bounce/complaint", { code: err.message, contactId: message.contact_id });
      }
    }

    return send(res, 200, { ok: true, status: newStatus });
  } catch (err) {
    console.error("Resend webhook: processing failed", { code: err.message, status: err.status });
    // Still 200: our own transient DB error shouldn't make Resend hammer
    // this endpoint with retries for an event it already successfully
    // delivered once — best-effort, matching api/_notify.js's philosophy.
    return send(res, 200, { ok: false, error: "processing_failed" });
  }
};

// REQUIRED for signature verification: Vercel's Node.js Serverless
// Functions parse req.body into JSON automatically by default, which both
// discards the exact original bytes AND fully drains the request stream
// before this handler runs — either one alone would make
// verifySvixSignature() above impossible to pass even for a genuine Resend
// request, since Svix signatures are computed over the exact raw body
// bytes, not a re-serialized JSON.stringify() of the parsed object. This
// config disables that automatic parsing for this route only; readRawBody()
// above does the (now necessary) manual buffering instead. This is Vercel's
// own documented pattern for any webhook that needs signature verification
// (Stripe, Svix-based providers, etc.). Must be attached AFTER
// `module.exports = async function handler...` above — assigning
// `module.exports = ...` replaces the exports object wholesale, so setting
// `.config` before that line would silently get wiped out.
module.exports.config = { api: { bodyParser: false } };

module.exports.helpers = { verifySvixSignature };
