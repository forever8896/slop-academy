// Slop Academy: the local server. Listens on 127.0.0.1 only; `slop-academy` (bin/) starts it.
//
//   /api/home, /api/talk/*, …    the conversation app (lib/talk.mjs)
//   everything else              the page itself, from public/

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import * as talk from "./lib/talk.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8795);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------------------------------------------------------------- http

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, "too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "too large");
  }
  return JSON.parse(body || "{}");
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

// Only this page may talk to the server. Any website you visit could otherwise POST to localhost
// (CSRF), or point its own domain at 127.0.0.1 and read the answers (DNS rebinding).
function allowed(req, port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || hosts.some((h) => origin === `http://${h}`);
}

const handler = (port) => async (req, res) => {
  try {
    if (!allowed(req, port)) throw httpError(403, "forbidden");
    const url = new URL(req.url, "http://localhost");
    // Everything below runs on this machine.
    const post = req.method === "POST";
    if (!post && url.pathname === "/api/home") return send(res, 200, await talk.home());
    if (!post && url.pathname === "/api/repos") return send(res, 200, await talk.suggestRepos());
    if (!post && url.pathname === "/api/file") return send(res, 200, await talk.readRepoFile(url.searchParams.get("file") ?? ""));
    if (post && url.pathname === "/api/scan") return send(res, 200, await talk.scanRepo((await readJson(req)).repo));
    if (post && url.pathname === "/api/profile") return send(res, 200, await talk.setProfile(await readJson(req)));
    if (post && url.pathname === "/api/prepare") return send(res, 200, await talk.prepare((await readJson(req)).file));
    if (post && url.pathname === "/api/talk/start") return send(res, 200, await talk.start(await readJson(req)));
    if (post && url.pathname === "/api/talk/turn") return send(res, 200, await talk.turn(await readJson(req)));
    if (post && url.pathname === "/api/talk/finish") return send(res, 200, await talk.finish(await readJson(req)));
    if (post && url.pathname === "/api/goal") return send(res, 200, await talk.setDailyGoal(await readJson(req)));
    if (post && url.pathname === "/api/confidence") return send(res, 200, await talk.rateConfidence(await readJson(req)));
    if (post && url.pathname === "/api/speak") return send(res, 200, await talk.speak(await readJson(req)), "audio/wav");
    if (!post && url.pathname === "/api/speech") return send(res, 200, talk.speechStatus());
    if (!post && url.pathname === "/api/hello") return send(res, 200, { app: "slop-academy" });
    if (post && url.pathname === "/api/transcribe") return send(res, 200, await talk.transcribe(await readBody(req)));
    if (req.method !== "GET") throw httpError(405, "method not allowed");

    // The checkout has the marketing page at /; the installed app opens straight into the app.
    const home = existsSync(path.join(ROOT, "public", "index.html")) ? "index.html" : "app.html";
    const rel = url.pathname === "/" ? home : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(ROOT, "public", rel);
    if (!file.startsWith(path.join(ROOT, "public"))) throw httpError(403, "forbidden");
    await stat(file).catch(() => { throw httpError(404, "not found"); });
    send(res, 200, await readFile(file), MIME[path.extname(file)] ?? "application/octet-stream");
  } catch (error) {
    send(res, error.status ?? 500, { error: error.message });
  }
};

/** Starts listening on 127.0.0.1:port. Resolves to the server, or rejects (e.g. EADDRINUSE). */
export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler(port));
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      talk.warmSpeech();
      resolve(server);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
  console.log(`Slop Academy on http://localhost:${PORT}`);
}
