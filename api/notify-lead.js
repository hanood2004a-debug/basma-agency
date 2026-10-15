// Thin server-side endpoint used ONLY by crm/leads.html's manual "create
// Lead" form. The browser sends nothing but a lead id (no PII) — this
// handler looks the Lead + its linked Contact/Company up itself using the
// service-role key, then delegates to _notify.js. RESEND_API_KEY and
// SUPABASE_SERVICE_ROLE_KEY never leave the server.
//
// Never blocks the CRM UI: crm/leads.html fires this request without
// awaiting/inspecting the result, exactly like it already does not depend
// on any other side-effect of saving a Lead.
const { serverConfig, supabaseHeaders } = require("./appointments.js").helpers;
const { notifyNewLead } = require("./_notify.js");

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function restGet(config, table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, { headers: supabaseHeaders(config) });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_LOOKUP_FAILED`), { status: response.status });
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const config = serverConfig();
  if (!config) return send(res, 503, { error: "الخدمة غير متاحة حاليًا." });

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "طريقة الطلب غير مسموحة." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const leadId = body.leadId;
    if (!isUuid(leadId)) return send(res, 400, { error: "leadId غير صالح." });

    const leadRows = await restGet(config, "crm_leads", {
      select: "id,title,source,service_interest,company_id,contact_id",
      id: `eq.${leadId}`,
      limit: "1",
    });
    const lead = leadRows[0];
    if (!lead) return send(res, 200, { ok: true, skipped: "lead_not_found" }); // no-op, never an error the UI needs to surface

    const [contactRows, companyRows] = await Promise.all([
      lead.contact_id
        ? restGet(config, "crm_contacts", { select: "full_name,email,phone", id: `eq.${lead.contact_id}`, limit: "1" })
        : Promise.resolve([]),
      lead.company_id
        ? restGet(config, "crm_companies", { select: "name", id: `eq.${lead.company_id}`, limit: "1" })
        : Promise.resolve([]),
    ]);
    const contact = contactRows[0] || null;
    const company = companyRows[0] || null;

    const result = await notifyNewLead({
      leadId: lead.id,
      leadTitle: lead.title,
      name: contact ? contact.full_name : null,
      email: contact ? contact.email : null,
      phone: contact ? contact.phone : null,
      company: company ? company.name : null,
      service: lead.service_interest,
      source: lead.source || "CRM (manual)",
      companyId: lead.company_id,
      contactId: lead.contact_id,
    });

    return send(res, 200, { ok: result.ok, skipped: result.skipped || null });
  } catch (error) {
    console.error("Notify-lead API error", { code: error.message, status: error.status || 500 });
    // Still 200: this endpoint's only job is a best-effort email. A failure
    // here must never look like an error to the CRM user who already saved
    // their Lead successfully before this request was even sent.
    return send(res, 200, { ok: false });
  }
};
