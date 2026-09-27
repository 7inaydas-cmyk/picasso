# Wiring picasso into a clone

Hooks are committed; activation is per clone:

```sh
git config core.hooksPath .githooks
```

Verify with the doctor — it refuses an unwired clone at push time:

```sh
node tools/task-coverage.mjs --doctor
```

The push range starts at the committed adoption base, `.picasso-base` (one full
sha per line, read from HEAD's tree — history the fence treats as settled). No
base, an unresolvable one, or an empty range REFUSES rather than guessing. Pin
it once, at adoption, under a task that covers `.picasso-base`:

```sh
git rev-parse HEAD > .picasso-base && git add .picasso-base \
  && git commit -m 'chore: pin the picasso adoption base' -m 'task: <tooling-task>'
```

A branch made before adoption that must merge later: add its tip as another
line (its history is then settled, not re-judged). The base is read from the
remote's tree, so a push cannot re-pin its own base. CI re-judges the pushed
range server-side (`node tools/task-coverage.mjs --base <event base>`, the
head commit checked out with `fetch-depth: 0`) — the fence a clone without
hooks cannot skip. Pull requests merge cleanly without a footer (a clean merge
introduces nothing); a merge that resolves conflicts carries one.

**Known ceiling — protect the fence's own surface.** CI runs the fence code of
the commit it judges, so a push that edits `tools/`, `.githooks/`, `.github/`,
`.picasso-base` or `docs/gates/` could weaken the fence in the same change.
Protect the default branch and require review of those paths (CODEOWNERS).

**Registry carrier shapes (strict).** A declared gate counts only in its exact
carrier: a hook line `<invocation> || exit 1`; a battery/script that is a plain
`&&` chain; a single-line CI `run:` in a workflow `on: [push, pull_request]`
with no `if:` and no `continue-on-error`. Commented, echoed, swallowed,
conditional or extended lines keep nothing "present".

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

## The gate discipline in a repo that does not vendor picasso

A repo governed by stallion (Antitube is one) keeps stallion's lifecycle and
fences; picasso contributes its front-end gate discipline, run from a picasso
checkout against the running site — nothing is vendored into the host repo:

```sh
BASE_URL=https://antitube.tv ROUTES="/, /feed, /watch" ROOT_SELECTOR=body \
  REPORT_DIR=<dir> node <picasso>/template/scripts/render-report.mjs
node <picasso>/tools/console-ratchet.mjs --report <dir>/console-report.json --baseline <console-baseline.json>
node <picasso>/tools/a11y-ratchet.mjs --violations <dir>/a11y-report.json --baseline <a11y-baseline.json> \
  --render-failures <dir>/render-failures.json --render-baseline <render-baseline.json>
```

`BASE_URL` sweeps in place (nothing built or started); a page answering HTTP
>= 400 is a render failure; missing assets and failing API calls are named in
the console report with origin+path identities. Baselines start as `[]` and
live with the host repo's gates; fixes land under the host repo's own
lifecycle. The `picasso` skill (plugin) carries this recipe into every session.

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
- The repo is found from the EDITED FILE's repo top (through symlinks), never the
  session cwd. Outside jurisdiction, no `picasso.json`, or no vendored harness:
  **inert** — never refused, and the repo's code is never imported.
- Inside a claimed repo the gate fails closed: an unreadable claim, an
  unloadable harness, a patch that names no file, or a crash denies with a fix.
- Known ceiling: shell writes (Bash `cat >`, `sed -i`) are not gated; the git
  fences judge them at commit and push.
- Banner (SessionStart/UserPromptSubmit): live front-end task state every turn;
  fails open; silent in unclaimed repos.

Install: see `plugin/README.md` (ZCode registers `plugin/`; Claude Code installs the
`plugin/claude-code-persistent/` root). Verify:
`node plugin/lib/gate-law.mjs --self-test`, then a live payload probe (see
`plugin/README.md`).

## Adopting the gates in a consuming front-end project

1. Copy `tools/` + `.githooks/` (or vendor picasso at a pinned commit), then
   `git config core.hooksPath .githooks`, and pin the adoption base
   (`.picasso-base`, above).
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
