const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const required = [
  "index.html",
  "assets/site-ui.js",
  "assets/chatbot.js",
  "assets/chatbot.css",
  "api/chat.js",
  ".env.example",
  "vercel.json"
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error("Missing required files:", missing.join(", "));
  process.exit(1);
}

for (const file of ["assets/site-ui.js", "assets/chatbot.js", "api/chat.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  try {
    new Function(source);
  } catch (error) {
    console.error(`JavaScript syntax error in ${file}:`, error.message);
    process.exit(1);
  }
}

console.log("Basma website validation passed.");

