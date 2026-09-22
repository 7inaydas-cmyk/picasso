#!/usr/bin/env node
/**
 * The authoring gate (PreToolUse, matcher Edit|Write|ApplyPatch).
 *
 * Exit-code contract (the hook runner's own): 0 passes, 2 BLOCKS the edit. The
 * deny text on stderr reaches the model — rule, evidence, exact fix command.
 *
 * Picasso's difference from stallion's gate is the claim, not the transport:
 * this gate speaks ONLY inside the repo's declared front-end jurisdiction
 * (picasso.json). A repo without a vendored picasso harness, or with no
 * jurisdiction declared, is INERT — never refusing — because a front-end
 * harness must not govern work that is not front-end work.
 */
import { findHarnessRoot, loadLaw, readJurisdiction } from "../lib/law-source.mjs";
import { authoringDecision, parseEditPayload, readRecords } from "../lib/gate-law.mjs";
import { readStdin } from "../lib/io.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed input is not evidence of a lifecycle violation: stay inert.
    process.exit(0);
  }
  const parsed = parseEditPayload(payload);
  if (!parsed.ok) {
    process.stderr.write(`picasso authoring-gate: ${parsed.reason}.\n`);
    process.exit(2);
  }
  const root = findHarnessRoot(parsed.cwd);
  if (!root) {
    process.stderr.write(`picasso authoring-gate: ${parsed.filePath} — no picasso harness here; not this plugin's claim.\n`);
    process.exit(0);
  }
  const jurisdiction = readJurisdiction(root);
  if (!jurisdiction) {
    process.stderr.write(`picasso authoring-gate: no picasso.json jurisdiction declared at ${root} — the plugin makes no claim; declare one or uninstall this plugin there.\n`);
    process.exit(0);
  }
  const law = await loadLaw(root);
  if (!law.ok) {
    process.stderr.write(`picasso authoring-gate: ${law.reason}.\n  rule: a gate that cannot import the repo's own law refuses the edit\n`);
    process.exit(2);
  }
  const records = readRecords(law.stateDir, readdirSync, readFileSync, join);
  const decision = authoringDecision(parsed, law, jurisdiction, records);
  if (decision.decision === "deny") {
    process.stderr.write(`picasso authoring-gate: ${decision.reason}\n`);
    process.exit(2);
  }
  if (decision.hint) process.stderr.write(`picasso authoring-gate: ${decision.hint}\n`);
  process.exit(0);
}

main();
