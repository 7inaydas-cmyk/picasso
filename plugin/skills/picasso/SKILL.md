---
name: picasso
metadata:
  author: picasso contributors
  version: "0.1.0"
description: "Front-end task-lifecycle harness (picasso, the front-end brother of stallion). Use when doing front-end work (components, pages, styles, templates) in a repo that vendors picasso, when adopting picasso into a front-end repo, or when the user mentions picasso, the front-end jurisdiction, or front-end gates."
license: "MIT — see the picasso repo's LICENSE"
---

# Picasso — the front-end task lifecycle

Picasso governs **front-end work** (components, pages, styles, templates) the way
stallion governs all code: tasks are pre-registered, scopes are declared, and
fences refuse violations with the rule, the evidence, and an exact fix command.

## When this applies

A repo is under picasso when it vendors the harness (`tools/task-coverage.mjs` +
`.tasks/`) **and** declares a front-end jurisdiction (`picasso.json`, e.g.
`{ "jurisdiction": ["src/**", "index.html"] }`). Outside that jurisdiction — or
in a repo without the harness — picasso makes no claim; work there freely.

If the picasso enforcement plugin is installed, an edit inside jurisdiction
without a covering in-flight task is **denied at edit time**. That refusal is
the feature: run the fix command it prints.

## The lifecycle

```
intake → planned → executing → verified → adversarial → done
```

- Open: `node tools/task-state.mjs new <id> --risk-class <ui-runtime|styles|tooling|docs>`
- Declare scope at planned: `node tools/task-state.mjs scope <id> --add "src/**"`
- Advance one phase at a time: `node tools/task-state.mjs advance <id>`
- `verified` needs a red-check pin (a recorded FAILING check you then make pass)
  and a green `npm run selftest`; `done` needs an adversarial pass record.

## The gates (one gate, one meaning)

- `npm run lint` — the design-token register (`@shadcn/lint`): components own
  their appearance; callers place (layout), never restyle.
- `npm run build` — typecheck + production build.
- `npm run render:gate` — headless render of every route: console ratchet
  (new runtime errors fail), a11y ratchet (axe vs baseline), render-failure
  ratchet. Baselines start empty; only new findings fail; resolved prune.
- `npm run budget:gate` — dist artifacts within `budgets.json`.
- Visual regression and screenshots are the **adversarial phase's** job — never
  a commit fence.

## Working here

- Before planning: `node tools/task-state.mjs status`
- The repo's own `AGENTS.md` states the full law — it wins over this skill.
- Refusals print an exact fix command. Run the fix; never bypass the hooks.
