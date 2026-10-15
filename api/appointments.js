const crypto = require("node:crypto");

const TIME_ZONE = "Asia/Gaza";
const OPEN_MINUTES = 10 * 60;
const CLOSE_MINUTES = 19 * 60;
const DURATION_MINUTES = 30;
const ACTIVE_STATUSES = ["pending", "confirmed"];

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function serverConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function isTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function minutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isValidSlot(value) {
  if (!isTime(value)) return false;
  const total = minutes(value);
  return total >= OPEN_MINUTES && total + DURATION_MINUTES <= CLOSE_MINUTES && total % DURATION_MINUTES === 0;
}

function isFriday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 5;
}

function gazaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function isPast(date, time) {
  const now = gazaNow();
  return date < now.date || (date === now.date && minutes(time) <= minutes(now.time));
}

function allSlots() {
  const slots = [];
  for (let total = OPEN_MINUTES; total + DURATION_MINUTES <= CLOSE_MINUTES; total += DURATION_MINUTES) {
    slots.push(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
  }
  return slots;
}

async function bookedTimes(config, date) {
  const query = new URLSearchParams({
    select: "appointment_time",
    appointment_date: `eq.${date}`,
    status: `in.(${ACTIVE_STATUSES.join(",")})`,
  });
  const response = await fetch(`${config.url}/rest/v1/appointments?${query}`, {
    headers: supabaseHeaders(config),
  });
  if (!response.ok) throw new Error(`SUPABASE_READ_${response.status}`);
  const rows = await response.json();
  return new Set(rows.map((row) => String(row.appointment_time).slice(0, 5)));
}

async function availability(config, date) {
  if (!isDate(date)) return { error: "Invalid date" };
  if (isFriday(date)) return { error: "Friday is a holiday", availableTimes: [] };
  const occupied = await bookedTimes(config, date);
  const availableTimes = allSlots().filter((time) => !occupied.has(time) && !isPast(date, time));
  return { date, durationMinutes: DURATION_MINUTES, timeZone: TIME_ZONE, availableTimes };
}

function bookingReference() {
  return `BASMA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const config = serverConfig();
    if (!config) return send(res, 503, { error: "Appointments service is not configured" });

    if (req.method === "GET") {
      const date = clean(req.query?.date, 10);
      const result = await availability(config, date);
      return send(res, result.error ? 400 : 200, result);
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const name = clean(body.name, 80);
    const whatsapp = clean(body.whatsapp, 24);
    const service = clean(body.service, 120);
    const appointmentDate = clean(body.appointment_date, 10);
    const appointmentTime = clean(body.appointment_time, 5);

    if (name.length < 2 || service.length < 2 || !/^\+?[0-9\s-]{7,24}$/.test(whatsapp)) {
      return send(res, 400, { error: "Invalid booking details" });
    }
    if (!isDate(appointmentDate) || isFriday(appointmentDate) || !isValidSlot(appointmentTime) || isPast(appointmentDate, appointmentTime)) {
      return send(res, 400, { error: "Invalid or unavailable appointment time" });
    }

    const currentAvailability = await availability(config, appointmentDate);
    if (!currentAvailability.availableTimes.includes(appointmentTime)) {
      return send(res, 409, { error: "Appointment time is already booked" });
    }

    const reference = bookingReference();
    const record = {
      name,
      whatsapp,
      service,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      duration_minutes: DURATION_MINUTES,
      status: "pending",
      booking_reference: reference,
    };
    const response = await fetch(`${config.url}/rest/v1/appointments`, {
      method: "POST",
      headers: supabaseHeaders(config, { Prefer: "return=representation" }),
      body: JSON.stringify(record),
    });
    if (response.status === 409) return send(res, 409, { error: "Appointment time is already booked" });
    if (!response.ok) {
      console.error("Appointments save error", { status: response.status });
      return send(res, 502, { error: "Unable to save appointment" });
    }
    const rows = await response.json();
    return send(res, 201, { bookingReference: rows[0]?.booking_reference || reference, status: "pending" });
  } catch (error) {
    console.error("Appointments handler error", { code: error?.code || error?.name || "unknown" });
    return send(res, 500, { error: "Appointments service failed safely" });
  }
};

// Exposed so other server-side endpoints (e.g. api/book-appointment.js) can
// reuse the exact same slot/working-hours rules instead of redefining them.
// Purely additive — does not change this handler's own request/response
// behavior in any way.
module.exports.helpers = {
  serverConfig,
  supabaseHeaders,
  isDate,
  isTime,
  minutes,
  isValidSlot,
  isFriday,
  gazaNow,
  isPast,
  allSlots,
  bookedTimes,
  availability,
  bookingReference,
  clean,
  TIME_ZONE,
  DURATION_MINUTES,
  ACTIVE_STATUSES,
};
