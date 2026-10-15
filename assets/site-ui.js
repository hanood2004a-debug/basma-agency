(function () {
  "use strict";

  /* ========================================
     إعدادات بصمة العامة
  ======================================== */

  var CONFIG = {
    whatsappNumber: "970592608998",
    whatsappDisplay: "+970 59 260 8998",
    mobileBreakpoint: 768
  };

  /* ========================================
     تحميل ملفات البوت مرة واحدة
  ======================================== */

  function loadChatbot() {
    if (!document.querySelector('link[data-basma-chatbot]')) {
      var chatbotStyle = document.createElement("link");

      chatbotStyle.rel = "stylesheet";
      chatbotStyle.href = "assets/chatbot.css";
      chatbotStyle.setAttribute("data-basma-chatbot", "");

      document.head.appendChild(chatbotStyle);
    }

    if (!document.querySelector('script[data-basma-chatbot]')) {
      var chatbotScript = document.createElement("script");

      chatbotScript.src = "assets/chatbot.js";
      chatbotScript.defer = true;
      chatbotScript.setAttribute("data-basma-chatbot", "");

      document.head.appendChild(chatbotScript);
    }
  }

  /* ========================================
     إنشاء أيقونة SVG
  ======================================== */

  function createIcon(type) {
    var icons = {
      globe:
        '<circle cx="12" cy="12" r="9"></circle>' +
        '<path d="M3 12h18"></path>' +
        '<path d="M12 3c3 3.5 3 14 0 18"></path>' +
        '<path d="M12 3c-3 3.5-3 14 0 18"></path>',

      whatsapp:
        '<path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.4-4.7A8.5 8.5 0 1 1 20.5 11.7z"></path>' +
        '<path d="M8.3 7.7c.3-.4.7-.3 1 0l1 2c.2.4.1.7-.2 1l-.7.7c.8 1.6 2 2.8 3.7 3.5l.7-.9c.3-.3.6-.4 1-.2l2 1c.4.2.5.6.3 1-.5 1-1.5 1.6-2.7 1.5-3.9-.5-7.2-3.6-7.8-7.5-.1-.8.2-1.6.7-2.1z"></path>',

      home:
        '<path d="M3 11.5 12 4l9 7.5"></path>' +
        '<path d="M5.5 10.5V20h13v-9.5"></path>' +
        '<path d="M9.5 20v-6h5v6"></path>',

      services:
        '<rect x="4" y="4" width="6" height="6" rx="1"></rect>' +
        '<rect x="14" y="4" width="6" height="6" rx="1"></rect>' +
        '<rect x="4" y="14" width="6" height="6" rx="1"></rect>' +
        '<rect x="14" y="14" width="6" height="6" rx="1"></rect>',

      team:
        '<circle cx="9" cy="8" r="3"></circle>' +
        '<circle cx="17" cy="9" r="2.5"></circle>' +
        '<path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6"></path>' +
        '<path d="M14 15c3.8-.8 6 1 6.5 5"></path>',

      partners:
        '<path d="m8 12 3 3 5-6"></path>' +
        '<path d="M12 3 4.5 6v5c0 4.8 3 8.2 7.5 10 4.5-1.8 7.5-5.2 7.5-10V6L12 3Z"></path>',

      contact:
        '<rect x="3" y="5" width="18" height="14" rx="2"></rect>' +
        '<path d="m4 7 8 6 8-6"></path>'
    };

    return (
      '<svg viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' +
      (icons[type] || "") +
      "</svg>"
    );
  }

  /* ========================================
     إضافة CSS
  ======================================== */

  function injectStyles() {
    if (document.getElementById("basma-global-ui-style")) {
      return;
    }

    var style = document.createElement("style");

    style.id = "basma-global-ui-style";

    style.textContent = `
      :root {
        --basma-bg: #0d1720;
        --basma-text: #fbf7f0;
        --basma-muted: #dcd6c8;
        --basma-accent: #c9a98d;
        --basma-dark: #10131a;
        --basma-border: rgba(201, 169, 141, 0.28);
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        overflow-x: hidden;
        background-color: var(--basma-bg);
        color: var(--basma-text);
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      img,
      video,
      canvas,
      iframe,
      image-slot {
        max-width: 100%;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      summary::marker {
        content: "";
      }

      /* ===============================
         ناف بار الكمبيوتر
         DISABLED: تنسيق الديسكتوب صار موحّد ومحلي بكل صفحة (basma-nav-shell)،
         عشان ما يصير تعارض/تكرار مع هاد الملف. ضل بس ناف بار الجوال تحت.
      =============================== */
      /*
      #basmaNav.basma-nav-shell {
        position: sticky !important;
        top: 0 !important;
        z-index: 9999 !important;

        width: 100% !important;
        min-height: 86px !important;

        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;

        gap: 20px !important;

        padding: 12px clamp(24px, 5vw, 72px) !important;

        direction: rtl !important;

        background: rgba(13, 23, 32, 0.9) !important;
        border: 0 !important;
        border-bottom: 1px solid rgba(201, 169, 141, 0.25) !important;

        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;

        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.18) !important;
      }

      #basmaNav .basma-nav-logo {
        order: 1 !important;

        display: flex !important;
        align-items: center !important;
        gap: 12px !important;

        flex: 0 0 auto !important;

        margin: 0 !important;
        padding: 0 !important;

        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;

        text-decoration: none !important;
      }

      #basmaNav .basma-nav-logo img {
        display: block !important;

        width: 190px !important;
        height: 72px !important;

        object-fit: contain !important;

        border-radius: 14px !important;
        background: rgba(255, 255, 255, 0.96) !important;

        filter: none !important;
      }

      #basmaNav .basma-nav-logo span {
        display: none !important;
      }

      #basmaNav .basma-nav-center {
        order: 2 !important;

        position: absolute !important;
        left: 50% !important;
        transform: translateX(-50%) !important;

        display: flex !important;
        align-items: center !important;
        justify-content: center !important;

        gap: clamp(20px, 2.5vw, 36px) !important;

        margin: 0 !important;
        padding: 0 !important;

        flex-wrap: nowrap !important;
      }

      #basmaNav .basma-nav-center > a {
        position: relative !important;

        display: inline-block !important;

        min-width: 0 !important;

        padding: 7px 2px !important;

        color: var(--basma-muted) !important;
        background: transparent !important;

        border: 0 !important;
        border-radius: 0 !important;

        box-shadow: none !important;
        animation: none !important;

        font-family: "Tajawal", sans-serif !important;
        font-size: 14px !important;
        font-weight: 500 !important;

        text-decoration: none !important;
        white-space: nowrap !important;

        overflow: visible !important;
        transform: none !important;

        transition: color 0.25s ease !important;
      }

      #basmaNav .basma-nav-center > a::before {
        display: none !important;
      }

      #basmaNav .basma-nav-center > a::after {
        content: "";

        position: absolute;

        right: 0;
        bottom: 0;
        left: 0;

        height: 1px;

        background: var(--basma-accent);

        transform: scaleX(0);
        transform-origin: right;

        transition: transform 0.25s ease;
      }

      #basmaNav .basma-nav-center > a:hover,
      #basmaNav .basma-nav-center > a.active,
      #basmaNav .basma-nav-center > a[aria-current="page"] {
        color: var(--basma-accent) !important;
      }

      #basmaNav .basma-nav-center > a:hover::after,
      #basmaNav .basma-nav-center > a.active::after,
      #basmaNav .basma-nav-center > a[aria-current="page"]::after {
        transform: scaleX(1);
      }

      #basmaNav .basma-nav-actions {
        order: 3 !important;

        display: flex !important;
        align-items: center !important;
        justify-content: flex-end !important;

        gap: 12px !important;

        flex: 0 0 auto !important;

        margin: 0 !important;
        padding: 0 !important;
      }

      #basmaNav .basma-whatsapp-link,
      #basmaNav .basma-whatsapp-number {
        display: inline-flex !important;
        align-items: center !important;

        gap: 7px !important;

        padding: 0 !important;

        color: var(--basma-muted) !important;
        background: transparent !important;

        border: 0 !important;
        box-shadow: none !important;

        font-family: "IBM Plex Mono", "Tajawal", sans-serif !important;
        font-size: 13px !important;
        font-weight: 500 !important;

        text-decoration: none !important;
        white-space: nowrap !important;

        animation: none !important;
      }

      #basmaNav .basma-whatsapp-link:hover,
      #basmaNav .basma-whatsapp-number:hover {
        color: var(--basma-accent) !important;
      }

      #basmaNav .basma-whatsapp-link svg,
      #basmaNav .basma-whatsapp-number svg {
        width: 18px !important;
        height: 18px !important;

        flex: 0 0 18px !important;
      }

      #basmaNav details {
        position: relative !important;

        margin: 0 !important;
        padding: 0 !important;
      }

      #basmaNav .basma-lang-summary {
        width: 44px !important;
        height: 44px !important;
        min-width: 44px !important;

        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;

        padding: 0 !important;

        color: var(--basma-accent) !important;
        background: rgba(255, 255, 255, 0.06) !important;

        border: 1px solid rgba(201, 169, 141, 0.5) !important;
        border-radius: 11px !important;

        box-shadow: none !important;

        cursor: pointer !important;
      }

      #basmaNav .basma-lang-summary svg {
        width: 22px !important;
        height: 22px !important;
      }

      #basmaNav details > div {
        position: absolute !important;

        top: calc(100% + 8px) !important;
        left: 0 !important;

        min-width: 145px !important;

        display: flex !important;
        flex-direction: column !important;

        padding: 7px !important;

        background: rgba(13, 23, 32, 0.98) !important;

        border: 1px solid rgba(201, 169, 141, 0.26) !important;
        border-radius: 9px !important;

        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.34) !important;

        backdrop-filter: blur(14px) !important;
        -webkit-backdrop-filter: blur(14px) !important;

        z-index: 10000 !important;
      }

      #basmaNav details > div a {
        padding: 7px 11px !important;

        color: var(--basma-muted) !important;
        background: transparent !important;

        border: 0 !important;
        border-radius: 6px !important;

        box-shadow: none !important;

        font-family: "Tajawal", sans-serif !important;
        font-size: 13px !important;
        font-weight: 500 !important;

        text-decoration: none !important;

        animation: none !important;
      }

      #basmaNav details > div a:hover {
        color: var(--basma-accent) !important;
        background: rgba(201, 169, 141, 0.13) !important;
      }

      #basmaNav #basmaCtaBtn,
      #basmaNav .basma-cta,
      #basmaNav .basma-nav-actions > a[href^="Contact.dc.html"],
      #basmaNav .basma-nav-actions > a[href^="#homecontact"] {
        min-width: 150px !important;

        padding: 13px 25px !important;

        color: #173442 !important;

        background: linear-gradient(
          135deg,
          #edc9a8,
          #c99a74
        ) !important;

        border: 2px solid rgba(255, 231, 208, 0.88) !important;
        border-radius: 13px !important;

        box-shadow:
          0 10px 28px rgba(201, 169, 141, 0.28),
          inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;

        animation: none !important;

        font-family: "Tajawal", sans-serif !important;
        font-size: 15px !important;
        font-weight: 900 !important;

        text-align: center !important;
        text-decoration: none !important;
        white-space: nowrap !important;

        overflow: visible !important;

        transition:
          transform 0.25s ease,
          box-shadow 0.25s ease !important;
      }

      #basmaNav #basmaCtaBtn::before,
      #basmaNav .basma-cta::before,
      #basmaNav .basma-nav-actions > a[href^="Contact.dc.html"]::before,
      #basmaNav .basma-nav-actions > a[href^="#homecontact"]::before {
        display: none !important;
      }

      #basmaNav #basmaCtaBtn:hover,
      #basmaNav .basma-cta:hover,
      #basmaNav .basma-nav-actions > a[href^="Contact.dc.html"]:hover,
      #basmaNav .basma-nav-actions > a[href^="#homecontact"]:hover {
        transform: translateY(-2px) !important;

        box-shadow:
          0 15px 34px rgba(201, 169, 141, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.48) !important;
      }
      */

      /* ===============================
         ناف بار الجوال
      =============================== */

      .basma-bottom-nav {
        display: none;
      }

      @media (max-width: 1150px) {
        #basmaNav .basma-nav-logo img {
          width: 155px !important;
          height: 62px !important;
        }

        #basmaNav .basma-whatsapp-link span,
        #basmaNav .basma-whatsapp-number span {
          display: none !important;
        }

        #basmaNav .basma-nav-center {
          gap: 18px !important;
        }
      }

      @media (max-width: 920px) {
        #basmaNav {
          padding-right: 18px !important;
          padding-left: 18px !important;
        }

        #basmaNav .basma-nav-logo img {
          width: 128px !important;
          height: 54px !important;
        }

        #basmaNav .basma-nav-center {
          gap: 12px !important;
        }

        #basmaNav .basma-nav-center > a {
          font-size: 12.5px !important;
        }

        #basmaNav #basmaCtaBtn,
        #basmaNav .basma-cta {
          min-width: 120px !important;
          padding: 10px 14px !important;
          font-size: 13px !important;
        }
      }

      @media (max-width: 768px) {
        html,
        body {
          width: 100% !important;
          max-width: 100% !important;

          margin: 0 !important;

          overflow-x: hidden !important;
        }

        body {
          padding-bottom:
            calc(78px + env(safe-area-inset-bottom)) !important;
        }

        #basmaNav,
        nav.basma-nav-shell,
        body nav:not(.basma-bottom-nav) {
          display: none !important;
        }

        .basma-bottom-nav {
          position: fixed;

          right: 0;
          bottom: 0;
          left: 0;

          z-index: 99999;

          width: 100%;
          min-height: 68px;

          display: flex;

          align-items: center;
          justify-content: space-between;

          direction: rtl;

          padding:
            6px 4px
            calc(6px + env(safe-area-inset-bottom));

          background: rgba(13, 23, 32, 0.98);

          border-top:
            1px solid rgba(201, 169, 141, 0.3);

          box-shadow:
            0 -8px 24px rgba(0, 0, 0, 0.24);

          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .basma-bottom-nav a {
          position: relative;

          min-width: 0;
          min-height: 44px;

          display: flex;
          flex: 1 1 20%;

          flex-direction: column;
          align-items: center;
          justify-content: center;

          gap: 3px;

          padding: 5px 2px;

          color: #d1ccc4 !important;

          font-family: "Tajawal", sans-serif;
          font-size: 11.5px;
          font-weight: 700;
          line-height: 1.2;

          text-decoration: none;
          white-space: nowrap;
        }

        .basma-bottom-nav svg {
          width: 21px;
          height: 21px;

          flex: 0 0 21px;

          fill: none;
          stroke: currentColor;
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .basma-bottom-nav__label {
          display: block;

          max-width: 100%;

          overflow: hidden;
          text-overflow: ellipsis;
        }

        .basma-bottom-nav a:hover,
        .basma-bottom-nav a.is-active {
          color: var(--basma-accent) !important;
        }

        .basma-bottom-nav a.is-active::after {
          content: "";

          position: absolute;

          right: 32%;
          bottom: 0;
          left: 32%;

          height: 2px;

          border-radius: 2px;

          background: var(--basma-accent);

          box-shadow:
            0 0 8px rgba(201, 169, 141, 0.55);
        }

        main,
        header,
        section,
        footer,
        .team-page-shell,
        .services-page,
        .about-page {
          width: 100% !important;
          max-width: 100% !important;

          margin-right: auto !important;
          margin-left: auto !important;

          transform: none !important;
        }

        .basma-chat {
          bottom:
            calc(86px + env(safe-area-inset-bottom)) !important;
        }

        .basma-chat__window {
          bottom:
            calc(150px + env(safe-area-inset-bottom)) !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* ========================================
     البحث عن الناف بار
  ======================================== */

  function findNavbar() {
    return (
      document.getElementById("basmaNav") ||
      document.querySelector("nav")
    );
  }

  /* ========================================
     تحديد الشعار
  ======================================== */

  function findLogo(nav) {
    var logo =
      nav.querySelector(".basma-nav-logo") ||
      nav.querySelector("#basmaLogoLink");

    if (logo) {
      return logo;
    }

    var children = Array.prototype.slice.call(nav.children);

    return children.find(function (child) {
      return (
        child.tagName === "A" &&
        child.querySelector("img")
      );
    });
  }

  /* ========================================
     تحديد روابط المنتصف
  ======================================== */

  function findCenterLinks(nav) {
    var center =
      nav.querySelector(".basma-nav-center") ||
      nav.querySelector(".basma-nav-links");

    if (center) {
      return center;
    }

    var children = Array.prototype.slice.call(nav.children);

    return children.find(function (child) {
      if (child.tagName !== "DIV") {
        return false;
      }

      return child.querySelector(
        'a[href*="About.dc.html"],' +
        'a[href*="Team.dc.html"],' +
        'a[href*="Services.dc.html"],' +
        'a[href*="Partners.dc.html"]'
      );
    });
  }

  /* ========================================
     إنشاء رابط واتساب
  ======================================== */

  function createWhatsappLink() {
    var link = document.createElement("a");

    link.className = "basma-whatsapp-link";

    link.href =
      "https://wa.me/" + CONFIG.whatsappNumber;

    link.target = "_blank";
    link.rel = "noopener";

    link.setAttribute(
      "aria-label",
      "واتساب " + CONFIG.whatsappDisplay
    );

    link.innerHTML =
      createIcon("whatsapp") +
      '<span dir="ltr">' +
      CONFIG.whatsappDisplay +
      "</span>";

    return link;
  }

  /* ========================================
     تنظيف تكرار الواتساب
  ======================================== */

  function removeDuplicateWhatsapp(nav) {
    var links = nav.querySelectorAll(
      ".basma-whatsapp-link, .basma-whatsapp-number"
    );

    if (links.length <= 1) {
      return;
    }

    Array.prototype.forEach.call(
      links,
      function (link, index) {
        if (index > 0) {
          link.remove();
        }
      }
    );
  }

  /* ========================================
     تجهيز روابط الصفحة الحالية
  ======================================== */

  function setupActiveLink(center) {
    if (!center) {
      return;
    }

    var currentPage =
      (
        window.location.pathname
          .split("/")
          .pop() || "index.html"
      ).toLowerCase();

    var links = center.querySelectorAll("a");

    Array.prototype.forEach.call(
      links,
      function (link) {
        var href =
          (link.getAttribute("href") || "")
            .split("#")[0]
            .split("?")[0]
            .toLowerCase();

        link.classList.remove("active");
        link.removeAttribute("aria-current");

        if (href && href === currentPage) {
          link.classList.add("active");
          link.setAttribute(
            "aria-current",
            "page"
          );
        }
      }
    );
  }

  /* ========================================
     تجهيز الناف بار
  ======================================== */

  function setupNavbar() {
    var nav = findNavbar();

    if (!nav) {
      return;
    }

    if (
      nav.getAttribute("data-basma-navbar-ready") ===
      "true"
    ) {
      return;
    }

    nav.setAttribute(
      "data-basma-navbar-ready",
      "true"
    );

    nav.id = "basmaNav";
    nav.classList.add("basma-nav-shell");

    var logo = findLogo(nav);

    if (logo) {
      logo.classList.add("basma-nav-logo");
    }

    var center = findCenterLinks(nav);

    if (center) {
      center.classList.remove(
        "basma-nav-links"
      );

      center.classList.add(
        "basma-nav-center"
      );
    }

    var actions =
      nav.querySelector(".basma-nav-actions");

    if (!actions) {
      actions = document.createElement("div");

      actions.className =
        "basma-nav-actions";

      nav.appendChild(actions);
    }

    removeDuplicateWhatsapp(nav);

    var whatsapp =
      nav.querySelector(
        ".basma-whatsapp-link, .basma-whatsapp-number"
      );

    if (!whatsapp) {
      whatsapp = createWhatsappLink();
    }

    var language =
      nav.querySelector("details");

    if (language) {
      var summary =
        language.querySelector("summary");

      if (summary) {
        summary.className =
          "basma-lang-summary";

        summary.removeAttribute("style");

        summary.setAttribute(
          "aria-label",
          "اختيار اللغة"
        );

        summary.title = "اختيار اللغة";

        summary.innerHTML =
          createIcon("globe");
      }
    }

    var contactLink =
      nav.querySelector("#basmaCtaBtn") ||
      nav.querySelector(".basma-cta") ||
      nav.querySelector(
        'a[href^="Contact.dc.html"],' +
        'a[href^="#homecontact"]'
      );

    if (
      whatsapp &&
      whatsapp.parentElement !== actions
    ) {
      actions.appendChild(whatsapp);
    }

    if (
      language &&
      language.parentElement !== actions
    ) {
      actions.appendChild(language);
    }

    if (
      contactLink &&
      contactLink.parentElement !== actions
    ) {
      actions.appendChild(contactLink);
    }

    setupActiveLink(center);
  }

  /* ========================================
     إنشاء ناف بار الجوال
  ======================================== */

  function setupMobileNavbar() {
    if (
      document.querySelector(
        ".basma-bottom-nav"
      )
    ) {
      return;
    }

    var mobileNav =
      document.createElement("nav");

    mobileNav.className =
      "basma-bottom-nav";

    mobileNav.setAttribute(
      "aria-label",
      "التنقل الرئيسي للهاتف"
    );

    var items = [
      {
        href: "index.html",
        label: "الرئيسية",
        icon: "home"
      },
      {
        href: "Services.dc.html",
        label: "خدماتنا",
        icon: "services"
      },
      {
        href: "Team.dc.html",
        label: "الفريق",
        icon: "team"
      },
      {
        href: "Partners.dc.html",
        label: "شركاؤنا",
        icon: "partners"
      },
      {
        href: "Contact.dc.html",
        label: "تواصل",
        icon: "contact"
      }
    ];

    var currentPage =
      (
        window.location.pathname
          .split("/")
          .pop() || "index.html"
      ).toLowerCase();

    items.forEach(function (item) {
      var link =
        document.createElement("a");

      link.href = item.href;

      link.setAttribute(
        "aria-label",
        item.label
      );

      link.innerHTML =
        createIcon(item.icon) +
        '<span class="basma-bottom-nav__label">' +
        item.label +
        "</span>";

      if (
        item.href.toLowerCase() ===
        currentPage
      ) {
        link.classList.add("is-active");

        link.setAttribute(
          "aria-current",
          "page"
        );
      }

      mobileNav.appendChild(link);
    });

    document.body.appendChild(mobileNav);
  }

  /* ========================================
     إضافة منصة X إلى الفوتر
  ======================================== */

  function setupFooterX() {
    var instagram =
      document.querySelector(
        'footer a[href*="instagram.com"]'
      );

    if (!instagram) {
      return;
    }

    var container =
      instagram.parentElement;

    if (
      container.querySelector(
        'a[href*="x.com/basmadigitalps"]'
      )
    ) {
      return;
    }

    var xLink =
      document.createElement("a");

    xLink.href =
      "https://x.com/basmadigitalps";

    xLink.target = "_blank";
    xLink.rel = "noopener";

    xLink.setAttribute(
      "aria-label",
      "بصمة على منصة X"
    );

    xLink.style.cssText =
      "width:36px;" +
      "height:36px;" +
      "border-radius:50%;" +
      "border:1px solid rgba(251,247,240,.25);" +
      "display:flex;" +
      "align-items:center;" +
      "justify-content:center;" +
      "color:#dcd6c8;" +
      "text-decoration:none;";

    xLink.innerHTML =
      '<svg viewBox="0 0 24 24" ' +
      'fill="currentColor" ' +
      'style="width:15px;height:15px">' +
      '<path d="M18.3 2H22l-8.1 9.2L23.4 22H16l-5.8-7.6L3.5 22H0l8.5-9.7L-.6 2H7l5.2 6.9L18.3 2Zm-1.3 18.1h2L5.9 3.8H3.8L17 20.1Z"></path>' +
      "</svg>";

    container.appendChild(xLink);
  }

  /* ========================================
     تعبئة نموذج التعاون
  ======================================== */

  function setupRequestedModel() {
    var params =
      new URLSearchParams(
        window.location.search
      );

    var requestedModel =
      params.get("model");

    var message =
      document.getElementById("bf-msg");

    if (!message) {
      return;
    }

    var labels = {
      monthly: "باقات شاملة شهرية",
      project: "مشروع تنفيذ لمرة واحدة",
      support: "عقد صيانة ودعم",
      consulting: "استشارة رقمية"
    };

    if (
      requestedModel &&
      labels[requestedModel] &&
      !message.value
    ) {
      message.value =
        "طريقة التعاون المطلوبة: " +
        labels[requestedModel] +
        "\n\n";

      message.setSelectionRange(
        message.value.length,
        message.value.length
      );
    }
  }

  /* ========================================
     مراقبة ظهور الأقسام
  ======================================== */

  function observeSection(
    sectionId,
    threshold
  ) {
    var section =
      document.getElementById(sectionId);

    if (!section) {
      return;
    }

    if (
      !("IntersectionObserver" in window)
    ) {
      section.classList.add("is-visible");
      return;
    }

    var observer =
      new IntersectionObserver(
        function (entries) {
          entries.forEach(
            function (entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add(
                  "is-visible"
                );

                observer.unobserve(
                  entry.target
                );
              }
            }
          );
        },
        {
          threshold: threshold
        }
      );

    observer.observe(section);
  }

  /* ========================================
     تشغيل الملف
  ======================================== */

  function setup() {
    loadChatbot();
    injectStyles();
    // setupNavbar() disabled: it auto-detected/moved nav elements via
    // heuristics and fought each page's own local nav markup+CSS,
    // causing duplicated/overlapping nav elements. Each page now ships
    // a consistent, static basma-nav-shell nav that needs no JS rewiring.
    setupMobileNavbar();
    setupFooterX();
    setupRequestedModel();

    observeSection("values", 0.15);
    observeSection("model", 0.18);
    observeSection("team", 0.18);
    observeSection("growth", 0.15);
    observeSection("services", 0.12);
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      setup,
      {
        once: true
      }
    );
  } else {
    setup();
  }
})();