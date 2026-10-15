// Returns ONLY the public Supabase project URL and the public "anon" key so
// the browser-side CRM pages can initialize supabase-js and sign users in.
//
// This never reads or exposes SUPABASE_SERVICE_ROLE_KEY. The anon key is
// designed by Supabase to be safe to ship to a browser: every table it can
// touch is still gated by Row Level Security (see CRM-SETUP.sql).
function send(res, status, payload) {
  return res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed" });
  }

  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return send(res, 503, {
      error: "crm_not_configured",
      message:
        "SUPABASE_URL and/or SUPABASE_ANON_KEY are not set in the environment. Basma CRM cannot start until both are configured (see CRM-SETUP.sql / final report for instructions).",
    });
  }

  return send(res, 200, { supabaseUrl: url, supabaseAnonKey: anonKey });
};
