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
 *   - a parallel render-failures file ratchets stories that fail to render at all.
 *
 * Usage:
 *   a11y-ratchet.mjs --violations <file> --baseline <file> [--render-failures <file>]
 *   a11y-ratchet.mjs --prune ...      (rewrite baseline to the current surviving set)
 *   a11y-ratchet.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function die(msg) { console.error(`a11y-ratchet: ${msg}`); process.exit(1); }

// A violation identity: rule + node selector + impact. Anything coarser merges
// distinct defects; anything finer lets a fix slip through as "different".
export function keyOf(v) {
  return [v.rule, v.selector ?? v.node ?? "", v.impact ?? ""].join("|");
}

export function judge(current, baseline) {
  const cur = new Set(current.map(keyOf));
  const base = new Set(baseline.map(keyOf));
  const added = [...cur].filter(k => !base.has(k));
  const resolved = [...base].filter(k => !cur.has(k));
  return { added, resolved, clean: added.length === 0 && resolved.length === 0 };
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
  ok("identity is rule+selector (impact included)", keyOf(v("label", "#email")) === keyOf({ rule: "label", selector: "#email", impact: "serious" }));
  ok("same rule elsewhere is a different defect", judge([v("label", "#name")], base).added.length === 1);

  // File-level wiring on disk, the way CI consumes it.
  const dir = mkdtempSync(join(tmpdir(), "picasso-a11y-"));
  const cur = join(dir, "cur.json"), bas = join(dir, "bas.json");
  writeFileSync(bas, JSON.stringify(base));
  writeFileSync(cur, JSON.stringify([...base, v("button-name", "#ok")]));
  let failed = false;
  const r = spawnJudge(cur, bas, []);
  ok("gate exits 1 on a new violation with the rule named", r.code !== 0 && r.out.includes("button-name"));
  writeFileSync(cur, JSON.stringify(base));
  ok("gate exits 0 when the report matches the baseline", spawnJudge(cur, bas, []).code === 0);
  writeFileSync(cur, JSON.stringify([base[0]]));
  const stale = spawnJudge(cur, bas, []);
  ok("gate exits 1 on unpruned resolved entries, naming the fix", stale.code !== 0 && stale.out.includes("--prune"));
  const pruned = spawnJudge(cur, bas, ["--prune"]);
  ok("--prune rewrites the baseline to the surviving set", pruned.code === 0 &&
    JSON.parse(readFileSync(bas, "utf8")).length === 1);
  ok("pruned baseline now matches", spawnJudge(cur, bas, []).code === 0);

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `a11y-ratchet: ${failures.length} self-test failure(s)` : "a11y-ratchet: self-test clean");
  if (failures.length) process.exit(1);
}

import { spawnSync } from "node:child_process";
function spawnJudge(curFile, basFile, extra) {
  const SELF = new URL(import.meta.url).pathname;
  const r = spawnSync("node", [SELF, "--violations", curFile, "--baseline", basFile, ...extra], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else {
  const val = f => args[args.indexOf(f) + 1];
  const violationsFile = val("--violations"), baselineFile = val("--baseline");
  if (!violationsFile || !baselineFile)
    die("usage: a11y-ratchet.mjs --violations <file> --baseline <file> [--prune]");
  for (const f of [violationsFile, baselineFile])
    if (!existsSync(f)) die(`refused: ${f} is missing — an unread report is 'unreachable', never a pass`);
  const current = JSON.parse(readFileSync(violationsFile, "utf8"));
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { added, resolved, clean } = judge(current, baseline);
  if (added.length)
    die(`refused: ${added.length} NEW accessibility violation(s) the baseline does not cover:\n  ${added.join("\n  ")}\n` +
        `rule: new violations fail the gate; only the baseline's known set is tolerated\n  fix: fix the violation, or (deliberately) add it to the baseline`);
  if (resolved.length && !args.includes("--prune"))
    die(`refused: ${resolved.length} baseline entr(ies) no longer reproduce — the baseline must be pruned:\n  ${resolved.join("\n  ")}\n  fix: a11y-ratchet.mjs --prune (rewrites the baseline to the surviving set)`);
  if (args.includes("--prune")) {
    writeFileSync(baselineFile, JSON.stringify(current, null, 2) + "\n");
    console.log(`a11y-ratchet: baseline pruned to ${current.length} surviving violation(s)`);
  } else console.log(`a11y-ratchet: clean against baseline (${current.length} known)`);
}
