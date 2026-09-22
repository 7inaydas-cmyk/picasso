# AGENTS.md

Picasso (named for Pablo Picasso — two c's, two s's after the a: P-i-c-a-s-s-o) is the
front-end brother of stallion: the same task-lifecycle law, retargeted at UI work.

- Before planning: `node tools/task-state.mjs status`
- Code lands only under a task: `node tools/task-state.mjs new <id> --risk-class <class>`,
  advanced one phase at a time (`intake → planned → executing → verified → adversarial → done`).
  Risk classes: `ui-runtime` (components/pages/hooks), `styles` (tokens/css),
  `tooling` (harness + build config), `docs`.
- Commits that touch code carry a `task: <id>` footer on its own line, in the final
  trailer block of the message.
- The footer is bound by DECLARED SCOPE: `node tools/task-state.mjs scope <id> --add "src/**"`
  records the blast radius (declared at planned, append-only until executing). The
  commit-msg gate refuses code staged outside it; the push fence re-judges every
  commit in the range.
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
- Fresh clones: `git config core.hooksPath .githooks` (hooks are committed; the
  activation is per clone, and the doctor enforces it).
