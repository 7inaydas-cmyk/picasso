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

- Inside jurisdiction: a front-end edit is allowed only when an in-flight task
  (`executing`–`adversarial`; `done` authorizes nothing) whose declared scope
  covers the file exists. Everything else exits 2 with the rule, the evidence,
  and an exact fix command.
- Outside jurisdiction, or with no `picasso.json` at all: **inert** — the plugin
  never refuses work that is not front-end work.
- A repo without a vendored picasso harness (`tools/task-coverage.mjs` +
  `.tasks/`): inert.
- The banner (SessionStart + UserPromptSubmit) re-injects live front-end task
  state every turn; it fails open, always.

The law is never copied: the plugin imports `PHASES`, `authorizingPhases` and
`pathMatches` from the repo's own `tools/task-coverage.mjs`.

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
| Plugin root | `plugin/` (manifest `.zcode-plugin/plugin.json`) | `plugin/claude-code/` (manifest `.claude-plugin/plugin.json`) |
| Registration file | `hooks/hooks.json` — `type: "process"`, argv, `${ZCODE_PLUGIN_ROOT}` | `claude-code/hooks/hooks.json` — `type: "command"`, shell string, `${CLAUDE_PLUGIN_ROOT}` |
| Reaches the core via | `${ZCODE_PLUGIN_ROOT}/hooks/*.mjs` (same dir) | `${CLAUDE_PLUGIN_ROOT}/../hooks/*.mjs` (one level up) |
| Timeouts | `timeoutMs` (ms) | `timeout` (seconds) |
| File-edit tools matched | `Edit\|Write\|ApplyPatch` | `Edit\|Write\|MultiEdit` |

The Claude Code root is its own directory because Claude Code merges the
default scan (`./hooks/hooks.json` at the plugin root) with manifest-declared
files — pointing it at `plugin/` would load the ZCode-schema registration too.
The `../hooks` reach-up is what keeps the core single: it resolves whenever the
files stay in place, and a hook that cannot resolve its script errors (which
fails open — an errored hook never blocks an edit).

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

1. Session (no install — the route the shared core is laid out for):
   `claude --plugin-dir /path/to/picasso/plugin/claude-code` (repeatable).
   `${CLAUDE_PLUGIN_ROOT}` expands to that dir, so `../hooks/*.mjs` resolves to
   the shared core in place.
2. Persistent: `claude plugin marketplace add <dir holding
   .claude-plugin/marketplace.json>` then `claude plugin install
   picasso-enforcement@<marketplace>`. Caveat: installing COPIES the plugin
   into `~/.claude/plugins/cache/`, and a copy of `claude-code/` alone loses
   the `../hooks` sibling — a persistent install must copy a root that still
   contains the shared core, or the hooks error open (never block).
3. `claude plugin validate /path/to/picasso/plugin/claude-code` must pass.
   Hooks load at session start only — restart to apply.

In both cases the edited repo must vendor a picasso harness AND declare a
jurisdiction (`template/` ships `picasso.json` with defaults; this repo
dogfoods its own at the root, jurisdiction `template/src/**` +
`template/index.html`). Either missing → inert.

## Verify (run these; never trust the diff)

```sh
node plugin/lib/gate-law.mjs --self-test   # the deny/allow matrix
# live probes, from a repo vendoring picasso:
echo '{"tool_name":"Edit","cwd":"<repo>","tool_input":{"file_path":"<repo>/src/App.tsx"}}' \
  | node plugin/hooks/authoring-gate.mjs; echo "exit=$?"   # 2 = denied, no task
```
