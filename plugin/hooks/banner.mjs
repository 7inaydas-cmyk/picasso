#!/usr/bin/env node
/**
 * The banner (SessionStart + UserPromptSubmit). Re-injects the live front-end
 * task state every turn, including after compaction. Fails open, always: an
 * advisory context must never brick a session.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findHarnessRoot, loadLaw, readJurisdiction } from "../lib/law-source.mjs";
import { readRecords, bannerLine } from "../lib/gate-law.mjs";

try {
  const cwd = process.cwd();
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
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(0);
} catch {
  process.exit(0);
}
