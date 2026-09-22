# picasso

[![selftest](https://github.com/7inaydas-cmyk/picasso/actions/workflows/selftest.yml/badge.svg)](https://github.com/7inaydas-cmyk/picasso/actions/workflows/selftest.yml)

The front-end brother of [stallion](https://github.com/7inaydas-cmyk/stallion): a
task-lifecycle harness for AI coding agents doing UI work. Named for Pablo
Picasso (P-i-c-a-s-s-o).

- **Lifecycle**: `intake → planned → executing → verified → adversarial → done`,
  driven by `tools/task-state.mjs`. Code lands only under a task; the
  `task: <id>` commit footer binds it to a DECLARED, append-only scope.
- **Fences**: pre-commit / commit-msg / pre-push (`tools/task-coverage.mjs`)
  refuse out-of-scope code, footerless commits, and unwired clones — with the
  rule, the evidence, and an exact fix command.
- **Front-end gates**: the lint ratchet cap (`tools/lint-budget.mjs`), the a11y
  baseline ratchet (`tools/a11y-ratchet.mjs`, the GSA pattern), and the bundle
  size ratchet (`tools/size-budget.mjs`). Visual regression stays in the
  adversarial phase, never a commit fence.
- **Enforcement plugin**: [`plugin/`](plugin/) — a PreToolUse hook that denies
  front-end edits outside an in-flight task, judged by the repo's own vendored
  harness. Governed by the repo's declared jurisdiction (`picasso.json`);
  inert everywhere else. Ships a `picasso` skill for discovery.
- **Registry**: every gate invocation declared once in
  `docs/gates/gate-registry.json`, drift-checked in both directions.
- **Template**: [`template/`](template/) — Vite + React + TS strict + Tailwind v4 +
  shadcn/ui with every gate pre-wired, including the visual verification seam
  (headless render + console/a11y/render-failure ratchets) and the
  [standards pack](docs/standards/README.md) (fenced vs guidance layers).

```sh
git config core.hooksPath .githooks   # per clone
npm run selftest                      # the whole battery
node tools/task-coverage.mjs --doctor # wiring check
```

Docs: [TASK-LIFECYCLE.md](docs/TASK-LIFECYCLE.md) · [WIRING.md](docs/WIRING.md) ·
[research basis](docs/research/build-plan.md).
