---
name: picasso
metadata:
  author: picasso contributors
  version: "0.4.0"
description: "Front-end task-lifecycle harness and gate discipline (picasso, the front-end brother of stallion). Use when doing front-end work (components, pages, styles, templates, a front-end verification walk of a site) in a repo that vendors picasso, in a stallion-governed repo such as Antitube (apps/web), when adopting picasso into a front-end repo, or when the user mentions picasso, the front-end jurisdiction, front-end gates, a console-error / a11y / render-failure ratchet, or visual QA."
license: "MIT — see the picasso repo's LICENSE"
---

# Picasso — the front-end task lifecycle and gate discipline

Picasso governs **front-end work** (components, pages, styles, templates) the way
stallion governs all code: tasks are pre-registered, scopes are declared, and
fences refuse violations with the rule, the evidence, and an exact fix command.

## Which mode applies — look at the repo top first

1. **The repo vendors picasso** (`tools/task-coverage.mjs` + `picasso.json` at the
   repo top, e.g. a repo made from picasso's `template/`): picasso's lifecycle,
   fences and plugin all apply — see "The lifecycle" below. An edit inside the
   declared jurisdiction without a covering in-flight task is **denied at edit
   time**; that refusal is the feature — run the fix command it prints.
2. **The repo is governed by stallion** — NO `picasso.json`, and a stallion
   harness: `.stallion-base`, or `tasks/` beside `tools/task-coverage.mjs`
   (stallion's native layout), or a vendored `tools/harness/` (**Antitube**: front
   end at `apps/web`, TanStack Start + React, live at https://antitube.tv).
   **Stallion owns the lifecycle and the fences** — open and advance a stallion
   task, cite it in the commit footer, follow that repo's AGENTS.md/CLAUDE.md.
   The picasso plugin stays inert there. What picasso contributes is its
   **front-end gate discipline**, in one of two forms:
   - **2a — the repo vendors picasso's checks bundle**: `git ls-files '*VENDOR.json'`
     yields a file whose `schema` is `picasso/checks-manifest@1` (its directory is
     the bundle, e.g. `docs/gates/picasso/`). Run the host's OWN registered
     commands (its battery and CI; picasso's `docs/WIRING.md` part A lists them);
     baselines live in the host's `docs/gates/`; fixes land under the host's
     lifecycle; never add `picasso.json`. Re-vendoring is
     `node <picasso>/tools/checks-vendor.mjs --export <bundle-dir>` (a host task);
     at each wave's intake run
     `node <bundle-dir>/checks-vendor.mjs --freshness <picasso-clone>`.
   - **2b — no bundle** (Antitube today): run the checks from a picasso checkout —
     see the next section.
3. **Neither**: picasso makes no claim; work freely, or adopt picasso
   (picasso's `docs/WIRING.md`, "Adopting the gates").

## Mode 2b — the gate discipline from a picasso checkout (e.g. Antitube)

From a picasso checkout (`PICASSO=~/Desktop/picasso` on this machine; once:
`npm --prefix "$PICASSO/template" install && npm --prefix "$PICASSO/template" exec playwright install chromium`):

```sh
# 1. The deterministic half: sweep the running site headlessly (a deployed URL,
#    or the repo's own preview server). Nothing is built or started for you.
BASE_URL=https://antitube.tv ROUTES="/, /feed, /watch" ROOT_SELECTOR=body \
  REPORT_DIR=<dir> node "$PICASSO/template/scripts/render-report.mjs"
# 2. Judge the reports against committed baselines (start from [] — every
#    finding is then NEW; that list is the walk's work queue):
node "$PICASSO/tools/console-ratchet.mjs" --report <dir>/console-report.json --baseline <console-baseline.json>
node "$PICASSO/tools/a11y-ratchet.mjs" --violations <dir>/a11y-report.json --baseline <a11y-baseline.json> \
  --render-failures <dir>/render-failures.json --render-baseline <render-baseline.json>
```

- A page answering HTTP >= 400 is a render failure; missing assets, failing API
  calls, console and page errors land in the console report.
- Every route the app serves goes in `ROUTES` — the sweep covers only what it is
  given.
- The judged half is agent work in the adversarial phase: screenshot walks
  across breakpoints (browser automation MCP / computer use), the judgment
  recorded per route. Pixels are never a commit fence.
- Fix what the ratchets name under the host repo's own lifecycle (a stallion
  task, its red-pin law), re-sweep, and prune resolved baseline entries.
- Picasso's standards pack (`$PICASSO/docs/standards/`) is the design guidance;
  the host repo's own design system and AGENTS.md win where they speak.

## The lifecycle (repos that vendor picasso)

```
intake → planned → executing → verified → adversarial → done
```

- Before planning: `node tools/task-state.mjs status`
- Open: `node tools/task-state.mjs new <id> --risk-class <ui-runtime|styles|tooling|docs>`
- Declare scope at planned: `node tools/task-state.mjs scope <id> --add "src/**"`
  (a scope's first segment is a literal path — `**` refuses)
- Advance one phase at a time: `node tools/task-state.mjs advance <id>`
- `verified` needs a red-check pin (a recorded FAILING check you then make pass)
  and a green `npm run selftest`; `done` needs an adversarial pass record.
- Commit code while the task is in flight (`task: <id>` footer); `done`
  authorizes only the task's own paperwork, never new code.

## The gates (one gate, one meaning)

- `npm run lint` — the design-token register (`@shadcn/lint`): components own
  their appearance; callers place (layout), never restyle.
- `npm run build` — typecheck + production build.
- `npm run render:gate` — headless render of the routes: console ratchet
  (new runtime errors fail), a11y ratchet (axe vs baseline), render-failure
  ratchet. Baselines start empty; only new findings fail; resolved prune.
- `npm run budget:gate` — dist artifacts within `budgets.json`.
- Visual regression and screenshots are the **adversarial phase's** job — never
  a commit fence.

## Working here

- The repo's own `AGENTS.md` states the full law — it wins over this skill.
- Refusals print an exact fix command. Run the fix; never bypass the hooks.
