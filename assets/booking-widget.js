// Shared appointment-booking client logic, used identically by every page
// that offers the "احجز استشارة" CTA (currently the Home page and the
// standalone Contact page). Reuses the existing GET /api/appointments
// endpoint (already built, already tested) for real-time slot availability,
// and posts confirmed bookings to the new POST /api/book-appointment
// endpoint, which links everything into Basma CRM server-side.
//
// This module owns booking LOGIC only — it never creates or styles any DOM.
// Each page supplies its own modal markup (reusing the existing
// .basma-feedback-modal / .basma-feedback-dialog / .basma-feedback-field
// classes already established on the site) and wires this module's
// functions to its own elements.
(function () {
  "use strict";

  function currentLang() {
    return window.getBasmaLang ? window.getBasmaLang() : "ar";
  }

  function dict() {
    return (window.translations && window.translations[currentLang()]) || {};
  }

  // Returns { ok, availableTimes, error }
  async function fetchAvailability(date) {
    try {
      var response = await fetch("/api/appointments?date=" + encodeURIComponent(date), {
        headers: { Accept: "application/json" },
      });
      var data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || data.error) {
        return {
          ok: false,
          availableTimes: [],
          error: data.error === "Friday is a holiday" ? dict()["booking.friday"] || "يوم الجمعة غير متاح للحجز." : dict()["booking.loadError"] || "تعذّر تحميل الأوقات المتاحة.",
        };
      }
      return { ok: true, availableTimes: data.availableTimes || [] };
    } catch (e) {
      return { ok: false, availableTimes: [], error: dict()["booking.loadError"] || "تعذّر تحميل الأوقات المتاحة." };
    }
  }

  // fields: { name, email, phone, company, service, appointment_date, appointment_time, notes }
  // Returns { ok, message, bookingReference }
  async function submitBooking(fields) {
    var name = String((fields && fields.name) || "").trim();
    var email = String((fields && fields.email) || "").trim();
    var phone = String((fields && fields.phone) || "").trim();
    var company = String((fields && fields.company) || "").trim();
    var service = String((fields && fields.service) || "");
    var appointmentDate = String((fields && fields.appointment_date) || "");
    var appointmentTime = String((fields && fields.appointment_time) || "");
    var notes = String((fields && fields.notes) || "").trim();

    if (!name || !email || !phone || !service || !appointmentDate || !appointmentTime) {
      return { ok: false, message: dict()["booking.validationError"] || "الرجاء تعبئة كل الحقول المطلوبة واختيار موعد." };
    }

    try {
      var response = await fetch("/api/book-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          company: company,
          service: service,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          notes: notes,
        }),
      });
      var data = await response.json().catch(function () {
        return {};
      });

      if (!response.ok) {
        var errMsg =
          currentLang() === "ar"
            ? data.error || "تعذّر إتمام الحجز حاليًا. حاول مرة أخرى لاحقًا أو تواصل معنا عبر واتساب."
            : dict()["booking.errorGeneric"] || "Something went wrong. Please try again.";
        return { ok: false, message: errMsg };
      }

      var okMsg =
        currentLang() === "ar"
          ? data.message || "تم تأكيد حجزك بنجاح."
          : (dict()["booking.success"] || "Your booking is confirmed. Reference: {ref}").replace("{ref}", data.bookingReference || "");
      return { ok: true, message: okMsg, bookingReference: data.bookingReference };
    } catch (networkError) {
      var netMsg =
        currentLang() === "ar"
          ? "تعذّر إتمام الحجز حاليًا. تأكد من اتصالك بالإنترنت أو تواصل معنا عبر واتساب."
          : dict()["booking.errorGeneric"] || "Something went wrong. Please try again.";
      return { ok: false, message: netMsg };
    }
  }

  function isClientSideFriday(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    return new Date(dateStr + "T12:00:00Z").getUTCDay() === 5;
  }

  // Auto-wires a booking modal if the page provides one using the standard
  // element IDs below. Both the Home page and the Contact page use these
  // exact IDs, so this single init function drives identical open/close,
  // date→time availability loading, and submit behavior on both — no
  // per-page wiring code needed, so there is nothing to drift apart.
  function initBookingWidget() {
    var openBtns = document.querySelectorAll('[data-booking-open]');
    var modal = document.getElementById("basmaBookingModal");
    if (!openBtns.length || !modal) return;

    var form = document.getElementById("basmaBookingForm");
    var closeBtn = document.getElementById("bk-cancel");
    var dateInput = document.getElementById("bk-date");
    var timeSelect = document.getElementById("bk-time");
    var statusBox = document.getElementById("bk-status");
    var submitBtn = document.getElementById("bk-submit");
    if (!form || !dateInput || !timeSelect || !submitBtn) return;
    var submitLabel = submitBtn.textContent;

    function openModal() {
      modal.hidden = false;
      modal.style.display = "grid";
      modal.setAttribute("aria-hidden", "false");
    }
    function closeModal() {
      modal.hidden = true;
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }
    function resetTimeSelect(placeholder) {
      timeSelect.innerHTML = '<option value="">' + placeholder + "</option>";
      timeSelect.disabled = true;
      timeSelect.value = "";
    }

    openBtns.forEach(function (btn) {
      btn.addEventListener("click", openModal);
    });
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    var todayStr = new Date().toISOString().slice(0, 10);
    dateInput.min = todayStr;

    dateInput.addEventListener("change", async function () {
      if (!dateInput.value) {
        resetTimeSelect(dict()["booking.selectDateFirst"] || "اختر التاريخ أولاً");
        return;
      }
      if (isClientSideFriday(dateInput.value)) {
        resetTimeSelect(dict()["booking.friday"] || "يوم الجمعة غير متاح للحجز");
        return;
      }
      resetTimeSelect(dict()["booking.loading"] || "جارٍ التحميل…");
      var result = await fetchAvailability(dateInput.value);
      if (!result.ok) {
        resetTimeSelect(result.error || dict()["booking.loadError"] || "تعذّر تحميل الأوقات المتاحة.");
        return;
      }
      if (!result.availableTimes.length) {
        resetTimeSelect(dict()["booking.noSlots"] || "لا توجد أوقات متاحة في هذا اليوم.");
        return;
      }
      timeSelect.innerHTML =
        '<option value="">' + (dict()["booking.selectTime"] || "اختر الوقت") + "</option>" +
        result.availableTimes.map(function (t) { return '<option value="' + t + '">' + t + "</option>"; }).join("");
      timeSelect.disabled = false;
    });

    var isSubmitting = false;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (isSubmitting) return; // guards against a second "submit" event (e.g. double Enter) firing mid-request
      isSubmitting = true;
      if (statusBox) {
        statusBox.textContent = "";
      }
      submitBtn.disabled = true;
      submitBtn.textContent = dict()["booking.submitting"] || "جارٍ الحجز…";

      var result = await submitBooking({
        name: document.getElementById("bk-name") ? document.getElementById("bk-name").value : "",
        email: document.getElementById("bk-email") ? document.getElementById("bk-email").value : "",
        phone: document.getElementById("bk-phone") ? document.getElementById("bk-phone").value : "",
        company: document.getElementById("bk-company") ? document.getElementById("bk-company").value : "",
        service: document.getElementById("bk-service") ? document.getElementById("bk-service").value : "",
        appointment_date: dateInput.value,
        appointment_time: timeSelect.value,
        notes: document.getElementById("bk-notes") ? document.getElementById("bk-notes").value : "",
      });

      isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;

      if (statusBox) {
        statusBox.textContent = result.message;
        statusBox.style.color = result.ok ? "#72c79a" : "#e59a9a";
      }

      if (result.ok) {
        form.reset();
        resetTimeSelect(dict()["booking.selectDateFirst"] || "اختر التاريخ أولاً");
        setTimeout(closeModal, 3200);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBookingWidget);
  } else {
    initBookingWidget();
  }

  window.Basma = window.Basma || {};
  window.Basma.fetchAvailability = fetchAvailability;
  window.Basma.submitBooking = submitBooking;
})();
