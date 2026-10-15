// Basma CRM — Unified Communication Composer (v1.6 Outreach Automation;
// v1.6.2 production polish pass — sticky footer, responsive/RTL layout,
// variable chips, live preview, drafts, validation, dirty-close guard).
// One shared modal + shared send/render/log logic used from Company 360,
// Outreach Hub, Contacts, and Lead Details — so "compose + send/log a
// message on one of Email/WhatsApp/LinkedIn" exists in exactly one place.
//
// Channel capability split (explicitly, per product requirement — never
// fake a capability we don't have):
//   - Email: can actually send, server-side, via the existing Resend
//     integration (POST /api/crm-send-email). RESEND_API_KEY never reaches
//     this file or the browser.
//   - WhatsApp: opens a wa.me deep link (assisted). A crm_outreach_messages
//     row is only ever written after the user explicitly confirms they
//     sent it — never merely because the link was opened.
//   - LinkedIn: no automatic send exists (no official API integration is
//     configured). Copy-to-clipboard + open-profile, then the same
//     explicit "confirm sent" step as WhatsApp.
// Phone is intentionally NOT part of this composer — it has its own
// simpler call/outcome UI (see company-details.html), reusing the same
// crm_outreach_messages table and crm_schedule_followup() function.
//
// Public API surface (window.Basma.Composer) is unchanged from v1.6 —
// outreach.html's bulk review queue and outreach-templates.html's live
// preview call renderTemplate/buildVars/checkCooldown/sendEmailViaApi/
// getSenderName directly, without going through the modal. Nothing below
// changes those functions' signatures or behavior.
(function () {
  "use strict";
  var CRM = window.Basma.CRM;

  // Same cooldown for every channel, for now — a real per-org "configurable
  // cooldown" would need a settings table/UI, which is out of scope for
  // this phase (see final report, "Known Limitations"). Changing this one
  // constant changes the warning threshold everywhere.
  var COOLDOWN_HOURS = 24;

  var VAR_LABELS = {
    contact_name: "اسم جهة الاتصال", first_name: "الاسم الأول", company_name: "اسم الشركة",
    country: "الدولة", city: "المدينة", website: "الموقع الإلكتروني", industry: "القطاع", sender_name: "اسم المرسل"
  };
  var VAR_KEYS = ["contact_name", "first_name", "company_name", "country", "city", "website", "industry", "sender_name"];

  var CHANNEL_LABELS = { email: "بريد إلكتروني", whatsapp: "واتساب", linkedin: "LinkedIn" };

  // ---------------------------------------------------------------------
  // Smart-fallback rendering (production polish pass). renderTemplate()
  // above stays exactly as it was — it's still used to fill the editor's
  // Subject/Body when a template is applied, and it deliberately leaves
  // `{{var}}` visible when a value is missing/empty, as a hint to the user
  // that they may want to fill it in by hand. That is fine for the EDITOR
  // per the current spec ("the editor may keep placeholders if needed
  // internally"), but the PREVIEW and the actual outgoing message must
  // never contain a raw, unresolved `{{var}}` token — so a second render
  // path exists specifically for those two cases: every KNOWN CRM variable
  // always resolves to a real value or a sensible, generic Arabic fallback
  // phrase (never blank, never the literal token); any variable name that
  // is NOT one of the known CRM variables is left flagged (not silently
  // dropped) so it can block sending instead.
  // ---------------------------------------------------------------------
  var VAR_FALLBACKS = {
    // "{{contact_name}} -> فريق {{company_name}}" per spec, computed
    // dynamically against the already-resolved (or already-fallen-back)
    // company name rather than the literal text "{{company_name}}".
    contact_name: function (vars) { return "فريق " + (vars.company_name || "شركتكم"); },
    first_name: function () { return "فريق"; },
    company_name: function () { return "شركتكم"; },
    country: function () { return "بلدكم"; },
    city: function () { return "مدينتكم"; },
    website: function () { return "موقعكم الإلكتروني"; },
    industry: function () { return "مجالكم"; },
    sender_name: function () { return "فريق Basma"; }
  };

  // Every {{token}} whose name is NOT one of VAR_KEYS — these are the ones
  // that must block sending (requirement 6) rather than silently render to
  // something plausible-looking, since we have no idea what they mean.
  function unknownVariablesIn(str) {
    var found = [];
    String(str || "").replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, key) {
      if (VAR_KEYS.indexOf(key) === -1 && found.indexOf(key) === -1) found.push(key);
      return m;
    });
    return found;
  }

  // Renders EVERY {{token}} to a non-placeholder string: a known variable
  // with a real value uses that value; a known variable with no value uses
  // its smart fallback; an unknown variable name is rendered as a visible
  // (but not raw-braces) warning marker so it can never leak a literal
  // `{{...}}` into the Preview even in that edge case — unknownVariablesIn()
  // is what actually blocks Send for this case, not this function.
  function renderTemplateSmart(str, vars) {
    return String(str || "").replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, key) {
      if (VAR_KEYS.indexOf(key) === -1) return "⚠[" + key + "]";
      var v = vars[key];
      if (v != null && v !== "") return v;
      var fallback = VAR_FALLBACKS[key];
      return fallback ? fallback(vars) : "";
    });
  }

  var state = null; // set fresh on every open()
  var senderNameCache = null;
  var lastFocusedFieldId = "cpBody";

  function el(id) { return document.getElementById(id); }
  function onlyDigits(v) { return (v || "").replace(/[^\d]/g, ""); }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); }

  // ---------------------------------------------------------------------
  // Shared, exported helpers (also used directly by outreach.html's bulk
  // review queue and outreach-templates.html's live preview, without going
  // through the modal UI at all). Untouched by this polish pass.
  // ---------------------------------------------------------------------
  function renderTemplate(str, vars) {
    return String(str || "").replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null && vars[key] !== "" ? vars[key] : m;
    });
  }

  function buildVars(company, contact, senderName) {
    var fullName = (contact && contact.full_name) || "";
    return {
      contact_name: fullName,
      first_name: fullName ? fullName.split(/\s+/)[0] : "",
      company_name: (company && company.name) || "",
      country: (company && company.country) || "",
      city: (company && company.city) || "",
      website: (company && company.website) || "",
      industry: (company && company.industry) || "",
      sender_name: senderName || ""
    };
  }

  async function getSenderName(db) {
    if (senderNameCache !== null) return senderNameCache;
    try {
      var authRes = await db.auth.getUser();
      var uid = authRes && authRes.data && authRes.data.user && authRes.data.user.id;
      if (!uid) return (senderNameCache = "");
      var res = await db.from("crm_members").select("full_name").eq("user_id", uid).maybeSingle();
      senderNameCache = (res.data && res.data.full_name) || "";
    } catch (e) { senderNameCache = ""; }
    return senderNameCache;
  }

  // Cooldown / duplicate-send check (section 13). Returns the most recent
  // matching message (same company + channel + template) sent within
  // COOLDOWN_HOURS, or null.
  async function checkCooldown(db, companyId, channel, templateId) {
    try {
      var since = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString();
      var query = db.from("crm_outreach_messages").select("id,created_at,status").eq("company_id", companyId).eq("channel", channel).gt("created_at", since).order("created_at", { ascending: false }).limit(1);
      if (templateId) query = query.eq("template_id", templateId);
      else query = query.is("template_id", null);
      var res = await query;
      if (res.error) return null;
      return (res.data && res.data[0]) || null;
    } catch (e) { return null; }
  }

  async function sendEmailViaApi(db, payload) {
    var sessionRes = await db.auth.getSession();
    var token = sessionRes && sessionRes.data && sessionRes.data.session && sessionRes.data.session.access_token;
    if (!token) return { ok: false, error: "unauthorized", message: "لا توجد جلسة صالحة — سجّل الدخول من جديد." };
    try {
      var res = await fetch("/api/crm-send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) return Object.assign({ ok: false }, data);
      return data;
    } catch (err) {
      return { ok: false, error: "network_error", message: "تعذّر الاتصال بالخادم." };
    }
  }

  // Client-side, RLS-protected logging for WhatsApp/LinkedIn "confirm sent"
  // and for Phone call completion (company-details.html calls this too).
  async function logConfirmedMessage(db, payload) {
    var res = await db.from("crm_outreach_messages").insert(payload).select().single();
    if (res.error) throw res.error;
    return res.data;
  }

  // Loads every Email/WhatsApp/LinkedIn template, fresh, every time the
  // Composer opens (never cached across opens — a template added or edited
  // on the Templates page must show up immediately). Unlike the original
  // v1.6 version, this explicitly checks res.error instead of only relying
  // on a try/catch: supabase-js resolves query errors into
  // `{data: null, error: {...}}` rather than throwing, so a plain
  // `tplRes.data || []` was silently swallowing real failures (RLS,
  // network, etc.) and leaving the dropdown on "— بدون قالب —" with no
  // visible sign anything had gone wrong. That failure mode is now surfaced
  // with a toast (requirement 6) instead of failing silently.
  async function loadTemplatesForComposer(db) {
    try {
      var res = await db.from("crm_outreach_templates").select("*").in("type", ["email", "whatsapp", "linkedin"]).order("name", { ascending: true });
      if (res.error) throw res.error;
      return { templates: res.data || [], failed: false };
    } catch (e) {
      CRM.toast("تعذّر تحميل القوالب: " + ((e && e.message) || "خطأ غير معروف") + ". يمكنك المتابعة بدون قالب أو إعادة فتح النافذة للمحاولة مجددًا.", "danger");
      return { templates: [], failed: true };
    }
  }

  // ---------------------------------------------------------------------
  // Local draft persistence (client-only — no DB schema change). Keyed per
  // company + channel so switching channel mid-edit doesn't clobber a
  // draft for a different channel on the same company.
  // ---------------------------------------------------------------------
  function draftKey(companyId, channel) { return "basma_crm_draft:" + companyId + ":" + channel; }

  function saveDraftToStorage(companyId, channel, payload) {
    try { localStorage.setItem(draftKey(companyId, channel), JSON.stringify(payload)); return true; }
    catch (e) { return false; }
  }
  function readDraftFromStorage(companyId, channel) {
    try {
      var raw = localStorage.getItem(draftKey(companyId, channel));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraftFromStorage(companyId, channel) {
    try { localStorage.removeItem(draftKey(companyId, channel)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // Modal DOM (injected once). Structure: fixed header, a single scrolling
  // body region, and a footer that is always visible (position: sticky)
  // regardless of how tall the body content grows — satisfies "keep action
  // buttons always visible" without a second, competing scrollbar.
  // ---------------------------------------------------------------------
  function ensureModal() {
    if (el("crmComposerOverlay")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="crm-modal-overlay" id="crmComposerOverlay">' +
      '<div class="crm-modal crm-modal-lg crm-modal-flex" id="crmComposerModal" role="dialog" aria-modal="true" aria-labelledby="cpModalTitle">' +
      '<div class="crm-modal-head">' +
      '<h3 id="cpModalTitle">مركز التواصل</h3>' +
      '<button type="button" class="crm-modal-close" id="cpCloseX" data-close aria-label="إغلاق">&times;</button>' +
      "</div>" +
      '<div class="crm-modal-body-scroll" id="cpBodyScroll">' +
      '<div id="crmComposerWarnings"></div>' +
      '<div id="crmComposerDraftBanner"></div>' +
      '<p class="crm-muted" id="cpCompanyLine" style="font-size:12.5px;margin:0 0 10px"></p>' +
      '<div class="crm-form-grid">' +
      '<div class="crm-field"><label for="cpChannel">القناة</label><select id="cpChannel"></select></div>' +
      '<div class="crm-field"><label for="cpContact">جهة الاتصال / المستلم</label><select id="cpContact"></select></div>' +
      '<div class="crm-field"><label for="cpTemplate">القالب</label><select id="cpTemplate"><option value="">— بدون قالب —</option></select></div>' +
      '<div class="crm-field" id="cpCcWrap"><label for="cpCc">CC (اختياري)</label><input id="cpCc" type="email" dir="ltr"></div>' +
      "</div>" +
      '<div class="crm-field" id="cpSubjectWrap" style="margin-top:12px"><label for="cpSubject">الموضوع</label><input id="cpSubject"><span class="crm-field-error" id="cpSubjectErr"></span></div>' +
      '<div class="crm-field" style="margin-top:12px"><label id="cpToLabel" for="cpTo">إلى</label><input id="cpTo" dir="ltr" readonly style="background:rgba(255,255,255,.03)"><span class="crm-field-error" id="cpToErr"></span></div>' +
      '<div class="crm-field" style="margin-top:12px">' +
      '<div class="crm-flex-between" style="margin-bottom:2px"><label for="cpBody" style="margin:0">الرسالة (تم استبدال المتغيرات — يمكنك التعديل)</label><span class="crm-char-counter" id="cpCharCount">0 حرف</span></div>' +
      '<div class="crm-var-chips" id="cpVarChips" dir="ltr"></div>' +
      '<textarea id="cpBody" style="min-height:150px"></textarea>' +
      '<span class="crm-field-error" id="cpBodyErr"></span>' +
      '<div id="cpVarWarningBox"></div>' +
      "</div>" +
      '<div class="crm-field" style="margin-top:12px"><label>متابعة بعد</label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<select id="cpFollowUp"><option value="">بدون متابعة</option><option value="1">يوم واحد</option><option value="2">يومين</option><option value="3">3 أيام</option><option value="5" selected>5 أيام</option><option value="7">7 أيام</option><option value="14">14 يومًا</option><option value="custom">مخصص…</option></select>' +
      '<input id="cpFollowUpCustom" type="number" min="1" placeholder="عدد الأيام" style="display:none;max-width:120px">' +
      "</div></div>" +
      '<div class="crm-email-preview" id="cpPreviewPanel" style="display:none">' +
      '<div class="crm-email-preview-head">' +
      '<div><strong>من:</strong> <span id="cpPreviewFrom" dir="ltr"></span></div>' +
      '<div><strong>إلى:</strong> <span id="cpPreviewTo" dir="ltr"></span></div>' +
      '<div id="cpPreviewSubjectRow"><strong>الموضوع:</strong> <span id="cpPreviewSubject"></span></div>' +
      "</div>" +
      '<div class="crm-email-preview-body" id="cpPreviewBody"></div>' +
      "</div>" +
      "</div>" + // /cpBodyScroll
      '<div class="crm-modal-footer-sticky" id="cpFooter">' +
      '<div class="crm-footer-left">' +
      '<button type="button" class="crm-btn crm-btn-sm" id="cpCancelBtn" data-close>إلغاء</button>' +
      '<button type="button" class="crm-btn crm-btn-sm" id="cpSaveDraftBtn">حفظ كمسودة</button>' +
      '<button type="button" class="crm-btn crm-btn-sm" id="cpPreviewToggleBtn">معاينة</button>' +
      "</div>" +
      '<span id="cpActions" style="display:flex;gap:8px;flex-wrap:wrap"></span>' +
      "</div>" +
      "</div></div>";
    document.body.appendChild(wrap.firstChild);

    el("cpChannel").addEventListener("change", onChannelChange);
    el("cpContact").addEventListener("change", onContactChange);
    el("cpTemplate").addEventListener("change", onTemplateChange);
    el("cpFollowUp").addEventListener("change", function () {
      el("cpFollowUpCustom").style.display = this.value === "custom" ? "block" : "none";
      onFieldInput();
    });
    el("cpFollowUpCustom").addEventListener("input", onFieldInput);
    el("cpCc").addEventListener("input", onFieldInput);
    el("cpSubject").addEventListener("input", function () { lastFocusedFieldId = "cpSubject"; clearFieldError("cpSubject"); onFieldInput(); });
    el("cpSubject").addEventListener("focus", function () { lastFocusedFieldId = "cpSubject"; });
    el("cpBody").addEventListener("input", function () { lastFocusedFieldId = "cpBody"; clearFieldError("cpBody"); onFieldInput(); });
    el("cpBody").addEventListener("focus", function () { lastFocusedFieldId = "cpBody"; });
    el("cpSaveDraftBtn").addEventListener("click", saveDraft);
    el("cpPreviewToggleBtn").addEventListener("click", togglePreview);

    renderVarChips();
  }

  // ---------------------------------------------------------------------
  // Variable chips (clickable, insert at cursor into whichever of
  // subject/body was last focused — defaults to the body).
  // ---------------------------------------------------------------------
  function renderVarChips() {
    el("cpVarChips").innerHTML = VAR_KEYS.map(function (k) {
      return '<button type="button" class="crm-var-chip" data-var="' + k + '" title="' + CRM.escape(VAR_LABELS[k] || k) + '">{{' + k + "}}</button>";
    }).join("");
    el("cpVarChips").querySelectorAll(".crm-var-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { insertVariable(chip.dataset.var); });
    });
  }

  function insertVariable(key) {
    var field = el(lastFocusedFieldId === "cpSubject" ? "cpSubject" : "cpBody");
    var token = "{{" + key + "}}";
    var start = field.selectionStart != null ? field.selectionStart : field.value.length;
    var end = field.selectionEnd != null ? field.selectionEnd : field.value.length;
    field.value = field.value.slice(0, start) + token + field.value.slice(end);
    field.focus();
    var pos = start + token.length;
    if (field.setSelectionRange) field.setSelectionRange(pos, pos);
    clearFieldError(field.id);
    onFieldInput();
  }

  function currentContact() {
    var id = el("cpContact").value;
    if (id === "__company_email__") return null;
    return (state.contacts || []).filter(function (c) { return c.id === id; })[0] || null;
  }

  function currentRecipient(channel) {
    var contactSel = el("cpContact").value;
    if (channel === "email") {
      if (contactSel === "__company_email__") return state.company.email || "";
      var c = currentContact();
      return (c && c.email) || "";
    }
    if (channel === "whatsapp") {
      var c2 = currentContact();
      return onlyDigits((c2 && (c2.whatsapp || c2.phone)) || state.company.phone || "");
    }
    if (channel === "linkedin") {
      var c3 = currentContact();
      return (c3 && c3.linkedin_url) || state.company.linkedin_url || "";
    }
    return "";
  }

  function refreshRecipientField() {
    var channel = el("cpChannel").value;
    el("cpTo").value = currentRecipient(channel);
    el("cpToLabel").textContent = channel === "email" ? "إلى (بريد إلكتروني)" : channel === "whatsapp" ? "إلى (رقم واتساب)" : "رابط LinkedIn";
    clearFieldError("cpTo");
  }

  function applyTemplateToBody() {
    var tplId = el("cpTemplate").value;
    var tpl = (state.templates || []).filter(function (t) { return t.id === tplId; })[0];
    var vars = buildVars(state.company, currentContact(), state.senderName);
    if (tpl) {
      // Auto-fill subject from the template whenever one is selected
      // (email's primary use case — WhatsApp/LinkedIn templates have no
      // subject and cpSubjectWrap is hidden for those channels anyway).
      if (tpl.subject) el("cpSubject").value = renderTemplate(tpl.subject, vars);
      el("cpBody").value = renderTemplate(tpl.body, vars);
    } else if (!el("cpBody").value) {
      el("cpBody").value = "";
    }
  }

  function onContactChange() { refreshRecipientField(); applyTemplateToBody(); checkAndRenderCooldown(); onFieldInput(); }
  // onTemplateChange only ever fires from the real DOM "change" event (see
  // ensureModal's addEventListener below) — never from programmatic
  // `.value = ...` assignment elsewhere in this file — so it's the one
  // reliable signal that the USER, not our own code, picked a template.
  function onTemplateChange() {
    state.templateManuallySet = true;
    state.lastManualTemplateId = el("cpTemplate").value || null;
    applyTemplateToBody(); checkAndRenderCooldown(); onFieldInput();
  }

  function onChannelChange() {
    var channel = el("cpChannel").value;
    el("cpSubjectWrap").style.display = channel === "email" ? "block" : "none";
    el("cpCcWrap").style.display = channel === "email" ? "block" : "none";
    populateTemplates(channel);
    // Rebuilding the <select>'s options resets its value to blank even if
    // the user had deliberately chosen a template — restore their choice
    // when it still exists among this channel's templates (e.g. bouncing
    // WhatsApp -> Email -> back). If it doesn't apply to this channel, the
    // assignment is a no-op and the field correctly stays blank.
    if (state.templateManuallySet && state.lastManualTemplateId) {
      el("cpTemplate").value = state.lastManualTemplateId;
    }
    autoSelectDefaultTemplateIfNeeded(channel);
    refreshRecipientField();
    applyTemplateToBody();
    renderActions();
    checkAndRenderCooldown();
    onFieldInput();
    loadDraftIfAny();
  }

  function populateTemplates(channel) {
    var list = (state.allTemplates || []).filter(function (t) { return t.type === channel; });
    state.templates = list;
    el("cpTemplate").innerHTML = '<option value="">— بدون قالب —</option>' + list.map(function (t) { return '<option value="' + t.id + '">' + CRM.escape(t.name) + "</option>"; }).join("");
  }

  // Requirement: preselect "First Contact (Email)" automatically when
  // opening the Email composer, but only if the user hasn't already picked
  // a template themselves in this session (and only for Email — WhatsApp/
  // LinkedIn have no such default per spec). Matches by name so it keeps
  // working even if CRM-OUTREACH-DEFAULT-TEMPLATES.sql's exact wording is
  // later tweaked by an admin.
  function findDefaultEmailTemplate() {
    return (state.templates || []).filter(function (t) {
      var name = String(t.name || "");
      return /first contact/i.test(name) || name.indexOf("التواصل الأول") !== -1;
    })[0] || null;
  }

  function autoSelectDefaultTemplateIfNeeded(channel) {
    if (channel !== "email") return;
    if (state.templateManuallySet) return;
    if (el("cpTemplate").value) return; // something is already selected (e.g. a restored draft)
    var def = findDefaultEmailTemplate();
    if (def) el("cpTemplate").value = def.id;
  }

  async function checkAndRenderCooldown() {
    var box = el("crmComposerWarnings");
    box.innerHTML = "";
    state.cooldownConfirmed = false;
    if (!state.company || !state.company.id) return;
    var channel = el("cpChannel").value;
    var templateId = el("cpTemplate").value || null;
    var prior = await checkCooldown(state.db, state.company.id, channel, templateId);
    if (!prior) return;
    var hoursAgo = Math.max(0, Math.round((Date.now() - new Date(prior.created_at).getTime()) / 3600000));
    box.innerHTML =
      '<div class="crm-alert crm-alert-warning" style="margin-bottom:12px">' +
      "تم إرسال نفس القالب عبر " + (CHANNEL_LABELS[channel] || channel) + " لهذه الشركة قبل " + hoursAgo + " ساعة تقريبًا. " +
      '<label style="display:block;margin-top:6px;cursor:pointer"><input type="checkbox" id="cpCooldownConfirm" style="width:auto;min-height:auto"> أفهم ذلك وأريد المتابعة على أي حال</label>' +
      "</div>";
    el("cpCooldownConfirm").addEventListener("change", function () { state.cooldownConfirmed = this.checked; renderActions(); });
  }

  function followUpDays() {
    var v = el("cpFollowUp").value;
    if (!v) return null;
    if (v === "custom") { var n = Number(el("cpFollowUpCustom").value); return n > 0 ? Math.floor(n) : null; }
    return Number(v);
  }

  function hasBlockingWarning() {
    var box = el("crmComposerWarnings");
    return box.querySelector("#cpCooldownConfirm") && !state.cooldownConfirmed;
  }

  // ---------------------------------------------------------------------
  // Field-level validation UI (in addition to the toast — a red border +
  // inline message under the field, cleared as soon as the user edits it).
  // ---------------------------------------------------------------------
  function setFieldError(id, msg) {
    var f = el(id); if (!f) return;
    var wrap = f.closest(".crm-field"); if (wrap) wrap.classList.add("has-error");
    var errEl = el(id + "Err"); if (errEl) errEl.textContent = msg;
  }
  function clearFieldError(id) {
    var f = el(id); if (!f) return;
    var wrap = f.closest(".crm-field"); if (wrap) wrap.classList.remove("has-error");
    var errEl = el(id + "Err"); if (errEl) errEl.textContent = "";
  }
  function clearAllFieldErrors() { ["cpTo", "cpSubject", "cpBody"].forEach(clearFieldError); }

  // ---------------------------------------------------------------------
  // Live character counter + live email preview — pure string operations,
  // cheap enough to recompute on every keystroke regardless of whether the
  // preview panel is currently visible (so it's instant when toggled open).
  // ---------------------------------------------------------------------
  function updateCharCount() {
    var n = el("cpBody").value.length;
    var counter = el("cpCharCount");
    counter.textContent = n + " حرف";
    counter.classList.toggle("is-empty", n === 0);
  }

  function updateLivePreview() {
    if (!state || !state.company) return;
    var channel = el("cpChannel").value;
    var vars = buildVars(state.company, currentContact(), state.senderName);
    el("cpPreviewFrom").textContent = (state.senderName || "فريق Basma") + " — Basma CRM";
    el("cpPreviewTo").textContent = el("cpTo").value.trim() || "—";
    var subjectRow = el("cpPreviewSubjectRow");
    // Requirement 1-4: Preview always renders real values (with smart
    // fallbacks for anything missing) — never the raw {{var}} the editor
    // may still be showing.
    if (channel === "email") {
      subjectRow.style.display = "";
      el("cpPreviewSubject").textContent = renderTemplateSmart(el("cpSubject").value, vars) || "(بدون موضوع)";
    } else {
      subjectRow.style.display = "none";
    }
    el("cpPreviewBody").textContent = renderTemplateSmart(el("cpBody").value, vars) || "—";

    var unknown = unknownVariablesIn(el("cpSubject").value).concat(unknownVariablesIn(el("cpBody").value))
      .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
    renderVariableWarning(unknown);
  }

  // Requirement 6: an unknown (not one of VAR_KEYS) variable must show a
  // warning and block sending, rather than sending silently. Recomputed on
  // every keystroke (onFieldInput runs this unconditionally, whether or not
  // the preview panel is currently open) so state.unknownVariables is
  // always current by the time Send/Confirm is clicked.
  function renderVariableWarning(unknownKeys) {
    var box = el("cpVarWarningBox");
    state.unknownVariables = unknownKeys || [];
    if (!box) return;
    if (!unknownKeys || !unknownKeys.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="crm-alert crm-alert-warning" style="margin-top:8px">' +
      "⚠ متغيّرات غير معروفة في الرسالة: " + unknownKeys.map(function (k) { return "{{" + CRM.escape(k) + "}}"; }).join("، ") +
      ". يجب إزالتها أو تصحيحها قبل الإرسال." +
      "</div>";
  }

  // Renders the actual outgoing subject/body (smart fallbacks applied) and
  // reports any unknown variables found — used right before every real send
  // path (email API, WhatsApp deep link, LinkedIn copy/open, confirm-sent
  // logging) so no unresolved {{token}} can ever reach the network or get
  // stored, regardless of what the editor still visually shows.
  function renderForSend() {
    var vars = buildVars(state.company, currentContact(), state.senderName);
    var subjectRaw = el("cpSubject").value.trim();
    var bodyRaw = el("cpBody").value.trim();
    var unknown = unknownVariablesIn(subjectRaw).concat(unknownVariablesIn(bodyRaw))
      .filter(function (k, i, arr) { return arr.indexOf(k) === i; });
    var subject = renderTemplateSmart(subjectRaw, vars);
    var body = renderTemplateSmart(bodyRaw, vars);
    // Defensive double-check: renderTemplateSmart should never leave a raw
    // "{{" for a KNOWN variable, and unknown ones are already caught above
    // as warning markers ("⚠[...]"), not "{{...}}" — so this should be
    // unreachable in practice, but if it's ever hit, treat it exactly like
    // an unknown variable and block the send rather than risk shipping a
    // literal placeholder.
    if (/\{\{/.test(subject) || /\{\{/.test(body)) {
      if (!unknown.length) unknown = ["?"];
    }
    return { subject: subject, body: body, unknown: unknown };
  }

  function blockSendIfUnknownVariables(unknown) {
    if (!unknown || !unknown.length) return false;
    setFieldError("cpBody", "توجد متغيّرات غير معروفة في الرسالة.");
    CRM.toast("لا يمكن الإرسال — الرسالة تحتوي على متغيّرات غير معروفة: " + unknown.map(function (k) { return "{{" + k + "}}"; }).join("، ") + ".", "danger");
    return true;
  }

  function togglePreview() {
    var panel = el("cpPreviewPanel");
    var show = panel.style.display === "none";
    panel.style.display = show ? "block" : "none";
    el("cpPreviewToggleBtn").textContent = show ? "إخفاء المعاينة" : "معاينة";
    if (show) updateLivePreview();
  }

  function onFieldInput() {
    updateCharCount();
    updateLivePreview();
  }

  // ---------------------------------------------------------------------
  // Draft save/restore (client-only, localStorage — no DB schema change).
  // ---------------------------------------------------------------------
  function snapshotForm() {
    return JSON.stringify({
      channel: el("cpChannel").value, contact: el("cpContact").value, template: el("cpTemplate").value,
      cc: el("cpCc").value, subject: el("cpSubject").value, body: el("cpBody").value,
      followUp: el("cpFollowUp").value, followUpCustom: el("cpFollowUpCustom").value
    });
  }
  function isDirty() { return !!state && state.initialSnapshot !== snapshotForm(); }

  function saveDraft() {
    if (state.sending) return;
    if (!state.company || !state.company.id) { closeComposer(); return; }
    var channel = el("cpChannel").value;
    var payload = {
      contact: el("cpContact").value, template: el("cpTemplate").value, cc: el("cpCc").value,
      subject: el("cpSubject").value, body: el("cpBody").value,
      followUp: el("cpFollowUp").value, followUpCustom: el("cpFollowUpCustom").value,
      savedAt: new Date().toISOString()
    };
    var ok = saveDraftToStorage(state.company.id, channel, payload);
    CRM.toast(ok ? "تم حفظ المسودة." : "تعذّر حفظ المسودة محليًا.", ok ? "info" : "warning");
    closeComposer();
  }

  function clearDraft() {
    if (!state.company || !state.company.id) return;
    clearDraftFromStorage(state.company.id, el("cpChannel").value);
  }

  function loadDraftIfAny() {
    var box = el("crmComposerDraftBanner");
    box.innerHTML = "";
    if (!state.company || !state.company.id) return;
    var channel = el("cpChannel").value;
    var draft = readDraftFromStorage(state.company.id, channel);
    if (!draft) return;
    var when = "";
    try { when = draft.savedAt ? new Date(draft.savedAt).toLocaleString("ar") : ""; } catch (e) { when = ""; }
    box.innerHTML =
      '<div class="crm-draft-banner">' +
      "<span>توجد مسودة محفوظة" + (when ? " من " + CRM.escape(when) : "") + "</span>" +
      '<span style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="crm-btn crm-btn-sm" id="cpDraftRestore">استعادة</button>' +
      '<button type="button" class="crm-btn crm-btn-sm" id="cpDraftDiscard">تجاهل</button>' +
      "</span></div>";
    el("cpDraftRestore").addEventListener("click", function () { applyDraft(draft); box.innerHTML = ""; });
    el("cpDraftDiscard").addEventListener("click", function () { clearDraftFromStorage(state.company.id, channel); box.innerHTML = ""; });
  }

  function applyDraft(draft) {
    if (draft.contact) el("cpContact").value = draft.contact;
    if (draft.template != null) { el("cpTemplate").value = draft.template; state.templateManuallySet = true; state.lastManualTemplateId = draft.template || null; }
    el("cpCc").value = draft.cc || "";
    el("cpSubject").value = draft.subject || "";
    el("cpBody").value = draft.body || "";
    if (draft.followUp != null) el("cpFollowUp").value = draft.followUp;
    el("cpFollowUpCustom").style.display = el("cpFollowUp").value === "custom" ? "block" : "none";
    el("cpFollowUpCustom").value = draft.followUpCustom || "";
    refreshRecipientField();
    clearAllFieldErrors();
    onFieldInput();
    checkAndRenderCooldown();
    state.initialSnapshot = snapshotForm();
    CRM.toast("تم استعادة المسودة.", "info");
  }

  // ---------------------------------------------------------------------
  // Busy-state locking (section 12: disable Send — and everything else
  // that could interrupt an in-flight request — while it runs).
  // ---------------------------------------------------------------------
  function setBusy(busy) {
    state.sending = !!busy;
    ["cpChannel", "cpContact", "cpTemplate", "cpCc", "cpSubject", "cpBody", "cpFollowUp", "cpFollowUpCustom",
      "cpCancelBtn", "cpSaveDraftBtn", "cpPreviewToggleBtn", "cpCloseX"].forEach(function (id) {
        var f = el(id); if (f) f.disabled = busy;
      });
    el("cpActions").querySelectorAll("button").forEach(function (b) { b.disabled = busy; });
  }

  function renderActions() {
    var channel = el("cpChannel").value;
    var actions = el("cpActions");
    var noContactAtAll = !(state.contacts || []).length && !state.company.email && !state.company.phone && !state.company.linkedin_url;
    actions.innerHTML = "";
    if (noContactAtAll) {
      actions.innerHTML = '<span class="crm-muted" style="font-size:12.5px;align-self:center">لا توجد جهة اتصال متاحة لهذه الشركة.</span>';
      return;
    }
    if (channel === "email") {
      actions.innerHTML = '<button type="button" class="crm-btn crm-btn-primary" id="cpSend">إرسال</button>';
      el("cpSend").addEventListener("click", doSendEmail);
    } else if (channel === "whatsapp") {
      actions.innerHTML = '<button type="button" class="crm-btn" id="cpOpenWa">فتح واتساب</button>' +
        '<button type="button" class="crm-btn crm-btn-primary" id="cpConfirmSent">تأكيد الإرسال</button>';
      el("cpOpenWa").addEventListener("click", doOpenWhatsapp);
      el("cpConfirmSent").addEventListener("click", function () { doConfirmSent("whatsapp"); });
    } else if (channel === "linkedin") {
      actions.innerHTML = '<button type="button" class="crm-btn" id="cpCopyMsg">نسخ الرسالة</button>' +
        '<button type="button" class="crm-btn" id="cpOpenLi">فتح LinkedIn</button>' +
        '<button type="button" class="crm-btn crm-btn-primary" id="cpConfirmSent">تأكيد الإرسال</button>';
      el("cpCopyMsg").addEventListener("click", doCopyMessage);
      el("cpOpenLi").addEventListener("click", doOpenLinkedin);
      el("cpConfirmSent").addEventListener("click", function () { doConfirmSent("linkedin"); });
    }
  }

  function requireRecipientOrToast(channel) {
    var to = el("cpTo").value.trim();
    if (!to) {
      var msg = channel === "email" ? "لا يوجد بريد إلكتروني لهذا المستلم." : channel === "whatsapp" ? "لا يوجد رقم واتساب لهذا المستلم." : "لا يوجد رابط LinkedIn لهذا المستلم.";
      setFieldError("cpTo", msg);
      CRM.toast(msg, "warning");
      return null;
    }
    return to;
  }

  async function doSendEmail() {
    if (hasBlockingWarning()) { CRM.toast("أكّد أنك تريد المتابعة رغم التنبيه أعلاه.", "warning"); return; }
    clearAllFieldErrors();
    var to = el("cpTo").value.trim();
    var subject = el("cpSubject").value.trim();
    var bodyText = el("cpBody").value.trim();
    var valid = true;
    if (!to) { setFieldError("cpTo", "لا يوجد بريد إلكتروني لهذا المستلم."); valid = false; }
    else if (!isEmail(to)) { setFieldError("cpTo", "عنوان البريد الإلكتروني غير صالح."); valid = false; }
    if (!subject) { setFieldError("cpSubject", "الموضوع مطلوب."); valid = false; }
    if (!bodyText) { setFieldError("cpBody", "نص الرسالة مطلوب."); valid = false; }
    if (!valid) { CRM.toast("يرجى تصحيح الحقول المطلوبة قبل الإرسال.", "danger"); return; }

    // Requirement 5+6: render every CRM variable to its real value/smart
    // fallback and refuse to send if an unknown variable remains — this is
    // the one place that guarantees the Resend API never receives an
    // unresolved {{token}}, regardless of what the editor currently shows.
    var rendered = renderForSend();
    if (blockSendIfUnknownVariables(rendered.unknown)) return;

    setBusy(true);
    var btn = el("cpSend"); if (btn) btn.textContent = "جارٍ الإرسال…";
    try {
      var contact = currentContact();
      var result = await sendEmailViaApi(state.db, {
        companyId: state.company.id,
        contactId: contact ? contact.id : null,
        leadId: state.leadId || null,
        templateId: el("cpTemplate").value || null,
        campaignId: state.campaignId || null,
        to: to, cc: el("cpCc").value.trim() || null,
        subject: rendered.subject, bodyText: rendered.body,
        followUpDays: followUpDays()
      });
      if (!result.ok) {
        CRM.toast("تعذّر الإرسال: " + (result.message || result.error || ""), "danger");
        return;
      }
      (result.warnings || []).forEach(function (w) { CRM.toast(w, "warning"); });
      clearDraft();
      CRM.toast("تم إرسال البريد.", "info");
      closeComposer();
      // Refreshes timeline / communication history, outreach status, and
      // KPI/dashboard-style counters — each caller (Company 360, Outreach
      // Hub, Contacts, Lead Details) wires the specific refresh calls it
      // needs into this one callback.
      if (typeof state.onSent === "function") state.onSent({ channel: "email", result: result });
    } catch (err) {
      CRM.toast("تعذّر الإرسال: " + (err.message || ""), "danger");
    } finally {
      setBusy(false);
      if (btn) btn.textContent = "إرسال";
    }
  }

  function doOpenWhatsapp() {
    var to = requireRecipientOrToast("whatsapp");
    if (!to) return;
    var rendered = renderForSend();
    if (blockSendIfUnknownVariables(rendered.unknown)) return;
    var text = encodeURIComponent(rendered.body);
    window.open("https://wa.me/" + to + "?text=" + text, "_blank", "noopener");
  }

  function doCopyMessage() {
    var rendered = renderForSend();
    if (blockSendIfUnknownVariables(rendered.unknown)) return;
    var text = rendered.body;
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { CRM.toast("تم نسخ الرسالة.", "info"); })
        .catch(function () { CRM.toast("تعذّر النسخ التلقائي.", "warning"); });
    }
  }

  function doOpenLinkedin() {
    var to = requireRecipientOrToast("linkedin");
    if (!to) return;
    window.open(/^https?:\/\//i.test(to) ? to : "https://" + to, "_blank", "noopener");
  }

  async function doConfirmSent(channel) {
    if (hasBlockingWarning()) { CRM.toast("أكّد أنك تريد المتابعة رغم التنبيه أعلاه.", "warning"); return; }
    clearFieldError("cpBody");
    var to = el("cpTo").value.trim();
    var bodyText = el("cpBody").value.trim();
    if (!bodyText) { setFieldError("cpBody", "الرسالة مطلوبة."); CRM.toast("الرسالة مطلوبة.", "danger"); return; }

    var rendered = renderForSend();
    if (blockSendIfUnknownVariables(rendered.unknown)) return;

    setBusy(true);
    try {
      var contact = currentContact();
      var msg = await logConfirmedMessage(state.db, {
        company_id: state.company.id, contact_id: contact ? contact.id : null, lead_id: state.leadId || null,
        campaign_id: state.campaignId || null, template_id: el("cpTemplate").value || null,
        channel: channel, status: "sent", recipient: to, body: rendered.body, follow_up_days: followUpDays()
      });
      var statusPayload = {};
      statusPayload[channel + "_status"] = channel === "linkedin" ? "message_sent" : "sent";
      var outreachRes = await state.db.from("crm_outreach").update(statusPayload).eq("company_id", state.company.id);
      if (outreachRes.error) console.warn("crm_outreach status update failed:", outreachRes.error.message);
      try {
        await state.db.from("crm_activities").insert({
          company_id: state.company.id, contact_id: contact ? contact.id : null, lead_id: state.leadId || null,
          activity_type: channel, subject: (CHANNEL_LABELS[channel] || channel) + ": " + (contact ? contact.full_name : state.company.name)
        });
      } catch (e2) { /* best-effort */ }
      var days = followUpDays();
      if (days) {
        try { await state.db.rpc("crm_schedule_followup", { p_company_id: state.company.id, p_message_id: msg.id, p_days: days, p_channel: channel }); }
        catch (e3) { console.warn("crm_schedule_followup failed:", e3); }
      }
      // Preserves the pre-v1.6 "whatsapp_logged" bell notification (reuses
      // the same notification type/columns from CRM-SALES-OPS-UPGRADE.sql
      // — no schema change here) — now raised from this one shared place
      // instead of being duplicated on every page that can confirm a
      // WhatsApp send.
      if (channel === "whatsapp") {
        try {
          await state.db.from("crm_notifications").insert({
            type: "whatsapp_logged", title: "تم تسجيل رسالة واتساب", description: state.company.name,
            company_id: state.company.id, link: "company-details.html?id=" + state.company.id,
            dedupe_key: "whatsapp_logged:" + msg.id, is_read: false
          });
        } catch (e4) { console.warn("whatsapp_logged notification insert failed:", e4); }
      }
      clearDraft();
      CRM.toast("تم التسجيل.", "info");
      closeComposer();
      if (typeof state.onSent === "function") state.onSent({ channel: channel, result: msg });
    } catch (err) {
      CRM.toast("تعذّر الحفظ: " + (err.message || ""), "danger");
    } finally {
      setBusy(false);
    }
  }

  function closeComposer() { el("crmComposerOverlay").classList.remove("is-open"); }

  // Gate every close attempt (X button, Cancel button, Escape key) behind
  // a dirty-check — never discard typed work silently.
  function requestClose() {
    if (!state || state.sending) return;
    if (isDirty()) {
      if (!CRM.confirm("لديك تغييرات غير محفوظة في هذه الرسالة. هل تريد الإغلاق دون حفظها؟")) return;
    }
    closeComposer();
  }

  // ---------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------
  async function open(options) {
    ensureModal();
    state = {
      db: options.db, company: options.company, contacts: options.contacts || [],
      leadId: options.leadId || null, campaignId: options.campaignId || null,
      onSent: options.onSent || null, allTemplates: [], templates: [], senderName: "",
      cooldownConfirmed: false, sending: false, initialSnapshot: "",
      templateManuallySet: false, templatesLoadFailed: false, lastManualTemplateId: null
    };

    el("cpCompanyLine").textContent = "الشركة: " + (state.company && state.company.name ? state.company.name : "—");

    var contactSel = el("cpContact");
    var defaultContactId = options.defaultContactId || ((state.contacts.filter(function (c) { return c.is_primary; })[0] || state.contacts[0] || {}).id) || "";
    // Recipient selector shows the person's name AND their email/phone (not
    // just the name) so the user can see exactly who/what they're about to
    // message before sending.
    var opts = state.contacts.map(function (c) {
      var idBit = c.email || c.phone || c.whatsapp || "";
      var label = c.full_name + (idBit ? " — " + idBit : "") + (c.is_primary ? " (أساسي)" : "");
      return '<option value="' + c.id + '"' + (c.id === defaultContactId ? " selected" : "") + ">" + CRM.escape(label) + "</option>";
    }).join("");
    if (state.company.email) opts += '<option value="__company_email__">بريد الشركة العام — ' + CRM.escape(state.company.email) + "</option>";
    contactSel.innerHTML = opts || '<option value="">— لا توجد جهة اتصال —</option>';

    el("cpChannel").innerHTML = Object.keys(CHANNEL_LABELS).map(function (k) { return '<option value="' + k + '">' + CHANNEL_LABELS[k] + "</option>"; }).join("");
    el("cpChannel").value = options.channel && CHANNEL_LABELS[options.channel] ? options.channel : "email";
    el("cpCc").value = ""; el("cpFollowUpCustom").style.display = "none"; el("cpFollowUp").value = "5";
    clearAllFieldErrors();
    el("cpPreviewPanel").style.display = "none";
    el("cpPreviewToggleBtn").textContent = "معاينة";

    var tplResult = await loadTemplatesForComposer(state.db);
    state.allTemplates = tplResult.templates;
    state.templatesLoadFailed = tplResult.failed;
    state.senderName = await getSenderName(state.db);

    onChannelChange(); // populates templates/body/recipient/actions/preview/draft-check for the initial channel
    state.initialSnapshot = snapshotForm();
    el("crmComposerOverlay").classList.add("is-open");
    el("cpChannel").focus();
  }

  document.addEventListener("click", function (e) {
    if (e.target.matches("#crmComposerOverlay [data-close]")) requestClose();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && el("crmComposerOverlay") && el("crmComposerOverlay").classList.contains("is-open")) requestClose();
  });

  window.Basma = window.Basma || {};
  window.Basma.Composer = {
    open: open,
    renderTemplate: renderTemplate,
    renderTemplateSmart: renderTemplateSmart,
    unknownVariablesIn: unknownVariablesIn,
    buildVars: buildVars,
    checkCooldown: checkCooldown,
    sendEmailViaApi: sendEmailViaApi,
    logConfirmedMessage: logConfirmedMessage,
    getSenderName: getSenderName,
    COOLDOWN_HOURS: COOLDOWN_HOURS
  };
})();
