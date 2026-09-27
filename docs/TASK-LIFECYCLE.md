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

- `pre-commit` (`task-coverage --staged`): staged code outside every in-flight task's
  declared scope refuses.
- `commit-msg` (`task-coverage --commit-msg`): the footer is read after git's comment
  cleanup; no/ambiguous `task:` footer, unknown task, a task not in flight, or code
  outside the named task's scope refuses. A `done` task authorizes only its own
  paperwork (`.tasks/<id>.json`, `docs/tasks/<id>.adversarial.json`).
- `pre-push` (`task-coverage --pre-push` + `--doctor`): a pushed ref outside HEAD's
  history refuses; every commit the remote does not hold yet (bounded by the
  adoption base, `.picasso-base`, read from the remote's tree) is judged — roots
  against the empty tree, merges against git's own automatic merge of their
  parents; a commit that introduces nothing needs no footer; an unresolvable base
  REFUSES; an unwired clone refuses to push. Task-record changes are judged too:
  a phase never moves backwards, a scope never changes after planned.
  A `done` task's citations are judged against the settled anchor (`origin/<branch>`):
  work written in flight lands with it; a new citation after it settled refuses.
- CI (`task-coverage --base <event base>`): the same range check, server-side — the
  one fence no local bypass reaches.

## The picasso loop (how agents ride the lifecycle)

The five-stage loop agents actually run, mapped onto the phases — the loop is
the workflow, the lifecycle is the law:

```
[Spec / design prompt]
        │
1. Plan & Scope ─────────── planned      (scope globs declared per atom: beads
        │                                  granularity — atoms → molecules →
2. Scaffold & Tokenize ──── executing     organisms → pages)
   (template + standards pack)
        │
3. Strict generation ────── executing    (TS strict + token fence + generation
        │                                  constraints)
4. Visual & runtime ─────── adversarial   (render/console/a11y ratchets = the
   verification                             deterministic half; screenshot +
        │  fail → back to 3                MCP judgment = the multimodal half)
        │  pass
5. Commit / PR ──────────── fences        (footer + scope + registry + gh)
```

Grain rule: one atom per scope entry, one story set per atom. Component-tree
drift then surfaces as scope drift — which the fences already police.

## The front-end gates

Four ratchet gates ship with picasso; each is deterministic-exit-code and self-tested:

1. **lint-budget** — `--max-warnings N` cap in `lint-budget.json`; the cap only decreases
   (`--set` refuses a raise). Wraps ESLint or Oxlint (`--check --linter <eslint|oxlint>`);
   the design-token register is `@shadcn/lint`'s rule set (no-restyle, no-raw-colors,
   no-arbitrary-values, no-inline-styles, no-unknown-classes, require-static-classes)
   with per-component contracts. In picasso itself the gate is declared in the registry's
   `ci` transport (`.github/workflows/selftest.yml`): `npx eslint . --max-warnings 0`.
2. **a11y-ratchet** — committed violation baseline (identity: route + rule + selector +
   impact; GSA pattern: new violations fail;
   resolved entries must be `--prune`ed; the parallel render-failures ratchet
   (`--render-failures` + `--render-baseline`) catches stories that fail to render at
   all). Adoption includes the GSA sanity probe: plant a canary violation once and
   confirm the gate turns red before trusting its green.
3. **console-ratchet** — committed baseline of what the browser console says per
   route (identity: route + first line of text; the render sweep writes the report):
   a new error fails, a resolved one must be `--prune`d.
4. **size-budget** — `budgets.json` maxBytes per built artifact (a file, a directory —
   every file beneath it summed — or a `*` glob, each match measured the same way);
   over budget fails, missing artifacts fail, an empty budget list is refused,
   `--tighten` ratchets declared caps down to measured sizes.

The render sweep and the four ratchets also ship as a vendorable bundle
(`tools/checks-vendor.mjs --export`, see WIRING.md) — sha256-manifested and
drift-checked in the host; `--probe` in picasso's battery keeps every bundled
file standalone.

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
