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
 *   lint-budget.mjs --check [--linter eslint|oxlint] -- <linter args...>
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

  // The --linter flag validates before anything spawns: probe against a missing
  // budget file so the oxlint path dies at the cap check, never at a network npx.
  const SELF = new URL(import.meta.url).pathname;
  const probe = f => {
    const r = spawnSync("node", [SELF, "--check", "--linter", f], { encoding: "utf8",
      env: { ...process.env, PICASSO_LINT_BUDGET: join(dir, "no-cap.json") } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const bogus = probe("prettier");
  ok("--check refuses an unknown linter before spawning", bogus.code !== 0 && bogus.out.includes("eslint or oxlint"));
  const ox = probe("oxlint");
  ok("--check accepts the documented oxlint path (dies later at the cap, not at validation)",
    ox.code !== 0 && ox.out.includes("no cap recorded"));

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
  const linter = args[args.indexOf("--linter") + 1] || "eslint";
  if (!["eslint", "oxlint"].includes(linter))
    die(`--linter must be eslint or oxlint (got '${linter}') — both support --max-warnings`);
  const cap = loadBudget(BUDGET_FILE);
  if (cap === null) die(`refused: no cap recorded at ${BUDGET_FILE}\n  fix: lint-budget.mjs --set <current warning count>`);
  const rest = args.slice(args.indexOf("--check") + 1).filter((a, i, all) => !(a === "--linter" || all[i - 1] === "--linter"));
  const r = spawnSync("npx", [linter, ".", "--max-warnings", String(cap), ...rest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else die("usage: lint-budget.mjs --show | --set <N> | --check [--linter eslint|oxlint] -- <linter args> | --self-test");
