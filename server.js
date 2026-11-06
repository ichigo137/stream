const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

// Load local .env without a dependency. Render supplies the same values
// through its Environment settings, so no .env file is needed in production.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}
loadEnv(path.join(__dirname, ".env"));

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, JSON.stringify({ ok: true, service: "stream" }));
  }

  // These values are intentionally public browser config. Never put a
  // Supabase secret/service-role key here.
  if (req.method === "GET" && url.pathname === "/config.js") {
    const config = {
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || ""
    };
    return send(res, 200, "window.STREAM_CONFIG = " + JSON.stringify(config) + ";", "application/javascript; charset=utf-8");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, JSON.stringify({ error: "Method not allowed" }));
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return send(res, 400, JSON.stringify({ error: "Bad request" })); }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, JSON.stringify({ error: "Forbidden" }));
  }

  fs.readFile(target, (err, content) => {
    if (err) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Stream server listening on port " + PORT);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.warn("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY environment variable.");
  }
});
