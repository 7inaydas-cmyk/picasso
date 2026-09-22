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
  battery: "package.json",
};

function die(message) { console.error(`gate-registry: ${message}`); process.exit(1); }

export function check({ root = ROOT, registryPath = join(root, REGISTRY_PATH), transports = TRANSPORTS } = {}) {
  const problems = [];
  if (!existsSync(registryPath)) return { problems: [`${REGISTRY_PATH} is missing — an undeclared gate list checks nothing`] };
  let registry;
  try { registry = JSON.parse(readFileSync(registryPath, "utf8")); }
  catch (e) { return { problems: [`${REGISTRY_PATH} does not parse: ${e.message}`] }; }
  if (!Array.isArray(registry.gates) || registry.gates.length === 0)
    return { problems: [`${REGISTRY_PATH} declares no gates`] };
  const seen = new Set();
  for (const g of registry.gates) {
    if (!g.id || !g.invocation || !Array.isArray(g.transports) || g.transports.length === 0)
      return { problems: [`gate entry missing {id, invocation, transports}: ${JSON.stringify(g)}`] };
    if (seen.has(g.id)) problems.push(`duplicate gate id '${g.id}'`);
    seen.add(g.id);
    for (const tr of g.transports) {
      const file = transports[tr];
      if (!file) { problems.push(`gate '${g.id}' names unknown transport '${tr}'`); continue; }
      const path = join(root, file);
      if (!existsSync(file) && !existsSync(path)) { problems.push(`transport '${tr}' (${file}) is missing`); continue; }
      const text = readFileSync(existsSync(path) ? path : file, "utf8");
      if (!text.includes(g.invocation))
        problems.push(`gate '${g.id}' is missing from transport '${tr}' (${file}) — the invocation text is not there\n  fix: restore the line '${g.invocation}'`);
    }
  }
  // Reverse direction: any `node tools/...mjs ...` invocation in a transport must be declared.
  for (const [tr, file] of Object.entries(transports)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(/node tools\/[a-z-]+\.mjs[^"'`\n]*/g)) {
      const found = m[0].trim();
      if (!registry.gates.some(g => found.startsWith(g.invocation) || g.invocation.startsWith(found)))
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
      { id: "task-state-metrics", invocation: "node tools/task-state.mjs metrics", transports: ["battery"] },
    ] };
    const files = {
      ".githooks/pre-commit": "#!/bin/sh\nnode tools/task-coverage.mjs --staged || exit 1\n",
      "package.json": JSON.stringify({ scripts: { selftest: "node tools/task-state.mjs metrics" } }),
    };
    mutate?.(registry, files);
    writeFileSync(join(root, "docs/gates/gate-registry.json"), JSON.stringify(registry));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    return { root, result: check({ root, transports: { "pre-commit": ".githooks/pre-commit", battery: "package.json" } }) };
  };

  const clean = build();
  ok("clean registry passes", clean.result.problems.length === 0);
  rmSync(clean.root, { recursive: true, force: true });

  const drift = build((reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\n# gate dropped\n"; });
  ok("missing invocation in transport is drift", drift.result.problems.some(p => p.includes("missing from transport")));
  rmSync(drift.root, { recursive: true, force: true });

  const shadow = build((reg, files) => { files[".githooks/pre-commit"] += "node tools/task-coverage.mjs --doctor || exit 1\n"; });
  ok("undeclared invocation in transport is a shadow gate", shadow.result.problems.some(p => p.includes("undeclared invocation")));
  rmSync(shadow.root, { recursive: true, force: true });

  const dupe = build(reg => { reg.gates.push({ ...reg.gates[0] }); });
  ok("duplicate gate ids refused", dupe.result.problems.some(p => p.includes("duplicate gate id")));
  rmSync(dupe.root, { recursive: true, force: true });

  const broken = build((reg, files) => { files["package.json"] = "{ nope"; });
  ok("empty battery transport still parses as text, missing gate caught", broken.result.problems.length > 0);
  rmSync(broken.root, { recursive: true, force: true });

  console.log(failures.length ? `gate-registry: ${failures.length} self-test failure(s)` : "gate-registry: self-test clean");
  if (failures.length) process.exit(1);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const { problems, gates } = check();
  if (problems.length) die(problems.join("\n"));
  console.log(`gate-registry: ${gates} gate(s), every declaration present in every transport`);
}
