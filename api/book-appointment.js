// Public appointment booking → Basma CRM + existing appointments table.
//
// Reuses the exact slot/working-hours rules already defined in
// api/appointments.js (imported via its .helpers export) instead of
// redefining them, so the two endpoints can never drift apart.
//
// Order of operations matters for correctness under concurrent requests:
//   1) Validate input.
//   2) Pre-check availability (fast, friendly failure for the common case).
//   3) Atomically CLAIM the slot by inserting into public.appointments FIRST.
//      That table has a partial unique index on (appointment_date,
//      appointment_time) for active statuses — Supabase/PostgREST returns
//      409 on a real collision, which is the actual race-condition-safe
//      guarantee (the earlier pre-check is best-effort only).
//   4) Only after the slot is safely claimed, find-or-create the CRM
//      Company/Contact/Lead, create the crm_meetings row, and log an
//      activity. If a CRM step fails after the appointment was claimed,
//      the appointment itself remains correctly reserved (safer failure
//      mode than the reverse: never double-book a slot).
//
// Runs server-side only, using SUPABASE_SERVICE_ROLE_KEY. Never exposed to
// the browser. Never touches RLS-restricted CRM UI code paths.
const appointments = require("./appointments.js");
const {
  serverConfig,
  supabaseHeaders,
  isDate,
  isFriday,
  isValidSlot,
  isPast,
  availability,
  bookingReference,
  clean,
} = appointments.helpers;
const { notifyNewBooking } = require("./_notify.js");

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
  return typeof value === "string" && /^[0-9+\s()-]{6,30}$/.test(value);
}

// Converts a Gaza-local wall-clock date+time into an accurate UTC ISO
// instant, without assuming a fixed UTC offset (safe across any DST rules
// Asia/Gaza may follow). Standard iterative correction using Intl.
function gazaWallClockToUtcIso(dateStr, timeStr) {
  var target = new Date(`${dateStr}T${timeStr}:00Z`).getTime();
  var guess = target;
  for (var i = 0; i < 3; i++) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Gaza",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    var values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    var gotUtcMs = Date.parse(
      `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}Z`
    );
    var diff = target - gotUtcMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

async function restGet(config, table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${config.url}/rest/v1/${table}?${query}`, { headers: supabaseHeaders(config) });
  if (!response.ok) throw Object.assign(new Error(`SUPABASE_${table.toUpperCase()}_LOOKUP_FAILED`), { status: response.status });
  return response.json();
}

async function restInsert(config, table, payload, extraHeaders) {
  const response = await fetch(`${config.url}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders(config, Object.assign({ "Content-Type": "application/json", Prefer: "return=representation" }, extraHeaders || {})),
    body: JSON.stringify(payload),
  });
  return response;
}

async function findOrCreateCompany(config, name) {
  if (!name) return null;
  const existing = await restGet(config, "crm_companies", { select: "id", name: `ilike.${name}`, limit: "1" });
  if (existing[0]) return existing[0];
  const response = await restInsert(config, "crm_companies", { name });
  if (!response.ok) throw Object.assign(new Error("SUPABASE_COMPANY_INSERT_FAILED"), { status: response.status });
  const rows = await response.json();
  return rows[0];
}

async function findOrCreateContact(config, { name, email, phone, companyId }) {
  const existing = await restGet(config, "crm_contacts", { select: "id,company_id", email: `ilike.${email}`, limit: "1" });
  if (existing[0]) return existing[0];
  const response = await restInsert(config, "crm_contacts", {
    full_name: name,
    email,
    phone: phone || null,
    company_id: companyId || null,
  });
  if (!response.ok) throw Object.assign(new Error("SUPABASE_CONTACT_INSERT_FAILED"), { status: response.status });
  const rows = await response.json();
  return rows[0];
}

async function findOpenLeadForContact(config, contactId) {
  const rows = await restGet(config, "crm_leads", {
    select: "id",
    contact_id: `eq.${contactId}`,
    status: "eq.open",
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const config = serverConfig();
  if (!config) return send(res, 503, { error: "خدمة الحجز غير متاحة حاليًا." });

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "طريقة الطلب غير مسموحة." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const name = clean(body.name, 80);
    const email = clean(body.email, 120);
    const phone = clean(body.phone, 24);
    const company = clean(body.company, 120);
    const service = clean(body.service, 120);
    const notes = clean(body.notes, 1000);
    const appointmentDate = clean(body.appointment_date, 10);
    const appointmentTime = clean(body.appointment_time, 5);

    if (!name || name.length < 2) return send(res, 400, { error: "الاسم مطلوب." });
    if (!email || !isValidEmail(email)) return send(res, 400, { error: "الرجاء إدخال بريد إلكتروني صالح." });
    if (!phone || !isValidPhone(phone)) return send(res, 400, { error: "الرجاء إدخال رقم هاتف صالح." });
    if (!service) return send(res, 400, { error: "الرجاء اختيار الخدمة المطلوبة." });
    if (!isDate(appointmentDate)) return send(res, 400, { error: "تاريخ غير صالح." });
    if (isFriday(appointmentDate)) return send(res, 400, { error: "يوم الجمعة غير متاح للحجز، الرجاء اختيار يوم آخر (السبت إلى الخميس)." });
    if (!isValidSlot(appointmentTime)) {
      return send(res, 400, { error: "الوقت المحدد غير صالح. الحجز متاح من 10:00 صباحًا حتى 7:00 مساءً، على الساعة أو نصف الساعة فقط." });
    }
    if (isPast(appointmentDate, appointmentTime)) return send(res, 400, { error: "لا يمكن حجز موعد في وقت فائت." });

    const currentAvailability = await availability(config, appointmentDate);
    if (!currentAvailability.availableTimes.includes(appointmentTime)) {
      return send(res, 409, { error: "عذرًا، هذا الموعد أصبح محجوزًا. الرجاء اختيار وقت آخر." });
    }

    // Step 3: atomically claim the slot first — this is the real
    // collision-safety guarantee (relies on the DB's partial unique index).
    const reference = bookingReference();
    const appointmentPayload = {
      name,
      whatsapp: phone,
      service,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      duration_minutes: 30,
      status: "pending",
      booking_reference: reference,
    };
    const appointmentResponse = await restInsert(config, "appointments", appointmentPayload);
    if (appointmentResponse.status === 409) {
      return send(res, 409, { error: "عذرًا، هذا الموعد أصبح محجوزًا للتو. الرجاء اختيار وقت آخر." });
    }
    if (!appointmentResponse.ok) {
      console.error("Book-appointment: appointments insert failed", { status: appointmentResponse.status });
      return send(res, 502, { error: "تعذّر حجز الموعد حاليًا. حاول مرة أخرى لاحقًا." });
    }
    const appointmentRows = await appointmentResponse.json();
    const finalReference = appointmentRows[0]?.booking_reference || reference;

    // Step 4: link into the CRM. The slot is already safely reserved at
    // this point regardless of what happens below.
    let leadId = null;
    let linkedCompanyId = null;
    let linkedContactId = null;
    try {
      const companyRow = await findOrCreateCompany(config, company);
      const contactRow = await findOrCreateContact(config, {
        name,
        email,
        phone,
        companyId: companyRow ? companyRow.id : null,
      });
      const contactCompanyId = companyRow ? companyRow.id : contactRow.company_id || null;
      linkedCompanyId = contactCompanyId;
      linkedContactId = contactRow.id;

      const existingOpenLead = await findOpenLeadForContact(config, contactRow.id);
      if (existingOpenLead) {
        leadId = existingOpenLead.id;
      } else {
        const leadResponse = await restInsert(config, "crm_leads", {
          title: `${name} — ${service}`,
          source: "Website Booking",
          service_interest: service,
          contact_id: contactRow.id,
          company_id: contactCompanyId,
        });
        if (!leadResponse.ok) throw Object.assign(new Error("SUPABASE_LEAD_INSERT_FAILED"), { status: leadResponse.status });
        const leadRows = await leadResponse.json();
        leadId = leadRows[0].id;
      }

      const scheduledAtIso = gazaWallClockToUtcIso(appointmentDate, appointmentTime);
      const meetingResponse = await restInsert(config, "crm_meetings", {
        lead_id: leadId,
        contact_id: contactRow.id,
        company_id: contactCompanyId,
        title: `استشارة: ${service}`,
        meeting_type: "call",
        scheduled_at: scheduledAtIso,
        duration_minutes: 30,
        notes: notes || null,
        status: "scheduled",
      });
      if (!meetingResponse.ok) throw Object.assign(new Error("SUPABASE_MEETING_INSERT_FAILED"), { status: meetingResponse.status });

      await restInsert(config, "crm_activities", {
        lead_id: leadId,
        contact_id: contactRow.id,
        company_id: contactCompanyId,
        activity_type: "meeting",
        subject: `تم حجز استشارة بتاريخ ${appointmentDate} الساعة ${appointmentTime}`,
        details: notes || null,
      });
    } catch (crmError) {
      // The appointment itself is already safely booked (see step 3), so we
      // do NOT fail the visitor's request — but we log loudly server-side
      // so this can be reconciled manually in the CRM if needed.
      console.error("Book-appointment: CRM linking failed after appointment was claimed", {
        code: crmError.message,
        status: crmError.status || 500,
        bookingReference: finalReference,
      });
    }

    // Admin email notification — fires for every successfully CLAIMED
    // booking (the atomic insert above already guarantees this can only
    // happen once per real appointment, so this is inherently duplicate-
    // safe on retries; the crm_activities marker in _notify.js is a second,
    // independent layer of protection). Sent even if CRM linking above
    // failed, since the admin needs to know about the booking regardless.
    // Never allowed to affect the response already prepared below.
    try {
      await notifyNewBooking({
        leadId,
        name,
        email,
        phone,
        company,
        service,
        appointmentDate,
        appointmentTime,
        bookingReference: finalReference,
        companyId: linkedCompanyId,
        contactId: linkedContactId,
      });
    } catch (notifyError) {
      console.error("Book-appointment: admin notification failed", { code: notifyError.message, bookingReference: finalReference });
    }

    return send(res, 201, {
      success: true,
      bookingReference: finalReference,
      message: `تم تأكيد حجزك بنجاح. رقم الحجز: ${finalReference}. سنتواصل معك قريبًا لتأكيد الموعد.`,
    });
  } catch (error) {
    console.error("Book-appointment API error", { code: error.message, status: error.status || 500 });
    return send(res, 500, { error: "تعذّر حجز الموعد حاليًا. حاول مرة أخرى لاحقًا أو تواصل معنا عبر واتساب." });
  }
};
