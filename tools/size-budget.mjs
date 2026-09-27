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

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

function globToRegex(glob) {
  let re = "";
  for (const c of glob) re += c === "*" ? "[^/]*" : c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  return new RegExp(`^${re}$`);
}

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

// A directory sums every file beneath it (its own stat size is the inode's).
function measureOne(path) {
  let st;
  try { st = statSync(path); } catch { return null; }
  if (!st.isDirectory()) return st.size;
  const sizes = readdirSync(path, { recursive: true }).map(f => statSync(join(path, f), { throwIfNoEntry: false })).filter(s => s?.isFile()).map(s => s.size);
  return sizes.length ? sizes.reduce((a, b) => a + b, 0) : null;
}

// A wildcard budget (hashed outputs: dist/assets/*.js) sums every match, each
// measured as a plain entry would be (a matched directory is its files); zero
// measurable matches is MISSING, not zero — no JS emitted is a regression.
export function measurePath(path) {
  if (!path.includes("*")) return measureOne(path);
  const dir = dirname(path);
  const re = globToRegex(basename(path));
  let total = 0, found = false;
  try {
    for (const f of readdirSync(dir)) {
      const size = re.test(f) ? measureOne(join(dir, f)) : null;
      if (size !== null) { found = true; total += size; }
    }
  } catch { return null; }
  return found ? total : null;
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
    const SELF = fileURLToPath(import.meta.url);
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

  // Wildcard semantics: hashed outputs sum; zero matches is MISSING.
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "a-1.js"), "x".repeat(100));
  writeFileSync(join(dir, "assets", "b-2.js"), "y".repeat(50));
  ok("wildcard budget sums all matches", measurePath(join(dir, "assets/*.js")) === 150);
  ok("wildcard with no matches is missing", measurePath(join(dir, "assets/*.css")) === null);
  ok("exact path still measures one file", measurePath(app) === 1000);
  // A directory's own stat size is its inode (4096 on ext4), not its contents.
  mkdirSync(join(dir, "assets", "nested"));
  writeFileSync(join(dir, "assets", "nested", "c-3.js"), "z".repeat(25));
  ok("a directory budget sums every file beneath it", measurePath(join(dir, "assets")) === 175);
  ok("a wildcard matching a directory sums its files, never its inode", measurePath(join(dir, "assets/*")) === 175);
  mkdirSync(join(dir, "empty"));
  ok("a directory budget with no files is missing", measurePath(join(dir, "empty")) === null);

  // A budget list that names nothing is a gate that can never fail.
  for (const [what, body] of [["an empty budget list", { budgets: [] }], ["a bare array", []], ["an object with no budgets", {}]]) {
    writeFileSync(budgetsFile, JSON.stringify(body));
    const r = run([]);
    ok(`${what} refuses with a rule, not a green over nothing`, r.code === 1 && r.out.includes("declares no budgets"));
  }

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
  const budgets = JSON.parse(readFileSync(budgetsFile, "utf8"))?.budgets;
  if (!Array.isArray(budgets) || budgets.length === 0)
    die(`refused: ${budgetsFile} declares no budgets — a size gate over nothing is green by construction and can never fail\n` +
        `  fix: declare { "budgets": [{ "path": "dist/assets/*.js", "maxBytes": <a generous cap> }] }, build, then --tighten (it lowers declared caps; it adds none)`);
  const problems = checkSizes(budgets, measurePath);
  if (problems.length) die(problems.join("\n"));
  if (args.includes("--tighten")) {
    const shrunk = budgets.map(b => ({ ...b, maxBytes: measurePath(b.path) }));
    writeFileSync(budgetsFile, JSON.stringify({ budgets: shrunk }, null, 2) + "\n");
    console.log(`size-budget: tightened ${shrunk.length} budget(s) to measured sizes`);
  } else console.log(`size-budget: ${budgets.length} artifact(s) within budget`);
}
