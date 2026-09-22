# The picasso task lifecycle

Picasso is stallion's lifecycle ported to front-end work. The phases, the fences,
and the pins are the same law; the gates are the front-end set the research run
(2026-09-22, `docs/research/build-plan.md`) validated.

## Phases

```
intake → planned → executing → verified → adversarial → done
```

| Transition | Requirement |
|---|---|
| intake → planned | DECLARED scope (at least one glob) |
| planned → executing | — (approval to start) |
| executing → verified | ≥1 red-check pin recorded FAILING then green, + green selftest |
| verified → adversarial | green selftest at the boundary |
| adversarial → done | findings record (≥3 probes, ≥1 real refusal), pins green, battery green |

## The fences

- `pre-commit` (`task-coverage --staged`): staged code outside every declared scope refuses.
- `commit-msg` (`task-coverage --commit-msg`): no/ambiguous `task:` footer, unknown task,
  or staged code outside the named task's scope refuses.
- `pre-push` (`task-coverage --push` + `--doctor`): every commit in the range re-judged;
  an unresolvable push base REFUSES rather than guessing; an unwired clone refuses to push.

## The front-end gates

Three ratchet gates ship with picasso; each is deterministic-exit-code and self-tested:

1. **lint-budget** — `--max-warnings N` cap in `lint-budget.json`; the cap only decreases
   (`--set` refuses a raise). Wraps ESLint/Oxlint; for Tailwind v4 projects the
   design-token register is `@shadcn/lint`'s rule set (no-restyle, no-raw-colors,
   no-arbitrary-values, no-inline-styles, no-unknown-classes, require-static-classes)
   with per-component contracts.
2. **a11y-ratchet** — committed violation baseline (GSA pattern: new violations fail;
   resolved entries must be `--prune`d; a parallel render-failures ratchet catches
   stories that fail to render at all).
3. **size-budget** — `budgets.json` maxBytes per built artifact; over budget fails,
   missing artifacts fail, `--tighten` ratchets caps down to measured sizes.

Non-ratchet checks (typecheck, build, unit tests, e2e smoke) are exit-code native and
belong directly in the consuming project's CI + picasso's registry — they need no
wrapper, only a declaration.

**Visual regression is adversarial-phase only**, never a commit fence: the render
pipeline is non-deterministic at seven stages (parse, CSS, JS, resources, layout,
raster, composite), and a flaky blocking gate costs more authority than it buys.

## The adversarial pass (UI flavor)

Stallion's adversarial pass aggregates clean. Picasso's UI equivalent, per the
research:

- fence probes (bad footer, out-of-scope stage, unwired clone) — must be REFUSED;
- the a11y sweep against its baseline;
- interaction tests (Storybook/Vitest) at `error` severity;
- visual regression behind baselines, serial execution, animations disabled.

The findings record (`docs/tasks/<id>.adversarial.json`) carries every probe's real
command, exit code, and evidence. `done` refuses a record where nothing was refused.
