#!/usr/bin/env node
/**
 * The banner (SessionStart + UserPromptSubmit). Re-injects the live front-end
 * task state every turn, including after compaction. Fails open, always: an
 * advisory context must never brick a session.
 *
 * Transport (one core, both runtimes): context reaches the conversation ONLY as
 * strict JSON on stdout — { hookSpecificOutput: { hookEventName, additionalContext } }
 * — echoing the payload's own hook_event_name (ZCode and Claude Code share this
 * output schema). Plain stderr on exit 0 is log diagnostics, never injected, on
 * either runner. The project dir comes from payload.cwd (Claude Code sends it),
 * else CLAUDE_PROJECT_DIR / ZCODE_PROJECT_DIR (both runners inject one), else
 * the process cwd.
 *
 * Silent — and never importing repo code — unless the repo top claims a
 * jurisdiction (picasso.json beside tools/task-coverage.mjs).
 */
import { findHarnessRoot, loadLaw, readJurisdiction } from "../lib/law-source.mjs";
import { readRecords, bannerLine, parseEditPayload } from "../lib/gate-law.mjs";
import { readStdin } from "../lib/io.mjs";

try {
  let payload = null;
  try { payload = JSON.parse(await readStdin()); } catch { /* no parsable payload: fall back to env/cwd */ }
  const { cwd } = parseEditPayload(payload);
  const event = payload?.hook_event_name === "SessionStart" ? "SessionStart" : "UserPromptSubmit";
  const root = findHarnessRoot(cwd);
  if (!root) process.exit(0);
  const claim = readJurisdiction(root);
  const lines = [];
  if (!claim.ok) {
    lines.push(`picasso: front-end harness claim is unreadable — every edit in this repo is refused until it is repaired: ${claim.reason}`);
  } else {
    lines.push(`picasso: front-end harness armed (jurisdiction: ${claim.globs.join(", ")})`);
    const law = await loadLaw(root);
    if (!law.ok) lines.push(`picasso: the harness law cannot load — front-end edits are refused: ${law.reason}`);
    else lines.push(`picasso: ${bannerLine(readRecords(law.stateDir), law.authorizingPhases) ?? "no in-flight front-end task (front-end edits inside jurisdiction will be denied until one exists)"}`);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: lines.join("\n") } }) + "\n");
  process.exit(0);
} catch {
  process.exit(0);
}
