#!/usr/bin/env node
/**
 * GATE-REGISTRY — picasso's gate invocations, declared once, drift-checked everywhere.
 *
 * Ported from stallion's law: every gate invocation is declared ONCE in
 * docs/gates/gate-registry.json with the transports that must carry it. The
 * checker greps each declared transport file for the invocation's text. Both
 * directions fail:
 *   1. a declared gate missing from a transport that must carry it (drift)
 *   2. a transport carrying a `node tools/...` invocation the registry does not
 *      declare (an unwired shadow gate — code that looks like enforcement)
 *
 * The reverse scan splits on shell-chain boundaries: `&&` and `||` end a match,
 * so a chained battery line is judged segment by segment — an undeclared
 * invocation hiding mid-chain is caught, not swallowed by the first prefix.
 *
 * Usage:
 *   gate-registry.mjs            check every declaration against every transport
 *   gate-registry.mjs --self-test
 */

import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGISTRY_PATH = "docs/gates/gate-registry.json";
const TRANSPORTS = {
  "pre-commit": ".githooks/pre-commit",
  "commit-msg": ".githooks/commit-msg",
  "pre-push": ".githooks/pre-push",
  ci: ".github/workflows/selftest.yml",
  battery: "package.json",
};

function die(message) { console.error(`gate-registry: ${message}`); process.exit(1); }

// `&` and `|` are excluded from the match so chain operators terminate it.
const INVOCATION_RE = /node tools\/[a-z-]+\.mjs[^"'`\n&|]*/g;

export function check({ root = ROOT, registryPath = join(root, REGISTRY_PATH), transports = TRANSPORTS } = {}) {
  const problems = [];
  if (!existsSync(registryPath)) return { problems: [`${REGISTRY_PATH} is missing — an undeclared gate list checks nothing`] };
  let registry;
  try { registry = JSON.parse(readFileSync(registryPath, "utf8")); }
  catch (e) { return { problems: [`${REGISTRY_PATH} does not parse: ${e.message}`] }; }
  if (!Array.isArray(registry.gates) || registry.gates.length === 0)
    return { problems: [`${REGISTRY_PATH} declares no gates`] };
  const seen = new Set();
  const declared = inv => registry.gates.some(g =>
    g.invocation === inv || g.invocation.startsWith(inv + " ") || inv.startsWith(g.invocation + " "));
  for (const g of registry.gates) {
    if (!g.id || !g.invocation || !Array.isArray(g.transports) || g.transports.length === 0)
      return { problems: [`gate entry missing {id, invocation, transports}: ${JSON.stringify(g)}`] };
    if (seen.has(g.id)) problems.push(`duplicate gate id '${g.id}'`);
    seen.add(g.id);
    for (const tr of g.transports) {
      const file = transports[tr];
      if (!file) { problems.push(`gate '${g.id}' names unknown transport '${tr}'`); continue; }
      const path = join(root, file);
      if (!existsSync(path)) { problems.push(`transport '${tr}' (${file}) is missing`); continue; }
      const text = readFileSync(path, "utf8");
      if (!text.includes(g.invocation))
        problems.push(`gate '${g.id}' is missing from transport '${tr}' (${file}) — the invocation text is not there\n  fix: restore the line '${g.invocation}'`);
    }
  }
  // Reverse direction: every `node tools/...` invocation in a transport (per chain
  // segment) must be declared — none other.
  for (const [tr, file] of Object.entries(transports)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(INVOCATION_RE)) {
      const found = m[0].trim().replace(/\s+/g, " ");
      if (!declared(found))
        problems.push(`transport '${tr}' carries an undeclared invocation: '${found}'\n  fix: declare it in ${REGISTRY_PATH} or remove it`);
    }
  }
  return { problems, gates: registry.gates.length };
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("gate-registry --self-test");

  const build = (mutate) => {
    const root = mkdtempSync(join(tmpdir(), "picasso-reg-"));
    mkdirSync(join(root, "docs/gates"), { recursive: true });
    const registry = { gates: [
      { id: "task-coverage-staged", invocation: "node tools/task-coverage.mjs --staged", transports: ["pre-commit"] },
      { id: "task-state-self-test", invocation: "node tools/task-state.mjs --self-test", transports: ["battery"] },
      { id: "task-state-metrics", invocation: "node tools/task-state.mjs metrics", transports: ["battery"] },
    ] };
    const files = {
      ".githooks/pre-commit": "#!/bin/sh\nnode tools/task-coverage.mjs --staged || exit 1\n",
      "package.json": JSON.stringify({ scripts: { selftest:
        "node tools/task-state.mjs --self-test && node tools/task-state.mjs metrics" } }),
    };
    mutate?.(registry, files);
    writeFileSync(join(root, "docs/gates/gate-registry.json"), JSON.stringify(registry));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    return { root, result: check({ root, transports: { "pre-commit": ".githooks/pre-commit", battery: "package.json" } }) };
  };

  const cases = [
    ["clean registry passes", b => b, r => r.problems.length === 0],
    ["missing invocation in transport is drift", (reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\n# gate dropped\n"; }, r => r.problems.some(p => p.includes("missing from transport"))],
    ["undeclared invocation in transport is a shadow gate", (reg, files) => { files[".githooks/pre-commit"] += "node tools/task-coverage.mjs --doctor || exit 1\n"; }, r => r.problems.some(p => p.includes("undeclared invocation"))],
    ["an undeclared invocation HIDING MID-CHAIN in the battery is caught", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest:
        "node tools/task-state.mjs --self-test && node tools/lint-budget.mjs --set 99 && node tools/task-state.mjs metrics" } });
    }, r => r.problems.some(p => p.includes("lint-budget.mjs --set 99"))],
    ["a declared invocation mid-chain is not flagged", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest:
        "node tools/task-state.mjs --self-test && node tools/task-state.mjs metrics && true" } });
    }, r => r.problems.length === 0],
    ["duplicate gate ids refused", reg => { reg.gates.push({ ...reg.gates[0] }); }, r => r.problems.some(p => p.includes("duplicate gate id"))],
    ["gate naming an unknown transport is refused", reg => { reg.gates[0].transports = ["nope"]; }, r => r.problems.some(p => p.includes("unknown transport"))],
  ];
  for (const [name, mutate, verdict] of cases) {
    const b = build(mutate);
    ok(name, verdict(b.result));
    rmSync(b.root, { recursive: true, force: true });
  }

  console.log(failures.length ? `gate-registry: ${failures.length} self-test failure(s)` : "gate-registry: self-test clean");
  if (failures.length) process.exit(1);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const { problems, gates } = check();
  if (problems.length) die(problems.join("\n"));
  console.log(`gate-registry: ${gates} gate(s), every declaration present in every transport`);
}
