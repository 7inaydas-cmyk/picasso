#!/usr/bin/env node
/**
 * RATCHET — the shared baseline law behind picasso's ratchet gates.
 *
 * One deep module, three thin adapters at the same seam (a11y-ratchet,
 * console-ratchet, and any future list-shaped gate): a committed baseline of
 * known findings; the fresh report is judged against it; NEW entries fail the
 * gate; RESOLVED entries must be pruned or the baseline rots into fiction.
 *
 * This file is the module; the gates are the interface callers see. It carries
 * a --self-test so the battery covers the law itself, once, at the seam.
 *
 * Usage:
 *   ratchet.mjs --self-test
 */

// The identity of a finding: entries key by themselves when scalar; object
// entries get a caller-supplied identity (a11y: rule|selector|impact; console:
// route|text). Anything coarser merges distinct findings; anything finer lets
// a fix slip through as "different".
export function judge(current, baseline, identity = x => x) {
  const cur = new Set(current.map(identity));
  const base = new Set(baseline.map(identity));
  const added = [...cur].filter(k => !base.has(k));
  const resolved = [...base].filter(k => !cur.has(k));
  return { added, resolved, clean: added.length === 0 && resolved.length === 0 };
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("ratchet --self-test");

  const v = (rule, sel) => ({ rule, selector: sel, impact: "serious" });
  const id = e => [e.rule, e.selector, e.impact].join("|");
  const base = [v("color-contrast", "#s"), v("label", "#e")];

  ok("identical report is clean (object identity)", judge(base, base, id).clean);
  ok("identical report is clean (string identity)", judge(["a", "b"], ["a", "b"]).clean);
  ok("new entry fails", judge([...base, v("aria", "#m")], base, id).added.length === 1);
  ok("resolved entry is not clean", judge([base[0]], base, id).resolved.length === 1);
  ok("same key elsewhere is a different finding", judge([v("label", "#n")], base, id).added.length === 1);
  ok("scalar entries key by themselves", judge(["x"], ["x"]).clean);
  ok("empty current against empty baseline is clean", judge([], []).clean);
  ok("empty current against non-empty baseline demands pruning", judge([], ["x"]).resolved.length === 1);

  console.log(failures.length ? `ratchet: ${failures.length} self-test failure(s)` : "ratchet: self-test clean");
  if (failures.length) process.exit(1);
}

if (process.argv.includes("--self-test")) selfTest();
