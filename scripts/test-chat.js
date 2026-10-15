const assert = require("assert");
const handler = require("../api/chat");

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function run() {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousFetch = global.fetch;

  delete process.env.GEMINI_API_KEY;
  let response = responseRecorder();
  await handler({ method: "POST", headers: {}, socket: {}, body: { message: "مرحبا" } }, response);
  assert.equal(response.statusCode, 503);

  process.env.GEMINI_API_KEY = "test-only";
  delete process.env.GEMINI_MODEL;
  global.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
    );
    assert.equal(new URL(url).search, "");
    assert.equal(options.headers["x-goog-api-key"], "test-only");
    assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.contents.at(-1).parts[0].text, "ما خدماتكم؟");
    assert.ok(payload.systemInstruction.parts[0].text.includes("بصمة للحلول الرقمية"));
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "نقدم خدمات رقمية " }, { text: "متكاملة." }] } }],
      }),
    };
  };

  response = responseRecorder();
  await handler(
    {
      method: "POST",
      headers: { "x-forwarded-for": "chat-test-ip" },
      socket: {},
      body: { message: "ما خدماتكم؟", history: [] },
    },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.reply, "نقدم خدمات رقمية متكاملة.");

  global.fetch = previousFetch;
  if (previousKey) process.env.GEMINI_API_KEY = previousKey;
  else delete process.env.GEMINI_API_KEY;
  if (previousModel) process.env.GEMINI_MODEL = previousModel;
  else delete process.env.GEMINI_MODEL;
  console.log("Chat endpoint tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
