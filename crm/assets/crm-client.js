// Basma CRM — shared client bootstrap.
// Loaded on every /crm/*.html page (after the supabase-js CDN script tag).
// Responsibilities: init the Supabase client with the PUBLIC anon key only,
// guard pages behind a real session, expose the current user's CRM role,
// and render the shared sidebar/topbar shell.
(function () {
  "use strict";

  var NAV_ITEMS = [
    { href: "index.html", key: "dashboard", label: "لوحة المؤشرات", icon: "grid" },
    { href: "leads.html", key: "leads", label: "العملاء المحتملون", icon: "users" },
    { href: "pipeline.html", key: "pipeline", label: "مسار المبيعات", icon: "columns" },
    { href: "companies.html", key: "companies", label: "الشركات", icon: "building" },
    { href: "import-companies.html", key: "import-companies", label: "استيراد الشركات", icon: "upload" },
    { href: "contacts.html", key: "contacts", label: "الأشخاص", icon: "contact" },
    { href: "outreach.html", key: "outreach", label: "مركز التواصل", icon: "megaphone" },
    { href: "outreach-dashboard.html", key: "outreach-dashboard", label: "لوحة التواصل", icon: "chart" },
    { href: "outreach-calendar.html", key: "outreach-calendar", label: "تقويم المتابعات", icon: "calendar" },
    { href: "outreach-templates.html", key: "outreach-templates", label: "قوالب التواصل", icon: "file" },
    { href: "outreach-campaigns.html", key: "outreach-campaigns", label: "الحملات", icon: "flag" },
    { href: "tasks.html", key: "tasks", label: "المهام", icon: "check" },
    { href: "meetings.html", key: "meetings", label: "الاجتماعات", icon: "calendar" },
    { href: "proposals.html", key: "proposals", label: "عروض الأسعار", icon: "file" },
    { href: "settings.html", key: "settings", label: "الإعدادات والفريق", icon: "gear" }
  ];

  var ICONS = {
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    users: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 20c0-3 2.5-5 5-5s5 2 5 5M17 11a3 3 0 1 0-1.5-5.6M15.5 20c.3-2.3 1.7-4 3.5-4.6"/>',
    columns: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"/>',
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 21h6M8 8h.01M8 12h.01M8 16h.01M11 8h.01M11 12h.01M11 16h.01M14 10h6v11h-6z"/>',
    contact: '<path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/>',
    check: '<path d="M4 7h16M4 12h16M4 17h10"/><path d="M18 15l2 2 3-3"/>',
    calendar: '<path d="M4 8h16M6 4v3M18 4v3M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/>',
    file: '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
    gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    upload: '<path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    megaphone: '<path d="M3 11v2a2 2 0 0 0 2 2h1l3 6 2-1-2-5h2l7 4V6l-7 4H6a2 2 0 0 0-2 2z"/><path d="M17 8a4 4 0 0 1 0 8"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/>'
  };

  // Notification type -> { icon, badge } used to render the bell dropdown
  // and the full notifications page consistently. Purely presentational —
  // does not affect what gets stored server-side.
  var NOTIF_TYPE_META = {
    lead_new_website: { icon: "users", badge: "gold" },
    lead_new_booking: { icon: "calendar", badge: "gold" },
    lead_new_manual: { icon: "users", badge: "gold" },
    meeting_scheduled: { icon: "calendar", badge: "gold" },
    meeting_reminder_24h: { icon: "calendar", badge: "warning" },
    meeting_reminder_today: { icon: "calendar", badge: "warning" },
    task_due_today: { icon: "check", badge: "warning" },
    task_overdue: { icon: "check", badge: "danger" },
    proposal_created: { icon: "file", badge: "gold" },
    proposal_status_changed: { icon: "file", badge: "gold" },
    lead_stage_changed: { icon: "columns", badge: "gold" },
    lead_won: { icon: "columns", badge: "success" },
    lead_lost: { icon: "columns", badge: "danger" },
    lead_no_activity_3d: { icon: "bell", badge: "warning" },
    lead_inactive_7d: { icon: "bell", badge: "danger" },
    whatsapp_logged: { icon: "users", badge: "gold" },
    outreach_followup_due: { icon: "bell", badge: "warning" }
  };

  function iconSvg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  var state = {
    client: null,
    session: null,
    who: null, // { is_admin, role, can_read, can_write }
    notifications: { items: [], unreadCount: 0 }
  };

  function currentPage() {
    var path = window.location.pathname.split("/").pop();
    return path || "index.html";
  }

  async function fetchConfig() {
    var res = await fetch("/api/crm-config", { headers: { Accept: "application/json" } });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.message || "crm_not_configured");
    return data;
  }

  async function initClient() {
    if (state.client) return state.client;
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("supabase-js failed to load from CDN");
    }
    var config = await fetchConfig();
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return state.client;
  }

  function renderFatal(message) {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1720;color:#dcd6c8;font-family:Tajawal,sans-serif;padding:24px;text-align:center">' +
      '<div style="max-width:420px"><div style="font-size:15px;color:#c9a98d;font-weight:700;margin-bottom:8px">Basma CRM</div>' +
      '<p style="line-height:1.8;font-size:14px">' + message + "</p></div></div>";
  }

  function renderNoAccess(who) {
    var main = document.getElementById("crmApp") || document.body;
    main.innerHTML =
      '<div class="crm-empty" style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 15v2m0-10v5m9 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>' +
      "<h2 style=\"color:#fbf7f0;margin-top:10px\">لا تملك صلاحية الوصول إلى Basma CRM</h2>" +
      "<p>حسابك مسجّل دخول لكنه غير مضاف كموظف مصرح له. تواصل مع مسؤول النظام لإضافتك ضمن فريق العمل.</p>" +
      '<button class="crm-btn" id="crmNoAccessSignout" style="margin-top:14px">تسجيل الخروج</button></div>';
    var btn = document.getElementById("crmNoAccessSignout");
    if (btn) btn.addEventListener("click", function () { crmSignOut(); });
  }

  function svgLogo() {
    return '<img src="../assets/basma-logo-navbar.webp" alt="بصمة">';
  }

  function renderShell(activeKey, pageTitle, pageSub) {
    var navHtml = NAV_ITEMS.map(function (item) {
      var active = item.key === activeKey ? " is-active" : "";
      return '<a href="' + item.href + '" class="crm-nav-link' + active + '" data-key="' + item.key + '">' + iconSvg(item.icon) + "<span>" + item.label + "</span></a>";
    }).join("");

    var role = state.who ? (state.who.is_admin ? "admin" : (state.who.role || "")) : "";
    var roleLabel = { admin: "مدير", sales: "مبيعات", manager: "مدير فريق", viewer: "عرض فقط" }[role] || role;

    document.body.insertAdjacentHTML("afterbegin",
      '<div class="crm-mobile-overlay" id="crmMobileOverlay"></div>' +
      '<div class="crm-shell">' +
      '<aside class="crm-sidebar" id="crmSidebar">' +
      '<div class="crm-sidebar-logo">' + svgLogo() + "<div><strong>Basma CRM</strong><span>نظام المبيعات الداخلي</span></div></div>" +
      '<nav class="crm-nav">' + navHtml + "</nav>" +
      '<div class="crm-sidebar-footer">' +
      '<div class="crm-user-chip"><span id="crmUserEmail">…</span></div>' +
      '<div class="crm-user-chip"><span class="crm-badge crm-badge-gold crm-role-badge">' + (roleLabel || "…") + "</span></div>" +
      '<button class="crm-btn crm-btn-sm" id="crmSignOutBtn" style="justify-content:flex-start">' + iconSvg("logout") + " تسجيل الخروج</button>" +
      "</div></aside>" +
      '<div class="crm-main">' +
      '<header class="crm-topbar">' +
      '<button class="crm-mobile-toggle" id="crmMobileToggle" aria-label="فتح القائمة" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
      '<div><h1>' + pageTitle + "</h1>" + (pageSub ? '<div class="crm-topbar-sub">' + pageSub + "</div>" : "") + "</div>" +
      '<div class="crm-topbar-actions" id="crmTopbarActions"></div>' +
      '<div class="crm-notif-wrap" id="crmNotifWrap">' +
      '<button type="button" class="crm-notif-bell" id="crmNotifBell" aria-label="الإشعارات" aria-expanded="false" aria-haspopup="true">' +
      iconSvg("bell") + '<span class="crm-notif-badge" id="crmNotifBadge" hidden>0</span></button>' +
      '<div class="crm-notif-dropdown" id="crmNotifDropdown" role="menu">' +
      '<div class="crm-notif-dropdown-head"><strong>الإشعارات</strong>' +
      '<button type="button" class="crm-notif-markall" id="crmNotifMarkAll">تعليم الكل كمقروء</button></div>' +
      '<div class="crm-notif-list" id="crmNotifList"><div class="crm-loading">جارِ التحميل…</div></div>' +
      '<a href="notifications.html" class="crm-notif-viewall">عرض كل الإشعارات</a>' +
      "</div></div>" +
      "</header>" +
      '<div class="crm-content" id="crmApp"></div>' +
      "</div></div>"
    );

    document.getElementById("crmSignOutBtn").addEventListener("click", crmSignOut);
    var toggle = document.getElementById("crmMobileToggle");
    var sidebar = document.getElementById("crmSidebar");
    var overlay = document.getElementById("crmMobileOverlay");
    function closeDrawer() { sidebar.classList.remove("is-open"); overlay.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
    function openDrawer() { sidebar.classList.add("is-open"); overlay.classList.add("is-open"); toggle.setAttribute("aria-expanded", "true"); }
    toggle.addEventListener("click", function () { sidebar.classList.contains("is-open") ? closeDrawer() : openDrawer(); });
    overlay.addEventListener("click", closeDrawer);
    sidebar.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeDrawer); });

    var email = (state.session && state.session.user && state.session.user.email) || "";
    var emailEl = document.getElementById("crmUserEmail");
    if (emailEl) emailEl.textContent = email;
  }

  async function crmSignOut() {
    try { if (state.client) await state.client.auth.signOut(); } catch (e) { /* ignore */ }
    window.location.href = "login.html";
  }

  // ---------- Notification Center ----------
  // Dropdown lives in the shared topbar (see renderShell above), so this
  // logic runs on every CRM page once boot succeeds. All reads/writes go
  // through crm_notifications with RLS (crm_can_read/crm_can_write), same
  // as every other CRM table — nothing here bypasses existing security.

  function notifTimeAgo(iso) {
    if (!iso) return "";
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "الآن";
    if (mins < 60) return "منذ " + mins + " د";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return "منذ " + hours + " س";
    var days = Math.floor(hours / 24);
    if (days < 30) return "منذ " + days + " يوم";
    return crmFormatDate(iso);
  }

  function notifItemHtml(n) {
    var meta = NOTIF_TYPE_META[n.type] || { icon: "bell", badge: "gold" };
    var unreadCls = n.is_read ? "" : " is-unread";
    return (
      '<a href="#" class="crm-notif-item' + unreadCls + '" data-id="' + n.id + '" data-link="' + crmEscape(n.link || "") + '">' +
      '<span class="crm-notif-item-icon crm-badge-' + meta.badge + '">' + iconSvg(meta.icon) + "</span>" +
      '<span class="crm-notif-item-body"><strong>' + crmEscape(n.title) + "</strong>" +
      (n.description ? "<p>" + crmEscape(n.description) + "</p>" : "") +
      "<time>" + notifTimeAgo(n.created_at) + "</time></span></a>"
    );
  }

  function crmUpdateNotifBadge() {
    var badge = document.getElementById("crmNotifBadge");
    if (!badge) return;
    var count = state.notifications.unreadCount;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  async function crmRefreshUnreadCount(client) {
    try {
      var res = await client.from("crm_notifications").select("id", { count: "exact", head: true }).eq("is_read", false);
      if (!res.error) {
        state.notifications.unreadCount = res.count || 0;
        crmUpdateNotifBadge();
      }
    } catch (e) { /* best-effort only */ }
  }

  async function crmLoadNotifications(client, options) {
    options = options || {};
    var limit = options.limit || 8;
    var query = client.from("crm_notifications").select("*").order("created_at", { ascending: false }).limit(limit);
    if (options.unreadOnly) query = query.eq("is_read", false);
    var res = await query;
    if (res.error) throw res.error;
    state.notifications.items = res.data || [];
    return state.notifications.items;
  }

  function crmRenderNotifDropdownList() {
    var list = document.getElementById("crmNotifList");
    if (!list) return;
    var items = state.notifications.items;
    if (!items.length) {
      list.innerHTML = '<div class="crm-notif-dropdown-empty">لا توجد إشعارات حتى الآن</div>';
      return;
    }
    list.innerHTML = items.map(notifItemHtml).join("");
  }

  async function crmMarkNotifRead(client, id) {
    try {
      await client.from("crm_notifications").update({
        is_read: true,
        read_at: new Date().toISOString(),
        read_by: (state.session && state.session.user && state.session.user.id) || null
      }).eq("id", id);
      var item = state.notifications.items.filter(function (n) { return n.id === id; })[0];
      if (item && !item.is_read) {
        item.is_read = true;
        state.notifications.unreadCount = Math.max(0, state.notifications.unreadCount - 1);
        crmUpdateNotifBadge();
      }
    } catch (e) { /* best-effort only */ }
  }

  async function crmMarkAllNotifRead(client) {
    try {
      await client.from("crm_notifications").update({
        is_read: true,
        read_at: new Date().toISOString(),
        read_by: (state.session && state.session.user && state.session.user.id) || null
      }).eq("is_read", false);
      state.notifications.items.forEach(function (n) { n.is_read = true; });
      state.notifications.unreadCount = 0;
      crmUpdateNotifBadge();
      crmRenderNotifDropdownList();
    } catch (e) { /* best-effort only */ }
  }

  async function crmRefreshTimeBasedNotifications(client) {
    try { await client.rpc("crm_refresh_time_based_notifications"); } catch (e) { /* best-effort only */ }
  }

  function initNotifications(client) {
    var wrap = document.getElementById("crmNotifWrap");
    var bell = document.getElementById("crmNotifBell");
    var dropdown = document.getElementById("crmNotifDropdown");
    var markAllBtn = document.getElementById("crmNotifMarkAll");
    var list = document.getElementById("crmNotifList");
    if (!wrap || !bell || !dropdown) return;

    function closeDropdown() { dropdown.classList.remove("is-open"); bell.setAttribute("aria-expanded", "false"); }
    function openDropdown() {
      dropdown.classList.add("is-open");
      bell.setAttribute("aria-expanded", "true");
      crmLoadNotifications(client, { limit: 8 })
        .then(crmRenderNotifDropdownList)
        .catch(function () { list.innerHTML = '<div class="crm-notif-dropdown-empty">تعذّر تحميل الإشعارات</div>'; });
    }

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dropdown.classList.contains("is-open")) closeDropdown(); else openDropdown();
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) closeDropdown();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDropdown();
    });

    // Marking read/unread is an UPDATE against crm_notifications, gated by
    // crm_can_write() in RLS (see CRM-SALES-OPS-UPGRADE.sql) so a VIEWER
    // stays strictly read-only with no exceptions. Hide the write-only
    // affordances for non-writers instead of letting them silently no-op
    // against RLS (an UPDATE blocked by RLS matches zero rows rather than
    // throwing, so optimistically flipping local state would desync from
    // the DB on next reload).
    var canMarkRead = !!(state.who && state.who.can_write);
    if (markAllBtn) markAllBtn.style.display = canMarkRead ? "" : "none";

    list.addEventListener("click", function (e) {
      var itemEl = e.target.closest(".crm-notif-item");
      if (!itemEl) return;
      e.preventDefault();
      var link = itemEl.getAttribute("data-link");
      if (!canMarkRead) { if (link) window.location.href = link; return; }
      var id = itemEl.getAttribute("data-id");
      crmMarkNotifRead(client, id).then(function () {
        itemEl.classList.remove("is-unread");
        if (link) window.location.href = link;
      });
    });

    if (markAllBtn && canMarkRead) {
      markAllBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        crmMarkAllNotifRead(client);
      });
    }

    // Initial unread badge + a best-effort refresh of time-based
    // notifications (task due/overdue, meeting reminders, stale leads) —
    // see crm_refresh_time_based_notifications() in
    // CRM-SALES-OPS-UPGRADE.sql for why this runs on page load instead of
    // a cron job (no deploy is allowed for this project).
    crmRefreshTimeBasedNotifications(client).then(function () { crmRefreshUnreadCount(client); });
    crmRefreshUnreadCount(client);
    setInterval(function () { crmRefreshUnreadCount(client); }, 60000);

    // Follow-up reminder emails (overdue task / meeting within 24h) — see
    // CRM-v1.2 report for why this is triggered on page load instead of a
    // cron job. Fire-and-forget: must never affect the CRM UI either way.
    fetch("/api/notify-followups", { method: "GET" }).catch(function () { /* best-effort only */ });
  }

  // Call this at the top of every protected page.
  // options: { title, sub, activeKey, minRole: 'read'|'write'|'admin' }
  async function crmBoot(options) {
    options = options || {};
    try {
      var client = await initClient();
      var sessionRes = await client.auth.getSession();
      var session = sessionRes.data && sessionRes.data.session;
      if (!session) {
        var here = encodeURIComponent(currentPage());
        window.location.href = "login.html?redirect=" + here;
        return null;
      }
      state.session = session;

      var whoRes = await client.rpc("crm_whoami");
      if (whoRes.error) throw whoRes.error;
      state.who = whoRes.data || { is_admin: false, role: null, can_read: false, can_write: false };

      if (!state.who.can_read) {
        renderShell(options.activeKey, options.title || "", options.sub || "");
        renderNoAccess(state.who);
        return null;
      }

      var needsWrite = options.minRole === "write" || options.minRole === "admin";
      var needsAdmin = options.minRole === "admin";
      if ((needsWrite && !state.who.can_write) || (needsAdmin && !state.who.is_admin)) {
        renderShell(options.activeKey, options.title || "", options.sub || "");
        renderNoAccess(state.who);
        return null;
      }

      renderShell(options.activeKey, options.title || "", options.sub || "");
      initNotifications(client);

      client.auth.onAuthStateChange(function (event) {
        if (event === "SIGNED_OUT") window.location.href = "login.html";
      });

      return { client: client, session: session, who: state.who };
    } catch (err) {
      renderFatal(
        "تعذّر تشغيل Basma CRM: " + (err && err.message ? err.message : "خطأ غير معروف") +
        "<br><br>تأكد من ضبط SUPABASE_URL و SUPABASE_ANON_KEY في متغيرات البيئة (راجع تقرير CRM)."
      );
      return null;
    }
  }

  // Small shared helpers used by page-specific scripts.
  function crmEscape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function crmFormatMoney(amount, currency) {
    var n = Number(amount || 0);
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " " + (currency || "USD");
  }

  function crmFormatDate(value) {
    if (!value) return "—";
    try {
      var d = new Date(value);
      return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
    } catch (e) { return String(value); }
  }

  function crmFormatDateTime(value) {
    if (!value) return "—";
    try {
      var d = new Date(value);
      return d.toLocaleString("ar-EG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return String(value); }
  }

  function crmToast(message, kind) {
    var box = document.getElementById("crmToastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "crmToastBox";
      box.style.cssText = "position:fixed;bottom:18px;inset-inline-end:18px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:320px";
      document.body.appendChild(box);
    }
    var el = document.createElement("div");
    el.className = "crm-alert crm-alert-" + (kind || "info");
    el.style.boxShadow = "0 12px 30px rgba(0,0,0,.4)";
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function crmConfirm(message) {
    return window.confirm(message);
  }

  // ---------- Shared, dependency-free chart + export helpers ----------
  // Same visual language as the original dashboard bars (crm/index.html),
  // promoted here so new pages (Outreach Dashboard, etc.) reuse one
  // implementation instead of duplicating chart-rendering logic.

  function crmDistBar(rows, labelKey, countKey) {
    countKey = countKey || "count";
    if (!rows || !rows.length) return '<p class="crm-muted" style="font-size:13px">لا توجد بيانات كافية بعد.</p>';
    var max = Math.max.apply(null, rows.map(function (r) { return r[countKey] || 0; }));
    return rows.map(function (r) {
      var val = r[countKey] || 0;
      var pct = max ? Math.round((val / max) * 100) : 0;
      return '<div style="margin-bottom:10px">' +
        '<div class="crm-flex-between" style="font-size:12.5px;margin-bottom:4px"><span>' + crmEscape(r[labelKey] || "غير محدد") + '</span><strong style="color:#fbf7f0">' + val + '</strong></div>' +
        '<div style="height:6px;border-radius:4px;background:rgba(255,255,255,.06)"><div style="height:100%;border-radius:4px;background:var(--crm-gold);width:' + pct + '%"></div></div>' +
        '</div>';
    }).join("");
  }

  function crmGroupCount(list, key, limit) {
    var map = {};
    (list || []).forEach(function (row) {
      var k = row[key] || "غير محدد";
      map[k] = (map[k] || 0) + 1;
    });
    return Object.keys(map).map(function (k) {
      var obj = {}; obj[key] = k; obj.count = map[k]; return obj;
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, limit || 8);
  }

  function crmCsvEscape(value) {
    var s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function crmDownloadCsv(filename, rows, columns) {
    // columns: [{ key, label }]
    var lines = [];
    lines.push(columns.map(function (c) { return crmCsvEscape(c.label); }).join(","));
    (rows || []).forEach(function (row) {
      lines.push(columns.map(function (c) {
        return crmCsvEscape(typeof c.value === "function" ? c.value(row) : row[c.key]);
      }).join(","));
    });
    var csv = "﻿" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.Basma = window.Basma || {};
  window.Basma.CRM = {
    boot: crmBoot,
    signOut: crmSignOut,
    state: state,
    escape: crmEscape,
    formatMoney: crmFormatMoney,
    formatDate: crmFormatDate,
    formatDateTime: crmFormatDateTime,
    toast: crmToast,
    confirm: crmConfirm,
    charts: {
      distBar: crmDistBar,
      groupCount: crmGroupCount
    },
    downloadCsv: crmDownloadCsv,
    notifications: {
      typeMeta: NOTIF_TYPE_META,
      timeAgo: notifTimeAgo,
      load: crmLoadNotifications,
      markRead: crmMarkNotifRead,
      markAllRead: crmMarkAllNotifRead,
      refreshTimeBased: crmRefreshTimeBasedNotifications,
      refreshUnreadCount: crmRefreshUnreadCount
    }
  };
})();
