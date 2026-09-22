#!/usr/bin/env node
/**
 * GATE-LAW — the pure decision core of picasso's enforcement plugin.
 *
 * The problem it exists for is the same one stallion's plugin names: agents stop
 * invoking the harness after a handful of turns — instruction decay — and an
 * AGENTS.md nobody re-reads is adoption by consent. The fix class is transport:
 * a PreToolUse hook that denies the edit itself, within one action of the mistake.
 *
 * What is picasso's here (and stallion's is not): the front-end-only claim. The
 * plugin governs exactly the repo's DECLARED JURISDICTION — the front-end surface
 * the repo itself declares in picasso.json (jurisdiction globs, shipped with
 * defaults by template/). Inside jurisdiction, the stallion rule applies verbatim:
 * an edit is allowed only when an IN-FLIGHT task whose declared scope covers the
 * file exists. Outside jurisdiction, the plugin is silent — backend files in a
 * mixed repo are never spoken to.
 *
 * The law is never copied: the authorizing phases come from the repo's own
 * vendored harness (law-source.mjs imports CODE_PHASES from tools/task-coverage.mjs),
 * and scope matching delegates to that harness's pathMatches — so this gate cannot
 * drift from the staged fence and push fence that judge the same file later.
 *
 * Usage:
 *   gate-law.mjs --self-test     prove the deny/allow matrix both directions
 */

const DEFAULT_JURISDICTION_NOTE = "no picasso.json jurisdiction declared — the plugin makes no claim on this repo";

/**
 * Parse a PreToolUse hook payload (the stdin JSON). Mirrors stallion's contract:
 * Edit/Write carry file_path; path/filePath spellings are accepted — a gate that
 * cannot name the file it is asked to bless must refuse, not guess.
 */
export function parseEditPayload(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "hook payload is not an object" };
  const toolName = typeof payload.tool_name === "string" && payload.tool_name.length > 0 ? payload.tool_name : "(unknown tool)";
  const raw = payload.tool_input?.file_path ?? payload.tool_input?.filePath ?? payload.tool_input?.path;
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: `cannot determine the target file of the ${toolName} edit` };
  }
  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  return { ok: true, toolName, filePath: raw, cwd };
}

/** Read every parsable task record — malformed records authorize nothing. */
export function readRecords(stateDir, readdirSync, readFileSync, join) {
  const records = [];
  let files = [];
  try {
    files = readdirSync(stateDir).filter(f => f.endsWith(".json"));
  } catch {
    return records;
  }
  for (const f of files) {
    try { records.push(JSON.parse(readFileSync(join(stateDir, f), "utf8"))); }
    catch { /* a malformed record cannot authorize anything */ }
  }
  return records;
}

/**
 * The authoring decision, pure over (payload facts, law, jurisdiction, records).
 * law = { root, pathMatches, codePhases } imported from the repo's own vendored
 * harness. jurisdiction = string[] of globs from picasso.json (null = none declared).
 * Returns { decision: "allow", hint? } or { decision: "deny", reason }.
 */
export function authoringDecision({ filePath, cwd }, law, jurisdiction, records) {
  const absolute = filePath.startsWith("/") ? filePath : law.join(cwd, filePath);
  const relPath = law.relative(law.root, absolute);
  if (relPath.startsWith(".."))
    return { decision: "allow", hint: `${filePath} is outside the picasso harness repo at ${law.root} — not this harness's claim` };

  const inJurisdiction = Array.isArray(jurisdiction) && jurisdiction.length > 0 &&
    law.pathMatches(relPath, jurisdiction);
  if (!inJurisdiction)
    return { decision: "allow", hint: jurisdiction ? `${relPath} is outside the declared front-end jurisdiction` : DEFAULT_JURISDICTION_NOTE };

  const covering = records.filter(t => law.pathMatches(relPath, t.scope || []) && law.authorizingPhases.includes(t.phase));
  if (covering.length > 0)
    return { decision: "allow", hint: `${relPath} is covered by ${covering.map(t => t.id).join(", ")}` };

  const parked = records.filter(t => law.pathMatches(relPath, t.scope || []));
  const parkedList = parked.length ? parked.map(t => `${t.id} (${t.phase})`).join(", ") : "none";
  return {
    decision: "deny",
    reason: `the edit targets ${relPath}, inside this repo's declared front-end jurisdiction, and no in-flight task covers it` +
      `\n  rule: front-end code lands only under a task advanced to executing (found: ${parkedList})` +
      `\n  fix: node tools/task-state.mjs new <id> --risk-class ui-runtime && node tools/task-state.mjs scope <id> --add "${relPath.replace(/[^/]+$/, "**")}" && node tools/task-state.mjs advance <id> twice`,
  };
}

/** The banner's one-line state, or null when there is nothing to say. */
export function bannerLine(records, codePhases) {
  const inFlight = records.filter(t => codePhases.includes(t.phase));
  if (inFlight.length === 0) return null;
  return inFlight.map(t => `${t.id} · ${t.phase} · scope: ${(t.scope || []).join(", ")}`).join(" | ");
}

// ---- self-test: the deny/allow matrix, both directions ----
function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("gate-law --self-test");

  const pathMatches = (p, pats) => (pats || []).some(g => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*") { if (g[i + 1] === "*") { re += ".*"; i++; } else re += "[^/]*"; }
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`).test(p);
  });
  const law = { root: "/repo", pathMatches, authorizingPhases: ["executing", "verified", "adversarial"], join: (a, b) => a + "/" + b, relative: (root, abs) => abs.startsWith(root + "/") ? abs.slice(root.length + 1) : ".." + abs };
  const J = ["src/**", "index.html"];
  const t = (id, phase, scope) => ({ id, phase, scope });
  const d = (file, juris, records) => authoringDecision({ filePath: "/repo/" + file, cwd: "/repo" }, law, juris, records);

  ok("in jurisdiction, no task at all → deny with fix", (() => { const r = d("src/App.tsx", J, []); return r.decision === "deny" && r.reason.includes("fix:"); })());
  ok("in jurisdiction, covered by executing ui task → allow", d("src/App.tsx", J, [t("feat", "executing", ["src/**"])]).decision === "allow");
  ok("in jurisdiction, covered only by parked task → deny", d("src/App.tsx", J, [t("feat", "planned", ["src/**"])]).decision === "deny");
  ok("in jurisdiction, covered only by done task → deny (done authorizes nothing)", d("src/App.tsx", J, [t("old", "done", ["src/**"])]).decision === "deny");
  ok("in jurisdiction, covered by tooling task → allow (risk-class routes gates, not the plugin)", d("src/App.tsx", J, [t("chore", "executing", ["src/**"])]).decision === "allow");
  ok("in jurisdiction, task covers a different scope → deny", d("src/App.tsx", J, [t("other", "executing", ["docs/**"])]).decision === "deny");
  ok("outside jurisdiction → allow silent", d("README.md", J, []).decision === "allow");
  ok("no jurisdiction declared → allow everything (plugin makes no claim)", d("src/App.tsx", null, []).decision === "allow");
  ok("file outside harness root → allow (not this repo's claim)", authoringDecision({ filePath: "/elsewhere/x.tsx", cwd: "/repo" }, law, J, []).decision === "allow");
  ok("payload without a file path refuses", parseEditPayload({ tool_name: "Edit", tool_input: {} }).ok === false);
  ok("payload with path spelling variants parses", parseEditPayload({ tool_name: "Write", tool_input: { path: "/repo/src/a.tsx" }, cwd: "/repo" }).ok === true);
  ok("banner is null with nothing authorizing (done included)", bannerLine([t("old", "done", ["src/**"])], law.authorizingPhases) === null);
  ok("banner names in-flight tasks", (bannerLine([t("feat", "executing", ["src/**"])], law.authorizingPhases) || "").includes("feat · executing"));

  console.log(failures.length ? `gate-law: ${failures.length} self-test failure(s)` : "gate-law: self-test clean");
  if (failures.length) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("gate-law.mjs") && process.argv.includes("--self-test")) selfTest();
