# picasso-enforcement (ZCode + Claude Code plugin)

The same move as [stallion's enforcement plugin](../docs/WIRING.md): agents stop
invoking the harness after a handful of turns — instruction decay — and an
`AGENTS.md` nobody re-reads is adoption by consent. This plugin moves the law to
a transport that cannot decay: a **PreToolUse hook that denies the edit itself**,
within one action of the mistake, judged by the repo's OWN vendored picasso
harness so the gate cannot drift from the staged fence and push fence.

## What is picasso's here

The **claim**, not the transport. A front-end harness must not govern work that
is not front-end work, so this gate speaks only inside the repo's **declared
jurisdiction** — the front-end surface the repo itself declares in `picasso.json`:

```json
{ "jurisdiction": ["src/**", "index.html"] }
```

- **Which repo judges:** the repo top of the EDITED FILE (the nearest ancestor
  holding `.git`, through symlinks) — never the session's cwd. The git fences
  run from the repo top, so the plugin judges from there too; a nested harness
  (picasso's own `template/`) cannot flip the verdict.
- **A claim** is `picasso.json` beside `tools/task-coverage.mjs` at that repo top.
  No claim: **inert** — never refused, and the repo's code is never imported.
  A fresh adoption with no `.tasks/` yet is claimed and enforced.
- **Inside jurisdiction:** a front-end edit is allowed only when an in-flight
  task (`executing`–`adversarial`; `done` authorizes nothing) whose declared
  scope covers the file exists. Otherwise exit 2 with the rule, the evidence,
  and a fix command that, run as printed, authorizes the same edit.
- **Outside jurisdiction:** silent — except the gate's own control surface:
  `picasso.json` and `tools/task-coverage.mjs` need a covering in-flight task
  like front-end code; `.tasks/**` (written by `task-state` only) and any `.git`
  path (a planted `.git` would hide a subtree) are never written by the edit tools.
- **Paths are resolved like the kernel will:** through every symlink (dangling
  ones too), with `..` applied after the links, not to the text.
- **Fail-closed once claimed:** in a claimed repo, an unreadable `picasso.json`,
  an unloadable harness, a patch that names no file, or a crash denies (exit 2)
  — a crash would otherwise exit 1, which both runners treat as non-blocking.
  `picasso.json` and `tools/task-coverage.mjs` themselves stay editable so the
  claim and the law can be repaired. Malformed task records authorize nothing.
- The banner (SessionStart + UserPromptSubmit) re-injects live front-end task
  state every turn; it fails open, always, and stays silent in unclaimed repos.

The law is never copied: the plugin imports `PHASES`, `authorizingPhases` and
`pathMatches` from the repo's own `tools/task-coverage.mjs`.

### Known ceilings

- **Shell writes are not gated.** Only the file-edit tools route to the hook;
  `cat >`, `sed -i`, `cp`, `git apply` from Bash are not seen. The git fences
  (pre-commit, commit-msg, pre-push) judge those files at commit and push time.
- **The repo's code runs.** In a claimed repo the gate and the banner import
  that repo's `tools/task-coverage.mjs` on every gated edit and every prompt.
  Treat an untrusted repo that ships `picasso.json` like any repo whose hooks
  you run.
- **Patch dialects:** ApplyPatch targets are read from `*** Update/Add/Delete
  File:` / `*** Move to:` headers and unified-diff `---`/`+++` pairs. A patch in
  another dialect names no file and is denied inside a claimed repo.

## Dual-runtime

ONE shared core, two registration shells. The law, the io seam, and both hook
scripts exist exactly once; each runtime contributes only a registration file
and its plugin-root variable. The banner transport is itself shared law: both
runners inject context ONLY as strict JSON on stdout
(`{ "hookSpecificOutput": { "hookEventName", "additionalContext" } }`, echoing
the payload's `hook_event_name`); exit-0 stderr is log-only on both.

**Shared — exists once:**

- `lib/law-source.mjs`, `lib/gate-law.mjs`, `lib/io.mjs` — harness seam, the
  decision core, stdin.
- `hooks/authoring-gate.mjs` — the PreToolUse gate. Same exit-code contract on
  both runtimes: 0 passes, 2 blocks, deny text on stderr reaches the model.
- `hooks/banner.mjs` — the SessionStart + UserPromptSubmit banner (strict
  stdout JSON, fails open).

**Per-runtime — registration only:**

| | ZCode | Claude Code |
|---|---|---|
| Plugin root | `plugin/` (manifest `.zcode-plugin/plugin.json`) | `plugin/claude-code-persistent/` (manifest `.claude-plugin/plugin.json`) |
| Registration file | `hooks/hooks.json` — `type: "process"`, argv, `${ZCODE_PLUGIN_ROOT}` | `claude-code-persistent/hooks/hooks.json` — `type: "command"`, shell string, `${CLAUDE_PLUGIN_ROOT}` |
| Reaches the core via | `${ZCODE_PLUGIN_ROOT}/hooks/*.mjs` (same dir) | `${CLAUDE_PLUGIN_ROOT}/hooks/*.mjs` — in-root symlinks (`hooks/*.mjs → ../../hooks`, `lib → ../lib`, `skills → ../skills`) |
| Timeouts | `timeoutMs` (ms) | `timeout` (seconds) |
| File-edit tools matched | `Edit\|Write\|ApplyPatch` | `Edit\|Write\|MultiEdit\|NotebookEdit` |

The Claude Code root is its own directory because Claude Code merges the
default scan (`./hooks/hooks.json` at the plugin root) with manifest-declared
files — pointing it at `plugin/` would load the ZCode-schema registration too.
The in-root symlinks keep the core single.

**Live vs snapshot.** ZCode's `plugins.dirs` and a Claude Code marketplace or
`--plugin-dir` that points at this working tree run the LIVE files: a
half-finished edit to `plugin/` breaks the gate in every open session, so land
plugin edits in one step. A persistent Claude Code install copies the root
(symlinks become files) into `~/.claude/plugins/cache/` — a snapshot. Bump the
version in the three manifests (`plugin/package.json`,
`.zcode-plugin/plugin.json`, `claude-code-persistent/.claude-plugin/plugin.json`)
and reinstall to refresh it.

### Install (ZCode)

1. Prerequisite: `plugin/.zcode-plugin/plugin.json` must exist. Check:
   `node /opt/ZCode/resources/glm/zcode.cjs plugins validate /path/to/picasso/plugin`
2. Register the dir in `~/.zcode/cli/config.json`:
   `"plugins": { "dirs": ["/path/to/picasso/plugin"] }` (id
   `picasso-enforcement@inline`), or add a local marketplace and
   `plugins install picasso-enforcement@<market>`.
3. `node` (≥ 18) on PATH; hooks are `type: "process"` (argument vector, no
   shell). Registration is read at session start — restart ZCode to apply.

### Install (Claude Code)

1. Session (no install, live files):
   `claude --plugin-dir /path/to/picasso/plugin/claude-code-persistent`.
2. Persistent: `claude plugin marketplace add /path/to/picasso/plugin` (it holds
   `.claude-plugin/marketplace.json`, whose plugin source is
   `./claude-code-persistent`), then
   `claude plugin install picasso-enforcement@picasso-local`.
3. `claude plugin validate /path/to/picasso/plugin/claude-code-persistent` must
   pass. Hooks load at session start only — restart to apply.

In both cases the edited repo must vendor a picasso harness AND declare a
jurisdiction (`template/` ships `picasso.json` with defaults; this repo
dogfoods its own at the root, jurisdiction `template/src/**` +
`template/index.html`). Either missing → inert.

## Verify (run these; never trust the diff)

```sh
node plugin/lib/gate-law.mjs --self-test   # the decision matrix on the real law, then the live hooks end to end
# a live probe, from a repo vendoring picasso with no in-flight task:
echo '{"tool_name":"Edit","cwd":"<repo>","tool_input":{"file_path":"<repo>/src/App.tsx"}}' \
  | node plugin/hooks/authoring-gate.mjs; echo "exit=$?"   # 2 = denied, with a runnable fix
```
