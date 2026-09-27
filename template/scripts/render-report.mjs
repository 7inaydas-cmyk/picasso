#!/usr/bin/env node
/**
 * RENDER-REPORT — the deterministic half of picasso's visual verification seam.
 *
 * Judges nothing: it drives every route headlessly (playwright, chromium) and
 * writes the reports the ratchet gates then judge:
 *   <REPORT_DIR>/console-report.json   [{route, text}]  — console/page errors,
 *                                      failed requests, HTTP >= 400 responses
 *   <REPORT_DIR>/a11y-report.json      axe violations    — judged by a11y-ratchet
 *   <REPORT_DIR>/render-failures.json  [route, ...]      — routes that never
 *                                      rendered, or answered HTTP >= 400
 *
 * Two targets:
 *   (default)       build dist if absent, start a production preview server
 *   BASE_URL=<url>  sweep an already-running site in place — a deployed app,
 *                   or any repo's own dev/preview server (a repo that does not
 *                   vendor picasso, e.g. a stallion-governed monorepo)
 *
 * Text is normalized to its first line, URLs to origin + path: that is
 * console-ratchet's identity contract (stable text, route-scoped).
 *
 * Usage:
 *   node scripts/render-report.mjs            ROUTES="/, /about"  (default "/")
 *     BASE_URL=https://example.org            sweep a running site
 *     ROOT_SELECTOR=body                      the element that must carry content (default #root)
 *     REPORT_DIR=reports                      where the reports land
 *   node scripts/render-report.mjs --self-test
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

// Off vite's default preview port (4173): a collision there silently sweeps
// whatever app already owns it — the gate would judge a stranger's UI.
// PORT is overridable so the printed fix command actually works.
const PORT = Number(process.env.PORT) || 4573;
const EXTERNAL = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/+$/, "") : null;
const BASE = EXTERNAL ?? `http://localhost:${PORT}`;
const ROOT_SELECTOR = process.env.ROOT_SELECTOR || "#root";
const REPORT_DIR = process.env.REPORT_DIR || "reports";
// A URL's stable identity: origin + path (query strings carry cache-busters).
const stable = u => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };
const routes = (process.env.ROUTES || "/").split(",").map(r => r.trim()).filter(Boolean);

function buildIfNeeded() {
  if (!existsSync("dist/index.html")) {
    console.log("render-report: building (dist absent)…");
    const r = spawnSync("npx", ["vite", "build"], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

async function withPreviewServer(fn) {
  // The port must be free BEFORE we spawn, or we would sweep its owner.
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(500) });
    console.error(`render-report: ${BASE} already answers (status ${res.status}) — refusing to sweep a server we did not start\n  fix: free the port or set PORT`);
    process.exit(1);
  } catch { /* free: fetch failed to connect */ }
  // Spawn vite directly (not via npx) so kill() reaches vite itself and cannot
  // orphan a child behind the wrapper.
  const server = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(BASE);
        if (res.ok) break;
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 500));
      // throw (not exit): the finally below still kills the server, so a
      // timeout cannot orphan vite and brick the port for the next run.
      if (i === 59) throw new Error(`preview server never answered on ${BASE}`);
    }
    await fn();
  } finally {
    server.kill("SIGTERM");
  }
}

async function sweep() {
  const consoleErrors = [];
  const a11yViolations = [];
  const renderFailures = [];
  const browser = await chromium.launch();
  try {
    for (const route of routes) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on("console", m => { if (m.type() === "error") errors.push({ route, text: m.text() }); });
      page.on("pageerror", e => errors.push({ route, text: String(e) }));
      page.on("requestfailed", r => errors.push({ route, text: `request failed: ${stable(r.url())}` }));
      // A subresource answering an error status is a broken page even when the
      // network "succeeded" (a 404 asset, a failing API call).
      page.on("response", r => {
        if (r.status() >= 400 && r.request().resourceType() !== "document")
          errors.push({ route, text: `HTTP ${r.status()}: ${stable(r.url())}` });
      });
      try {
        const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 15000 });
        // The page itself answering an error status (a 404 route) never
        // rendered, whatever its error page draws.
        if (res && res.status() >= 400) {
          errors.push({ route, text: `HTTP ${res.status()} on ${route}` });
          renderFailures.push(route);
        }
        // networkidle is Playwright-discouraged for SPAs; settle instead on
        // the root actually carrying content, polled briefly.
        const root = page.locator(ROOT_SELECTOR).first();
        let rendered = false;
        for (let i = 0; i < 12 && !rendered; i++) {
          rendered = (await root.count()) > 0 && (await root.innerHTML()).length > 0;
          if (!rendered) await page.waitForTimeout(250);
        }
        if (!rendered && !renderFailures.includes(route)) renderFailures.push(route);
        const axe = await new AxeBuilder({ page }).analyze();
        for (const v of axe.violations)
          for (const node of v.nodes)
            a11yViolations.push({ rule: v.id, selector: node.target.join(" "), impact: v.impact ?? "" });
      } catch (e) {
        if (!renderFailures.includes(route)) renderFailures.push(route);
        errors.push({ route, text: `navigation failed: ${String(e).split("\n")[0]}` });
      } finally {
        consoleErrors.push(...errors);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "console-report.json"), JSON.stringify(consoleErrors, null, 2) + "\n");
  writeFileSync(join(REPORT_DIR, "a11y-report.json"), JSON.stringify(a11yViolations, null, 2) + "\n");
  writeFileSync(join(REPORT_DIR, "render-failures.json"), JSON.stringify(renderFailures, null, 2) + "\n");
  console.log(`render-report: ${BASE} — ${routes.length} route(s) — ${consoleErrors.length} console error(s), ${a11yViolations.length} axe violation(s), ${renderFailures.length} render failure(s)`);
}

// ---- self-test: a tiny live site, swept for real (needs chromium) ----
async function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("render-report --self-test");
  const page = body => `<!doctype html><html lang="en"><head><title>t</title></head><body><main>${body}</main></body></html>`;
  const site = {
    "/": page('<div id="root"><h1>home</h1><img src="/missing.png?v=1" alt="missing"></div>'),
    "/empty": page('<div id="root"></div>'),
    "/broken": page('<div id="root"><h1>broken</h1></div><script>console.error("boom from /broken")</script>'),
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (site[path]) { res.writeHead(200, { "content-type": "text/html" }); res.end(site[path]); }
    else { res.writeHead(404, { "content-type": "text/html" }); res.end(page('<div id="root"><h1>not found</h1></div>')); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "picasso-render-"));
  const env = { ...process.env, BASE_URL: `http://127.0.0.1:${server.address().port}/`, ROUTES: "/, /empty, /gone, /broken", REPORT_DIR: dir };
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: dir, env, stdio: "inherit" });
  const code = await new Promise(r => child.on("exit", r));
  server.close();
  const read = f => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
  const failuresReport = read("render-failures.json") ?? [];
  const consoleReport = (read("console-report.json") ?? []).map(e => `${e.route} ${e.text}`);
  ok("an external BASE_URL is swept in place (nothing built, nothing started)", code === 0 && !existsSync(join(dir, "dist")));
  ok("a page answering HTTP 404 is a render failure", failuresReport.includes("/gone"));
  ok("an empty root is a render failure", failuresReport.includes("/empty"));
  ok("a rendered page is not", !failuresReport.includes("/") && !failuresReport.includes("/broken"));
  ok("the 404 is named in the console report", consoleReport.some(e => e.startsWith("/gone HTTP 404")));
  ok("a missing asset is named, query string stripped (stable identity)", consoleReport.some(e => /^\/ HTTP 404: http:\/\/127\.0\.0\.1:\d+\/missing\.png$/.test(e)));
  ok("a console error is named", consoleReport.some(e => e.startsWith("/broken boom from /broken")));
  ok("reports land in REPORT_DIR", read("a11y-report.json") !== null);
  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `render-report: ${failures.length} self-test failure(s)` : "render-report: self-test clean");
  if (failures.length) process.exit(1);
}

if (process.argv.includes("--self-test")) await selfTest();
else {
  try {
    if (EXTERNAL) await sweep();
    else { buildIfNeeded(); await withPreviewServer(sweep); }
  } catch (e) {
    console.error(`render-report: ${e.message}`);
    process.exit(1);
  }
}
