# picasso-enforcement (ZCode plugin)

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

## Install

1. Copy this directory to your plugins location (Settings → Plugin Management →
   add from filesystem), or symlink it. `hooks/hooks.json` registers the hooks.
2. `node` (≥ 18) on PATH; hooks are `type: "process"` (argument vector, no shell).
3. The edited repo must vendor a picasso harness AND declare a jurisdiction
   (template/ ships `picasso.json` with defaults). Either missing → inert.

## Verify (run these; never trust the diff)

```sh
node plugin/lib/gate-law.mjs --self-test   # the deny/allow matrix
# live probes, from a repo vendoring picasso:
echo '{"tool_name":"Edit","cwd":"<repo>","tool_input":{"file_path":"<repo>/src/App.tsx"}}' \
  | node plugin/hooks/authoring-gate.mjs; echo "exit=$?"   # 2 = denied, no task
```
