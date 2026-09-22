# Build plan — research basis (2026-09-22)

Deepresearch run (standard depth, Mode A; report at
`~/deepresearch-reports/picaso-harness-20260922-0248.json`): 30 claims verified,
28 survived, 2 killed; citation accuracy 83.3% survivors-only (degraded: 23 audit
calls lost to a transport race; synthesis hand-composed; singleRater: true).

## Verdict on github.com/shadcn-ui/lint

**Adopt as a gate, not a core.** MIT-licensed (v0.1.5, published 2026-09-21),
agent-first ESLint/Oxlint plugin for Tailwind v4 (shadcn/ui NOT required). Six
rules — `no-restyle`, `no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`,
`no-unknown-classes`, `require-static-classes` — with per-component contracts,
custom messages with placeholders, and error messages that tell the agent the fix
from your own design system. Fence-grade: per-glob severities (error in `app/**`,
warn in `legacy/**`), folder exemptions, and the documented `--max-warnings`
ratchet (fails when the count rises; lower the cap as you fix).

Risks: launched 2026-09-14, 22 commits — very young; Oxlint's JS plugin API is
alpha; the eval numbers (150+ runs, zero violations in one round, 10–48% cheaper
fixes) are the author's own, unreplicated. Mitigation: pin the version, keep it
behind picasso's registry so it costs one line to swap.

## Evidence notes that shaped picasso

- Natural-language rules barely constrain agents: a study of 481 CLAUDE.md files
  found only ~4–16% of security rules had a matching built-in control (strictest
  standard 4.4%, CI 2.6–6.7). Instruction files are a write-only channel — hence
  fences, not conventions.
- GitHub Spec Kit (130k★) validates phase-gated, artifact-driven agent lifecycles:
  don't advance until the current task is fully validated.
- Flaky tests destroy a suite's authority (rerun-and-ignore, regressions hiding in
  noise; Google ~1.5% flaky share). Visual regression's render chain is
  non-deterministic at seven stages — keep it out of commit fences; baselines +
  serial execution make the a11y sweep deterministic instead.
- The GSA pattern (GSA/ngx-uswds-icons PR #127, mirroring sam-styles and ngx-uswds):
  axe WCAG 2.1 AA sweep over every Storybook story via Playwright, committed
  violation baseline (new fails, resolved must be pruned), render-failures ratchet,
  exit-0 acceptance, and a sanity probe that axe actually detects a violation.
- One gate, one meaning: mixing a second meaning into a red gate costs the
  information the gate carries — keep the verified pins and the adversarial
  battery separate signals.
- axe-core catches up to ~57% of WCAG issues — a fence, not a proof; keep manual
  review in the adversarial pass.
