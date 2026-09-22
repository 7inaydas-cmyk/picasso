#!/usr/bin/env node
/**
 * RENDER-REPORT — the deterministic half of picasso's visual verification seam.
 *
 * Builds nothing, judges nothing: it starts a production preview server, drives
 * every route headlessly (playwright, chromium), and writes the reports the
 * ratchet gates then judge:
 *   reports/console-report.json   [{route, text}]  — console/page errors + failed requests
 *   reports/a11y-report.json      axe violations    — judged by a11y-ratchet
 *   reports/render-failures.json  [route, ...]      — routes that never rendered
 *
 * Text is normalized to its first line: that is console-ratchet's identity
 * contract (stable text, route-scoped).
 *
 * Usage:
 *   node scripts/render-report.mjs            (ROUTES="/, /about" to override)
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

// Off vite's default preview port (4173): a collision there silently sweeps
// whatever app already owns it — the gate would judge a stranger's UI.
// PORT is overridable so the printed fix command actually works.
const PORT = Number(process.env.PORT) || 4573;
const BASE = `http://localhost:${PORT}`;
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
      page.on("requestfailed", r => errors.push({ route, text: `request failed: ${r.url()}` }));
      try {
        await page.goto(BASE + route, { waitUntil: "load", timeout: 15000 });
        // networkidle is Playwright-discouraged for SPAs; settle instead on
        // the root actually carrying content, polled briefly.
        const root = page.locator("#root");
        let rendered = false;
        for (let i = 0; i < 12 && !rendered; i++) {
          rendered = (await root.count()) > 0 && (await root.innerHTML()).length > 0;
          if (!rendered) await page.waitForTimeout(250);
        }
        if (!rendered) renderFailures.push(route);
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

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/console-report.json", JSON.stringify(consoleErrors, null, 2) + "\n");
  writeFileSync("reports/a11y-report.json", JSON.stringify(a11yViolations, null, 2) + "\n");
  writeFileSync("reports/render-failures.json", JSON.stringify(renderFailures, null, 2) + "\n");
  console.log(`render-report: ${routes.length} route(s) — ${consoleErrors.length} console error(s), ${a11yViolations.length} axe violation(s), ${renderFailures.length} render failure(s)`);
}

buildIfNeeded();
try {
  await withPreviewServer(sweep);
} catch (e) {
  console.error(`render-report: ${e.message}`);
  process.exit(1);
}
