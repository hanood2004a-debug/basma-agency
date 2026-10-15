const MAX_BODY_BYTES = 4096;

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function config() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function headers(settings, extra = {}) {
  return { apikey: settings.key, Authorization: `Bearer ${settings.key}`, ...extra };
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

async function listPublished(settings) {
  const query = new URLSearchParams({
    select: "name,rating,comment,verified,admin_reply,published_at",
    status: "eq.approved",
    order: "published_at.desc",
    limit: "6"
  });
  const response = await fetch(`${settings.url}/rest/v1/feedback?${query}`, { headers: headers(settings) });
  if (!response.ok) throw Object.assign(new Error("SUPABASE_READ_FAILED"), { status: response.status });
  const items = await response.json();
  const aggregateQuery = new URLSearchParams({ select: "rating", status: "eq.approved" });
  const aggregateResponse = await fetch(`${settings.url}/rest/v1/feedback?${aggregateQuery}`, { headers: headers(settings) });
  if (!aggregateResponse.ok) throw Object.assign(new Error("SUPABASE_AGGREGATE_FAILED"), { status: aggregateResponse.status });
  const ratings = await aggregateResponse.json();
  const count = ratings.length;
  const average = count ? ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / count : 0;
  return { average: Number(average.toFixed(1)), count, items };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const settings = config();
  if (!settings) return send(res, 503, { error: "خدمة التقييم غير متاحة حاليًا." });

  try {
    if (req.method === "GET") return send(res, 200, await listPublished(settings));
    if (req.method !== "POST") return send(res, 405, { error: "طريقة الطلب غير مسموحة." });

    const rawLength = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
    if (rawLength > MAX_BODY_BYTES) return send(res, 413, { error: "حجم الطلب أكبر من المسموح." });

    const rating = Number(req.body?.rating);
    const name = cleanText(req.body?.name, 60);
    const comment = cleanText(req.body?.comment, 500);
    const bookingReference = cleanText(req.body?.booking_reference, 80);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return send(res, 400, { error: "اختر تقييمًا صحيحًا من نجمة إلى خمس نجوم." });
    }

    const response = await fetch(`${settings.url}/rest/v1/feedback`, {
      method: "POST",
      headers: headers(settings, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ name, rating, comment, booking_reference: bookingReference, status: "pending" })
    });
    if (!response.ok) throw Object.assign(new Error("SUPABASE_INSERT_FAILED"), { status: response.status });
    return send(res, 201, { success: true, message: "شكرًا لك. تم إرسال تقييمك للمراجعة." });
  } catch (error) {
    console.error("Feedback API error", { code: error.message, status: error.status || 500 });
    return send(res, 500, { error: "تعذر إرسال التقييم حاليًا. حاول مرة أخرى لاحقًا." });
  }
};

