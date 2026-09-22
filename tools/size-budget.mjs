#!/usr/bin/env node
/**
 * SIZE-BUDGET — bundle-size ratchet, the front-end analog of a performance fence.
 *
 * Law: budgets.json declares { path, maxBytes } for built artifacts. Every check:
 *   - an artifact MISSING from disk fails (a budgeted asset silently vanishing
 *     is a regression, not a pass);
 *   - an artifact OVER budget fails, naming the overflow;
 *   - an artifact under its cap can TIGHTEN (`--tighten` rewrites maxBytes to
 *     the measured size), so budgets ratchet down, never up.
 *
 * Usage:
 *   size-budget.mjs --budgets <file> [--tighten]
 *   size-budget.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function die(msg) { console.error(`size-budget: ${msg}`); process.exit(1); }

export function checkSizes(budgets, measure) {
  const problems = [];
  for (const b of budgets) {
    const size = measure(b.path);
    if (size === null) { problems.push(`${b.path}: budgeted artifact is MISSING — a vanished asset is a regression\n  fix: restore the artifact or retire its budget entry deliberately`); continue; }
    if (size > b.maxBytes)
      problems.push(`${b.path}: ${size}B over budget ${b.maxBytes}B (+${size - b.maxBytes}B)\n  fix: shrink the artifact, or raise the budget only via a deliberate reviewed change`);
  }
  return problems;
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("size-budget --self-test");

  const dir = mkdtempSync(join(tmpdir(), "picasso-size-"));
  const app = join(dir, "app.js");
  writeFileSync(app, "x".repeat(1000));
  const budgetsFile = join(dir, "budgets.json");
  writeFileSync(budgetsFile, JSON.stringify({ budgets: [{ path: app, maxBytes: 2000 }] }));

  const measureReal = p => { try { return statSync(p).size; } catch { return null; } };
  const run = extra => {
    const SELF = new URL(import.meta.url).pathname;
    const r = spawnSyncNode([SELF, "--budgets", budgetsFile, ...extra]);
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };

  ok("under budget passes", run([]).code === 0);
  writeFileSync(budgetsFile, JSON.stringify({ budgets: [{ path: app, maxBytes: 500 }] }));
  const over = run([]);
  ok("over budget fails naming the overflow", over.code !== 0 && over.out.includes("+500B"));
  writeFileSync(budgetsFile, JSON.stringify({ budgets: [{ path: join(dir, "gone.js"), maxBytes: 100 }] }));
  const gone = run([]);
  ok("missing artifact fails", gone.code !== 0 && gone.out.includes("MISSING"));
  writeFileSync(budgetsFile, JSON.stringify({ budgets: [{ path: app, maxBytes: 5000 }] }));
  ok("--tighten shrinks the cap to the measured size", run(["--tighten"]).code === 0 &&
    JSON.parse(readFileSync(budgetsFile, "utf8")).budgets[0].maxBytes === 1000);
  ok("tightened budget still passes", run([]).code === 0);

  // Logic-level checks with a stub measure (no disk).
  ok("checkSizes logic: null size is a problem", checkSizes([{ path: "x", maxBytes: 1 }], () => null).length === 1);
  ok("checkSizes logic: exact budget passes", checkSizes([{ path: "x", maxBytes: 10 }], () => 10).length === 0);

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `size-budget: ${failures.length} self-test failure(s)` : "size-budget: self-test clean");
  if (failures.length) process.exit(1);
}

function spawnSyncNode(argv) { return spawnSync("node", argv, { encoding: "utf8" }); }


const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else {
  const budgetsFile = args[args.indexOf("--budgets") + 1];
  if (!budgetsFile || !existsSync(budgetsFile))
    die(`refused: budgets file missing (${budgetsFile ?? "none given"})\n  fix: declare { budgets: [{ path, maxBytes }] } and commit it`);
  const budgets = JSON.parse(readFileSync(budgetsFile, "utf8")).budgets;
  const problems = checkSizes(budgets, p => { try { return statSync(p).size; } catch { return null; } });
  if (problems.length) die(problems.join("\n"));
  if (args.includes("--tighten")) {
    const shrunk = budgets.map(b => ({ ...b, maxBytes: statSync(b.path).size }));
    writeFileSync(budgetsFile, JSON.stringify({ budgets: shrunk }, null, 2) + "\n");
    console.log(`size-budget: tightened ${shrunk.length} budget(s) to measured sizes`);
  } else console.log(`size-budget: ${budgets.length} artifact(s) within budget`);
}
