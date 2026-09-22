#!/usr/bin/env node
/**
 * TASK-COVERAGE — picasso's binding gate, ported from stallion's fence trio.
 *
 * The 'task:' footer must name an in-flight task whose DECLARED scope covers the
 * changed code. Refused three times, in three transports:
 *   --staged      pre-commit: refuse at stage time, one action from the mistake
 *   --commit-msg  commit-msg: the footer must sit in the FINAL TRAILER BLOCK,
 *                 name an in-flight task, and that task's scope must cover what
 *                 is staged
 *   (default)     pre-push: re-judge EVERY commit in the push range; an
 *                 unresolvable base REFUSES rather than guessing
 *   --doctor      the gate for the gate: an unwired clone refuses to push
 *
 * Usage:
 *   task-coverage.mjs --staged | --commit-msg <file> | --push | --doctor
 *   task-coverage.mjs --self-test
 */

import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CODE_PHASES = ["executing", "verified", "adversarial", "done"];

function die(msg) { console.error(`task-coverage: ${msg}`); process.exit(1); }

function git(args, opts = {}) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd: opts.cwd || ROOT, ...opts });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// Glob → RegExp. 'tools/**' covers everything under tools/; 'package.json' is
// exact-or-directory (a bare dir pattern covers its subtree); '*' within a
// segment; '?' one char.
export function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function pathMatches(path, patterns) {
  return patterns.some(p => {
    if (globToRegex(p).test(path)) return true;
    // A pattern without wildcards names a path: it matches itself and its subtree.
    if (!/[*?]/.test(p)) return path === p || path.startsWith(p.replace(/\/$/, "") + "/");
    return false;
  });
}

function tasksDir() { return process.env.PICASSO_TASKS_DIR || join(ROOT, ".tasks"); }

function inFlightTasks() {
  if (!existsSync(tasksDir())) return [];
  return readdirSync(tasksDir()).filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(tasksDir(), f), "utf8")))
    .filter(t => CODE_PHASES.includes(t.phase));
}

// The one task-lookup seam: returns null (with a reason) for unknown tasks, so
// every caller refuses cleanly instead of crashing on a missing file.
function taskById(id) {
  const t = inFlightTasks().find(x => x.id === id);
  if (t) return t;
  const p = join(tasksDir(), `${id}.json`);
  if (!existsSync(p))
    return { error: `task '${id}' has no register file at all\n  fix: open it (task-state.mjs new ${id} --risk-class <class>), or fix the footer id` };
  const parked = JSON.parse(readFileSync(p, "utf8"));
  return { error: `task '${id}' is parked at '${parked.phase}' — not a code phase\n  fix: advance it to executing, or bind the commit to a live task` };
}

// The footer law: exactly one 'task: <id>' line, in the FINAL paragraph of the
// message (the trailer block). A 'task:' line mid-body is not a trailer and
// does not bind the commit.
export function footerTaskId(message) {
  const paragraphs = message.trim().split(/\n\s*\n/);
  const trailer = paragraphs[paragraphs.length - 1] || "";
  const matches = [...trailer.matchAll(/^task:\s*([a-z0-9][a-z0-9-]*)\s*$/gim)];
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error(`${matches.length} 'task:' footers in the trailer block — exactly one binds a commit`);
  return matches[0][1];
}

function cmdStaged() {
  const diff = git(["diff", "--cached", "--name-only"]);
  if (diff.code !== 0) die(`refused: cannot read the staged file list\n${diff.out}\n  fix: run inside the work tree, with a healthy git index`);
  const files = diff.out.split("\n").filter(Boolean);
  if (files.length === 0) return console.log("task-coverage: nothing staged");
  const tasks = inFlightTasks();
  const uncovered = files.filter(f => !tasks.some(t => pathMatches(f, t.scope)));
  if (uncovered.length)
    die(`refused: staged code outside every declared scope:\n  ${uncovered.join("\n  ")}\n` +
        `rule: code lands only under an in-flight task whose scope covers it\n` +
        `  fix: node tools/task-state.mjs scope <id> --add "<glob>" (at planned), or unstage`);
  console.log(`task-coverage: ${files.length} staged file(s) covered`);
}

function cmdCommitMsg(file) {
  if (!file || !existsSync(file)) die("usage: task-coverage.mjs --commit-msg <file>");
  const message = readFileSync(file, "utf8");
  let id;
  try { id = footerTaskId(message); }
  catch (e) { die(`refused: ${e.message}\n  fix: keep exactly one 'task: <id>' trailer`); }
  if (!id)
    die(`refused: no 'task: <id>' footer in the message's final trailer block\n` +
        `rule: commits that touch code carry a task footer in the trailer block — a 'task:' line mid-body does not bind\n` +
        `  fix: end the message with a blank line, then a single 'task: <in-flight-id>' line`);
  const t = taskById(id);
  if (t.error) die(`refused: footer names '${id}', which is not an in-flight code task\n${t.error}`);
  const files = git(["diff", "--cached", "--name-only"]).out.split("\n").filter(Boolean);
  const uncovered = files.filter(f => !pathMatches(f, t.scope));
  if (uncovered.length)
    die(`refused: staged code outside '${id}' declared scope:\n  ${uncovered.join("\n  ")}\n` +
        `  fix: commit under a task whose scope covers it, or unstage`);
  console.log(`task-coverage: footer binds '${id}' (${t.phase}); staged files covered`);
}

function cmdPush() {
  const base = resolveBase();
  const log = git(["log", "--format=%H%x1f%B%x1e", `${base}..HEAD`]);
  if (log.code !== 0) die(`refused: cannot read range ${base}..HEAD\n${log.out}`);
  const commits = log.out.split("\x1e").map(s => s.trim()).filter(Boolean);
  if (commits.length === 0) return console.log("task-coverage: nothing to push");
  for (const c of commits) {
    const [hash, ...bodyParts] = c.split("\x1f");
    const body = bodyParts.join("\x1f");
    let id;
    try { id = footerTaskId(body); }
    catch (e) { die(`refused: commit ${hash.slice(0, 7)}: ${e.message}`); }
    if (!id)
      die(`refused: commit ${hash.slice(0, 7)} carries no 'task:' footer in its trailer block\n` +
          `rule: the push fence re-judges every commit in the range\n  fix: rebase and amend a footer onto it`);
    const t = taskById(id);
    if (t.error) die(`refused: commit ${hash.slice(0, 7)}: ${t.error}`);
    const files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", hash]).out.split("\n").filter(Boolean);
    const uncovered = files.filter(f => !pathMatches(f, t.scope));
    if (uncovered.length)
      die(`refused: commit ${hash.slice(0, 7)} touches code outside '${id}' declared scope:\n  ${uncovered.join("\n  ")}\n  fix: split the commit, or widen scope on a follow-up task covering it`);
  }
  console.log(`task-coverage: ${commits.length} commit(s) in range judged clean`);
}

function resolveBase() {
  const configured = git(["config", "--get", "picasso.push-base"]);
  if (configured.code === 0 && configured.out.trim()) return configured.out.trim();
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.code === 0 && upstream.out.trim()) return upstream.out.trim();
  die(`refused: no push base resolvable (no upstream, no picasso.push-base)\n` +
      `rule: an unresolvable base REFUSES rather than guessing\n  fix: git branch --set-upstream-to=origin/<branch> or git config picasso.push-base <ref>`);
}

function cmdDoctor() {
  const hooksPath = git(["config", "--get", "core.hooksPath"]);
  const problems = [];
  if (hooksPath.code !== 0 || hooksPath.out.trim() !== ".githooks")
    problems.push(`core.hooksPath is '${hooksPath.code === 0 ? hooksPath.out.trim() || "(unset)" : "(unset)"}' — hooks are committed, activation is per clone\n  fix: git config core.hooksPath .githooks`);
  for (const h of ["commit-msg", "pre-commit", "pre-push"]) {
    const p = join(ROOT, ".githooks", h);
    if (!existsSync(p)) problems.push(`.githooks/${h} is missing`);
    else if (!(spawnSync("test", ["-x", p]).status === 0)) problems.push(`.githooks/${h} is not executable\n  fix: chmod +x .githooks/${h}`);
  }
  const reg = spawnSync("node", [join(ROOT, "tools/gate-registry.mjs")], { encoding: "utf8" });
  if (reg.status !== 0) problems.push(`gate-registry check is red:\n${(reg.stdout || "") + (reg.stderr || "")}`);
  if (problems.length) die(`doctor: wiring incomplete\n  ${problems.join("\n  ")}`);
  console.log("task-coverage: doctor clean (hooksPath, hook files, registry)");
}

// ---- self-test: prove the matcher and the footer law discriminate ----
function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("task-coverage --self-test");

  const m = (p, g) => pathMatches(p, [g]);
  ok("** covers subtree", m("tools/x/y.mjs", "tools/**"));
  ok("** does not cover sibling prefix", !m("toolset/x.mjs", "tools/**"));
  ok("exact file matches", m("package.json", "package.json"));
  ok("bare dir covers subtree", m("docs/gates/reg.json", "docs"));
  ok("bare dir does not cover sibling", !m("docsy/x", "docs"));
  ok("* within segment", m("src/a.tsx", "src/*.tsx"));
  ok("* does not cross /", !m("src/ui/a.tsx", "src/*.tsx"));

  // The footer law: trailer block only, exactly one.
  ok("footer in the trailer block binds", footerTaskId("subject\n\nbody\n\ntask: my-task\n") === "my-task");
  ok("footer mid-body does NOT bind", footerTaskId("subject\n\nbody task: my-task mid-body\n") === null);
  ok("footer as the whole trailer binds", footerTaskId("subject\n\ntask: t1\n") === "t1");
  ok("subject-only message without footer is footerless", footerTaskId("just a subject\n") === null);
  ok("two trailers are malformed", (() => { try { footerTaskId("s\n\ntask: a\ntask: b\n"); return false; } catch { return true; } })());

  // Scope semantics as the fences consume them.
  const tasks = [{ id: "t1", phase: "executing", scope: ["tools/**", "docs"] }];
  ok("in-scope file covered", tasks.some(t => pathMatches("tools/a.mjs", t.scope)));
  ok("out-of-scope file uncovered", !tasks.some(t => pathMatches("app/page.tsx", t.scope)));

  console.log(failures.length ? `task-coverage: ${failures.length} self-test failure(s)` : "task-coverage: self-test clean");
  if (failures.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else if (args.includes("--staged")) cmdStaged();
else if (args.includes("--commit-msg")) cmdCommitMsg(args[args.indexOf("--commit-msg") + 1]);
else if (args.includes("--push") || args.length === 0) cmdPush();
else if (args.includes("--doctor")) cmdDoctor();
else die("usage: task-coverage.mjs --staged | --commit-msg <file> | --push | --doctor");
