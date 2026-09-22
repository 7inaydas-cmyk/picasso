#!/usr/bin/env node
/**
 * TASK-STATE — picasso's front-end task lifecycle, ported from stallion's contract.
 *
 * Phases: intake → planned → executing → verified → adversarial → done.
 * Risk classes: ui-runtime (components/pages/hooks), styles (tokens/css),
 * tooling (harness + build config), docs.
 *
 * Laws carried over from stallion:
 *   - Code lands only under a task; the commit footer `task: <id>` binds it.
 *   - Scope is append-only, declared at planned; fences refuse code outside it.
 *   - `verified` needs a red-check pin (recorded FAILING, then green) AND a green
 *     selftest battery. `done` needs an adversarial findings record, every pin
 *     re-run green, and the battery green again.
 *
 * Usage:
 *   task-state.mjs new <id> --risk-class <class>
 *   task-state.mjs scope <id> --add "<glob>"
 *   task-state.mjs red-check <id> --command "<failing check>"
 *   task-state.mjs advance <id> [--findings <file>]   (done requires --findings)
 *   task-state.mjs status | metrics
 *   task-state.mjs --self-test
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PHASES } from "./task-coverage.mjs";

const RISK_CLASSES = ["ui-runtime", "styles", "tooling", "docs"];
// Phases under which code may land (the commit footer's task must be in one of these).
const CODE_PHASES = ["executing", "verified", "adversarial", "done"];

const tasksDir = () => process.env.PICASSO_TASKS_DIR || ".tasks";

function die(msg) { console.error(`task-state: ${msg}`); process.exit(1); }
function taskPath(id) { return join(tasksDir(), `${id}.json`); }

function loadTask(id) {
  const p = taskPath(id);
  if (!existsSync(p)) die(`unknown task '${id}'\n  fix: task-state.mjs new ${id} --risk-class <class>`);
  return JSON.parse(readFileSync(p, "utf8"));
}
function saveTask(t) {
  mkdirSync(tasksDir(), { recursive: true });
  writeFileSync(taskPath(t.id), JSON.stringify(t, null, 2) + "\n");
}

function run(cmd) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

// Pins are recorded as full shell lines — a quoted one-liner must re-run whole,
// not shattered on spaces.
function runShell(command) {
  const r = spawnSync(command, { shell: true, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

function rerunPins(t) {
  for (const pin of t.pins || []) {
    const r = runShell(pin.command);
    if (r.code !== 0) return { ok: false, pin: pin.command, out: r.out };
  }
  return { ok: true };
}

function selftestGreen() {
  const cmd = (process.env.PICASSO_SELFTEST_CMD || "npm run selftest").split(" ");
  const r = run(cmd);
  return r.code === 0 ? { ok: true } : { ok: false, out: r.out };
}

function cmdNew(args) {
  const id = args[0];
  const rc = flagValue(args, "--risk-class");
  if (!id || !rc) die("usage: task-state.mjs new <id> --risk-class <class>");
  if (!RISK_CLASSES.includes(rc)) die(`risk-class '${rc}' not one of: ${RISK_CLASSES.join(", ")}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) die(`id '${id}' must be kebab-case`);
  if (existsSync(taskPath(id))) die(`task '${id}' already exists`);
  saveTask({ id, phase: "intake", riskClass: rc, scope: [], pins: [],
    created: new Date().toISOString(), history: [{ at: new Date().toISOString(), to: "intake" }] });
  console.log(`task-state: ${id} opened at intake (risk-class ${rc})`);
}

function cmdScope(args) {
  const id = args[0];
  const add = flagValue(args, "--add");
  const t = loadTask(id);
  if (!add) { console.log(`${id} scope:`); t.scope.forEach(s => console.log(`  ${s}`)); return; }
  if (t.scope.includes(add)) die(`scope already declares '${add}'`);
  if (!["intake", "planned"].includes(t.phase))
    die(`scope is declared at planned and append-only until then; '${id}' is at ${t.phase}`);
  t.scope.push(add);
  saveTask(t);
  console.log(`task-state: ${id} scope + '${add}' (${t.scope.length} declared)`);
}

function cmdRedCheck(args) {
  const id = args[0];
  const command = flagValue(args, "--command");
  const t = loadTask(id);
  if (!command) die('usage: task-state.mjs red-check <id> --command "<failing check>"');
  if (!["executing", "verified"].includes(t.phase))
    die(`red-check records a failing check mid-flight; '${id}' is at ${t.phase}`);
  const r = runShell(command);
  if (r.code === 0)
    die(`refused: the command PASSED — a red-check pin must FAIL when recorded\n  fix: record a check that genuinely fails, then make it pass`);
  t.pins.push({ command, recordedExit: r.code,
    evidence: r.out.trim().split("\n").slice(-4).join("\n") || "(no output)", at: new Date().toISOString() });
  saveTask(t);
  console.log(`task-state: pin recorded (exit ${r.code}): ${command}`);
}

function cmdAdvance(t, findingsFile) {
  const next = PHASES[PHASES.indexOf(t.phase) + 1];
  if (!next) die(`'${t.id}' is already done`);
  if (next === "planned" && t.scope.length === 0)
    die(`refused: planned requires DECLARED scope\n  fix: task-state.mjs scope ${t.id} --add "tools/**"`);
  if (next === "verified") {
    if ((t.pins || []).length === 0)
      die(`refused: verified needs a red-check pin\n  fix: task-state.mjs red-check ${t.id} --command "<failing check>"`);
    const pins = rerunPins(t);
    if (!pins.ok) die(`refused: pin '${pins.pin}' is not green\n${pins.out.slice(-400)}`);
    const st = selftestGreen();
    if (!st.ok) die(`refused: selftest battery is red\n${st.out.slice(-400)}\n  fix: make npm run selftest green first`);
  }
  if (next === "adversarial") {
    const st = selftestGreen();
    if (!st.ok) die(`refused: selftest battery is red at the phase boundary\n${st.out.slice(-400)}`);
  }
  if (next === "done") {
    if (!findingsFile || !existsSync(findingsFile))
      die(`refused: done needs a prepared adversarial pass\n  fix: task-state.mjs advance ${t.id} --findings docs/tasks/${t.id}.adversarial.json`);
    let f;
    try { f = JSON.parse(readFileSync(findingsFile, "utf8")); }
    catch (e) { die(`refused: findings file does not parse: ${e.message}`); }
    const probes = f.probes || [];
    if (probes.length < 3) die(`refused: adversarial pass needs >= 3 probes, got ${probes.length}`);
    for (const p of probes)
      if (!p.name || !p.command || typeof p.exitCode !== "number" || !p.evidence)
        die("refused: probe missing {name, command, exitCode, evidence}");
    if (!probes.some(p => p.exitCode !== 0))
      die("refused: no probe observed an actual refusal (every exitCode is 0)");
    const pins = rerunPins(t);
    if (!pins.ok) die(`refused: pin '${pins.pin}' not green at done\n${pins.out.slice(-400)}`);
    const st = selftestGreen();
    if (!st.ok) die(`refused: selftest battery is red at done\n${st.out.slice(-400)}`);
    t.adversarial = { findings: findingsFile, probes: probes.length, clean: true, at: new Date().toISOString() };
  }
  t.phase = next;
  t.history.push({ at: new Date().toISOString(), to: next });
  saveTask(t);
  console.log(`task-state: ${t.id} → ${next}`);
}

function cmdStatus() {
  const rows = listTasks().map(t => `${t.id.padEnd(28)} ${t.phase.padEnd(12)} ${t.riskClass}`);
  console.log(rows.length ? rows.join("\n") : "(no tasks)");
}

function cmdMetrics() {
  const tasks = listTasks();
  const byPhase = Object.groupBy(tasks, t => t.phase);
  const pins = tasks.reduce((n, t) => n + (t.pins?.length || 0), 0);
  console.log(`tasks ${tasks.length} | pins ${pins} | ` +
    PHASES.map(p => `${p} ${(byPhase[p] || []).length}`).join(" "));
}

function listTasks() {
  if (!existsSync(tasksDir())) return [];
  return readdirSync(tasksDir()).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(tasksDir(), f), "utf8")));
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---- self-test: run the real CLI as a subprocess and prove the refusals discriminate ----
function selfTest() {
  const SELF = new URL(import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), "picasso-ts-"));
  const env = { ...process.env, PICASSO_TASKS_DIR: dir, PICASSO_SELFTEST_CMD: "true" };
  const failures = [];
  const call = (args, envOverrides) => {
    const r = spawnSync("node", [SELF, ...args], { encoding: "utf8", env: { ...env, ...envOverrides } });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };

  console.log("task-state --self-test");
  ok("new opens at intake", call(["new", "probe", "--risk-class", "tooling"]).code === 0);
  ok("new refuses unknown risk-class", call(["new", "x", "--risk-class", "nope"]).code !== 0);
  ok("new refuses non-kebab id", call(["new", "Bad_Id", "--risk-class", "docs"]).code !== 0);
  ok("advance refuses planned with empty scope", call(["advance", "probe"]).code !== 0);
  ok("scope add lands", call(["scope", "probe", "--add", "tools/**"]).code === 0);
  ok("scope refuses duplicates", call(["scope", "probe", "--add", "tools/**"]).code !== 0);
  ok("advance reaches planned", call(["advance", "probe"]).code === 0);
  ok("advance reaches executing", call(["advance", "probe"]).code === 0);
  ok("scope refuses after executing", call(["scope", "probe", "--add", "docs/**"]).code !== 0);
  ok("verified refuses with no pin", call(["advance", "probe"]).code !== 0);
  ok("red-check refuses a passing command", call(["red-check", "probe", "--command", "true"]).code !== 0);

  // A red-check that fails at record time, then turns green: the flag file is absent now.
  const flag = join(dir, "flag");
  const rc = call(["red-check", "probe", "--command", `test -f ${flag}`]);
  ok("red-check records a genuinely failing command", rc.code === 0);
  ok("verified still refuses while the pin is red", call(["advance", "probe"]).code !== 0);
  closeSync(openSync(flag, "w"));
  ok("verified lands when pin is green + battery green", call(["advance", "probe"]).code === 0);
  ok("adversarial lands on green battery", call(["advance", "probe"]).code === 0);

  // A QUOTED shell one-liner pin must record and re-run whole, not shattered.
  const q = call(["new", "quoted-probe", "--risk-class", "tooling"]);
  call(["scope", "quoted-probe", "--add", "tools/**"]);
  call(["advance", "quoted-probe"]); call(["advance", "quoted-probe"]);
  const qflag = join(dir, "q flag with spaces.txt");
  const qrc = call(["red-check", "quoted-probe", "--command", `sh -c 'test -f "${qflag}"'`]);
  ok("red-check records a quoted one-liner", qrc.code === 0);
  ok("verified refuses while the quoted pin is red", call(["advance", "quoted-probe"]).code !== 0);
  writeFileSync(qflag, "x");
  ok("verified re-runs the quoted pin green (shell semantics)", call(["advance", "quoted-probe"]).code === 0);

  const good = { probes: [
    { name: "footer fence", command: "commit-msg probe", exitCode: 1, evidence: "refused: no task: footer" },
    { name: "scope fence", command: "staged probe", exitCode: 1, evidence: "refused: outside declared scope" },
    { name: "doctor", command: "doctor probe", exitCode: 0, evidence: "wiring intact" }] };
  writeFileSync(join(dir, "good.json"), JSON.stringify(good));
  ok("done refuses without findings", call(["advance", "probe"]).code !== 0);
  writeFileSync(join(dir, "thin.json"), JSON.stringify({ probes: good.probes.slice(0, 1) }));
  ok("done refuses a thin adversarial record", call(["advance", "probe", "--findings", join(dir, "thin.json")]).code !== 0);
  writeFileSync(join(dir, "fake.json"), JSON.stringify({ probes: good.probes.map(p => ({ ...p, exitCode: 0 })) }));
  ok("done refuses when no probe saw a refusal", call(["advance", "probe", "--findings", join(dir, "fake.json")]).code !== 0);
  ok("done lands on a real adversarial record", call(["advance", "probe", "--findings", join(dir, "good.json")]).code === 0);
  ok("done is terminal", call(["advance", "probe"]).code !== 0);

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `task-state: ${failures.length} self-test failure(s)` : "task-state: self-test clean");
  if (failures.length) process.exit(1);
}

// Import-safe (task-coverage's law is imported above): dispatch only as entry point.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && (() => {
  try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; }
  catch { return false; }
})();
if (!invokedDirectly) {
  // imported for the law — dispatch nothing
} else {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "--self-test": selfTest(); break;
    case "new": cmdNew(rest); break;
    case "scope": cmdScope(rest); break;
    case "red-check": cmdRedCheck(rest); break;
    case "advance": cmdAdvance(loadTask(rest[0]), flagValue(rest, "--findings")); break;
    case "status": cmdStatus(); break;
    case "metrics": cmdMetrics(); break;
    default: die("usage: task-state.mjs <new|scope|red-check|advance|status|metrics> (--self-test to self-test)");
  }
}
