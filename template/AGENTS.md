# AGENTS.md — picasso template

The picasso default template: Vite + React + TypeScript (strict) + Tailwind v4 +
shadcn/ui conventions, with every picasso gate pre-wired. The tools in `tools/`
are vendored from picasso at a pinned upstream commit.

- Same lifecycle law as picasso itself: `node tools/task-state.mjs status`;
  code lands only under a task advanced one phase at a time
  (`intake → planned → executing → verified → adversarial → done`); commits
  carry a `task: <id>` footer bound to the task's DECLARED scope.
- The gates, and what each one means (one gate, one meaning):
  - `npm run lint` — the design-token register (`@shadcn/lint`): no raw colors,
    no arbitrary values, no inline styles; components own their appearance,
    callers place (layout) but never restyle.
  - `npm run build` — typecheck (`tsc -b`, strict) + production build.
  - `npm run render:gate` — the visual verification seam's deterministic half:
    headless render of every route, then the console ratchet (new runtime
    console errors fail), the a11y ratchet (axe vs baseline), and the
    render-failure ratchet. Baselines live in `baselines/` — only new findings
    fail; resolved ones must be `--prune`d.
  - `npm run budget:gate` — built artifacts within `budgets.json`.
- The adversarial phase additionally requires a browser automation MCP
  (playwright-mcp or equivalent): screenshot walks across breakpoints, visual
  judgment recorded per route. Pixels are never a commit fence.
- Read-first: `docs/context-manifest.md` lists the files that define this
  design system. Read them before writing UI code.
- Fresh clones: `git config core.hooksPath .githooks`; verify with
  `node tools/task-coverage.mjs --doctor`.
- Refusals print the rule, the evidence, and an exact fix command. Run the fix.
