#!/usr/bin/env node
/**
 * GATE-LAW — the pure decision core of picasso's enforcement plugin.
 *
 * The problem it exists for is the same one stallion's plugin names: agents stop
 * invoking the harness after a handful of turns — instruction decay — and an
 * AGENTS.md nobody re-reads is adoption by consent. The fix class is transport:
 * a PreToolUse hook that denies the edit itself, within one action of the mistake.
 *
 * What is picasso's here (and stallion's is not): the front-end-only claim. The
 * plugin governs exactly the repo's DECLARED JURISDICTION — the front-end surface
 * the repo itself declares in picasso.json (jurisdiction globs, shipped with
 * defaults by template/). Inside jurisdiction, the stallion rule applies verbatim:
 * an edit is allowed only when an IN-FLIGHT task whose declared scope covers the
 * file exists. Outside jurisdiction, the plugin is silent — backend files in a
 * mixed repo are never spoken to.
 *
 * The law is never copied: the phases and the authorizing window come from the
 * repo's own vendored harness (law-source.mjs imports PHASES and authorizingPhases
 * from tools/task-coverage.mjs), and scope matching delegates to that harness's
 * pathMatches — so this gate cannot drift from the staged fence and push fence
 * that judge the same file later.
 *
 * Usage:
 *   gate-law.mjs --self-test     the decision matrix against the real law, then
 *                                the live hooks end to end
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse a PreToolUse hook payload (the stdin JSON) into the files it would write.
 * Edit/Write/MultiEdit carry file_path (filePath/path/notebook_path spellings are
 * accepted); ZCode's ApplyPatch carries only patch_text, whose targets are read
 * from its file headers. No nameable target → targets: [] — the caller refuses
 * that only inside a repo that claims a jurisdiction, never anywhere else.
 *
 * cwd: Claude Code puts it in the payload; ZCode does not, so fall back to
 * ZCODE_PROJECT_DIR first (a CLAUDE_PROJECT_DIR seen without a payload cwd is
 * one inherited from an outer session), then CLAUDE_PROJECT_DIR, then the
 * process cwd.
 */
export function parseEditPayload(payload) {
  const input = payload?.tool_input ?? {};
  const toolName = typeof payload?.tool_name === "string" && payload.tool_name ? payload.tool_name : "(unknown tool)";
  const cwd = typeof payload?.cwd === "string" && payload.cwd
    ? payload.cwd
    : process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const direct = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path;
  const patch = input.patch_text ?? input.patch ?? input.input;
  const targets = typeof direct === "string" && direct ? [direct]
    : typeof patch === "string" ? patchTargets(patch) : [];
  return { toolName, cwd, targets };
}

// ponytail: two patch dialects, read by their file headers — codex-style
// "*** Update File:" markers (any whitespace indent: codex trims it) and
// git/unified diffs ("diff --git", "--- / +++" pairs, rename/copy lines, any
// -p1 prefix incl. mnemonic i/ w/ c/ o/, C-quoted paths). A directive-shaped
// "*** Word:" line or a "diff --git" line that cannot be read means the patch
// cannot be read whole: it names nothing, and is refused inside a claimed
// repo. Add a dialect's headers here if one shows up.
const MARKER = /^(?:(?:Add|Update|Delete) File|Move to): (.+)$/;
const END_MARKER = /^(?:Begin Patch|End Patch|End of File)$/;
const DIRECTIVE_SHAPE = /^[A-Z][A-Za-z]*(?: [A-Za-z]+)*:/;

export function patchTargets(text) {
  const found = new Set();
  // A header path: judged with and without its first component — the
  // applier's strip level (-p0 / -p1) is not in the patch.
  const addHeader = h => {
    const p = unquote(h.split("\t")[0].trim());
    if (!p || p === "/dev/null") return;
    found.add(p);
    if (p.includes("/")) found.add(p.slice(p.indexOf("/") + 1));
  };
  for (const m of text.matchAll(/^[^\S\r\n]*\*\*\*[^\S\r\n]*(.*?)[^\S\r\n]*\r?$/gm)) {
    const target = m[1].match(MARKER);
    if (target) found.add(target[1].trim());
    else if (!END_MARKER.test(m[1]) && DIRECTIVE_SHAPE.test(m[1])) return [];
  }
  for (const m of text.matchAll(/^diff --git (.+?)\r?$/gm)) {
    const pair = splitGitHeader(m[1]);
    if (!pair) return [];
    pair.forEach(addHeader);
  }
  for (const m of text.matchAll(/^(?:rename|copy) (?:from|to) (.+?)\r?$/gm)) found.add(unquote(m[1]));
  for (const m of text.matchAll(/^--- (.+?)\r?\n\+\+\+ (.+?)\r?$/gm)) { addHeader(m[1]); addHeader(m[2]); }
  return [...found];
}

// "diff --git <src> <dst>": two tokens (quoted or space-free), else git's
// same-name-twice form for unquoted paths with spaces.
function splitGitHeader(s) {
  const tok = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(s);
  if (tok) return [tok[1], tok[2]];
  for (let i = s.indexOf(" "); i > 0; i = s.indexOf(" ", i + 1)) {
    const [l, r] = [s.slice(0, i), s.slice(i + 1)];
    if (l.slice(l.indexOf("/") + 1) === r.slice(r.indexOf("/") + 1)) return [l, r];
  }
  return null;
}

// git's C-quoting ("a/caf\303\251.tsx") back to the UTF-8 path.
function unquote(s) {
  if (!/^".*"$/.test(s)) return s;
  const esc = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
  const bytes = [];
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== "\\") { bytes.push(...Buffer.from(s[i])); continue; }
    const oct = s.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; }
    else { bytes.push(esc[s[i + 1]] ?? s.charCodeAt(i + 1)); i++; }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Every well-formed task record in stateDir. Anything else (findings files,
 *  null, a string scope) authorizes nothing and crashes nothing. */
export function readRecords(stateDir) {
  let files;
  try { files = readdirSync(stateDir).filter(f => f.endsWith(".json")); } catch { return []; }
  const records = [];
  for (const f of files) {
    try {
      const t = JSON.parse(readFileSync(join(stateDir, f), "utf8"));
      // task-state loads a task by its file name, so a record must be named for its id.
      if (typeof t?.id === "string" && f === `${t.id}.json` && typeof t.phase === "string" &&
          Array.isArray(t.scope) && t.scope.every(g => typeof g === "string")) records.push(t);
    } catch { /* unreadable: authorizes nothing */ }
  }
  return records;
}

/**
 * The authoring decision, pure over (repo-relative path, law, jurisdiction, records).
 * law = { root, stateDir, phases, authorizingPhases, pathMatches } from the repo's
 * own vendored harness; jurisdiction = the picasso.json globs.
 * Returns { decision: "allow", hint } or { decision: "deny", reason } — a deny's
 * fix line is a command that, run as printed, authorizes the same edit.
 */
// The gate's own control surface inside a claimed repo. The claim and the law
// are judged like front-end files (a covering in-flight task, or no edit);
// task records and git metadata are never written by the edit tools at all.
export const CONTROL_FILES = ["picasso.json", "tools/task-coverage.mjs"];

/** Quote for a POSIX shell: a fix line must run as printed, whatever the path holds. */
export const sh = s => `'${s.replace(/'/g, "'\\''")}'`;

export function authoringDecision(relPath, law, jurisdiction, records) {
  const refuse = (what, rule, fix) => ({ decision: "deny", reason: `${what}\n  rule: ${rule}\n  fix: ${fix}` });
  const ts = "node tools/task-state.mjs";
  if (/[\r\n\u2028\u2029]/.test(relPath))
    return refuse(`the edit targets a path with a line break (${JSON.stringify(relPath)}) inside a picasso-claimed repo`,
      "a path the glob law cannot judge is refused", "rename the file without line breaks");
  if (/(^|\/)\.git(\/|$)/.test(relPath))
    return refuse(`the edit targets ${relPath}, git metadata inside a picasso-claimed repo`,
      "the edit tools never write .git here — a planted .git would hide a subtree from the gate",
      "none for front-end work: git maintains .git itself");
  if (relPath === ".tasks" || relPath.startsWith(".tasks/"))
    return refuse(`the edit targets ${relPath}, a task record`,
      "task records are written by task-state only, never by an editor",
      `cd ${sh(law.root)} && ${ts} status`);
  if (!law.pathMatches(relPath, jurisdiction) && !CONTROL_FILES.includes(relPath))
    return { decision: "allow", hint: `${relPath} is outside the declared front-end jurisdiction` };
  const covering = records.filter(t => law.pathMatches(relPath, t.scope));
  const live = covering.filter(t => law.authorizingPhases.includes(t.phase));
  if (live.length)
    return { decision: "allow", hint: `${relPath} is covered by ${live.map(t => t.id).join(", ")}` };

  // A covering task not yet started needs only its advances; otherwise open one.
  const start = law.authorizingPhases[0];
  const pending = covering.find(t => law.phases.indexOf(t.phase) < law.phases.indexOf(start));
  const id = pending ? pending.id : freshId(relPath, law.stateDir);
  const glob = relPath.includes("/") ? relPath.replace(/[^/]+$/, "**") : relPath;
  const steps = pending ? [] : [`${ts} new ${id} --risk-class ui-runtime`, `${ts} scope ${id} --add ${sh(glob)}`];
  const advances = law.phases.indexOf(start) - law.phases.indexOf(pending ? pending.phase : law.phases[0]);
  for (let i = 0; i < advances; i++) steps.push(`${ts} advance ${id}`);
  const found = covering.length ? covering.map(t => `${t.id} (${t.phase})`).join(", ") : "none";
  return refuse(`the edit targets ${relPath}, inside this repo's declared front-end jurisdiction, and no in-flight task covers it`,
    `front-end code lands only under a task advanced to ${start} (covering tasks found: ${found})`,
    `cd ${sh(law.root)} && ${steps.join(" && ")}`);
}

// A task id derived from the file (src/NavBar.tsx → edit-nav-bar) that no
// register file already holds.
function freshId(relPath, stateDir) {
  const stem = relPath.split("/").pop().replace(/\.[^.]*$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = `edit-${stem || "front-end"}`;
  let id = base;
  for (let n = 2; existsSync(join(stateDir, `${id}.json`)); n++) id = `${base}-${n}`;
  return id;
}

/** The banner's one-line state, or null when there is nothing to say. */
export function bannerLine(records, authorizingPhases) {
  const inFlight = records.filter(t => authorizingPhases.includes(t.phase));
  if (inFlight.length === 0) return null;
  return inFlight.map(t => `${t.id} · ${t.phase} · scope: ${t.scope.join(", ")}`).join(" | ");
}

// ---- self-test: the decision matrix against the REAL vendored law ----
async function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("gate-law --self-test");

  const coverage = await import(new URL("../../tools/task-coverage.mjs", import.meta.url).href);
  const law = { root: "/repo", stateDir: "/nonexistent/.tasks", phases: coverage.PHASES,
    authorizingPhases: coverage.authorizingPhases(), pathMatches: coverage.pathMatches };
  const J = ["src/**", "index.html"];
  const t = (id, phase, scope) => ({ id, phase, scope });
  const d = (file, records, juris = J) => authoringDecision(file, law, juris, records);
  const fixOf = r => (r.reason?.match(/fix: (.+)/) || [])[1] || "";

  ok("in jurisdiction, no task at all → deny with fix", fixOf(d("src/App.tsx", [])).includes("new edit-app"));
  ok("in jurisdiction, covered by executing task → allow", d("src/App.tsx", [t("feat", "executing", ["src/**"])]).decision === "allow");
  ok("in jurisdiction, covered only by planned task → deny, fix advances it once",
    (r => r.decision === "deny" && fixOf(r).split("advance feat").length === 2 && !fixOf(r).includes(" new "))(d("src/App.tsx", [t("feat", "planned", ["src/**"])])));
  ok("in jurisdiction, covered only by done task → deny (done authorizes nothing)", d("src/App.tsx", [t("old", "done", ["src/**"])]).decision === "deny");
  ok("in jurisdiction, task covers a different scope → deny", d("src/App.tsx", [t("other", "executing", ["docs/**"])]).decision === "deny");
  ok("a root-level file's fix scopes the file, never **", fixOf(d("index.html", [])).includes("--add 'index.html'"));
  ok("a bare-dir scope covers its subtree (the real matcher, not a copy)", d("src/ui/a.tsx", [t("feat", "executing", ["src"])]).decision === "allow");
  ok("outside jurisdiction → allow", d("README.md", []).decision === "allow");
  ok("payload without a file names no target", parseEditPayload({ tool_name: "Edit", tool_input: {} }).targets.length === 0);
  ok("payload path spellings parse", parseEditPayload({ tool_name: "Write", tool_input: { path: "/repo/src/a.tsx" }, cwd: "/repo" }).targets[0] === "/repo/src/a.tsx");
  ok("patch targets: *** dialect, incl. move", patchTargets("*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n*** Add File: c.ts\n*** End Patch").join() === "a.ts,b.ts,c.ts");
  ok("patch targets: unified diff pairs, /dev/null skipped", (r => r.includes("src/new.tsx") && !r.some(p => p.includes("dev/null")))(patchTargets("--- /dev/null\n+++ b/src/new.tsx\n@@ -0,0 +1 @@\n+x\n")));
  ok("patch targets: a removed '-- x' line is not a header", (r => r.includes("f.ts") && !r.includes("x"))(patchTargets("--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n--- x\n+y\n")));
  ok("the claim file needs a covering task like front-end code", d("picasso.json", []).decision === "deny");
  ok("the law file needs a covering task like front-end code", d("tools/task-coverage.mjs", []).decision === "deny");
  ok("task records are never editor-written, even under a covering task", d(".tasks/forged.json", [t("feat", "executing", ["**"])]).decision === "deny");
  ok("git metadata is never editor-written (a planted .git hides a subtree)", d("packages/web/.git", [t("feat", "executing", ["**"])]).decision === "deny");
  ok("a path with a line break is refused", d("src/a\nb.tsx", [t("feat", "executing", ["src/**"])]).decision === "deny");
  ok("the fix quotes for the shell ($ and quotes survive)", fixOf(d("src/posts.$id/it's.tsx", [])).includes("--add 'src/posts.$id/**'"));
  ok("patch targets: indented markers are read", patchTargets("*** Begin Patch\n*** Add File: notes.md\n  *** Update File: src/App.tsx\n*** End Patch").includes("src/App.tsx"));
  ok("patch targets: git renames and new files are read", patchTargets("diff --git a/README.md b/src/App.tsx\nrename from README.md\nrename to src/App.tsx\n").includes("src/App.tsx"));
  ok("patch targets: any whitespace indent (NBSP, \\f) is read", patchTargets("*** Add File: n.md\n\u00a0*** Update File: src/App.tsx\n\f*** Delete File: src/Old.tsx").join() === "n.md,src/App.tsx,src/Old.tsx");
  ok("patch targets: mnemonic prefixes are stripped too", patchTargets("diff --git i/src/App.tsx w/src/App.tsx\n--- i/src/App.tsx\n+++ w/src/App.tsx\n").includes("src/App.tsx"));
  ok("patch targets: C-quoted git headers decode", patchTargets('diff --git "a/src/caf\\303\\251.tsx" "b/src/caf\\303\\251.tsx"\nnew file mode 100644\n').includes("src/café.tsx"));
  ok("patch targets: unquoted spaces in a git header", patchTargets("diff --git a/src/my file.tsx b/src/my file.tsx\n").includes("src/my file.tsx"));
  ok("patch targets: an unreadable diff --git line reads as unnameable", patchTargets("diff --git a/x.tsx\n").length === 0);
  ok("patch targets: a markdown *** context line is not a directive", patchTargets("*** Begin Patch\n*** Update File: README.md\n@@\n ***\n *** bold ***\n-a\n+b\n*** End Patch").join() === "README.md");
  ok("patch targets: an unknown *** directive reads as unnameable", patchTargets("*** Begin Patch\n*** Frobnicate File: src/App.tsx\n*** End Patch").length === 0);
  ok("banner is null with nothing authorizing (done included)", bannerLine([t("old", "done", ["src/**"])], law.authorizingPhases) === null);
  ok("banner names in-flight tasks", (bannerLine([t("feat", "executing", ["src/**"])], law.authorizingPhases) || "").includes("feat · executing"));

  liveHook(ok);
  console.log(failures.length ? `gate-law: ${failures.length} self-test failure(s)` : "gate-law: self-test clean");
  if (failures.length) process.exit(1);
}

// ---- the live hook, end to end: the real hook processes, the real vendored law,
// fixture repos shaped the way adoption actually leaves them ----
function liveHook(ok) {
  const REPO = fileURLToPath(new URL("../../", import.meta.url));
  const HOOK = fileURLToPath(new URL("../hooks/authoring-gate.mjs", import.meta.url));
  const BANNER = fileURLToPath(new URL("../hooks/banner.mjs", import.meta.url));
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "picasso-gate-")));
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.ZCODE_PROJECT_DIR;
  const run = (script, payload, cwd) => spawnSync("node", [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload), cwd, env, encoding: "utf8" });
  const edit = (file, cwd) => run(HOOK, { tool_name: "Write", cwd, tool_input: { file_path: file } }, cwd);
  // ZCode's ApplyPatch carries only patch_text, and ZCode payloads carry no cwd.
  const patch = (text, cwd) => run(HOOK, { tool_name: "ApplyPatch", tool_input: { patch_text: text } }, cwd);
  // A repo that vendors the harness and declares a jurisdiction, with no .tasks/
  // yet — git keeps no empty dirs, so this is what a fresh adoption looks like.
  const repo = (dir, jurisdiction) => {
    for (const d of [".git", "tools", "src"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ["task-coverage.mjs", "task-state.mjs"]) copyFileSync(join(REPO, "tools", f), join(dir, "tools", f));
    writeFileSync(join(dir, "picasso.json"), JSON.stringify({ jurisdiction }));
    return dir;
  };
  const task = (dir, id, phase, scope) => {
    mkdirSync(join(dir, ".tasks"), { recursive: true });
    writeFileSync(join(dir, ".tasks", `${id}.json`), JSON.stringify({ id, phase, riskClass: "ui-runtime", scope, pins: [], history: [] }));
  };
  const plain = join(tmp, "plain");
  mkdirSync(join(plain, ".git"), { recursive: true });
  const R = repo(join(tmp, "app"), ["src/**", "index.html"]);
  const APP = join(R, "src/App.tsx");

  ok("live: a fresh adoption (no .tasks/ yet) is enforced, not inert", edit(APP, R).status === 2);
  ok("live: outside jurisdiction stays silent", edit(join(R, "README.md"), R).status === 0);
  ok("live: a repo with no picasso claim is never spoken to", edit(join(plain, "src/App.tsx"), plain).status === 0);
  ok("live: ApplyPatch outside any picasso repo passes, whatever its dialect", patch("an opaque patch", plain).status === 0);
  ok("live: ApplyPatch (*** dialect) into jurisdiction with no task is denied",
    patch("*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-a\n+b\n*** End Patch\n", R).status === 2);
  ok("live: ApplyPatch (unified diff) into jurisdiction with no task is denied",
    patch("--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1 +1 @@\n-a\n+b\n", R).status === 2);
  ok("live: ApplyPatch naming no file inside a claimed repo is denied", patch("an opaque patch", R).status === 2);
  ok("live: the edited file picks the repo, not the session cwd", edit(APP, tmp).status === 2);
  symlinkSync(R, join(tmp, "link"));
  ok("live: a path through a symlink is judged, not waved through", edit(join(tmp, "link/src/App.tsx"), tmp).status === 2);

  // The printed fix is exact: running it, as printed, makes the same edit pass.
  const fix = (edit(APP, R).stderr.match(/fix: (.+)/) || [])[1];
  ok("live: the deny carries a fix command", Boolean(fix));
  if (fix) spawnSync(fix, { shell: true, cwd: tmp, env, encoding: "utf8" });
  ok("live: running the printed fix authorizes the edit", edit(APP, R).status === 0);
  ok("live: ApplyPatch into covered scope passes", patch("*** Begin Patch\n*** Update File: src/App.tsx\n*** End Patch\n", R).status === 0);

  // Malformed records authorize nothing and crash nothing (a crash exits 1,
  // which both runners treat as non-blocking — the edit would go through).
  const R2 = repo(join(tmp, "app2"), ["src/**"]);
  task(R2, "stringly", "executing", "src/**");
  writeFileSync(join(R2, ".tasks", "zz.json"), "null");
  writeFileSync(join(R2, ".tasks", "old.adversarial.json"), JSON.stringify({ probes: [] }));
  ok("live: malformed records neither crash the gate nor authorize", edit(join(R2, "src/App.tsx"), R2).status === 2);

  // A broken claim refuses with a fix; the broken file itself stays repairable.
  const R3 = repo(join(tmp, "app3"), ["src/**"]);
  writeFileSync(join(R3, "picasso.json"), "{ not json");
  const badClaim = edit(join(R3, "src/App.tsx"), R3);
  ok("live: an unreadable picasso.json refuses with a fix", badClaim.status === 2 && /fix:/.test(badClaim.stderr));
  ok("live: picasso.json itself stays editable to repair it", edit(join(R3, "picasso.json"), R3).status === 0);
  const R4 = repo(join(tmp, "app4"), ["src/**"]);
  writeFileSync(join(R4, "tools/task-coverage.mjs"), "export const = broken;");
  const badLaw = edit(join(R4, "src/App.tsx"), R4);
  ok("live: an unloadable harness refuses with a fix", badLaw.status === 2 && /fix:/.test(badLaw.stderr));
  ok("live: the harness file itself stays editable to repair it", edit(join(R4, "tools/task-coverage.mjs"), R4).status === 0);

  // Paths the kernel resolves differently from the text: a dangling link (the
  // write creates its target) and ".." after a directory link.
  mkdirSync(join(tmp, "out"));
  symlinkSync(join(R2, "src/New.tsx"), join(tmp, "out/dangling.tsx"));
  ok("live: a write through a dangling symlink is judged at its target", edit(join(tmp, "out/dangling.tsx"), tmp).status === 2);
  mkdirSync(join(R2, "src/ui/deep"), { recursive: true });
  symlinkSync(join(R2, "src/ui/deep"), join(tmp, "out/deeplink"));
  ok("live: '..' after a directory symlink is resolved like the kernel", edit(`${tmp}/out/deeplink/../Button.tsx`, tmp).status === 2);
  ok("live: forging a task record with Write is refused", edit(join(R2, ".tasks/forged.json"), R2).status === 2);

  // The control surface is judged by what it resolves to, not its spelling.
  const R8 = repo(join(tmp, "app8"), ["src/**"]);
  mkdirSync(join(R8, "config"));
  writeFileSync(join(R8, "config/picasso.json"), JSON.stringify({ jurisdiction: ["src/**"] }));
  rmSync(join(R8, "picasso.json"));
  symlinkSync("config/picasso.json", join(R8, "picasso.json"));
  mkdirSync(join(R8, "state/tasks"), { recursive: true });
  symlinkSync("state/tasks", join(R8, ".tasks"));
  ok("live: a claim file reached through a link is still guarded", edit(join(R8, "config/picasso.json"), R8).status === 2);
  ok("live: task records reached through a link are still guarded", edit(join(R8, "state/tasks/forged.json"), R8).status === 2);

  // A harness import that never settles must not drain to exit 0.
  const R9 = repo(join(tmp, "app9"), ["src/**"]);
  writeFileSync(join(R9, "tools/task-coverage.mjs"), "await new Promise(() => {});");
  ok("live: a harness import that never settles still blocks", edit(join(R9, "src/App.tsx"), R9).status === 2);

  // An older harness dispatches its CLI on import and calls process.exit.
  const R7 = repo(join(tmp, "app7"), ["src/**"]);
  writeFileSync(join(R7, "tools/task-coverage.mjs"), 'console.error("task-coverage: refused\\n  fix: stale-harness-advice"); process.exit(0);');
  const stale = edit(join(R7, "src/App.tsx"), R7);
  ok("live: a harness that exits on import cannot wave the edit through", stale.status === 2);
  ok("live: the stale harness's own output is muted (one fix line: the gate's)", !stale.stderr.includes("stale-harness-advice"));

  // A nested harness (picasso's own template/) must not flip the verdict by cwd:
  // the git fences judge from the repo top, so the plugin does too.
  const R5 = repo(join(tmp, "mono"), ["template/src/**"]);
  repo(join(R5, "template"), ["src/**"]);
  rmSync(join(R5, "template/.git"), { recursive: true });
  mkdirSync(join(R5, "template/.tasks"));
  task(R5, "tpl", "executing", ["template/src/**"]);
  const NESTED = join(R5, "template/src/x.tsx");
  ok("live: a nested harness does not flip the verdict by cwd",
    edit(NESTED, join(R5, "template")).status === 0 && edit(NESTED, R5).status === 0);

  // The banner never executes code in a repo that made no picasso claim.
  const R6 = join(tmp, "noclaim");
  for (const d of [".git", "tools", ".tasks"]) mkdirSync(join(R6, d), { recursive: true });
  writeFileSync(join(R6, "tools/task-coverage.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(R6, "ran"))}, "x");`);
  run(BANNER, { hook_event_name: "SessionStart", cwd: R6 }, R6);
  ok("live: the banner does not import an unclaimed repo's code", !existsSync(join(R6, "ran")));

  rmSync(tmp, { recursive: true, force: true });
}

if (process.argv[1] && process.argv[1].endsWith("gate-law.mjs") && process.argv.includes("--self-test")) await selfTest();
