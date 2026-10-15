// Local development server for Basma CRM live-trial testing.
//
// Unlike .preview-server.cjs (pure static file server, used for the public
// site), this server ALSO executes the Vercel-style serverless functions in
// api/*.js so that /api/crm-config and friends actually run instead of being
// served as raw source text or 404ing.
//
// It loads environment variables from .env.local in this project root (never
// prints their values anywhere) and never logs request/response bodies.
//
// Usage: node crm-dev-server.cjs   (listens on http://127.0.0.1:8010)

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const PORT = 8010;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) return;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  });
}
loadEnvFile(path.join(root, ".env.local"));

function serveStatic(request, response) {
  const urlPath = decodeURIComponent(request.url.split("?")[0]);
  const requestedPath = urlPath === "/" ? "نواة الشركة.dc.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, requestedPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

function handleApi(request, response, routeName) {
  const filePath = path.join(root, "api", routeName + ".js");
  if (!fs.existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found", message: "No such API route: " + routeName }));
    return;
  }

  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", async () => {
    try {
      delete require.cache[require.resolve(filePath)];
      const handler = require(filePath);

      const fullUrl = new URL(request.url, "http://127.0.0.1");
      request.query = Object.fromEntries(fullUrl.searchParams.entries());
      if (body) {
        try { request.body = JSON.parse(body); } catch (e) { request.body = body; }
      } else {
        request.body = undefined;
      }

      response.status = function (code) { response.statusCode = code; return response; };
      response.json = function (payload) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(payload));
        return response;
      };

      await handler(request, response);
    } catch (err) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "internal_error", message: err && err.message }));
    }
  });
}

http
  .createServer((request, response) => {
    const urlPath = decodeURIComponent(request.url.split("?")[0]);
    if (urlPath.startsWith("/api/")) {
      const routeName = urlPath.replace(/^\/api\//, "").replace(/\.js$/, "");
      return handleApi(request, response, routeName);
    }
    return serveStatic(request, response);
  })
  .listen(PORT, "127.0.0.1", () => {
    // Intentionally the only console output: a boot notice with no secret values.
    console.log("Basma CRM dev server (static + serverless) listening on http://127.0.0.1:" + PORT);
  });
