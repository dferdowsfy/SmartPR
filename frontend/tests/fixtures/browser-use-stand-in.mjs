/**
 * Local stand-in for Browser Use Cloud's Browser Infrastructure API (the
 * documented v4 contract), for exercising SmartPR's cloud-browser path
 * without a Browser Use account:
 *
 *   POST  /api/v4/browsers        → { id, cdpUrl, liveUrl, status }   (launches a real Chromium with CDP)
 *   GET   /api/v4/browsers/:id    → same + metadata
 *   PATCH /api/v4/browsers/:id    { action: "stop" }
 *   GET   /api/v2/billing/account → 200 when the X-Browser-Use-API-Key matches
 *
 * It says nothing about Browser Use's own service; only SmartPR's side of
 * the integration is real.
 *
 *   CHROME=/path/to/chrome BU_KEY=test-key node tests/fixtures/browser-use-stand-in.mjs 8790
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.argv[2] || 8790);
const KEY = process.env.BU_KEY || "test-key";
const CHROME = process.env.CHROME;
const browsers = new Map();

function launch() {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bu-standin-"));
    const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-sandbox", "--no-proxy-server", "--ignore-certificate-errors", "--window-size=1280,800", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome did not start")), 20000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve({ proc, cdpUrl: m[1] }); }
    });
    proc.on("exit", () => reject(new Error("chrome exited")));
  });
}

const view = (b) => ({ id: b.id, status: b.status, cdpUrl: b.status === "active" ? b.cdpUrl : null, liveUrl: `http://localhost:${PORT}/live/${b.id}`, metadata: b.metadata, startedAt: b.startedAt });

createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith("/live/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><body style='font:16px system-ui;padding:20px'>Browser Use live view (stand-in)</body>"); }
  if (req.headers["x-browser-use-api-key"] !== KEY) return send(401, { detail: "invalid api key" });
  let body = "";
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  if (req.method === "GET" && req.url === "/api/v2/billing/account") return send(200, { projectId: "p", concurrentSessionLimit: 3, activeSessionCount: [...browsers.values()].filter((b) => b.status === "active").length });
  if (req.method === "POST" && req.url === "/api/v4/browsers") {
    try {
      const { proc, cdpUrl } = await launch();
      const b = { id: randomUUID(), proc, cdpUrl, status: "active", metadata: json.metadata ?? null, startedAt: new Date().toISOString() };
      browsers.set(b.id, b);
      return send(201, view(b));
    } catch (e) { return send(500, { detail: String(e) }); }
  }
  const m = req.url.match(/^\/api\/v4\/browsers\/([\w-]+)$/);
  if (m) {
    const b = browsers.get(m[1]);
    if (!b) return send(404, { detail: "Session not found" });
    if (req.method === "PATCH" && json.action === "stop") { b.status = "stopped"; b.proc.kill(); }
    return send(200, view(b));
  }
  send(404, { detail: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`browser-use stand-in on :${PORT}`));
