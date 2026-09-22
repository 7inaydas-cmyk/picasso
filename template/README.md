# picasso template

The picasso default template: **Vite + React + TypeScript (strict) + Tailwind v4 +
shadcn/ui conventions**, every gate pre-wired. The first adapter at picasso's
stack seam — its green CI run is its self-test.

```sh
npm install
git config core.hooksPath .githooks   # the fences
npm run lint      # the design-token register (@shadcn/lint, cap 0)
npm run build     # tsc -b strict + production build
npm run render:gate   # headless render + console/a11y/render-failure ratchets
npm run budget:gate   # dist artifacts within budgets.json (wildcards sum)
npm run selftest   # the vendored picasso tools' battery
node tools/task-coverage.mjs --doctor
```

Baselines start empty in `baselines/` — only NEW findings fail; resolved ones
must be pruned. Read-first list: `docs/context-manifest.md`. Lifecycle law:
`AGENTS.md`. The tools in `tools/` are vendored from
[picasso](https://github.com/7inaydas-cmyk/picasso) at a pinned upstream commit.
