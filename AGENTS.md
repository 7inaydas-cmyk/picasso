# AGENTS.md

Picasso (named for Pablo Picasso — two c's, two s's after the a: P-i-c-a-s-s-o) is the
front-end brother of stallion: the same task-lifecycle law, retargeted at UI work.

- Before planning: `node tools/task-state.mjs status`
- Code lands only under a task: `node tools/task-state.mjs new <id> --risk-class <class>`,
  advanced one phase at a time (`intake → planned → executing → verified → adversarial → done`).
  Risk classes: `ui-runtime` (components/pages/hooks), `styles` (tokens/css),
  `tooling` (harness + build config), `docs`.
- Every commit that introduces files carries a `task: <id>` footer on its own
  line, in the final trailer block of the message (editor-composed messages are
  read after git's comment cleanup). A clean merge introduces nothing; a merge
  is judged on what it decides beyond git's own automatic merge.
- The footer is bound by DECLARED SCOPE: `node tools/task-state.mjs scope <id> --add "src/**"`
  records the blast radius (declared at planned, append-only until executing; a
  wildcard-rooted scope like `**` refuses). The footer's task must be in flight
  (`executing`–`adversarial`): `done` authorizes only the task's own paperwork
  (`.tasks/<id>.json`, `docs/tasks/<id>.adversarial.json`), never new code. Task
  records are driven by task-state: a committed record never moves its phase
  backwards and never changes its scope after planned.
- The push fence judges every commit the remote does not hold yet (bounded by the
  adoption base, `.picasso-base`) and refuses pushed refs outside HEAD's history;
  CI re-judges the pushed range server-side.
- `verified` needs a red-check pin (`red-check <id> --command "<failing check>"` — the
  tool runs it and refuses if it passes) AND a green run of the whole `npm run selftest`
  battery at the phase boundary; `done` needs a prepared adversarial pass (≥3 probes,
  at least one real refusal observed) aggregating clean and every pin re-run GREEN.
- Front-end gate law, where the fences differ from stallion:
  - **lint** runs through the ratchet cap (`tools/lint-budget.mjs`) — the cap only
    decreases. Design-system rules (`@shadcn/lint`: no-restyle, no-raw-colors,
    no-arbitrary-values, no-inline-styles, no-unknown-classes, require-static-classes)
    are the design-token register for Tailwind v4 projects.
  - **a11y** runs through the baseline ratchet (`tools/a11y-ratchet.mjs`) — new
    violations fail; resolved entries must be pruned. Automated axe catches a bounded
    share of WCAG issues (~57%); it is a fence, not a proof.
  - **visual regression stays OUT of commit fences** (a flaky gate is worse than no
    gate — it destroys the suite's authority). It belongs in the adversarial phase,
    behind baselines and deterministic rendering.
- Refusals print the rule, the evidence, and an exact fix command. Run the fix. Do not
  work around a refusal. Never bypass the hooks (`--no-verify`, `commit -n`,
  re-pointing `core.hooksPath` away from `.githooks`).
- Verify changes with `npm run selftest`; verify the wiring with
  `node tools/task-coverage.mjs --doctor`.
- The checks bundle (`tools/{ratchet,console-ratchet,a11y-ratchet,size-budget,lint-budget,checks-vendor}.mjs`
  and `template/scripts/render-report.mjs`) ships into host repos: a change to one
  of them is a change hosts must re-vendor, and `node tools/checks-vendor.mjs --probe`
  (in the battery) must stay green. `template/tools/checks-vendor.mjs` is carried
  only because vendor-sync mirrors every root tool; run bare in the template it
  refuses (no `VENDOR.json` there), by design.
- Fresh clones: `git config core.hooksPath .githooks` (hooks are committed; the
  activation is per clone, and the doctor enforces it).
