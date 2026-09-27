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

## Picasso's checks in a repo picasso does not govern

Two ways to run picasso's front-end checks in a repo whose lifecycle is someone
else's (a stallion-governed repo): vendor the checks bundle (A, recommended), or
run them from a picasso checkout (B).

### A. The vendored checks bundle (recommended for a stallion-governed repo)

`tools/checks-vendor.mjs --export` writes seven files FLAT into one host
directory — `render-report.mjs`, `ratchet.mjs`, `console-ratchet.mjs`,
`a11y-ratchet.mjs`, `size-budget.mjs`, `lint-budget.mjs` and the checker itself
— beside a `VENDOR.json` manifest: `schema` (`picasso/checks-manifest@1`),
`upstream` (the picasso commit) and a `source` + `sha256` per file. The bundle is
atomic: a manifest naming more or fewer files is refused. Export from a PUSHED
picasso checkout — the bytes come from HEAD's objects (a local edit is warned
about, never exported) and a HEAD no remote-tracking ref of `origin` contains
is refused (a throwaway remote does not count), so the pin stays findable:

```sh
# from the host repo's root
node <picasso>/tools/checks-vendor.mjs --export docs/gates/picasso
```

In a stallion host, place it at `docs/gates/picasso/`: `tools/` is stallion's
own vendored corpus (every file there must be declared in stallion's manifest),
and a top-level `vendor/` is not code to stallion's fence, so edits there would
need no task at all.

- **Drift gate** (host battery): `node docs/gates/picasso/checks-vendor.mjs`,
  from any cwd — refuses a missing or malformed manifest, an undeclared file, a
  deleted file or a patched one, any entry that is not a regular file (a
  symlink runs its target, whose `./ratchet.mjs` no gate reads), any
  `node_modules` between the bundle and the repo root (the bundle's bare imports
  resolve upward, and a clean install replaces only the root's; in a submodule
  the root is the superproject's), and a nearest `package.json` above the bundle
  that names itself `playwright` or `@axe-core/playwright` (node resolves a bare
  import to that package's own `exports` before it reads any `node_modules`), and
  names the fix. Inside a git work tree it needs a git that answers: git missing,
  an unreadable config or a dubious-ownership refusal fails it closed. Install
  `playwright` and `@axe-core/playwright` at the repo root.
- **Freshness** (each wave's intake), run by the picasso CLONE's checker so the
  copy being judged is never the judge (a host copy cannot certify its own
  checker), after pulling that clone:
  `node <picasso-clone>/tools/checks-vendor.mjs --freshness <picasso-clone> --bundle docs/gates/picasso` —
  refuses when the manifest's digests are not picasso's bytes at its own pin
  (`patched against upstream`: a hand patch under a regenerated manifest, the
  checker included), when the pin is on no remote-tracking ref of `origin` (a
  commit only the intake clone holds launders a patch as well as a regenerated
  manifest does), when picasso moved a bundled source past the pin, or when the
  clone is behind the pin or behind its own fetched upstream.
- **Host dependencies**: `playwright` pinned exactly (picasso pins `1.63.0`) and
  `@axe-core/playwright`; chromium via
  `npx playwright install chromium --with-deps`. Everything else runs on node
  alone, plus git: `--freshness` always, the drift gate inside a git work tree.
- **Baselines** live in the host's `docs/gates/` and start as `[]`:
  `console-baseline.json`, `a11y-baseline.json`, `render-baseline.json`. An a11y
  entry's identity is route + rule + selector + impact.
- **Budgets are not a baseline**: `size-budgets.json` starts as
  `{ "budgets": [{ "path": "<a built file, directory or dist/assets/*.js glob>", "maxBytes": <a generous cap> }] }`
  — an empty list is refused — and `--tighten` after the first build lowers the
  declared caps to measured sizes (it adds no entry). For an ESLint or Oxlint
  host only, `lint-budget.json` (lint-budget wraps no other linter).
  **Canary probe:** before trusting a green run, plant one console error and one
  a11y violation on a route that has none, lower one size cap below its
  artifact, and watch each gate FAIL.
- `reports/ui/` is gitignored.
- **Never add `picasso.json`** to such a host: beside stallion's
  `tools/task-coverage.mjs` it would arm picasso's plugin against stallion's law.

The host's gate-registry rows. Battery (members of `package.json` `selftest`):

```
node docs/gates/picasso/checks-vendor.mjs
node docs/gates/picasso/checks-vendor.mjs --self-test
node docs/gates/picasso/ratchet.mjs --self-test
node docs/gates/picasso/console-ratchet.mjs --self-test
node docs/gates/picasso/a11y-ratchet.mjs --self-test
node docs/gates/picasso/size-budget.mjs --self-test
node docs/gates/picasso/lint-budget.mjs --self-test
```

CI: a tracked workflow on push and pull_request, no `continue-on-error`. Install,
build, start the app in the background, and WAIT until it answers — `BASE_URL`
mode does not wait, so a sweep that races the server flakes red:

```yaml
- run: npx playwright install chromium --with-deps
- run: <build>
- run: <start the app> &
- run: for i in $(seq 1 60); do curl -fsS http://127.0.0.1:<port>/ >/dev/null && exit 0; sleep 1; done; exit 1
- run: node docs/gates/picasso/render-report.mjs --self-test
- run: BASE_URL=http://127.0.0.1:<port> ROUTES="/, /feed, /watch" ROOT_SELECTOR=<the app root, e.g. #root> REPORT_DIR=reports/ui node docs/gates/picasso/render-report.mjs
- run: node docs/gates/picasso/console-ratchet.mjs --report reports/ui/console-report.json --baseline docs/gates/console-baseline.json
- run: node docs/gates/picasso/a11y-ratchet.mjs --violations reports/ui/a11y-report.json --baseline docs/gates/a11y-baseline.json --render-failures reports/ui/render-failures.json --render-baseline docs/gates/render-baseline.json
- run: node docs/gates/picasso/size-budget.mjs --budgets docs/gates/size-budgets.json
# ESLint/Oxlint hosts only:
- run: PICASSO_LINT_BUDGET=docs/gates/lint-budget.json node docs/gates/picasso/lint-budget.mjs --check --linter eslint
```

`ROOT_SELECTOR` names the element the app renders INTO: a route whose root is
still empty after a short poll is a render failure. `body` always carries
content, so under `body` an app root that never renders is NOT a render failure
(only HTTP >= 400 and navigation errors are) — use it only for a server-rendered
host whose content is in the HTML itself. Each route is held open `SETTLE_MS`
(default 2000) after `load` before axe runs; a console error, failing request or
mounted element later than that is not recorded — raise it for a route that
fails late.

The registry carries the sweep line with or without its env prefix: dropping
`ROUTES` narrows the sweep to `/`, dropping `BASE_URL` turns render-report back
into its template default (a vite build + preview). The workflow file is fence
surface — review every change to that line.

REQUIRED in the same host adoption commit:

- a `docs/gates/coverage.json` gate, or stallion's census orphans the bundle and
  the host battery goes red the moment it lands — checked with
  `node tools/gate-coverage.mjs`:
  ```json
  {"name":"picasso-checks","spec":"docs/gates/picasso/**/*.mjs","sees":"the battery runs the bare drift check and every bundled self-test through declared gate-registry rows; the push fence counts docs/gates/** as code"}
  ```
- `docs/gates/picasso/**` in the host's formatter, linter and dead-code (knip)
  ignores — a reformatted byte reads as `patched`, and the bundle exports symbols
  the host never imports — and `docs/gates/picasso/** -text` in `.gitattributes`,
  so no checkout rewrites its line endings.

Under stallion, `docs/gates/**` is fence surface: every re-vendor and every
baseline edit (a `--prune` after a fix included) is a protected-tier stallion task
carrying a founder approval, recorded exactly as that stallion's `task-state`
refusal prints (in the task record, committed alone, where stallion records
approvals in-record). Picasso adds no approval mechanism of its own.

### B. From a picasso checkout (no vendoring)

A repo governed by stallion (Antitube is one) keeps stallion's lifecycle and
fences; picasso contributes its front-end gate discipline, run from a picasso
checkout against the running site — nothing is vendored into the host repo:

```sh
# ROOT_SELECTOR=body: Antitube is server-rendered (part A says what body gives up)
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
