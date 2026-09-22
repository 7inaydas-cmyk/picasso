# Generation constraints (guidance, not a fence)

Distilled from the v0.dev / Bolt.new / Claude Artifacts system prompts and
beads' atomic decomposition.

1. **Component scoping.** One concern per component; a component that needs a
   scroll bar to read is two components. Atoms → molecules → organisms →
   pages, and declare task scope per atom — component-tree drift then shows
   up as scope drift the fences already police.
2. **Single-file isolation.** A presentational component and its variants
   stay in one file; colocate its styles (classes) — never an orphan CSS
   file per component.
3. **State contracts on the seam.** Props in, callbacks out; derived state is
   computed, not stored. A store (zustand etc.) is a module with an
   interface, not a global bag.
4. **Token vocabulary only.** Classes from the register (`index.css`
   `@theme`); new need = new token, proposed in the design system — the
   no-raw-colors / no-arbitrary-values fence rejects the shortcut.
5. **Story granularity.** Every component ships at least: default, each
   variant, one edge case (empty/long/disabled). The stories are the a11y
   sweep's surface.
