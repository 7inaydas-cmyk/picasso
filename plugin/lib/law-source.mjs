/**
 * LAW-SOURCE — the adapter at the seam between the plugin and the repo's own
 * vendored picasso harness. The law is never copied: authorizingPhases and
 * pathMatches are imported from the harness's tools/task-coverage.mjs, so this
 * gate cannot drift from the staged fence and push fence that judge the same
 * file later.
 *
 * Which harness judges: the one at the REPO TOP of the edited file (the nearest
 * ancestor holding .git, through symlinks). The git fences run from there —
 * .githooks call `node tools/...` at the top — so the plugin judges from there
 * too, whatever the session's cwd, and a nested harness (picasso's own
 * template/) cannot flip the verdict.
 *
 * A repo top is a picasso claim when it holds tools/task-coverage.mjs AND
 * picasso.json ({ jurisdiction: [globs] }). No picasso.json means the repo made
 * no front-end claim: inert, and its code is never imported. A picasso.json that
 * cannot be read is a claim that cannot be stated: the caller refuses.
 */
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve an absolute path the way the kernel will when the edit lands:
 * component by component, following every symlink — dangling ones too, since
 * a write through a dangling link creates its target — and applying ".." to the
 * resolved directory, never to the text. Components past the first missing one
 * cannot be links.
 */
export function realPath(p) {
  const todo = (p.startsWith("/") ? p : `${process.cwd()}/${p}`).split("/");
  let cur = "/";
  for (let hops = 0; todo.length;) {
    const c = todo.shift();
    if (c === "" || c === ".") continue;
    if (c === "..") { cur = dirname(cur); continue; }
    const next = join(cur, c);
    let link = null;
    try { if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next); } catch { /* missing */ }
    if (link === null || ++hops > 40) { cur = next; continue; }
    todo.unshift(...link.split("/"));
    if (link.startsWith("/")) cur = "/";
  }
  return cur;
}

/** The picasso harness root governing `dir`, or null when no claim covers it. */
export function findHarnessRoot(dir) {
  for (let d = realPath(dir); ; d = dirname(d)) {
    if (existsSync(join(d, ".git")))
      return existsSync(join(d, "tools/task-coverage.mjs")) && existsSync(join(d, "picasso.json")) ? d : null;
    if (dirname(d) === d) return null;
  }
}

export async function loadLaw(root) {
  const coveragePath = join(root, "tools/task-coverage.mjs");
  // An older harness dispatches its CLI on import: it prints its own refusal
  // and calls process.exit — an exit 1 would not block (both runners treat it
  // as non-blocking). Trap the exit and mute its output for the import.
  const { exit } = process;
  const writes = [process.stdout.write, process.stderr.write];
  process.exit = code => { throw new Error(`the harness called process.exit(${code}) on import`); };
  process.stdout.write = process.stderr.write = () => true;
  try {
    const coverage = await import(pathToFileURL(coveragePath).href);
    if (!Array.isArray(coverage.PHASES) || typeof coverage.pathMatches !== "function" || typeof coverage.authorizingPhases !== "function")
      return { ok: false, reason: `${coveragePath} does not export PHASES, pathMatches and authorizingPhases — an older or foreign harness` };
    return {
      ok: true,
      root,
      stateDir: join(root, ".tasks"),
      phases: coverage.PHASES,
      pathMatches: coverage.pathMatches,
      authorizingPhases: coverage.authorizingPhases(),
    };
  } catch (e) {
    return { ok: false, reason: `cannot import the harness law at ${coveragePath}: ${e.message}` };
  } finally {
    process.exit = exit;
    [process.stdout.write, process.stderr.write] = writes;
  }
}

/** The repo's declared front-end surface: { ok: true, globs } or { ok: false, reason }. */
export function readJurisdiction(root) {
  const p = join(root, "picasso.json");
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (Array.isArray(j?.jurisdiction) && j.jurisdiction.every(g => typeof g === "string"))
      return { ok: true, globs: j.jurisdiction };
    return { ok: false, reason: `${p} has no "jurisdiction" array of glob strings` };
  } catch (e) {
    return { ok: false, reason: `${p} cannot be read: ${e.message}` };
  }
}
