const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

http
  .createServer((request, response) => {
    const urlPath = decodeURIComponent(request.url.split("?")[0]);
    const requestedPath =
      urlPath === "/" ? "نواة الشركة.dc.html" : urlPath.replace(/^\/+/, "");
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
        "Content-Type":
          mimeTypes[path.extname(filePath).toLowerCase()] ||
          "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(data);
    });
  })
  .listen(8000, "127.0.0.1");
