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

## Adopting the gates in a consuming front-end project

1. Copy `tools/` + `.githooks/` (or vendor picasso at a pinned commit), then
   `git config core.hooksPath .githooks`.
2. Lint: install ESLint ≥9.30 (or Oxlint ≥1.80) + `@shadcn/lint`; configure rules and
   contracts; record the current warning count:
   `node tools/lint-budget.mjs --set <count>`; run CI with
   `node tools/lint-budget.mjs --check`.
3. A11y: produce an axe report (Storybook a11y at `error` severity, or
   `@axe-core/playwright` sweeping every story); commit the initial baseline; gate CI
   with `node tools/a11y-ratchet.mjs --violations report.json --baseline baseline.json`.
4. Bundle budgets: declare `{ budgets: [{ path, maxBytes }] }`; gate the build with
   `node tools/size-budget.mjs --budgets budgets.json`.
5. Typecheck/build/unit/e2e: wire directly in CI and declare them in
   `docs/gates/gate-registry.json` — the registry drift-checks that every declared
   invocation actually runs in every transport that claims it.
