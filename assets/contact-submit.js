// Single shared implementation for submitting a contact/lead request to
// Basma CRM. Loaded by BOTH the Home page (#basmaHomeForm) and the
// standalone Contact page (#basmaForm) so their submission behavior —
// validation, endpoint, payload shape, and success/error message text — is
// literally the same function, not just similar code in two places.
//
// Each page still renders the result through its own existing UI (toast on
// the Home page, inline status box on the Contact page) — this module only
// owns the submission logic, never the page's design or markup.
(function () {
  "use strict";

  // v1.7 anti-spam: captured once, the moment this module executes (i.e.
  // right as the page containing the form finishes loading it) — used as
  // the "form rendered at" timestamp so the server can reject submissions
  // that arrive faster than a human could plausibly have read the form and
  // typed an answer. Deliberately module-load time, not per-field-focus
  // time, so this requires zero changes to either page's own submit-handler
  // script.
  var MODULE_LOADED_AT = Date.now();

  // Both forms (Contact page's #basmaForm and the Home page's
  // #basmaHomeForm) include one hidden input with this exact id — a
  // honeypot real visitors never see or fill. Looked up here, centrally,
  // so neither page's inline submit-handler script needs to know this
  // mechanism exists at all.
  var HONEYPOT_FIELD_ID = "basma-hp-field";

  function currentLang() {
    return window.getBasmaLang ? window.getBasmaLang() : "ar";
  }

  function dict() {
    return (window.translations && window.translations[currentLang()]) || {};
  }

  function honeypotValue() {
    var el = document.getElementById(HONEYPOT_FIELD_ID);
    return el ? String(el.value || "") : "";
  }

  // GA4 event tracking (analytics.js, loaded earlier in <head> on every
  // public page). Deliberately resolved lazily at call time (not cached at
  // module load) and guarded with typeof checks, so this file behaves
  // identically whether or not analytics.js loaded successfully — this
  // module's actual job (submitting the lead) is never affected either way.
  //
  // form_location is derived from which known form element is present on
  // the page — never anything the user typed — so the exact same
  // submitContactLead() implementation works unmodified for both the Home
  // page (#basmaHomeForm) and the standalone Contact page (#basmaForm).
  function formLocation() {
    if (document.getElementById("basmaHomeForm")) return "home";
    if (document.getElementById("basmaForm")) return "contact_page";
    return "unknown";
  }

  function trackFormSuccess() {
    try {
      if (typeof window.trackBasmaEvent === "function") {
        window.trackBasmaEvent("contact_form_submit", {
          form_location: formLocation(),
          page_path: window.location.pathname || "",
        });
      }
    } catch (e) {
      // never let analytics affect the actual submission result
    }
  }

  // fields: { name, email, phone, company, service, message }
  // phone/company are optional and may be empty strings.
  // Returns a Promise<{ ok: boolean, message: string }>.
  async function submitContactLead(fields) {
    var name = String((fields && fields.name) || "").trim();
    var email = String((fields && fields.email) || "").trim();
    var phone = String((fields && fields.phone) || "").trim();
    var company = String((fields && fields.company) || "").trim();
    var service = String((fields && fields.service) || "");
    var message = String((fields && fields.message) || "").trim();

    if (!name || !email || !service || !message) {
      return {
        ok: false,
        message: dict()["form.submitErrorGeneric"] || "الرجاء تعبئة الحقول المطلوبة.",
      };
    }

    try {
      var response = await fetch("/api/contact-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          company: company,
          service: service,
          message: message,
          hp: honeypotValue(),
          ts: MODULE_LOADED_AT,
          // turnstileToken is intentionally omitted unless a page opts into
          // Cloudflare Turnstile (window.basmaTurnstileToken) — the server
          // only checks it at all when TURNSTILE_SECRET_KEY is configured,
          // so this stays a no-op until Basma sets that up.
          turnstileToken: window.basmaTurnstileToken || undefined,
        }),
      });
      var data = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        var errMsg =
          currentLang() === "ar"
            ? data.error || "تعذّر إرسال طلبك حاليًا. حاول مرة أخرى لاحقًا أو تواصل معنا عبر واتساب."
            : dict()["form.submitErrorGeneric"] || "Something went wrong. Please try again.";
        return { ok: false, message: errMsg };
      }

      var okMsg =
        currentLang() === "ar"
          ? data.message || "شكرًا لك، تم استلام طلبك وسنعود إليك قريبًا."
          : dict()["form.submitSuccess"] || "Thank you! We received your request.";

      // Fires exactly once per call, only after the backend has confirmed
      // acceptance (we are past the `!response.ok` check above, which
      // already returns early for validation errors, spam/honeypot
      // rejection, and server errors). No name/email/phone/company/message
      // is included — only which form and which page.
      trackFormSuccess();

      return { ok: true, message: okMsg };
    } catch (networkError) {
      var netMsg =
        currentLang() === "ar"
          ? "تعذّر إرسال طلبك حاليًا. تأكد من اتصالك بالإنترنت أو تواصل معنا عبر واتساب."
          : dict()["form.submitErrorGeneric"] || "Something went wrong. Please try again.";
      return { ok: false, message: netMsg };
    }
  }

  window.Basma = window.Basma || {};
  window.Basma.submitContactLead = submitContactLead;
})();
