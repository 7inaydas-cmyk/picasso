# Wiring picasso into a clone

Hooks are committed; activation is per clone:

```sh
git config core.hooksPath .githooks
```

Verify with the doctor — it refuses an unwired clone at push time:

```sh
node tools/task-coverage.mjs --doctor
```

The push base resolves as: `picasso.push-base` config > the branch's upstream >
REFUSE. A local-only clone sets an explicit base:

```sh
git config picasso.push-base main
```

## The visual verification seam (blind execution is the unfenced failure mode)

Two halves, deliberately separate — one gate, one meaning:

**The deterministic fence (commit/CI-side): render + console sweep.** The
template's `scripts/render-report.mjs` drives every route headlessly (playwright —
hard-pinned in the template's `package.json`, like `@shadcn/lint`; `PORT` env
overrides the off-default port), collecting console errors, page errors, and
failed requests into `reports/console-report.json`. Gate it:

```sh
node tools/console-ratchet.mjs --report reports/console-report.json \
  --baseline baselines/console-baseline.json
```

New console errors fail the gate (hydration mismatches, broken styling, 404
assets — failures no code-level gate sees); resolved errors must be `--prune`d.
The report writer must emit stable text (first line normalized) — that is the
gate's identity contract.

**The judged pass (adversarial-side): the MCP contract.** Screenshot capture,
responsive breakpoint walks, and visual judgment are multimodal — inherently
agent work, never a commit fence (a flaky gate costs more authority than it
buys). The adversarial pass REQUIRES a browser automation MCP (e.g.
playwright-mcp) and must record, per probe: route, breakpoint, what the
screenshot shows, and the judgment. `done` refuses a pass where nothing was
refused — a screenshot loop that never found anything to question did not look.

## The enforcement plugin (invoking picasso in the session)

`plugin/` is the stallion-pattern transport against instruction decay: a
PreToolUse hook that denies the edit itself, judged by the repo's OWN vendored
harness (the law — `PHASES`, `authorizingPhases`, `pathMatches` — is imported
from `tools/task-coverage.mjs`, never copied).

The front-end-only claim is enforced by **declared jurisdiction**: the repo's
`picasso.json` (`{ "jurisdiction": ["src/**", "index.html"] }` — template ships
defaults) bounds everything the plugin may refuse.

- Inside jurisdiction: front-end edits require an in-flight task
  (`executing`–`adversarial`; `done` authorizes nothing) whose scope covers the
  file, else exit 2 with rule + evidence + exact fix.
- Outside jurisdiction, no `picasso.json`, or no vendored harness: **inert** —
  the plugin never governs work that is not front-end work.
- Banner (SessionStart/UserPromptSubmit): live front-end task state every turn;
  fails open.

Install: copy or symlink `plugin/` into your plugins location. Verify:
`node plugin/lib/gate-law.mjs --self-test`, then a live payload probe (see
`plugin/README.md`).

## Adopting the gates in a consuming front-end project

1. Copy `tools/` + `.githooks/` (or vendor picasso at a pinned commit), then
   `git config core.hooksPath .githooks`.
2. Lint: install ESLint ≥9.30 (or Oxlint ≥1.80) + `@shadcn/lint` (pinned; picasso
   pins 0.1.5); configure rules and contracts; record the current warning count:
   `node tools/lint-budget.mjs --set <count>`; run CI with
   `node tools/lint-budget.mjs --check` (add `--linter oxlint` for the Oxlint path).
3. A11y: produce an axe report (Storybook a11y at `error` severity, or
   `@axe-core/playwright` sweeping every story); commit the initial baseline; gate CI
   with `node tools/a11y-ratchet.mjs --violations report.json --baseline baseline.json`
   — plus `--render-failures`/`--render-baseline` to ratchet stories that fail to
   render at all. **Sanity probe (GSA pattern): before trusting a green run, plant one
   canary violation and confirm the gate FAILS** — a green that cannot turn red is not
   a gate.
4. Bundle budgets: declare `{ budgets: [{ path, maxBytes }] }`; gate the build with
   `node tools/size-budget.mjs --budgets budgets.json`.
5. Typecheck/build/unit/e2e: wire directly in CI and declare them in
   `docs/gates/gate-registry.json` — the registry drift-checks that every declared
   invocation actually runs in every transport that claims it.
