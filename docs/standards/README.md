# The picasso standards pack

One artifact, two layers — distilled from taste-skill, ui-ux-pro-max, the
mattpocock TypeScript rules, addyosmani's performance/a11y standards, and the
reverse-engineered v0/Bolt constraints. Every rule lands in the layer its
determinism allows.

**Layer 1 — fenced (machine-checked; violates = red build):**
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` —
  template `tsconfig.json` — plus `typescript-eslint` **strictTypeChecked** as
  an eslint fence — template `eslint.config.mjs`.
- Design tokens: the six `@shadcn/lint` rules + no-restyle
  `allow: ["layout"]` — template `eslint.config.mjs`.
- Performance: Lighthouse CI `assert` with error-level score floors
  (performance ≥ 0.8, accessibility ≥ 0.9, best-practices ≥ 0.8 — template
  `perf:gate`, `.lighthouserc.json`) and the bundle `budgets.json` ratchet.
- Runtime: the console ratchet, a11y ratchet, render-failure ratchet —
  `render:gate`.

**Layer 2 — guidance (prevents, does not enforce):**
- [aesthetics.md](aesthetics.md) — the anti-slop contract.
- [generation.md](generation.md) — component scoping and isolation constraints.

Layer 2 is labelled prose: it reduces what enters the funnel; Layer 1 catches
what slips through. Never present Layer 2 as a fence.
