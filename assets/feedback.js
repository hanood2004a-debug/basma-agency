(function initFeedback() {
  "use strict";
  const DISMISSED_KEY = "feedbackDismissedAt";
  const SUBMITTED_KEY = "feedbackSubmitted";
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  let bookingReference = null;

  function suppressForSevenDays() { localStorage.setItem(DISMISSED_KEY, String(Date.now())); }
  function stars(value) { return "★".repeat(value) + "☆".repeat(5 - value); }
  function firstName(value) { return String(value || "عميل بصمة").trim().split(/\s+/)[0].slice(0, 30); }
  function modal() { return document.getElementById("basmaFeedbackModal"); }

  function currentLang() { return window.getBasmaLang ? window.getBasmaLang() : "ar"; }

  function ratingSummaryText(average, count) {
    const lang = currentLang();
    if (lang !== "ar") {
      const dict = (window.translations && window.translations[lang]) || {};
      const template = dict["feedback.ratingSummary"];
      if (template) {
        return template.replace("{avg}", average).replace("{count}", count);
      }
    }
    return `${average} من 5 · ${count} تقييم`;
  }

  function feedbackSuccessText(serverMessage) {
    const lang = currentLang();
    if (lang !== "ar") {
      const dict = (window.translations && window.translations[lang]) || {};
      if (dict["feedback.successGeneric"]) return dict["feedback.successGeneric"];
    }
    return serverMessage;
  }

  function closeModal() { if (modal()) { modal().hidden = true; modal().setAttribute("aria-hidden", "true"); } }
  function postpone() { suppressForSevenDays(); closeModal(); }

  async function loadPublished() {
    const grid = document.getElementById("basmaFeedbackGrid");
    if (!grid) return;
    try {
      const response = await fetch("/api/feedback", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("load_failed");
      const result = await response.json();
      document.getElementById("basmaFeedbackSummary").textContent = result.count
        ? ratingSummaryText(result.average, result.count)
        : "بانتظار أول تقييم منشور";
      grid.replaceChildren();
      if (!result.items.length) { const empty=document.createElement("p"); empty.className="basma-feedback-empty"; empty.textContent="ستظهر هنا آراء العملاء بعد مراجعتها."; grid.appendChild(empty); return; }
      result.items.forEach((item) => {
        const card = document.createElement("article"); card.className = "basma-feedback-card";
        const top = document.createElement("div"); top.className = "basma-feedback-card__top";
        const name = document.createElement("strong"); name.textContent = firstName(item.name);
        const rating = document.createElement("span"); rating.className="basma-feedback-card__stars"; rating.setAttribute("aria-label", `${item.rating} من 5`); rating.textContent=stars(Number(item.rating));
        top.append(name, rating); card.appendChild(top);
        if (item.verified) { const badge=document.createElement("span"); badge.className="basma-feedback-verified"; badge.textContent="عميل موثّق"; card.appendChild(badge); }
        if (item.comment) { const comment=document.createElement("p"); comment.textContent=item.comment; card.appendChild(comment); }
        if (item.admin_reply) { const reply=document.createElement("p"); reply.className="basma-feedback-reply"; const replyLabel=document.createElement("strong"); replyLabel.textContent="رد بصمة:"; reply.appendChild(replyLabel); reply.appendChild(document.createTextNode(" " + item.admin_reply)); card.appendChild(reply); }
        grid.appendChild(card);
      });
    } catch (_) {
      grid.textContent = "تعذر تحميل الآراء حاليًا.";
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById("basmaFeedbackStatus");
    const rating = Number(new FormData(form).get("rating"));
    if (!rating) { status.textContent = "اختر عدد النجوم أولًا."; return; }
    const submitButton = form.querySelector("button[type=submit]"); submitButton.disabled = true;
    try {
      const response = await fetch("/api/feedback", {
        method:"POST", headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({ name:form.elements.name.value, rating, comment:form.elements.comment.value, booking_reference:bookingReference })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "تعذر الإرسال.");
      status.textContent = feedbackSuccessText(result.message);
      localStorage.setItem(SUBMITTED_KEY, "true");
      localStorage.removeItem(DISMISSED_KEY);
      setTimeout(closeModal, 1200);
    } catch (error) { status.textContent = error.message || "تعذر الإرسال حاليًا."; submitButton.disabled = false; }
  }

  function watchBookingSuccess() {
    const observer = new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const text = node.textContent || "";
      const match = text.match(/(?:رقم الحجز|Booking reference|Referencia)\s*:\s*([A-Z0-9-]+)/i);
      if (match) bookingReference = match[1];
    })));
    observer.observe(document.body, { childList:true, subtree:true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadPublished(); watchBookingSuccess();
    document.getElementById("basmaFeedbackForm")?.addEventListener("submit", submit);
    document.getElementById("basmaFeedbackLater")?.addEventListener("click", postpone);
  });
})();
