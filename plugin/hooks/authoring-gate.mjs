#!/usr/bin/env node
/**
 * The authoring gate (PreToolUse; Edit|Write|MultiEdit on Claude Code,
 * Edit|Write|ApplyPatch on ZCode).
 *
 * Exit-code contract (the hook runner's own): 0 passes, 2 BLOCKS the edit. The
 * deny text on stderr reaches the model — rule, evidence, exact fix command.
 *
 * Picasso's difference from stallion's gate is the claim, not the transport:
 * this gate speaks ONLY inside a repo that declares a front-end jurisdiction
 * (picasso.json beside a vendored tools/task-coverage.mjs at the repo top). Every
 * other repo is INERT — never refused, its code never imported.
 *
 * Fail-closed once claimed: after the edited file's repo is found to claim a
 * jurisdiction, anything that goes wrong — an unreadable claim, an unloadable
 * law, a crash — exits 2, because a crash exits 1 and both runners treat 1 as
 * non-blocking (the edit would go through). The claim file and the law file
 * themselves stay editable so an agent can repair them.
 *
 * Known ceiling: only the file-edit tools route here. A shell write (Bash
 * `cat >`, `sed -i`, `cp`) is not seen; the git fences judge it at commit/push.
 */
import { dirname, isAbsolute, relative } from "node:path";
import { findHarnessRoot, loadLaw, readJurisdiction, realPath } from "../lib/law-source.mjs";
import { authoringDecision, CONTROL_FILES, parseEditPayload, readRecords, sh } from "../lib/gate-law.mjs";
import { readStdin } from "../lib/io.mjs";

let claimed = false;
// Once a repo claims the edit, every way out that is not an explicit allow
// blocks — including an event loop that drains on a never-settling import.
const markClaimed = () => { claimed = true; process.exitCode = 2; };

async function judge(file, cwd) {
  // Plain concatenation, never path.join: ".." must meet the resolved links, not the text.
  const abs = realPath(isAbsolute(file) ? file : `${cwd}/${file}`);
  const root = findHarnessRoot(dirname(abs));
  if (!root) return null;
  markClaimed();
  // The control surface is judged by what it resolves to, not its spelling: a
  // picasso.json or .tasks that is itself a link is guarded at its target.
  let rel = relative(root, abs);
  for (const name of CONTROL_FILES) if (abs === realPath(`${root}/${name}`)) rel = name;
  const tasks = realPath(`${root}/.tasks`);
  if (abs === tasks || abs.startsWith(`${tasks}/`)) rel = `.tasks/${relative(tasks, abs)}`;
  const claim = readJurisdiction(root);
  if (!claim.ok)
    return rel === "picasso.json" ? null :
      `${claim.reason}\n  rule: a repo that declares a picasso jurisdiction must state it readably; an unreadable claim refuses\n  fix: rewrite picasso.json as {"jurisdiction": ["src/**"]} (editing it is allowed while it is unreadable), or cd ${sh(root)} && git checkout -- picasso.json`;
  const law = await loadLaw(root);
  if (!law.ok)
    return rel === "tools/task-coverage.mjs" ? null :
      `${law.reason}\n  rule: a claimed repo is judged by its own vendored harness; an unloadable harness refuses\n  fix: cd ${sh(root)} && git checkout -- tools/task-coverage.mjs (or re-vendor tools/ from picasso)`;
  const decision = authoringDecision(rel, law, claim.globs, readRecords(law.stateDir));
  return decision.decision === "deny" ? decision.reason : null;
}

async function main() {
  let payload = null;
  try { payload = JSON.parse(await readStdin()); } catch { /* unreadable: it names no file, judged below */ }
  const { toolName, cwd, targets } = parseEditPayload(payload);
  if (targets.length === 0) {
    const root = findHarnessRoot(cwd);
    if (!root) return 0;
    markClaimed();
    return deny(`cannot determine the target file of the ${toolName} edit inside ${root}, which declares a picasso jurisdiction` +
      `\n  rule: a gate that cannot name the file it is asked to bless refuses\n  fix: make the edit with Edit or Write and an explicit file_path`);
  }
  for (const file of targets) {
    const reason = await judge(file, cwd);
    if (reason) return deny(reason);
  }
  return 0;
}

function deny(reason) {
  process.stderr.write(`picasso authoring-gate: ${reason}\n`);
  return 2;
}

main().then(code => process.exit(code), e => {
  process.stderr.write(`picasso authoring-gate: internal error: ${e?.stack || e}\n`);
  process.exit(claimed ? 2 : 0);
});
