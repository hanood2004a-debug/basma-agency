// Basma Digital — GA4 custom event tracking (v1.0)
//
// Extends the existing GA4 install (Measurement ID G-9Z7D1YFF79, already
// present once in <head> on all 19 public pages) with business-event
// tracking. This file does NOT load gtag.js and does NOT call
// gtag('config', ...) — it only ever calls gtag('event', ...) through the
// trackBasmaEvent() helper below, using the tag that's already on the page.
//
// Loaded once per public page, right after the Google tag block in <head>.
// Must NOT be added to any CRM page.
//
// ============================================================================
// 1. SHARED HELPER
// ============================================================================
// trackBasmaEvent(eventName, params) is the ONLY thing on this page that
// calls gtag(). It is deliberately paranoid:
//   - no-ops if gtag isn't a function (ad blockers, GA blocked, offline,
//     script load failure, or simply not yet defined) — never throws
//   - wrapped in try/catch — a GA failure can never break the site
//   - never receives free-text/user-entered values; every call site below
//     only passes generic, pre-defined, non-PII strings (page paths, a
//     small fixed vocabulary of location tags, and English slugs already
//     present in the markup)
(function () {
  "use strict";

  function trackBasmaEvent(eventName, params) {
    try {
      if (typeof window.gtag !== "function") return;
      window.gtag("event", eventName, params || {});
    } catch (e) {
      // Analytics must never break the site. Swallow silently, no console
      // noise either (a console.error here would itself count as a "JS
      // error" for anyone auditing the page).
    }
  }
  window.trackBasmaEvent = trackBasmaEvent;

  // ==========================================================================
  // 2. DEDUPLICATION STRATEGY (read this before changing anything below)
  // ==========================================================================
  // Everything click-based in this file uses ONE delegated listener on
  // `document`, registered exactly once (guarded by window.__basmaAnalyticsBound
  // below). This is deliberate, for several reasons specific to this site:
  //
  //   - Desktop nav, mobile hamburger menu, and footer each render their own
  //     copies of some controls (e.g. the WhatsApp link appears in the nav,
  //     a mid-page CTA, and the footer). A single delegated listener keyed
  //     off stable selectors/attributes catches all copies uniformly without
  //     needing a separate listener bound to each copy.
  //   - assets/i18n.js re-applies translations and can re-render/re-touch
  //     DOM nodes on language switch and on late-arriving content (it uses a
  //     MutationObserver). Per-element listeners would risk being silently
  //     dropped (if nodes are replaced) or double-bound (if init code reruns
  //     and re-queries the same nodes). A single document-level delegated
  //     listener is immune to both failure modes, because it never attaches
  //     to the target elements themselves — it only reads e.target at click
  //     time.
  //   - window.__basmaAnalyticsBound is an idempotency guard: if this script
  //     were ever accidentally included twice on the same page, the second
  //     copy's IIFE exits immediately instead of registering a second
  //     listener (which would double-fire every event).
  //   - Inside the handler, each category check ends with `return` on match,
  //     so one physical click can only ever match (and emit) one category.
  //   - This listener never calls stopPropagation()/preventDefault(), so it
  //     cannot interfere with any existing handler (language switcher,
  //     mobile menu toggle, portfolio modal, booking modal, form submit).
  //     Conversely, the one existing handler that DOES call
  //     stopPropagation() (Portfolio.dc.html's modal opener) only stops
  //     propagation to ancestor elements — it does not stop other listeners
  //     already registered directly on `document`, so this listener still
  //     fires for portfolio clicks regardless of registration order.
  //
  // contact_form_submit is NOT handled here — see assets/contact-submit.js,
  // which fires it exactly once, only after the backend confirms success
  // (see comment block there for why that file, not this one, owns it).
  if (window.__basmaAnalyticsBound) return;
  window.__basmaAnalyticsBound = true;

  function pagePath() {
    try {
      return window.location.pathname || "";
    } catch (e) {
      return "";
    }
  }

  // Generic, low-cardinality "where on the page" tag shared by whatsapp/
  // email/phone click tracking. Derived purely from DOM structure (which
  // landmark the link sits in), never from link text/content.
  function linkLocation(el) {
    try {
      if (el.closest("footer")) return "footer";
      if (el.closest("#basmaNav")) return "nav";
      if (el.closest("#basmaMobileMenu") || el.closest(".basma-mobile-nav")) return "mobile_nav";
      return "page_content";
    } catch (e) {
      return "page_content";
    }
  }

  // Turns "Web-Development.dc.html" (optionally with a trailing ?lang=xx
  // added by the language switcher's link rewriting) into "web-development".
  // Stable, English, derived from the filename that's already public in the
  // URL — never translated display text.
  function slugFromDcHtmlHref(href) {
    if (!href) return "unknown";
    var clean = href.split("?")[0].split("#")[0];
    var file = clean.split("/").pop() || "";
    var slug = file.replace(/\.dc\.html$/i, "");
    return slug ? slug.toLowerCase() : "unknown";
  }

  // Same idea as slugFromDcHtmlHref(), but derived from the CURRENT page's
  // own URL rather than a link's href. Used for service_request_click,
  // where the slug identifies "which service page was this CTA clicked on"
  // — always the current page for the two .svcp-cta-primary buttons (hero +
  // final CTA) on each of the 12 dedicated service pages. Deliberately
  // never derived from the Arabic ?service= query value or the button's
  // (translated) label text, so it stays identical across AR/EN/ES.
  function currentPageSlug() {
    try {
      var file = window.location.pathname.split("/").pop() || "";
      var slug = file.replace(/\.dc\.html$/i, "");
      return slug ? slug.toLowerCase() : "unknown";
    } catch (e) {
      return "unknown";
    }
  }

  // Turns ".../Services.dc.html?lang=en#svc-3" into "svc-3". The hash is
  // always the last segment of a URL, so this is unaffected by the
  // language switcher inserting ?lang= before it.
  function slugFromHash(href) {
    if (!href) return "";
    var hash = href.split("#")[1] || "";
    return hash.toLowerCase();
  }

  // Portfolio cards carry a stable, English data-category (web/apps/design/
  // identity/content) but their data-slug is the project's (translated,
  // Arabic) display name — not something we send to GA. Instead we build a
  // non-PII identifier from the category plus the card's 1-based position
  // among cards of that same category, e.g. "web-2".
  function portfolioSlug(card) {
    if (!card) return "unknown";
    var category = card.getAttribute("data-category") || "unknown";
    try {
      var sameCategory = document.querySelectorAll('.portfolio-card[data-category="' + category + '"]');
      var idx = Array.prototype.indexOf.call(sameCategory, card);
      return idx > -1 ? category + "-" + (idx + 1) : category;
    } catch (e) {
      return category;
    }
  }

  // Matches the site's "-cta-primary" naming convention (about-cta-primary,
  // portfolio-cta-primary, services-cta-primary, svc-hero-cta-primary,
  // svcp-cta-primary, team-cta-primary, ...) used consistently across pages
  // for the page's main "Request a Proposal" style CTA.
  var CTA_PRIMARY_RE = /(?:^|\s)([a-z0-9-]+)-cta-primary(?:\s|$)/i;

  // Returns { el, location } if `el` (or an ancestor <a>) is a "request a
  // proposal" style CTA, else null. Deliberately excludes in-page-only
  // anchors like Portfolio's "#portfolioGrid" scroll link, which shares the
  // -cta-primary class but isn't a proposal request.
  function matchProposalCta(el) {
    var a = el.closest("a");
    if (!a) return null;
    var href = a.getAttribute("href") || "";
    var goesToContactFlow = href.indexOf("Contact.dc.html") !== -1 || href.indexOf("#homecontact") !== -1;
    if (!goesToContactFlow) return null;

    var cls = a.className || "";
    var m = CTA_PRIMARY_RE.exec(cls);
    if (m) return { el: a, location: m[1] };

    if (a.classList && a.classList.contains("svc-cta-btn")) {
      return { el: a, location: "service_page_cta" };
    }
    if (a.getAttribute("data-i18n") === "hero.cta1") {
      return { el: a, location: "home_hero" };
    }
    return null;
  }

  document.addEventListener(
    "click",
    function (e) {
      var el = e.target;
      if (!el || typeof el.closest !== "function") return;

      // WhatsApp — any link to wa.me anywhere on the page (nav, mid-page
      // CTA, footer icon). No phone number or prefilled message is sent.
      var wa = el.closest('a[href*="wa.me/"]');
      if (wa) {
        trackBasmaEvent("whatsapp_click", { page_path: pagePath(), link_location: linkLocation(wa) });
        return;
      }

      // mailto: — recipient address is never sent.
      var mail = el.closest('a[href^="mailto:"]');
      if (mail) {
        trackBasmaEvent("email_click", { page_path: pagePath(), link_location: linkLocation(mail) });
        return;
      }

      // tel: — phone number is never sent.
      var tel = el.closest('a[href^="tel:"]');
      if (tel) {
        trackBasmaEvent("phone_click", { page_path: pagePath(), link_location: linkLocation(tel) });
        return;
      }

      // Booking / appointment — existing shared attribute from
      // assets/booking-widget.js ([data-booking-open]). No date/time/name/
      // service text is sent; this only marks that the flow was opened.
      var booking = el.closest("[data-booking-open]");
      if (booking) {
        trackBasmaEvent("booking_click", { page_path: pagePath(), cta_location: linkLocation(booking) });
        return;
      }

      // Portfolio / work item open (Portfolio.dc.html's case-study button).
      var portfolioBtn = el.closest(".portfolio-details-btn");
      if (portfolioBtn) {
        var card = portfolioBtn.closest(".portfolio-card");
        trackBasmaEvent("portfolio_click", { page_path: pagePath(), project_slug: portfolioSlug(card) });
        return;
      }

      // Service detail navigation — Services.dc.html's grid links out to a
      // specific service's own page (Web-Development.dc.html, etc).
      var svcDetail = el.closest(".svc-detail-link");
      if (svcDetail) {
        trackBasmaEvent("service_click", {
          page_path: pagePath(),
          service_slug: slugFromDcHtmlHref(svcDetail.getAttribute("href")),
          link_location: "services_grid",
        });
        return;
      }

      // Home page service teaser cards -> Services.dc.html#svc-N anchor.
      var svcLink = el.closest('a[href*="Services.dc.html"]');
      if (svcLink) {
        var hash = slugFromHash(svcLink.getAttribute("href"));
        if (hash.indexOf("svc-") === 0) {
          trackBasmaEvent("service_click", {
            page_path: pagePath(),
            service_slug: hash,
            link_location: "home_services_teaser",
          });
          return;
        }
        // else: a plain nav-style link to the Services listing page itself
        // (no specific service selected) — intentionally not tracked as
        // service_click, since no specific service was targeted.
      }

      // Service-request CTA on one of the 12 dedicated service pages (the
      // two .svcp-cta-primary buttons: hero + final CTA, both labeled
      // "اطلب هذه الخدمة"). Tracked as its own service_request_click event
      // with a stable English slug, and checked BEFORE matchProposalCta()
      // below — .svcp-cta-primary also matches CTA_PRIMARY_RE ("svcp" +
      // "-cta-primary"), so without this early return + return statement
      // these clicks would double-fire as proposal_click too. This keeps
      // the "one physical click -> one business event" guarantee.
      var svcpPrimary = el.closest("a.svcp-cta-primary");
      if (svcpPrimary) {
        trackBasmaEvent("service_request_click", {
          page_path: pagePath(),
          service_slug: currentPageSlug(),
          cta_location: svcpPrimary.closest(".svcp-hero")
            ? "hero"
            : svcpPrimary.closest(".svcp-final-cta")
            ? "final_cta"
            : "page_content",
        });
        return;
      }

      // Request a Proposal family (page hero CTAs + per-service "request
      // this service" buttons that land on the contact flow).
      var proposal = matchProposalCta(el);
      if (proposal) {
        trackBasmaEvent("proposal_click", { page_path: pagePath(), cta_location: proposal.location });
        return;
      }

      // Contact Us / Get in touch nav CTA (id="basmaCtaBtn", one per page).
      var contactCta = el.closest("#basmaCtaBtn");
      if (contactCta) {
        trackBasmaEvent("contact_click", { page_path: pagePath(), cta_location: "nav" });
        return;
      }
    },
    false
  );
})();
