# Context manifest — read these before writing UI code

The files that define this design system, in read order:

1. `src/index.css` — the token register (`@theme`): every color/spacing value
   the UI may use. Change the system here, never at a call site.
2. `components.json` — shadcn/ui discovery: where components live, which CSS
   carries the theme.
3. `eslint.config.mjs` — the enforced contracts: the six `@shadcn/lint` rules
   and the no-restyle `allow: ["layout"]` split.
4. `src/components/ui/button.tsx` — the reference component: variants own
   appearance; className reaching a component is layout-only by contract.
5. `src/App.tsx` — the reference call site: tokens, variants, layout classes.
6. `AGENTS.md` — the lifecycle law and what each gate means.

Everything else is implementation detail behind those interfaces.
