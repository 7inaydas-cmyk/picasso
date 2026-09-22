#!/usr/bin/env node
/**
 * A11Y-RATCHET — the accessibility baseline gate, ported from the GSA pattern
 * (GSA/ngx-uswds-icons PR #127, itself mirroring sam-styles and ngx-uswds).
 *
 * Law: a committed baseline lists known violations. Every run compares the
 * fresh axe report against it:
 *   - a NEW violation fails the gate (listed, with its rule and selector);
 *   - a RESOLVED entry must be pruned (`--prune` rewrites the baseline), so the
 *     baseline cannot rot into a fiction;
 *   - a PARALLEL render-failures ratchet (`--render-failures` + `--render-baseline`)
 *     catches stories that fail to render at all — same law, separate baseline,
 *     because a story that never renders produces no axe report to judge.
 *
 * Usage:
 *   a11y-ratchet.mjs --violations <file> --baseline <file> \
 *                    [--render-failures <file> --render-baseline <file>] [--prune]
 *   a11y-ratchet.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function die(msg) { console.error(`a11y-ratchet: ${msg}`); process.exit(1); }

// A violation identity: rule + node selector + impact. Anything coarser merges
// distinct defects; anything finer lets a fix slip through as "different".
export function keyOf(v) {
  if (typeof v === "string") return v;
  return [v.rule, v.selector ?? v.node ?? "", v.impact ?? ""].join("|");
}

export function judge(current, baseline) {
  const cur = new Set(current.map(keyOf));
  const base = new Set(baseline.map(keyOf));
  const added = [...cur].filter(k => !base.has(k));
  const resolved = [...base].filter(k => !cur.has(k));
  return { added, resolved, clean: added.length === 0 && resolved.length === 0 };
}

function readList(file, what) {
  if (!existsSync(file)) die(`refused: ${what} file ${file} is missing — an unread report is 'unreachable', never a pass`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function spawnJudge(args) {
  const SELF = new URL(import.meta.url).pathname;
  const r = spawnSync("node", [SELF, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("a11y-ratchet --self-test");

  const v = (rule, sel) => ({ rule, selector: sel, impact: "serious" });
  const base = [v("color-contrast", "#submit"), v("label", "#email")];

  ok("identical report is clean", judge(base, base).clean);
  const worse = judge([...base, v("aria-valid-attr", "#menu")], base);
  ok("new violation fails", !worse.clean && worse.added.length === 1 && worse.added[0].startsWith("aria-valid-attr"));
  const better = judge([base[0]], base);
  ok("resolved entry demands pruning", !better.clean && better.resolved.length === 1);
  ok("same rule elsewhere is a different defect", judge([v("label", "#name")], base).added.length === 1);
  ok("string entries (render failures) key by themselves", keyOf("stories/foo--bar") === "stories/foo--bar");

  // File-level wiring on disk, the way CI consumes it.
  const dir = mkdtempSync(join(tmpdir(), "picasso-a11y-"));
  const cur = join(dir, "cur.json"), bas = join(dir, "bas.json");
  const rf = join(dir, "rf.json"), rb = join(dir, "rb.json");
  writeFileSync(bas, JSON.stringify(base));
  writeFileSync(cur, JSON.stringify([...base, v("button-name", "#ok")]));
  ok("gate exits 1 on a new violation with the rule named",
    spawnJudge(["--violations", cur, "--baseline", bas]).code !== 0 &&
    spawnJudge(["--violations", cur, "--baseline", bas]).out.includes("button-name"));
  writeFileSync(cur, JSON.stringify(base));
  ok("gate exits 0 when the report matches the baseline", spawnJudge(["--violations", cur, "--baseline", bas]).code === 0);
  writeFileSync(cur, JSON.stringify([base[0]]));
  const stale = spawnJudge(["--violations", cur, "--baseline", bas]);
  ok("gate exits 1 on unpruned resolved entries, naming the fix", stale.code !== 0 && stale.out.includes("--prune"));
  ok("--prune rewrites the baseline to the surviving set",
    spawnJudge(["--violations", cur, "--baseline", bas, "--prune"]).code === 0 &&
    JSON.parse(readFileSync(bas, "utf8")).length === 1);
  ok("pruned baseline now matches", spawnJudge(["--violations", cur, "--baseline", bas]).code === 0);

  // The parallel render-failures ratchet.
  writeFileSync(rb, JSON.stringify(["stories/card--edge"]));
  writeFileSync(rf, JSON.stringify(["stories/card--edge"]));
  ok("render-failures clean against baseline passes",
    spawnJudge(["--violations", cur, "--baseline", bas, "--render-failures", rf, "--render-baseline", rb]).code === 0);
  writeFileSync(rf, JSON.stringify(["stories/card--edge", "stories/new--story"]));
  const rfNew = spawnJudge(["--violations", cur, "--baseline", bas, "--render-failures", rf, "--render-baseline", rb]);
  ok("a story that stops rendering fails the gate, named", rfNew.code !== 0 && rfNew.out.includes("stories/new--story"));
  writeFileSync(rf, JSON.stringify(["stories/card--edge"]));
  writeFileSync(rb, JSON.stringify(["stories/card--edge", "stories/old--gone"]));
  const rfStale = spawnJudge(["--violations", cur, "--baseline", bas, "--render-failures", rf, "--render-baseline", rb]);
  ok("a recovered story must be pruned from the render baseline", rfStale.code !== 0 && rfStale.out.includes("--prune"));
  ok("--prune rewrites the render baseline too",
    spawnJudge(["--violations", cur, "--baseline", bas, "--render-failures", rf, "--render-baseline", rb, "--prune"]).code === 0 &&
    JSON.parse(readFileSync(rb, "utf8")).length === 1);
  const missing = spawnJudge(["--violations", cur, "--baseline", bas, "--render-failures", join(dir, "nope.json"), "--render-baseline", rb]);
  ok("a missing render-failures file refuses (unreachable is never a pass)", missing.code !== 0 && missing.out.includes("unreachable"));

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `a11y-ratchet: ${failures.length} self-test failure(s)` : "a11y-ratchet: self-test clean");
  if (failures.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else {
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const violationsFile = val("--violations"), baselineFile = val("--baseline");
  const renderFailures = val("--render-failures"), renderBaseline = val("--render-baseline");
  if (!violationsFile || !baselineFile)
    die("usage: a11y-ratchet.mjs --violations <file> --baseline <file> [--render-failures <file> --render-baseline <file>] [--prune]");
  if ((renderFailures || renderBaseline) && !(renderFailures && renderBaseline))
    die("refused: --render-failures and --render-baseline travel together (a parallel ratchet needs both sides)");
  const current = readList(violationsFile, "violations");
  const baseline = readList(baselineFile, "baseline");
  const { added, resolved } = judge(current, baseline);

  let rfAdded = [], rfResolved = [];
  if (renderFailures) {
    const rfCurrent = readList(renderFailures, "render-failures");
    const rfBase = readList(renderBaseline, "render-baseline");
    const rf = judge(rfCurrent, rfBase);
    rfAdded = rf.added; rfResolved = rf.resolved;
  }

  if (added.length)
    die(`refused: ${added.length} NEW accessibility violation(s) the baseline does not cover:\n  ${added.join("\n  ")}\n` +
        `rule: new violations fail the gate; only the baseline's known set is tolerated\n  fix: fix the violation, or (deliberately) add it to the baseline`);
  if (rfAdded.length)
    die(`refused: ${rfAdded.length} story/story-variant(s) that FAILED TO RENDER and are not in the render baseline:\n  ${rfAdded.join("\n  ")}\n` +
        `rule: a story that never renders produces no axe report — it fails here, not silently\n  fix: fix the render failure, or (deliberately) baseline it`);
  if ((resolved.length || rfResolved.length) && !args.includes("--prune"))
    die(`refused: baseline entries no longer reproduce — the baseline must be pruned:\n  ${[...resolved, ...rfResolved].join("\n  ")}\n  fix: a11y-ratchet.mjs --prune (rewrites both baselines to the surviving sets)`);
  if (args.includes("--prune")) {
    writeFileSync(baselineFile, JSON.stringify(current, null, 2) + "\n");
    if (renderFailures)
      writeFileSync(renderBaseline, JSON.stringify(readList(renderFailures, "render-failures"), null, 2) + "\n");
    console.log(`a11y-ratchet: baseline(s) pruned to ${current.length} violation(s)${renderFailures ? " + surviving render failures" : ""}`);
  } else console.log(`a11y-ratchet: clean against baseline (${current.length} known${renderFailures ? ", render failures ratcheted" : ""})`);
}
