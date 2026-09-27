#!/usr/bin/env node
/**
 * TASK-COVERAGE — picasso's binding gate, ported from stallion's fence trio.
 *
 * Every commit that introduces files carries a `task:` footer naming a task
 * whose DECLARED scope covers them. Judged in three transports:
 *   --staged       pre-commit: refuse at stage time, one action from the mistake
 *   --commit-msg   commit-msg: the footer (read after git's comment and scissors
 *                  cleanup) sits in the FINAL TRAILER BLOCK and names a task in
 *                  flight (executing–adversarial) whose scope covers what the
 *                  commit introduces
 *   --pre-push     pre-push: every pushed ref lies in HEAD's history, and every
 *                  commit the remote does not hold yet is judged
 *   --base <rev>   the same range check from an explicit base — CI's server-side
 *                  fence, the one no local bypass reaches
 *   --doctor       the gate for the gate: hooks wired and opening with their
 *                  exact gate lines, registry green, adoption base resolvable
 *
 * The laws the transports share:
 *   - A commit introduces its own files: a root against the empty tree, a plain
 *     commit against its parent, a merge against git's own automatic merge of
 *     its parents (a clean merge introduces nothing; a conflict resolution, a
 *     stale copy kept over a fix, a forged parent do). Paths are read with -z
 *     (never quoted) and --no-renames (a rename into scope does not hide its
 *     source). A commit that introduces nothing needs no footer.
 *   - A task's own paperwork (.tasks/<id>.json, docs/tasks/<id>.adversarial.json)
 *     is always within its reach — a finished task still records its finish. A
 *     record change never moves a phase backwards and never changes a scope
 *     after planned; a record's scope is rooted in a literal path.
 *   - done authorizes no NEW code. At the push fence "new" is judged against the
 *     settled anchor (the remote tip being updated, or --base): a task done there
 *     refuses citing commits new since it; one landing or in flight there
 *     authorizes its own tail, written in flight.
 *   - The range: what the remote does not hold yet (pre-push), or HEAD minus
 *     --base (CI), minus the adoption base (.picasso-base, one full sha per
 *     line, read from the anchor's tree — a push cannot re-pin its own base).
 *
 * Records are read as they are committed: at commit time from the index, at
 * the push fence from HEAD's tree — an uncommitted edit authorizes nothing.
 *
 * Known ceiling: CI runs the fence code of the commit it judges, so a change to
 * the fence's own surface (tools/, .githooks/, .github/, .picasso-base) must be
 * reviewed — protect the default branch and require review of those paths.
 *
 * Usage:
 *   task-coverage.mjs --staged | --commit-msg <file> | --pre-push | --doctor | [--base <rev>]
 *   task-coverage.mjs --self-test
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// The lifecycle law, stated here once and imported by task-state AND the
// enforcement plugin — never re-typed.
export const PHASES = ["intake", "planned", "executing", "verified", "adversarial", "done"];
// The window that AUTHORIZES new code: done is excluded — a finished task
// does not authorize new code (it keeps only its own paperwork).
export function authorizingPhases(phases = PHASES) {
  return phases.slice(phases.indexOf("executing"), phases.indexOf("done"));
}

const TS = "node tools/task-state.mjs";
const USAGE = "task-coverage.mjs --staged | --commit-msg <file> | --pre-push | --doctor | [--base <rev>] | --self-test";

function die(msg) { console.error(`task-coverage: ${msg}`); process.exit(1); }

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd: ROOT, maxBuffer: 512 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
// A git read the gate depends on: failure refuses, never passes.
function gitOk(args) {
  const r = git(args);
  if (r.code !== 0)
    die(`refused: git ${args.join(" ")} failed\n${r.err.trim()}\n  rule: a gate that cannot read state must not pass\n  fix: run inside a healthy work tree (CI: actions/checkout with fetch-depth: 0) and retry`);
  return r.out;
}
const zList = out => out.split("\0").filter(Boolean);
const resolves = rev => git(["rev-parse", "-q", "--verify", `${rev}^{commit}`]).code === 0;
const isAncestor = (rev, of) => git(["merge-base", "--is-ancestor", `${rev}^{commit}`, of]).code === 0;
// A file's content at a revision (":" is the index), or null where it is absent.
const showAt = (rev, path) => { const r = git(["show", rev === ":" ? `:${path}` : `${rev}:${path}`]); return r.code === 0 ? r.out : null; };

// Glob matching, segment by segment, with no backtracking blowup (a scope is
// data an agent writes): '**' spans zero or more whole segments, '*' any run
// within one segment, '?' one character; everything else is literal.
export function globMatches(glob, path) {
  const segs = path.split("/");
  let reach = segs.map(() => false).concat(false);
  reach[0] = true;
  for (const g of glob.split("/")) {
    const next = reach.map(() => false);
    if (g === "**") {
      for (let j = 0, on = false; j < reach.length; j++) next[j] = on = on || reach[j];
    } else {
      for (let j = 0; j < segs.length; j++) if (reach[j] && segmentMatches(g, segs[j])) next[j + 1] = true;
    }
    reach = next;
  }
  return reach[segs.length];
}

function segmentMatches(pattern, text) {
  const s = [...text];
  let row = s.map(() => false).concat(false);
  row[0] = true;
  for (const c of pattern) {
    const next = row.map(() => false);
    if (c === "*") for (let j = 0, on = false; j < row.length; j++) next[j] = on = on || row[j];
    else for (let j = 0; j < s.length; j++) if (row[j] && (c === "?" || c === s[j])) next[j + 1] = true;
    row = next;
  }
  return row[s.length];
}

// 'tools/**' covers everything under tools/; a pattern without wildcards names a
// path: it matches itself and its subtree.
export function pathMatches(path, patterns) {
  return patterns.some(p => globMatches(p, path) ||
    (!/[*?]/.test(p) && (path === p || path.startsWith(p.replace(/\/$/, "") + "/"))));
}

// Pure: a scope names where a task lands — its first segment is a literal path.
// A wildcard-rooted glob ('**', '*/x', '**/*.tsx') is a skeleton key. Shared by
// task-state (declaring) and the fences (hand-written records).
export function scopeRootRefusal(glob) {
  const first = String(glob).split("/")[0];
  if (!first || first === "." || first === ".." || /[*?[\]{}]/.test(first))
    return `scope '${glob}' is rooted in a wildcard or not a repo-relative path`;
  return null;
}

// git hands commit-msg the message BEFORE it strips comments: an editor-composed
// message still ends in the '# Please enter…' block (and, under -v, a scissors
// line and the diff). Read raw, that block was the last paragraph and every
// editor-written footer refused. '#' only; the push fence re-judges the stored
// message, so a custom core.commentChar fails closed, never open.
export function cleanCommitMessage(message) {
  const scissors = message.search(/^# -+ >8 -+$/m);
  const kept = scissors === -1 ? message : message.slice(0, scissors);
  return kept.split("\n").filter(line => !line.startsWith("#")).join("\n");
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

// Task records live at the repo top, whatever the cwd — no environment
// variable moves them (one would be a way around every fence).
const TASKS = join(ROOT, ".tasks");
const recordPath = id => `.tasks/${id}.json`;
const wellFormed = (t, id) => t?.id === id && PHASES.includes(t.phase) && Array.isArray(t.scope) &&
  t.scope.every(g => typeof g === "string" && !scopeRootRefusal(g));
const parseRecord = text => { try { return JSON.parse(text); } catch { return undefined; } };

// A record as committed: `rev` is ":" (the index — commit time; a record never
// added falls back to the working copy) or "HEAD" (the pushed tree).
function readTask(id, rev) {
  let text = showAt(rev, recordPath(id));
  if (text === null && rev === ":" && existsSync(join(TASKS, `${id}.json`))) text = readFileSync(join(TASKS, `${id}.json`), "utf8");
  if (text === null)
    return { error: `task '${id}' has no register file${rev === "HEAD" ? " in the pushed tree" : ""}\n    fix: ${TS} new ${id} --risk-class <class> (and commit its record), or correct the footer id (${TS} status)` };
  const task = parseRecord(text);
  if (!wellFormed(task, id))
    return { error: `${recordPath(id)} is not a well-formed task record (id, phase, scope rooted in a literal path)\n    fix: git checkout -- ${recordPath(id)}` };
  return { task };
}

function allTasks() {
  if (!existsSync(TASKS)) return [];
  return readdirSync(TASKS).filter(f => f.endsWith(".json")).flatMap(f => {
    const { task } = readTask(f.slice(0, -5), ":");
    return task ? [task] : [];
  });
}

const paperworkOf = id => [recordPath(id), `docs/tasks/${id}.adversarial.json`];

/**
 * Pure: may a commit change a task record from `before` to `after`? Phases only
 * move forward and scope is frozen once the task left planned — a record edit
 * never resurrects a finished task or widens a live one to cover work after
 * the fact (task-state writes records exactly this way). null = lawful.
 */
export function recordChangeRefusal(id, before, after) {
  if (after === undefined) return `${recordPath(id)} as committed does not parse`;
  if (after === null)
    return before && PHASES.indexOf(before.phase) > PHASES.indexOf("planned") ? `${recordPath(id)} deletes the record of a started task (${before.phase})` : null;
  if (!wellFormed(after, id)) return `${recordPath(id)} as committed is not a well-formed task record`;
  if (!before || !PHASES.includes(before.phase)) return null;
  const from = PHASES.indexOf(before.phase);
  if (PHASES.indexOf(after.phase) < from) return `${recordPath(id)} moves its phase backwards (${before.phase} → ${after.phase})`;
  if (from > PHASES.indexOf("planned") && JSON.stringify(before.scope) !== JSON.stringify(after.scope))
    return `${recordPath(id)} changes its scope after planned (${before.phase})`;
  return null;
}

// The record changes among `files`, judged against EVERY parent revision — a
// merge's record is at least as far along as the furthest parent's (null = absent).
function recordChanges(files, beforeRevs, afterRev) {
  return files.flatMap(f => {
    const m = f.match(/^\.tasks\/([a-z0-9][a-z0-9-]*)\.json$/);
    if (!m) return [];
    const at = rev => { const t = showAt(rev, f); return t === null ? null : parseRecord(t); };
    const after = at(afterRev);
    return [...new Set(beforeRevs.flatMap(rev => recordChangeRefusal(m[1], at(rev), after) ?? []))];
  });
}

/**
 * Pure: the citation law, one seam for commit-msg and the push fence. `files`
 * are what the commit introduces; `mayUseDone` is the transport's fact — false
 * for a commit being made now, and at the push fence false for a citation new
 * since a settled anchor that already showed the task done.
 */
export function citationRefusal(task, files, mayUseDone) {
  const own = paperworkOf(task.id);
  const code = files.filter(f => !own.includes(f));
  if (code.length === 0) return null;
  if (task.phase === "done" && !mayUseDone)
    return { reason: `task '${task.id}' is done — a finished task authorizes only its own paperwork, not new code`,
      fix: `${TS} new <new-id> --risk-class ${task.riskClass ?? "<class>"}   (done is terminal by design)` };
  if (task.phase !== "done" && !authorizingPhases().includes(task.phase))
    return { reason: `task '${task.id}' is parked at '${task.phase}' — not a code phase`,
      fix: `${TS} advance ${task.id}   (repeat until executing)` };
  const outside = code.filter(f => !pathMatches(f, task.scope));
  if (outside.length)
    return { reason: `code outside '${task.id}' declared scope:\n    ${outside.join("\n    ")}`,
      fix: `land those files under a task whose scope covers them (${TS} status), or unstage them: git restore --staged -- <file>` };
  return null;
}

// git's own automatic merge of two commits, as a tree — what a merge would be
// had it decided nothing itself. null when git cannot replay it.
function autoMergeTree(ours, theirs) {
  const r = git(["merge-tree", "--write-tree", "--no-messages", ours, theirs]);
  const tree = r.out.split("\n")[0].trim();
  return (r.code === 0 || r.code === 1) && /^[0-9a-f]{40}$/.test(tree) ? tree : null;
}

const listDiff = (...a) => zList(gitOk(["diff", "-z", "--no-renames", "--name-only", ...a]));

// What a commit being made now introduces: the staged files — for a two-parent
// merge, what the index decides beyond git's own automatic merge; an octopus is
// judged in full.
function mergeHeads() {
  const path = git(["rev-parse", "--git-path", "MERGE_HEAD"]).out.trim();
  const mergeHead = path.startsWith("/") ? path : join(ROOT, path);
  return path && existsSync(mergeHead) ? readFileSync(mergeHead, "utf8").split("\n").map(l => l.trim()).filter(Boolean) : [];
}
function stagedOwnFiles() {
  const staged = listDiff("--cached");
  const parents = mergeHeads();
  const tree = parents.length === 1 && autoMergeTree("HEAD", parents[0]);
  return tree ? listDiff("--cached", tree) : staged;
}

function cmdStaged() {
  const files = stagedOwnFiles();
  if (files.length === 0) return console.log("task-coverage: nothing staged that the commit itself introduces");
  const tasks = allTasks();
  const live = tasks.filter(t => authorizingPhases().includes(t.phase));
  const paperwork = new Set(tasks.flatMap(t => paperworkOf(t.id)));
  const uncovered = files.filter(f => !paperwork.has(f) && !live.some(t => pathMatches(f, t.scope)));
  if (uncovered.length)
    die(`refused: staged code outside every in-flight task's declared scope:\n  ${uncovered.join("\n  ")}\n` +
        `  rule: code lands only under a task in flight (executing–adversarial) whose scope covers it — done authorizes nothing new\n` +
        `  fix: git restore --staged -- <file>, or open a task that covers it: ${TS} new <id> --risk-class <class> (then scope at planned, advance to executing)`);
  console.log(`task-coverage: ${files.length} staged file(s) covered`);
}

function cmdCommitMsg(file) {
  if (!existsSync(file)) die(`usage: ${USAGE}`);
  let id;
  try { id = footerTaskId(cleanCommitMessage(readFileSync(file, "utf8"))); }
  catch (e) { die(`refused: ${e.message}\n  rule: exactly one 'task:' trailer binds a commit\n  fix: git commit -F ${file} --cleanup=strip   (after keeping one 'task: <id>' line)`); }
  const files = stagedOwnFiles();
  if (!id && files.length === 0) return console.log("task-coverage: the commit introduces no files — no footer required");
  if (!id)
    die(`refused: no 'task: <id>' footer in the message's final trailer block\n` +
        `  rule: a commit that introduces files carries a task footer in the trailer block — a 'task:' line mid-body does not bind\n` +
        `  fix: git commit -F ${file} --cleanup=strip --trailer 'task: <in-flight-id>'   (existing tasks: ${TS} status)`);
  const records = recordChanges(files, ["HEAD", ...mergeHeads()], ":");
  if (records.length)
    die(`refused: ${records.join("; ")}\n  rule: a task record's phase only moves forward and its scope is frozen after planned — task-state writes records, an editor does not\n  fix: git checkout HEAD -- <record> (then drive it with ${TS})`);
  const { task, error } = readTask(id, ":");
  if (error) die(`refused: the footer names '${id}': ${error}`);
  const refusal = citationRefusal(task, files, false);
  if (refusal)
    die(`refused: ${refusal.reason}\n  rule: a footer binds what the commit introduces to a task in flight and its declared scope\n  fix: ${refusal.fix}`);
  console.log(`task-coverage: footer binds '${id}' (${task.phase}); what the commit introduces is covered`);
}

// The files a commit ITSELF introduces — one law for every commit shape.
function filesIntroducedBy(sha) {
  const parents = gitOk(["show", "-s", "--format=%P", sha]).trim().split(/\s+/).filter(Boolean);
  const diff = (...a) => zList(gitOk(["diff-tree", "-z", "--no-renames", "--no-commit-id", "--name-only", "-r", ...a]));
  if (parents.length === 0) return { files: diff("--root", sha), parents };
  const tree = parents.length === 2 && autoMergeTree(parents[0], parents[1]);
  return { files: tree ? diff(tree, sha) : diff(parents[0], sha), parents };
}

const PIN_FIX = `git rev-parse HEAD > .picasso-base && git add .picasso-base && git commit -m 'chore: pin the picasso adoption base' -m 'task: <tooling-task>'`;

// The adoption base as committed at `rev`: null when none is there, else full
// shas — anything else refuses.
function committedBases(rev) {
  const text = showAt(rev, ".picasso-base");
  if (text === null) return null;
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (lines.length === 0 || lines.some(l => !/^[0-9a-f]{40}$/.test(l)))
    die(`refused: .picasso-base at ${rev} must hold full 40-hex commit shas, one per line\n  rule: the adoption base is a sha an auditor can reproduce\n  fix: ${PIN_FIX}`);
  return lines;
}

const explicitBase = b => typeof b === "string" && b !== "" && !/^0+$/.test(b);

/**
 * The range check. `base`: an explicit --base (CI). `pushed`: pre-push's facts
 * — the remote shas this push updates (the anchor, and history the remote
 * already holds). An explicit base that does not resolve (a force-push moved it
 * out of the clone) falls back to the adoption base, visibly.
 */
function cmdRange(base, pushed = null) {
  let explicit = explicitBase(base) ? base : null;
  if (explicit && !resolves(explicit)) {
    console.log(`task-coverage: ~ base ${explicit} does not resolve here (a force-push?) — judging from the adoption base instead`);
    explicit = null;
  }
  const remoteTips = (pushed ?? []).filter(resolves);
  const branch = git(["symbolic-ref", "-q", "--short", "HEAD"]).out.trim();
  const tracking = branch && resolves(`origin/${branch}`) ? `origin/${branch}` : null;
  // ponytail: the default branch is guessed (origin/HEAD, main, master) — a repo
  // with another default and no origin/HEAD passes --base explicitly.
  const fallback = ["origin/HEAD", "origin/main", "origin/master"].find(resolves) ?? null;
  const anchor = explicit ?? remoteTips[0] ?? tracking ?? fallback;
  const bases = committedBases(anchor ?? "HEAD") ?? committedBases("HEAD");
  if (!explicit && !bases)
    die(`refused: no adoption base committed (.picasso-base) and no --base given\n  rule: an unresolvable push base REFUSES rather than guessing a range\n  fix: ${PIN_FIX}`);
  const exclude = [...(pushed ? remoteTips : anchor ? [anchor] : []), ...(bases ?? []).filter(resolves)];
  const commits = gitOk(["rev-list", "--reverse", "HEAD", "--not", ...exclude, ...(pushed ? ["--remotes"] : [])]).split("\n").filter(Boolean);
  if (commits.length === 0) return console.log("task-coverage: nothing new to judge — every commit is already settled");

  const head = gitOk(["rev-parse", "HEAD"]).trim();
  const anchorPhases = new Map();
  const problems = [];
  let skipped = 0;
  for (const sha of commits) {
    const short = sha.slice(0, 8);
    const rewrite = sha === head ? "git commit --amend   (fix the footer or the content), then push again"
      : `git rebase -i ${short}~1   (reword or split ${short}), then push again`;
    const { files, parents } = filesIntroducedBy(sha);
    if (files.length === 0) continue;
    for (const r of recordChanges(files, parents.length ? parents : ["4b825dc642cb6eb9a060e54bf8d69288fbee4904"], sha))
      problems.push(`${short}: ${r}\n    fix: ${rewrite}`);
    let id;
    try { id = footerTaskId(gitOk(["log", "-1", "--format=%B", sha])); }
    catch (e) { problems.push(`${short}: ${e.message}\n    fix: ${rewrite}`); continue; }
    if (!id) { problems.push(`${short} introduces files but carries no 'task: <id>' footer in its trailer block\n    fix: ${rewrite}`); continue; }
    const { task, error } = readTask(id, "HEAD");
    if (error) { problems.push(`${short}: ${error}`); continue; }
    if (!anchorPhases.has(id)) anchorPhases.set(id, anchorPhase(id, anchor));
    const there = anchorPhases.get(id);
    // Done as committed, at the anchor, or already at a parent of this commit:
    // a record edited back from done does not un-finish a task, and code after
    // the done commit is new code even inside the push that lands both.
    const settled = anchor !== null && isAncestor(sha, anchor);
    const doneBefore = parents.some(p => parseRecord(showAt(p, recordPath(id)) ?? "")?.phase === "done");
    const done = task.phase === "done" || doneBefore || there === "settled-done" || there === "unreadable";
    if (done && there === "no-anchor") skipped++;
    const mayUseDone = !isNewCitation(there, settled) && !(doneBefore && !settled);
    const refusal = citationRefusal(done ? { ...task, phase: "done" } : task, files, mayUseDone);
    if (refusal) problems.push(`${short} (task ${id}): ${refusal.reason}\n    fix: ${rewrite}`);
  }
  if (skipped) console.log(`task-coverage: ~ done-citation law skipped for ${skipped} commit(s) — no settled anchor; skip, never brick`);
  if (problems.length)
    die(`refused: ${problems.length} problem(s) in the commits this range brings\n  ${problems.join("\n  ")}\n` +
        `  rule: every commit that introduces files is bound to a covering task — the fence re-judges what the remote does not hold yet`);
  console.log(`task-coverage: ${commits.length} commit(s) judged clean`);
}

// Pure: must this citation answer the done-law? A commit at or behind the
// anchor is settled history, re-audited but never accused; a task the anchor
// already showed done (or whose record there is unreadable) authorizes no new
// commit; landing, in flight there, or no anchor: its own tail stands.
export function isNewCitation(anchorPhaseValue, commitSettled) {
  if (commitSettled) return false;
  return anchorPhaseValue === "settled-done" || anchorPhaseValue === "unreadable";
}

function anchorPhase(id, anchor) {
  if (!anchor) return "no-anchor";
  const listed = git(["ls-tree", "--name-only", anchor, "--", recordPath(id)]);
  if (listed.code !== 0) return "no-anchor";
  if (!listed.out.trim()) return "first-landing";
  const record = parseRecord(showAt(anchor, recordPath(id)) ?? "");
  if (!wellFormed(record, id)) return "unreadable";
  return record.phase === "done" ? "settled-done" : "in-flight-there";
}

// git hands pre-push one '<local-ref> <local-sha> <remote-ref> <remote-sha>' line
// per ref. The range check judges HEAD's history, so a pushed tip outside it
// (`git push origin other-branch`, a tag on a side commit) would land unjudged.
function cmdPrePush() {
  const lines = readFileSync(0, "utf8").split("\n").map(l => l.trim().split(/\s+/)).filter(l => l.length === 4);
  const outside = lines.filter(([, sha]) => !/^0+$/.test(sha) && !isAncestor(sha, "HEAD")).map(([ref]) => ref);
  if (outside.length)
    die(`refused: this push carries ref(s) outside the checked-out history: ${outside.join(", ")}\n` +
        `  rule: the push fence judges HEAD's history — a pushed tip HEAD cannot reach would land unjudged\n` +
        `  fix: git checkout <branch> && git push origin <branch>   (one branch per push, from its own checkout)`);
  cmdRange(null, lines.map(l => l[3]).filter(sha => !/^0+$/.test(sha)));
}

// Each hook is a /bin/sh script opening with its gate lines, exactly: anything
// above them (an early `exit 0`, another interpreter) or changed in them (an
// extra flag) is a disabled fence.
const HOOK_GATES = {
  "pre-commit": ["node tools/task-coverage.mjs --staged || exit 1"],
  "commit-msg": ['node tools/task-coverage.mjs --commit-msg "$1" || exit 1'],
  "pre-push": ["node tools/task-coverage.mjs --pre-push || exit 1",
    "node tools/task-coverage.mjs --doctor || exit 1",
    "node tools/gate-registry.mjs || exit 1"],
};

function cmdDoctor() {
  const problems = [];
  const hooksPath = git(["config", "--get", "core.hooksPath"]).out.trim();
  if (hooksPath !== ".githooks")
    problems.push(`core.hooksPath is '${hooksPath || "(unset)"}' — hooks are committed, activation is per clone\n    fix: git config core.hooksPath .githooks`);
  for (const [hook, gates] of Object.entries(HOOK_GATES)) {
    const p = join(ROOT, ".githooks", hook);
    if (!existsSync(p)) { problems.push(`.githooks/${hook} is missing\n    fix: git checkout -- .githooks/${hook}`); continue; }
    if (spawnSync("test", ["-x", p]).status !== 0) problems.push(`.githooks/${hook} is not executable\n    fix: chmod +x .githooks/${hook}`);
    const text = readFileSync(p, "utf8");
    const live = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (text.split("\n")[0] !== "#!/bin/sh" || gates.some((g, i) => live[i] !== g))
      problems.push(`.githooks/${hook} is not '#!/bin/sh' opening with its gate line(s), exactly:\n      ${gates.join("\n      ")}\n    fix: git checkout -- .githooks/${hook}`);
  }
  const reg = spawnSync("node", [join(ROOT, "tools/gate-registry.mjs")], { encoding: "utf8" });
  if (reg.status !== 0) problems.push(`gate-registry check is red:\n${(reg.stdout || "") + (reg.stderr || "")}`);
  const bases = committedBases("HEAD");
  if (!bases) problems.push(`no adoption base committed (.picasso-base) — the push fence cannot resolve a range\n    fix: ${PIN_FIX}`);
  else for (const b of bases)
    if (!resolves(b)) problems.push(`adoption base ${b.slice(0, 8)} does not resolve in this clone\n    fix: git fetch --unshallow`);
  if (problems.length) die(`doctor: wiring incomplete\n  ${problems.join("\n  ")}`);
  console.log("task-coverage: doctor clean (hooksPath, hook gate lines, registry, adoption base)");
}

// Strict flags: exactly one mode per run, unknown flags refuse, --base stands alone.
function parseArgs(argv) {
  const MODES = ["--self-test", "--staged", "--commit-msg", "--pre-push", "--doctor"];
  const out = { mode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") {
      if ("base" in out) die(`--base given twice\n  usage: ${USAGE}`);
      out.base = argv[++i] ?? die(`--base needs a revision\n  usage: ${USAGE}`);
    } else if (MODES.includes(a)) {
      if (out.mode) die(`exactly one mode per run — got ${out.mode} and ${a}\n  usage: ${USAGE}`);
      out.mode = a;
      if (a === "--commit-msg") out.file = argv[++i] ?? die(`--commit-msg needs the message file\n  usage: ${USAGE}`);
    } else die(`unknown flag '${a}'\n  usage: ${USAGE}`);
  }
  if (out.mode && "base" in out) die(`--base stands alone (the range check), not with ${out.mode}\n  usage: ${USAGE}`);
  return out;
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

  ok("**/ matches zero directories", m("src/a.tsx", "src/**/*.tsx") && m("a.tsx", "**/*.tsx"));
  // In a child with a timeout: a backtracking matcher would hang the whole battery.
  const probe = `import { pathMatches } from ${JSON.stringify(import.meta.url)};\n` +
    "process.exit(pathMatches(`src/${'a'.repeat(40)}.tsx`, [`src/${'*a'.repeat(20)}*b`]) ? 1 : 0);";
  const redos = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { timeout: 2000 });
  ok("a pathological glob answers fast (no backtracking blowup)", redos.status === 0);

  liveFence(ok);
  console.log(failures.length ? `task-coverage: ${failures.length} self-test failure(s)` : "task-coverage: self-test clean");
  if (failures.length) process.exit(1);
}

// ---- the live fences, end to end: real git, the real hooks, a bare remote ----
function liveFence(ok) {
  const TOOLS = fileURLToPath(new URL(".", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "picasso-fence-"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: tmp, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  delete env.PICASSO_TASKS_DIR;
  delete env.GIT_EDITOR;
  const run = (cwd, cmd, extra = {}) => spawnSync("sh", ["-c", cmd], { cwd, env: { ...env, ...extra }, encoding: "utf8" });
  const HOOKS = ["pre-commit", "commit-msg", "pre-push"];
  const registry = JSON.parse(readFileSync(join(ROOT, "docs/gates/gate-registry.json"), "utf8"));
  const gates = registry.gates.filter(g => g.transports.some(t => HOOKS.includes(t)))
    .map(g => ({ ...g, transports: g.transports.filter(t => HOOKS.includes(t)) }));
  const task = (dir, id, phase, scope) => writeFileSync(join(dir, ".tasks", `${id}.json`),
    JSON.stringify({ id, phase, riskClass: "tooling", scope, pins: [], history: [] }, null, 2) + "\n");
  // A repo that adopted picasso: the harness, the real hooks, a pinned base, a remote.
  let n = 0;
  const fixture = () => {
    const name = `r${n++}`;
    const dir = join(tmp, name);
    for (const d of ["tools", ".githooks", "docs/gates", ".tasks", "src", "lib"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ["task-coverage.mjs", "gate-registry.mjs"]) copyFileSync(join(TOOLS, f), join(dir, "tools", f));
    for (const h of HOOKS) { copyFileSync(join(ROOT, ".githooks", h), join(dir, ".githooks", h)); chmodSync(join(dir, ".githooks", h), 0o755); }
    writeFileSync(join(dir, "docs/gates/gate-registry.json"), JSON.stringify({ gates }, null, 2));
    writeFileSync(join(dir, "lib/x.ts"), "x\n");
    task(dir, "boot", "executing", ["tools", ".githooks", "docs", "lib", ".tasks", ".picasso-base"]);
    task(dir, "t", "executing", ["src"]);
    task(dir, "u", "executing", ["lib"]);
    task(dir, "d", "done", ["src"]);
    run(dir, "git init -q -b main && git add -A && git commit -qm boot -m 'task: boot' && git rev-parse HEAD > .picasso-base && " +
      `git add .picasso-base && git commit -qm pin -m 'task: boot' && git init -q --bare ../${name}.git && ` +
      `git remote add origin ../${name}.git && git push -q -u origin main && git config core.hooksPath .githooks`);
    return dir;
  };
  const commit = (dir, file, footer, flags = "") =>
    run(dir, `mkdir -p "$(dirname '${file}')" && echo x >> '${file}' && git add -A && git commit -q ${flags} -m change` +
      (footer ? ` -m 'task: ${footer}'` : ""));

  // --- commit time ---
  let d = fixture();
  writeFileSync(join(tmp, "editor.sh"), '#!/bin/sh\n{ printf "feat: a\\n\\ntask: t\\n"; cat "$1"; } > "$1.new" && mv "$1.new" "$1"\n');
  chmodSync(join(tmp, "editor.sh"), 0o755);
  ok("live: an editor-composed commit (git's comment block after the footer) binds",
    run(d, "echo a > src/a.ts && git add -A && git commit -q", { GIT_EDITOR: join(tmp, "editor.sh") }).status === 0);
  const doneCite = commit(d, "src/b.ts", "d");
  ok("live: a new commit citing a done task is refused", doneCite.status !== 0 && /done/.test(doneCite.stderr));
  run(d, "git reset -q --hard HEAD && git clean -qfd src");
  writeFileSync(join(d, ".tasks/d.json"), JSON.stringify({ id: "d", phase: "done", riskClass: "tooling", scope: ["src"], pins: [], history: [], note: "finish" }));
  ok("live: a done task still commits its own paperwork", run(d, "git add -A && git commit -qm rec -m 'task: d'").status === 0);
  ok("live: a rename out of scope is refused at commit time", (r => r.status !== 0 && /lib\/x\.ts/.test(r.stderr))(run(d, "git mv lib/x.ts src/x.ts && git commit -qm mv -m 'task: t'")));
  run(d, "git reset -q --hard HEAD");
  ok("live: a non-ASCII path in scope commits", commit(d, "src/café.tsx", "t").status === 0);
  task(d, "g", "executing", ["src/**/*.tsx"]);
  run(d, "git add -A && git commit -qm g -m 'task: boot'");
  ok("live: src/**/*.tsx covers a file directly in src", commit(d, "src/top.tsx", "g").status === 0);
  run(d, "git checkout -qb side && echo s > lib/u.ts && git add -A && git commit -qm side -m 'task: u' && git checkout -q main");
  commit(d, "src/m.ts", "t");
  ok("live: an ordinary merge commits without judging incoming files against its footer",
    run(d, "git merge -q --no-ff side -m merge -m 'task: t'").status === 0);
  const ghost = join(tmp, "ghost");
  mkdirSync(ghost);
  writeFileSync(join(ghost, "ghost.json"), JSON.stringify({ id: "ghost", phase: "executing", scope: ["src"] }));
  ok("live: PICASSO_TASKS_DIR is not a way around the fence",
    (r => r.status !== 0 && /ghost/.test(r.stderr))(run(d, "echo h > src/h.ts && git add -A && git commit -qm h -m 'task: ghost'", { PICASSO_TASKS_DIR: ghost })));
  run(d, "git reset -q --hard HEAD && git clean -qfd src");

  // --- push time ---
  ok("live: a clean push of footered work lands", run(d, "git push -q origin main").status === 0);
  run(d, "git checkout -qb evil && echo e > src/e.ts && git add -A && git commit -qn -m evil && git checkout -q main");
  ok("live: pushing a branch outside HEAD's history is refused", (r => r.status !== 0 && /refs\/heads\/evil/.test(r.stderr))(run(d, "git push -q origin evil")));
  ok("live: pushing a tag outside HEAD's history is refused", (r => r.status !== 0 && /refs\/tags\/v/.test(r.stderr))(run(d, "git tag v evil && git push -q origin v")));
  run(d, "git checkout -qb feat");
  commit(d, "src/f.ts", "t");
  ok("live: the first push of a new branch is judged, not refused", run(d, "git push -q -u origin feat").status === 0);
  run(d, "git checkout -qb feat2 && echo g > src/g2.ts && git add -A && git commit -qn -m g");
  ok("live: an unfooted commit on a new branch is refused at push", (r => r.status !== 0 && /footer/.test(r.stderr))(run(d, "git push -q origin feat2")));
  d = fixture();
  run(d, "git checkout -qb side && echo s > lib/u.ts && git add -A && git commit -qm side -m 'task: u' && git checkout -q main");
  commit(d, "src/m.ts", "t");
  run(d, "git merge -q --no-ff --no-commit side; echo evil >> lib/x.ts && git add -A && git commit -qn -m merge -m 'task: t'");
  ok("live: an evil merge (its own change outside scope) is refused at push", (r => r.status !== 0 && /lib\/x\.ts/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  ok("live: an orphan root commit is judged at push",
    (r => r.status !== 0 && /footer/.test(r.stderr))(run(d, "git checkout -q --orphan o && echo r > src/r.ts && git add -A && git commit -qn -m root && git push -q origin o")));
  d = fixture();
  task(d, "z", "executing", ["src"]);
  run(d, "git add -A && git commit -qm z -m 'task: boot'");
  commit(d, "src/z.ts", "z");
  task(d, "z", "done", ["src"]);
  run(d, "git add -A && git commit -qm z-done -m 'task: z'");
  ok("live: work written in flight still pushes after its task is done", run(d, "git push -q origin main").status === 0);
  ok("live: a new citation of a task settled done at the remote is refused at push",
    commit(d, "src/z2.ts", "z", "-n").status === 0 && (r => r.status !== 0 && /done/.test(r.stderr))(run(d, "git push -q origin main")));
  ok("live: a range with nothing new passes, saying so", (r => r.status === 0 && /nothing new/.test(r.stdout))(run(d, "node tools/task-coverage.mjs --base HEAD")));

  // --- the wiring ---
  d = fixture();
  ok("live: the doctor passes a correctly wired clone", run(d, "node tools/task-coverage.mjs --doctor").status === 0);
  writeFileSync(join(d, ".githooks/commit-msg"), readFileSync(join(d, ".githooks/commit-msg"), "utf8").replace("\n", "\nexit 0\n"));
  ok("live: the doctor refuses a hook that exits before its gate", (r => r.status !== 0 && /commit-msg/.test(r.stderr))(run(d, "node tools/task-coverage.mjs --doctor")));
  run(d, "git checkout -q -- .githooks");
  writeFileSync(join(d, ".githooks/pre-push"), readFileSync(join(d, ".githooks/pre-push"), "utf8").replace(" || exit 1", " --self-test || exit 1"));
  ok("live: the doctor refuses a gate line carrying an extra flag", (r => r.status !== 0 && /pre-push/.test(r.stderr))(run(d, "node tools/task-coverage.mjs --doctor")));
  ok("live: modes are exclusive", (r => r.status !== 0 && /one mode/.test(r.stderr))(run(d, "node tools/task-coverage.mjs --staged --doctor")));
  ok("live: unknown flags refuse", (r => r.status !== 0 && /unknown/.test(r.stderr))(run(d, "node tools/task-coverage.mjs --frobnicate")));

  // --- the adversarial pass's breaks, pinned ---
  d = fixture();
  run(d, "git checkout -qb side && echo s > src/s.ts && git add -A && git commit -qm side -m 'task: t' && git checkout -q main");
  run(d, "echo hardened > lib/x.ts && git add -A && git commit -qm harden -m 'task: u'");
  const stale = run(d, "git merge -q --no-ff --no-commit side; git checkout side -- lib/x.ts && git commit -qm merge -m 'task: t'");
  ok("live: a merge keeping a stale side's copy over a fix is judged at commit time", stale.status !== 0 && /lib\/x\.ts/.test(stale.stderr));
  run(d, "git commit -qn -m merge -m 'task: t'");
  ok("live: ...and at push", (r => r.status !== 0 && /lib\/x\.ts/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  commit(d, "src/w.ts", "t");
  run(d, "git push -q origin main");
  run(d, "C=$(git commit-tree $(git rev-parse HEAD~2^{tree}) -p HEAD -p HEAD~2 -m forged -m 'task: t') && git update-ref refs/heads/main $C");
  ok("live: a merge forged with an ancestor parent (a rollback) is judged at push",
    (r => r.status !== 0 && /\.picasso-base/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  run(d, "git checkout -qb side && echo s > lib/u.ts && git add -A && git commit -qm side -m 'task: u' && git checkout -q main");
  commit(d, "src/m.ts", "t");
  ok("live: a clean merge (a git pull) introduces nothing and needs no footer",
    run(d, "git merge -q --no-ff --no-edit side").status === 0 && run(d, "git push -q origin main").status === 0);
  writeFileSync(join(d, ".tasks/d.json"), JSON.stringify({ id: "d", phase: "executing", riskClass: "tooling", scope: ["src"], pins: [], history: [] }));
  ok("live: resurrecting a done task by editing its record is refused",
    (r => r.status !== 0 && /backwards/.test(r.stderr))(run(d, "git add -A && git commit -qm undo -m 'task: d'")));
  run(d, "git reset -q");
  ok("live: an uncommitted record edit authorizes nothing", (r => r.status !== 0 && /done/.test(r.stderr))(run(d, "echo c > src/c.ts && git add src/c.ts && git commit -qm c -m 'task: d'")));
  run(d, "git reset -q --hard HEAD && git clean -qfd src");
  writeFileSync(join(d, ".tasks/evil.json"), JSON.stringify({ id: "evil", phase: "executing", riskClass: "tooling", scope: ["**"], pins: [], history: [] }));
  ok("live: a hand-written record with a wildcard-rooted scope authorizes nothing",
    (r => r.status !== 0 && /app\.ts/.test(r.stderr))(run(d, "echo e > app.ts && git add -A && git commit -qm e -m 'task: evil'")));
  run(d, "git reset -q --hard HEAD && git clean -qfd . -e .tasks && rm -f .tasks/evil.json");
  ok("live: pre-push judges only what the remote lacks (one bad remote commit does not block every push)",
    run(d, "echo b > src/bad.ts && git add -A && git commit -qn -m bad && git push -q --no-verify origin main").status === 0 &&
    commit(d, "src/good.ts", "t").status === 0 && run(d, "git push -q origin main").status === 0);
  run(d, "echo e > src/evil.ts && git add -A && git commit -qn -m evil && git rev-parse HEAD > .picasso-base && git add -A && git commit -qm repin -m 'task: boot'");
  ok("live: a push cannot re-pin its own base past an earlier commit", (r => r.status !== 0 && /footer/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  ok("live: an explicit base that does not resolve falls back to the adoption base",
    (r => r.status === 0 && /does not resolve/.test(r.stdout))(run(d, `node tools/task-coverage.mjs --base ${"f".repeat(40)}`)));
  const hook = join(d, ".githooks/pre-commit");
  writeFileSync(hook, readFileSync(hook, "utf8").replace("#!/bin/sh", "#!/usr/bin/true"));
  ok("live: the doctor refuses a hook whose interpreter is not /bin/sh", (r => r.status !== 0 && /pre-commit/.test(r.stderr))(run(d, "node tools/task-coverage.mjs --doctor")));

  // --- the adversarial pass's round-2 breaks, pinned ---
  d = fixture();
  task(d, "z", "executing", ["src"]);
  run(d, "git add -A && git commit -qm z -m 'task: boot'");
  commit(d, "src/z.ts", "z");
  task(d, "z", "done", ["src"]);
  run(d, "git add -A && git commit -qm z-done -m 'task: z'");
  commit(d, "src/late.ts", "z", "-n");
  ok("live: code after a task's done commit is new code, even inside the same push",
    (r => r.status !== 0 && /done/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  run(d, "git checkout -qb side");
  task(d, "t", "done", ["src"]);
  run(d, "git add -A && git commit -qm t-done -m 'task: t' && git checkout -q main");
  commit(d, "lib/m.ts", "u");
  const keep = run(d, "git merge -q --no-ff --no-commit side; git checkout main -- .tasks/t.json && git commit -qm merge -m 'task: boot'");
  ok("live: a merge cannot keep an older record over a parent's done (commit time)", keep.status !== 0 && /backwards/.test(keep.stderr));
  run(d, "git commit -qn -m merge -m 'task: boot'");
  ok("live: ...nor at push", (r => r.status !== 0 && /backwards/.test(r.stderr))(run(d, "git push -q origin main")));
  d = fixture();
  task(d, "t", "done", ["src"]);
  run(d, "git add -A && git commit -qm t-done -m 'task: t' && git push -q origin main && git checkout -q --detach");
  commit(d, "src/x2.ts", "t", "-n");
  ok("live: a CI fallback after a force-push still anchors on the default branch",
    (r => r.status !== 0 && /done/.test(r.stderr))(run(d, `node tools/task-coverage.mjs --base ${"f".repeat(40)}`)));
  d = fixture();
  ok("live: deleting a started task's record is refused",
    (r => r.status !== 0 && /deletes/.test(r.stderr))(run(d, "git rm -q .tasks/t.json && git commit -qm rm -m 'task: boot'")));
  run(d, "git reset -q --hard HEAD");
  writeFileSync(join(d, ".tasks/t.adversarial.json"), JSON.stringify({ probes: [] }));
  ok("live: a findings file beside the records is not misread as a record", run(d, "git add -A && git commit -qm f -m 'task: boot'").status === 0);

  rmSync(tmp, { recursive: true, force: true });
}

// Import-safe: the law exports above are loadable by the enforcement plugin;
// the CLI dispatch below runs only when this file IS the entry point.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
const invokedDirectly = process.argv[1] && (() => {
  try { return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; }
  catch { return false; }
})();
if (invokedDirectly) {
  const { mode, file, base } = parseArgs(process.argv.slice(2));
  if (mode === "--self-test") selfTest();
  else if (mode === "--staged") cmdStaged();
  else if (mode === "--commit-msg") cmdCommitMsg(file);
  else if (mode === "--pre-push") cmdPrePush();
  else if (mode === "--doctor") cmdDoctor();
  else cmdRange(base);
}
