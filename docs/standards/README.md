# The picasso standards pack

One artifact, two layers — distilled from taste-skill, ui-ux-pro-max, the
mattpocock TypeScript rules, addyosmani's performance/a11y standards, and the
reverse-engineered v0/Bolt constraints. Every rule lands in the layer its
determinism allows.

**Layer 1 — fenced (machine-checked; violates = red build):**
- TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` —
  template `tsconfig.json`.
- Design tokens: the six `@shadcn/lint` rules + no-restyle
  `allow: ["layout"]` — template `eslint.config.mjs`.
- Performance: Lighthouse CI `assert` presets (error-level score floors) and
  the bundle `budgets.json` ratchet — template CI. (Web Vitals: LCP, CLS, INP.)
- Runtime: the console ratchet, a11y ratchet, render-failure ratchet —
  `render:gate`.

**Layer 2 — guidance (prevents, does not enforce):**
- [aesthetics.md](aesthetics.md) — the anti-slop contract.
- [generation.md](generation.md) — component scoping and isolation constraints.

Layer 2 is labelled prose: it reduces what enters the funnel; Layer 1 catches
what slips through. Never present Layer 2 as a fence.
