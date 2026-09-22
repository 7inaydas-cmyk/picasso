#!/usr/bin/env node
/**
 * CONSOLE-RATCHET — the deterministic half of picasso's visual verification
 * seam: a fence over what the browser console says when the UI actually runs.
 *
 * The report comes from a headless render (see the template's
 * scripts/render-report.mjs: playwright drives every route, collects console
 * errors, page errors, and failed requests). This gate ratchets it:
 *   - a NEW console error on a route fails the gate — hydration mismatches,
 *     broken styling, 404 assets: failures every code-level gate passes;
 *   - a RESOLVED entry must be pruned (`--prune`), so the baseline stays honest.
 *
 * The MULTIMODAL half (screenshots, breakpoint walks, visual judgment) is the
 * adversarial-pass contract documented in docs/WIRING.md — one gate, one
 * meaning: this file never judges pixels.
 *
 * Usage:
 *   console-ratchet.mjs --report <file> --baseline <file> [--prune]
 *   console-ratchet.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "./ratchet.mjs";

function die(msg) { console.error(`console-ratchet: ${msg}`); process.exit(1); }

// route + text: the same error on another route is a different finding; the
// same route with new text is a new finding. The report writer must emit
// stable text (playwright's console .text(), first line normalized).
export const identity = e => [e.route, String(e.text).split("\n")[0].trim()].join("|");

function readJSON(file, what) {
  if (!existsSync(file)) die(`refused: ${what} file ${file} is missing — an unread report is 'unreachable', never a pass`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("console-ratchet --self-test");
  const SELF = new URL(import.meta.url).pathname;
  const run = args => {
    const r = spawnSync("node", [SELF, ...args], { encoding: "utf8" });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };

  const dir = mkdtempSync(join(tmpdir(), "picasso-cr-"));
  const rep = join(dir, "report.json"), bas = join(dir, "baseline.json");
  const e = (route, text) => ({ route, text });

  ok("identity separates routes", identity(e("/a", "x")) !== identity(e("/b", "x")));
  ok("identity folds multiline text to its first line", identity(e("/a", "boom\n  at App.tsx:12")) === identity(e("/a", "boom")));

  writeFileSync(bas, JSON.stringify([e("/", "hydration mismatch")]));
  writeFileSync(rep, JSON.stringify([e("/", "hydration mismatch")]));
  ok("matching report passes", run(["--report", rep, "--baseline", bas]).code === 0);

  writeFileSync(rep, JSON.stringify([e("/", "hydration mismatch"), e("/settings", "404 /api/me")]));
  const added = run(["--report", rep, "--baseline", bas]);
  ok("a new console error fails, route and text named", added.code !== 0 && added.out.includes("/settings") && added.out.includes("404 /api/me"));

  writeFileSync(rep, JSON.stringify([e("/", "hydration mismatch"), e("/", "old warning gone")]));
  writeFileSync(bas, JSON.stringify([e("/", "hydration mismatch"), e("/", "old warning gone")]));
  writeFileSync(rep, JSON.stringify([e("/", "hydration mismatch")]));
  const stale = run(["--report", rep, "--baseline", bas]);
  ok("a resolved error must be pruned", stale.code !== 0 && stale.out.includes("--prune"));
  ok("--prune rewrites the baseline to the surviving set",
    run(["--report", rep, "--baseline", bas, "--prune"]).code === 0 &&
    JSON.parse(readFileSync(bas, "utf8")).length === 1);
  ok("pruned baseline now matches", run(["--report", rep, "--baseline", bas]).code === 0);
  ok("a missing report refuses (unreachable is never a pass)",
    run(["--report", join(dir, "nope.json"), "--baseline", bas]).code !== 0);

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `console-ratchet: ${failures.length} self-test failure(s)` : "console-ratchet: self-test clean");
  if (failures.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const reportFile = val("--report"), baselineFile = val("--baseline");
  if (!reportFile || !baselineFile)
    die("usage: console-ratchet.mjs --report <file> --baseline <file> [--prune]");
  const report = readJSON(reportFile, "report");
  const baseline = readJSON(baselineFile, "baseline");
  const shapeError = list => Array.isArray(list) && list.every(e => e && typeof e.route === "string" && typeof e.text === "string");
  if (!shapeError(report) || !shapeError(baseline))
    die("refused: report/baseline must be arrays of {route, text} — the render script's contract");
  const { added, resolved } = judge(report, baseline, identity);
  if (added.length)
    die(`refused: ${added.length} NEW console error(s) the baseline does not cover:\n  ${added.join("\n  ")}\n` +
        `rule: a console error the running UI emits is a runtime failure no code-level gate sees\n  fix: fix the error, or (deliberately) baseline it`);
  if (resolved.length && !args.includes("--prune"))
    die(`refused: baseline entries no longer reproduce — prune them:\n  ${resolved.join("\n  ")}\n  fix: console-ratchet.mjs --prune`);
  if (args.includes("--prune")) {
    writeFileSync(baselineFile, JSON.stringify(report, null, 2) + "\n");
    console.log(`console-ratchet: baseline pruned to ${report.length} surviving error(s)`);
  } else console.log(`console-ratchet: clean against baseline (${report.length} known)`);
}
