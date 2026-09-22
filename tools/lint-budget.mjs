#!/usr/bin/env node
/**
 * LINT-BUDGET — the lint ratchet cap, from @shadcn/lint's documented adoption path.
 *
 * Law (adoption.md): run `eslint . --max-warnings N` in CI; it fails when the
 * warning total increases; lower the cap as findings are fixed. The cap lives in
 * lint-budget.json and may only DECREASE — `--set N` refuses a raise, so the
 * ratchet cannot silently unwind.
 *
 * Usage:
 *   lint-budget.mjs --show
 *   lint-budget.mjs --set <N>            (refuses N > current cap)
 *   lint-budget.mjs --check -- <eslint args...>   (runs eslint with the cap; --self-testable)
 *   lint-budget.mjs --self-test
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function die(msg) { console.error(`lint-budget: ${msg}`); process.exit(1); }

export function loadBudget(file) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, "utf8"));
  if (typeof j.maxWarnings !== "number" || j.maxWarnings < 0)
    throw new Error("lint-budget.json must carry { maxWarnings: <non-negative number> }");
  return j.maxWarnings;
}

export function setBudget(file, n) {
  const current = loadBudget(file);
  if (current !== null && n > current)
    throw new Error(`refused: the cap only decreases (current ${current}, asked ${n})\n  fix: fix findings, then set a cap <= ${current}`);
  writeFileSync(file, JSON.stringify({ maxWarnings: n }, null, 2) + "\n");
  return { current, next: n };
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("lint-budget --self-test");
  const dir = mkdtempSync(join(tmpdir(), "picasso-lb-"));
  const file = join(dir, "lint-budget.json");

  ok("missing budget reads as null (unset)", loadBudget(file) === null);
  setBudget(file, 287);
  ok("cap lands from the docs' worked example", loadBudget(file) === 287);
  ok("lowering is allowed", setBudget(file, 240).next === 240);
  let refused = false;
  try { setBudget(file, 300); } catch { refused = true; }
  ok("raising is refused (ratchet law)", refused);
  writeFileSync(file, JSON.stringify({ maxWarnings: -3 }));
  let malformed = false;
  try { loadBudget(file); } catch { malformed = true; }
  ok("negative cap is malformed", malformed);

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `lint-budget: ${failures.length} self-test failure(s)` : "lint-budget: self-test clean");
  if (failures.length) process.exit(1);
}

const args = process.argv.slice(2);
const BUDGET_FILE = process.env.PICASSO_LINT_BUDGET || "lint-budget.json";
if (args.includes("--self-test")) selfTest();
else if (args.includes("--show")) {
  const cap = loadBudget(BUDGET_FILE);
  console.log(cap === null ? "lint-budget: unset (first --set records the starting cap)" : `lint-budget: maxWarnings=${cap}`);
} else if (args.includes("--set")) {
  const n = Number(args[args.indexOf("--set") + 1]);
  if (!Number.isInteger(n) || n < 0) die("--set needs a non-negative integer");
  try { const r = setBudget(BUDGET_FILE, n); console.log(`lint-budget: cap ${r.current ?? "unset"} → ${r.next}`); }
  catch (e) { die(e.message); }
} else if (args.includes("--check")) {
  const cap = loadBudget(BUDGET_FILE);
  if (cap === null) die(`refused: no cap recorded at ${BUDGET_FILE}\n  fix: lint-budget.mjs --set <current warning count>`);
  const rest = args.slice(args.indexOf("--check") + 1);
  const r = spawnSync("npx", ["eslint", ".", "--max-warnings", String(cap), ...rest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else die("usage: lint-budget.mjs --show | --set <N> | --check -- <eslint args> | --self-test");
