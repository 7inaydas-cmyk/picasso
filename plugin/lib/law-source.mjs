/**
 * LAW-SOURCE — the adapter at the seam between the plugin and the repo's own
 * vendored picasso harness. The law is never copied: PHASES, authorizingPhases
 * and pathMatches are imported from the harness's tools/task-coverage.mjs, so
 * this gate cannot drift from the staged fence and push fence that judge the
 * same file later.
 *
 * Layouts recognized (walked up from the edited file's cwd):
 *   picasso root shape:     tools/task-coverage.mjs + .tasks/
 *   picasso template shape: identical (template vendors tools/ as-is)
 *
 * Jurisdiction comes from picasso.json at the harness root ({ jurisdiction:
 * [globs] }) — the repo's own declaration of its front-end surface. No
 * picasso.json means the repo has adopted the tools but made no front-end
 * claim: the plugin stays inert.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export function findHarnessRoot(cwd) {
  let dir = isAbsolute(cwd) ? cwd : cwd;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "tools/task-coverage.mjs")) && existsSync(join(dir, ".tasks"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export async function loadLaw(root) {
  const coveragePath = join(root, "tools/task-coverage.mjs");
  try {
    const coverage = await import(pathToFileURL(coveragePath).href);
    return {
      ok: true,
      root,
      stateDir: join(root, ".tasks"),
      join,
      relative: (from, to) => relative(from, to),
      pathMatches: coverage.pathMatches,
      phases: coverage.PHASES,
      authorizingPhases: coverage.authorizingPhases(),
    };
  } catch (e) {
    return { ok: false, reason: `cannot import the harness law at ${coveragePath}: ${e.message}` };
  }
}

/** The repo's declared front-end surface, or null when it declared none. */
export function readJurisdiction(root) {
  const p = join(root, "picasso.json");
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(j.jurisdiction) ? j.jurisdiction : null;
  } catch {
    return null;
  }
}
