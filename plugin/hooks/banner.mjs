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
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findHarnessRoot, loadLaw, readJurisdiction } from "../lib/law-source.mjs";
import { readRecords, bannerLine } from "../lib/gate-law.mjs";
import { readStdin } from "../lib/io.mjs";

try {
  let payload = {};
  try { payload = JSON.parse(await readStdin()) || {}; } catch { /* no parsable payload: fall back to env/cwd */ }
  const cwd = (typeof payload.cwd === "string" && payload.cwd.length > 0)
    ? payload.cwd
    : process.env.CLAUDE_PROJECT_DIR || process.env.ZCODE_PROJECT_DIR || process.cwd();
  const event = payload.hook_event_name === "SessionStart" ? "SessionStart" : "UserPromptSubmit";
  const root = findHarnessRoot(cwd);
  if (!root) process.exit(0);
  const jurisdiction = readJurisdiction(root);
  const lines = [];
  lines.push(`picasso: front-end harness ${jurisdiction ? `armed (jurisdiction: ${jurisdiction.join(", ")})` : "present but unarmed — no picasso.json jurisdiction declared"}`);
  const law = await loadLaw(root);
  if (law.ok) {
    const stateDir = join(root, ".tasks");
    const records = existsSync(stateDir)
      ? readRecords(stateDir, readdirSync, readFileSync, join)
      : [];
    const line = bannerLine(records, law.authorizingPhases);
    if (line) lines.push(`picasso: in-flight — ${line}`);
    else lines.push("picasso: no in-flight front-end task (front-end edits inside jurisdiction will be denied until one exists)");
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: lines.join("\n") } }) + "\n");
  process.exit(0);
} catch {
  process.exit(0);
}
