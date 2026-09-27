#!/usr/bin/env node
/**
 * GATE-REGISTRY — picasso's gate invocations, declared once, drift-checked everywhere.
 *
 * Ported from stallion's law: every gate invocation is declared ONCE in
 * docs/gates/gate-registry.json with the transports that must carry it. Both
 * directions fail:
 *   1. a declared gate a transport does not LIVE-carry (drift). Carrying means
 *      run: not commented out, not echoed, its failure not swallowed (|| true),
 *      and not extended — an extra flag is a different invocation.
 *   2. a transport carrying a `node tools/...` (or plugin/) invocation the
 *      registry does not declare exactly (an unwired shadow gate)
 * The battery is package.json's selftest script — the one the phase
 * boundaries run — not any script in the file; other scripts are 'scripts'.
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
import { spawnSync } from "node:child_process";
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
  scripts: "package.json",
};
// The text a transport carries, out of its file.
const scriptsOf = raw => { try { return JSON.parse(raw).scripts ?? {}; } catch { return {}; } };
const PICK = {
  battery: raw => String(scriptsOf(raw).selftest ?? ""),
  scripts: raw => Object.values(scriptsOf(raw)).join("\0"),
};
const carried = (tr, raw) => (PICK[tr] ?? (x => x))(raw);

// Does the transport RUN the invocation? Carrier shapes are strict — a looser
// match is a way to keep a gate "present" while it no longer bites:
//   hooks    an exact gate line: '<invocation> || exit 1' ('"$1"' for commit-msg)
//   battery  a plain '&&' chain, one line, EVERY segment a declared invocation —
//            the battery is the gate list; an 'exit 0 &&' carries nothing
//   scripts  a plain '&&' chain, one line, with a segment exactly the invocation
//            (any other operator, a line break, or an exit/true/: segment makes
//            the script carry nothing)
//   ci       a single-line 'run:' step, exactly the invocation (arguments only
//            as [object Object] expressions or plain words), in a workflow triggered
//            'on: [push, pull_request]' with no 'if:', 'shell:', 'env:',
//            'defaults:' or continue-on-error
const SHELL_OPS = /\|\||&&|[;|&`<>]|\$\(/;
const HOOKS = ["pre-commit", "commit-msg", "pre-push"];
export function carries(tr, text, invocation, declared = new Set([invocation])) {
  if (HOOKS.includes(tr))
    return text.split("\n").some(l => [`${invocation} || exit 1`, `${invocation} "$1" || exit 1`].includes(l.trim()));
  if (tr === "battery" || tr === "scripts")
    return text.split("\0").some(script => {
      const segs = script.split(" && ").map(x => x.trim());
      if (/[\r\n]/.test(script) || segs.some(x => SHELL_OPS.test(x) || /^(exit\b|true$|false$|:$)/.test(x))) return false;
      return segs.includes(invocation) && (tr === "scripts" || segs.every(x => declared.has(x)));
    });
  if (tr === "ci") {
    if (!/^on:\s*\[\s*push\s*,\s*pull_request\s*\]\s*$/m.test(text) || /continue-on-error|^\s*(-\s+)?(if|shell|env|defaults):/m.test(text)) return false;
    return text.split("\n").some(line => {
      const m = line.match(/^\s*(?:-\s+)?run:\s*(.+?)\s*$/);
      if (!m || /^[|>]/.test(m[1])) return false;
      const cmd = m[1].replace(/\$\{\{[\s\S]*?\}\}/g, "EXPR");
      return cmd === invocation || (cmd.startsWith(`${invocation} `) && !SHELL_OPS.test(cmd.slice(invocation.length)));
    });
  }
  return text.includes(invocation);
}

function die(message) { console.error(`gate-registry: ${message}`); process.exit(1); }

// `&` and `|` are excluded from the match so chain operators terminate it.
const INVOCATION_RE = /node (?:\.\/)?(?:tools|plugin)\/[a-z/-]+\.mjs[^"'`\n&|]*/g;

export function check({ root = ROOT, registryPath = join(root, REGISTRY_PATH), transports = TRANSPORTS } = {}) {
  const problems = [];
  if (!existsSync(registryPath)) return { problems: [`${REGISTRY_PATH} is missing — an undeclared gate list checks nothing`] };
  let registry;
  try { registry = JSON.parse(readFileSync(registryPath, "utf8")); }
  catch (e) { return { problems: [`${REGISTRY_PATH} does not parse: ${e.message}`] }; }
  if (!Array.isArray(registry.gates) || registry.gates.length === 0)
    return { problems: [`${REGISTRY_PATH} declares no gates`] };
  const seen = new Set();
  const declared = inv => registry.gates.some(g => g.invocation === inv);
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
      if (!carries(tr, carried(tr, readFileSync(path, "utf8")), g.invocation, new Set(registry.gates.map(x => x.invocation))))
        problems.push(`gate '${g.id}' is missing from transport '${tr}' (${file}) — no carrier of the strict shape runs it (commented, echoed, swallowed, conditional, or extended lines do not count)\n  fix: restore the line '${g.invocation}'`);
    }
  }
  // Reverse direction: every `node tools/...` invocation in a gate transport (per
  // chain segment) must be declared exactly. 'scripts' is forward-only: npm
  // aliases for the tools' CLIs live there and are not gates.
  for (const [tr, file] of Object.entries(transports)) {
    if (tr === "scripts") continue;
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = carried(tr, readFileSync(path, "utf8"));
    for (const m of text.matchAll(INVOCATION_RE)) {
      const found = m[0].trim().replace(/\s+/g, " ").replace("node ./", "node ");
      if (!declared(found))
        problems.push(`transport '${tr}' carries an undeclared invocation: '${found}'\n  fix: declare it in ${REGISTRY_PATH} or remove it`);
    }
  }
  return { problems: [...new Set(problems)], gates: registry.gates.length };
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
      { id: "ci-fence", invocation: "node tools/task-coverage.mjs --base", transports: ["ci"] },
    ] };
    const files = {
      ".githooks/pre-commit": "#!/bin/sh\nnode tools/task-coverage.mjs --staged || exit 1\n",
      "package.json": JSON.stringify({ scripts: { selftest:
        "node tools/task-state.mjs --self-test && node tools/task-state.mjs metrics" } }),
      ".github/workflows/selftest.yml": 'on: [push, pull_request]\njobs:\n  a:\n    steps:\n      - run: node tools/task-coverage.mjs --base "${{ github.event.before }}"\n',
    };
    mutate?.(registry, files);
    writeFileSync(join(root, "docs/gates/gate-registry.json"), JSON.stringify(registry));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    return { root, result: check({ root, transports: { "pre-commit": ".githooks/pre-commit", battery: "package.json", ci: ".github/workflows/selftest.yml" } }) };
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
        "node tools/task-state.mjs metrics && node tools/task-state.mjs --self-test" } });
    }, r => r.problems.length === 0],
    ["duplicate gate ids refused", reg => { reg.gates.push({ ...reg.gates[0] }); }, r => r.problems.some(p => p.includes("duplicate gate id"))],
    ["gate naming an unknown transport is refused", reg => { reg.gates[0].transports = ["nope"]; }, r => r.problems.some(p => p.includes("unknown transport"))],
    ["a commented-out gate line does not carry the gate", (reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\n# node tools/task-coverage.mjs --staged || exit 1\n"; }, r => r.problems.some(p => p.includes("missing from transport"))],
    ["an echoed gate line does not carry the gate", (reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\necho node tools/task-coverage.mjs --staged\n"; }, r => r.problems.some(p => p.includes("missing from transport"))],
    ["a gate whose failure is swallowed does not carry the gate", (reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\nnode tools/task-coverage.mjs --staged || true\n"; }, r => r.problems.some(p => p.includes("missing from transport"))],
    ["a declared gate carrying an extra flag is a different, undeclared invocation", (reg, files) => { files[".githooks/pre-commit"] = "#!/bin/sh\nnode tools/task-coverage.mjs --staged --self-test || exit 1\n"; }, r => r.problems.some(p => p.includes("undeclared invocation")) && r.problems.some(p => p.includes("missing from transport"))],
    ["a CI step allowed to fail carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] += "        continue-on-error: true\n"; }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["a conditional CI step carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] = files[".github/workflows/selftest.yml"].replace("      - run:", "      - if: false\n        run:"); }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["a CI run whose failure is swallowed carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] = files[".github/workflows/selftest.yml"].replace(/"\n$/, '" || true\n'); }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["a CI run with a command substitution carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] = files[".github/workflows/selftest.yml"].replace(/"\$\{\{ github.event.before \}\}"/, '"$(git rev-parse HEAD~1)"'); }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["a CI workflow not run on push and pull_request carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] = files[".github/workflows/selftest.yml"].replace("on: [push, pull_request]", "on: [workflow_dispatch]"); }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["a battery swallowing its failures carries nothing", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest: "node tools/task-state.mjs --self-test && node tools/task-state.mjs metrics && true || true" } });
    }, r => r.problems.some(p => p.includes("task-state-metrics"))],
    ["a battery that exits before its gates carries nothing", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest: "exit 0 && node tools/task-state.mjs --self-test && node tools/task-state.mjs metrics" } });
    }, r => r.problems.some(p => p.includes("task-state-self-test"))],
    ["a battery with an undeclared step carries nothing", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest: "node tools/task-state.mjs --self-test && echo skipped && node tools/task-state.mjs metrics" } });
    }, r => r.problems.some(p => p.includes("task-state-metrics"))],
    ["a battery split across lines carries nothing", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest: "exit 0\nnode tools/task-state.mjs --self-test && node tools/task-state.mjs metrics" } });
    }, r => r.problems.some(p => p.includes("task-state-metrics"))],
    ["a CI job with a custom shell carries nothing", (reg, files) => { files[".github/workflows/selftest.yml"] = files[".github/workflows/selftest.yml"].replace("    steps:", "    defaults:\n      run:\n        shell: sh -c 'exit 0' {0}\n    steps:"); }, r => r.problems.some(p => p.includes("ci-fence"))],
    ["'node ./tools/…' is seen by the shadow sweep", (reg, files) => { files[".githooks/pre-commit"] += "node ./tools/lint-budget.mjs --set 9 || exit 1\n"; }, r => r.problems.some(p => p.includes("lint-budget.mjs --set 9"))],
    ["the battery is the selftest script, not any script in package.json", (reg, files) => {
      files["package.json"] = JSON.stringify({ scripts: { selftest: "node tools/task-state.mjs --self-test", other: "node tools/task-state.mjs metrics" } });
    }, r => r.problems.some(p => p.includes("task-state-metrics"))],
  ];
  // The CLI's own refusal path: a drifted registry prints the rule and the fix,
  // it does not crash on the way out.
  {
    const root = mkdtempSync(join(tmpdir(), "picasso-reg-cli-"));
    mkdirSync(join(root, "tools"), { recursive: true });
    mkdirSync(join(root, "docs/gates"), { recursive: true });
    writeFileSync(join(root, "tools/gate-registry.mjs"), readFileSync(fileURLToPath(import.meta.url), "utf8"));
    writeFileSync(join(root, "docs/gates/gate-registry.json"), JSON.stringify({ gates: [{ id: "gone", invocation: "node tools/x.mjs", transports: ["pre-commit"] }] }));
    const r = spawnSync(process.execPath, [join(root, "tools/gate-registry.mjs")], { encoding: "utf8" });
    ok("the CLI refuses a drifted registry with its message, not a crash",
      r.status === 1 && /^gate-registry: /.test(r.stderr) && !/Error/.test(r.stderr));
    rmSync(root, { recursive: true, force: true });
  }
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
