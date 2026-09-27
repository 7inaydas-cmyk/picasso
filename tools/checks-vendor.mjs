#!/usr/bin/env node
/**
 * CHECKS-VENDOR — picasso's front-end checks as a vendorable bundle, and the
 * gate that keeps a vendored copy honest.
 *
 * The bundle is seven files copied FLAT into one host directory (flat keeps the
 * ratchets' sibling ./ratchet.mjs resolving): render-report.mjs, ratchet.mjs,
 * console-ratchet.mjs, a11y-ratchet.mjs, size-budget.mjs, lint-budget.mjs and
 * this checker. Beside them sits VENDOR.json:
 *   { schema: "picasso/checks-manifest@1", upstream: <40-hex picasso commit>,
 *     files: { <name>: { source: <picasso path>, sha256: <64-hex> } } }
 * The bundle is atomic: a manifest naming more or fewer files is refused.
 *
 * Modes:
 *   checks-vendor.mjs                      the HOST DRIFT GATE, from any cwd: the
 *                                          directory this file lives in holds exactly
 *                                          the manifest's files, byte for byte
 *   checks-vendor.mjs --export <dir>       (picasso checkout) HEAD's bundle bytes,
 *                                          read from git's object database, + VENDOR.json
 *   checks-vendor.mjs --freshness <clone> [--bundle <dir>]
 *                                          (wave intake) the manifest's digests are
 *                                          picasso's bytes at the pin, and no bundled
 *                                          source moved since; run it from the clone's
 *                                          own checker with --bundle, so the copy being
 *                                          judged is never the judge
 *   checks-vendor.mjs --probe              (picasso battery) export this working tree
 *                                          into a host-shaped temp dir (a spaced path)
 *                                          and prove it standalone there
 *   checks-vendor.mjs --self-test
 */

import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "picasso/checks-manifest@1";
const MANIFEST = "VENDOR.json";
const BUNDLE = {
  "render-report.mjs": "template/scripts/render-report.mjs",
  "ratchet.mjs": "tools/ratchet.mjs",
  "console-ratchet.mjs": "tools/console-ratchet.mjs",
  "a11y-ratchet.mjs": "tools/a11y-ratchet.mjs",
  "size-budget.mjs": "tools/size-budget.mjs",
  "lint-budget.mjs": "tools/lint-budget.mjs",
  "checks-vendor.mjs": "tools/checks-vendor.mjs",
};
// The browserless self-tests; render-report's needs playwright + chromium.
const PURE = ["ratchet.mjs", "console-ratchet.mjs", "a11y-ratchet.mjs", "size-budget.mjs", "lint-budget.mjs"];
// The only packages a bundled file may name: the host installs exactly these.
const PACKAGES = ["playwright", "@axe-core/playwright"];
const SELF = fileURLToPath(import.meta.url);
// The corpus is where the checker lives, never the cwd: a gate inside the tree
// it polices cannot be pointed at a different one.
const HERE = dirname(SELF);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha10 = s => s.slice(0, 10);

function die(msg, fix) {
  console.error(`checks-vendor: ${msg}${fix ? `\n  fix: ${fix}` : ""}`);
  process.exit(1);
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
// A hook's GIT_DIR / GIT_INDEX_FILE must never steer git at another repo.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function git(cwd, args, encoding = "utf8") {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding, env: cleanEnv(), maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: String(r.stderr ?? "") };
}
const zlist = s => String(s).split("\0").filter(Boolean);
const realpath = p => { try { return realpathSync(p); } catch { return p; } };

// Every entry under dir, relative, subdirectories included ('/'-joined). Dirents
// are lstat-typed: a symlink is an entry of its own, never followed.
function walk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
}
// A member must be a regular file: node runs a symlink's TARGET and resolves its
// ./ratchet.mjs beside it, where no gate reads; a write through one lands outside.
const irregular = p => { try { return !lstatSync(p).isFile(); } catch { return false; } };
// The pin's home is picasso's remote: a commit no origin ref holds lives only in
// this clone. ponytail: a hand-forged refs/remotes/origin/* is operator input,
// the same class as a clone with no fetched tip (F4).
const onOrigin = (cwd, rev) => git(cwd, ["for-each-ref", "--contains", rev, "--format=%(refname)", "refs/remotes/origin/"]).out.trim() !== "";

function shapeRefusal(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "the manifest is not a JSON object";
  if (m.schema !== SCHEMA) return `schema is ${JSON.stringify(m.schema)}, not "${SCHEMA}"`;
  if (typeof m.upstream !== "string" || !/^[0-9a-f]{40}$/.test(m.upstream)) return "upstream is not a 40-hex picasso commit";
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files)) return "files is not an object";
  const names = Object.keys(m.files), want = Object.keys(BUNDLE);
  const missing = want.filter(n => !names.includes(n)), extra = names.filter(n => !want.includes(n));
  if (missing.length || extra.length)
    return `files must name exactly the bundle (it is atomic)${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; extra ${extra.join(", ")}` : ""}`;
  for (const n of want) {
    const f = m.files[n];
    if (!f || f.source !== BUNDLE[n]) return `files["${n}"].source is not ${BUNDLE[n]}`;
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) return `files["${n}"].sha256 is not 64-hex`;
  }
  return null;
}

function loadManifest(dir) {
  const p = join(dir, MANIFEST);
  if (!existsSync(p)) return { refusal: `no ${MANIFEST} beside the checker in ${dir} — a bundle without its manifest is unverifiable, never clean` };
  let m;
  try { m = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { return { refusal: `${MANIFEST} does not parse: ${e.message}` }; }
  const bad = shapeRefusal(m);
  return bad ? { refusal: `${MANIFEST} is malformed: ${bad}` } : { manifest: m };
}

// A bare import (PACKAGES) resolves first to the bundle's package scope when the
// nearest package.json above it names itself that package (node's self-reference),
// then up the bundle's ancestors' node_modules, and a clean install replaces only
// the root's: either one between the bundle and the repo root is read by no gate
// and runs as the real package. The root is the OUTERMOST work tree (a submodule's
// root is not where the host installs), and a git that cannot answer inside a work
// tree refuses rather than reading as "no repo". ponytail: outside any git work
// tree there is no root to bound the walk, so node_modules above the bundle go
// unchecked there (the package scope is checked everywhere).
function shadowModules(dir) {
  const real = realpath(dir), up = [real], found = [];
  while (dirname(up.at(-1)) !== up.at(-1)) up.push(dirname(up.at(-1)));
  const scope = up.map(d => join(d, "package.json")).find(p => statSync(p, { throwIfNoEntry: false })?.isFile());
  let name;
  // node's reader skips a UTF-8 BOM; anything this reader still cannot parse is
  // refused, so no parser disagreement reads as a scope with no name.
  if (scope) try { ({ name } = JSON.parse(readFileSync(scope, "utf8").replace(/^﻿/, ""))); }
  catch (e) { found.push(`unparseable package scope: ${scope} (${e.message})`); }
  if (PACKAGES.includes(name)) found.push(`self-referencing package scope: ${scope} names itself ${name}`);
  const top = git(real, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0)
    return up.some(d => existsSync(join(d, ".git"))) ? [...found, `git cannot name the repo root above the bundle: ${top.err.trim().split("\n")[0] || "git did not run"}`] : found;
  let root = realpath(top.out.trim());
  for (let s; (s = git(root, ["rev-parse", "--show-superproject-working-tree"]).out.trim()); ) root = realpath(s);
  const parts = relative(root, real).split(sep);
  if (parts[0] === "..") return found;
  for (let i = parts.length - 1; i > 0; i--) {
    const rel = [...parts.slice(0, i), "node_modules"].join("/");
    if (lstatSync(join(root, rel), { throwIfNoEntry: false })) found.push(`shadowing node_modules: ${rel}`);
  }
  return found;
}

// Divergence in every direction: a stray file, a deleted one, a changed one.
function driftProblems(dir, manifest) {
  const problems = [...shadowModules(dir), ...walk(dir).filter(rel => rel !== MANIFEST && !Object.hasOwn(manifest.files, rel)).map(rel => `undeclared: ${rel}`)];
  if (irregular(join(dir, MANIFEST))) problems.push(`not a regular file: ${MANIFEST}`);
  for (const [name, { sha256: want }] of Object.entries(manifest.files)) {
    const p = join(dir, name);
    if (irregular(p)) { problems.push(`not a regular file: ${name}`); continue; }
    if (!existsSync(p)) { problems.push(`deleted: ${name}`); continue; }
    let got = null;
    try { got = sha256(readFileSync(p)); } catch { /* unreadable reads as patched */ }
    if (got !== want) problems.push(`patched: ${name}`);
  }
  return problems;
}

function writeBundle(dir, upstream, bytesOf) {
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, source] of Object.entries(BUNDLE)) {
    const bytes = bytesOf(source);
    rmSync(join(dir, name), { force: true }); writeFileSync(join(dir, name), bytes); // a fresh inode: never through a hard link
    files[name] = { source, sha256: sha256(bytes) };
  }
  const manifest = { schema: SCHEMA, upstream, files };
  rmSync(join(dir, MANIFEST), { force: true }); writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// Static import law: a flat host dir resolves node builtins, the declared
// packages and bundle siblings — anything else breaks only after vendoring.
const FROM_RE = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"']*)\1/g;
const SIDE_EFFECT_RE = /\bimport\s*(["'])([^"']*)\1/g;
const DYNAMIC_RE = /\bimport\s*\(([^)]*)\)/g;
const allowed = s => s.startsWith("node:") || PACKAGES.includes(s) || (s.startsWith("./") && Object.hasOwn(BUNDLE, s.slice(2)));
// Line comments go first, so a quote in one cannot hide a multi-line import clause.
// ponytail: only a '//' with no quote before it on its line is blanked, and /* */ stays —
// a quote inside a block comment in an import clause still hides it; a real lexer
// (es-module-lexer) if the bundle grows past picasso's own files.
const blankLineComments = text => text.replace(/^([^'"`\n]*?)(?<!\S)\/\/.*$/gm, "$1");
function importProblems(name, source) {
  const text = blankLineComments(source);
  const statics = [...text.matchAll(FROM_RE), ...text.matchAll(SIDE_EFFECT_RE)].map(m => m[2]);
  const problems = statics.filter(s => !allowed(s)).map(s => `${name}: imports '${s}'`);
  for (const m of text.matchAll(DYNAMIC_RE)) {
    const lit = m[1].trim().match(/^(["'`])([^"'`$]*)\1$/);
    if (!lit) problems.push(`${name}: a computed dynamic specifier cannot be checked (${m[1].trim()})`);
    else if (!allowed(lit[2])) problems.push(`${name}: imports '${lit[2]}'`);
  }
  return problems;
}

function cmdDrift() {
  const reVendor = `node <picasso>/tools/checks-vendor.mjs --export ${HERE}   (from a pushed picasso checkout)`;
  const { manifest, refusal } = loadManifest(HERE);
  if (refusal) die(`refused: ${refusal}`, reVendor);
  const problems = driftProblems(HERE, manifest);
  if (problems.length)
    die(`refused: the vendored bundle in ${HERE} diverges from ${MANIFEST} (picasso ${sha10(manifest.upstream)}):\n  ${problems.join("\n  ")}\n` +
        `  rule: the bundle is picasso's bytes at the pin, in regular files — a host edit is a patch, a stray file is undeclared, a link is not a member, no node_modules sits between the bundle and the repo root and no package.json above the bundle names itself a bundled package (remove it; the host installs ${PACKAGES.join(" and ")} at its root), and inside a git work tree git must answer`, reVendor);
  console.log(`checks-vendor: OK — ${Object.keys(manifest.files).length} bundled file(s) match ${MANIFEST} (picasso ${sha10(manifest.upstream)})`);
}

function cmdExport(target) {
  if (!target) die("usage: checks-vendor.mjs --export <dir>");
  const dir = resolve(target);
  if (existsSync(dir) && !statSync(dir).isDirectory())
    die(`refused: --export needs a directory; ${dir} is a file (nothing was written)`, "name the bundle directory, e.g. --export docs/gates/picasso");
  const top = git(ROOT, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || realpath(top.out.trim()) !== realpath(ROOT))
    die(`refused: --export runs from a picasso checkout — ${ROOT} is not a git toplevel (a vendored copy cannot re-export itself)`,
        `node <picasso-checkout>/tools/checks-vendor.mjs --export ${dir}`);
  const absent = Object.values(BUNDLE).filter(src => git(ROOT, ["cat-file", "-e", `HEAD:${src}`]).code !== 0);
  if (absent.length) die(`refused: bundle source(s) absent at HEAD: ${absent.join(", ")}`, "export from a picasso commit that carries the whole bundle");
  if (!onOrigin(ROOT, "HEAD"))
    die("refused: HEAD is on no remote-tracking ref of origin — --freshness could never find this pin (a throwaway remote does not count)", "push picasso to origin (git push), then export");
  const leftovers = walk(dir).filter(rel => rel !== MANIFEST && !Object.hasOwn(BUNDLE, rel));
  if (leftovers.length)
    die(`refused: ${dir} holds files outside the bundle (nothing was written):\n  ${leftovers.join("\n  ")}`,
        "remove them by hand (a file that left the bundle upstream, or a host file), then re-run the export");
  const links = [...Object.keys(BUNDLE), MANIFEST].filter(n => irregular(join(dir, n)));
  if (links.length)
    die(`refused: ${dir} holds bundle names that are not regular files (nothing was written — a write would land THROUGH them):\n  ${links.join("\n  ")}`,
        "remove them by hand (a symlink or a directory), then re-run the export");
  const dirty = zlist(git(ROOT, ["status", "--porcelain", "-z", "--", ...Object.values(BUNDLE)]).out);
  if (dirty.length) console.warn(`checks-vendor: warning — local edits are NOT exported (the bundle is HEAD's bytes):\n  ${dirty.join("\n  ")}`);
  const head = git(ROOT, ["rev-parse", "HEAD"]).out.trim();
  const manifest = writeBundle(dir, head, src => {
    const r = git(ROOT, ["show", `HEAD:${src}`], "buffer");
    if (r.code !== 0) die(`refused: cannot read HEAD:${src}: ${r.err.trim()}`);
    return r.out;
  });
  const problems = driftProblems(dir, manifest);
  if (problems.length) die(`refused: the export does not verify:\n  ${problems.join("\n  ")}`);
  console.log(`checks-vendor: exported ${Object.keys(BUNDLE).length} file(s) + ${MANIFEST} into ${dir} at picasso ${sha10(head)}\n` +
    `  drift gate:  node ${join(dir, "checks-vendor.mjs")}\n` +
    `  wave intake: node <picasso-clone>/tools/checks-vendor.mjs --freshness <picasso-clone> --bundle ${dir}\n` +
    `  wiring:      picasso docs/WIRING.md, "Picasso's checks in a repo picasso does not govern"`);
}

function cmdFreshness(target, bundle) {
  if (!target || bundle === "") die("usage: checks-vendor.mjs --freshness <picasso-clone> [--bundle <vendored-dir>]");
  const clone = resolve(target);
  // Default: the bundle this checker lives in. A host copy cannot certify its own
  // checker, so wave intake runs picasso's copy with --bundle <host dir>.
  const dir = bundle ? resolve(bundle) : HERE;
  const reVendor = `node ${join(clone, "tools/checks-vendor.mjs")} --export ${dir}`;
  const { manifest, refusal } = loadManifest(dir);
  if (refusal) die(`refused: ${refusal}`, reVendor);
  const drift = driftProblems(dir, manifest);
  if (drift.length) die(`refused: the bundle diverges from ${MANIFEST}:\n  ${drift.join("\n  ")}`, `node ${join(dir, "checks-vendor.mjs")}   (the drift gate), then re-vendor`);
  const pin = manifest.upstream;
  const g = (args, enc) => git(clone, args, enc);
  if (g(["rev-parse", "--show-toplevel"]).code !== 0) die(`refused: ${clone} is not a git clone of picasso`, "point --freshness at a picasso clone");
  if (g(["cat-file", "-e", `${pin}^{commit}`]).code !== 0)
    die(`refused: the pin ${sha10(pin)} is not a commit in ${clone} — a verdict from a tree that cannot see the pin is a guess`, `git -C ${clone} pull --ff-only`);
  if (!onOrigin(clone, pin))
    die(`refused: the pin ${sha10(pin)} is on no remote-tracking ref of origin in ${clone} — a commit only this clone holds launders a patch as well as a regenerated manifest does`,
        `git -C ${clone} fetch origin; if it still refuses, the pin was never pushed — re-vendor from a pushed commit: ${reVendor}`);
  const head = g(["rev-parse", "HEAD"]).out.trim();
  if (g(["merge-base", "--is-ancestor", pin, "HEAD"]).code !== 0)
    die(`refused: ${clone} HEAD ${sha10(head)} does not descend from the pin ${sha10(pin)} — a clone behind the pin names a downgrade`, `git -C ${clone} pull --ff-only`);
  // The first fetched tip that resolves (stallion's law): a clone behind its own
  // fetch answers for an old HEAD.
  for (const [tip, fix] of [["@{upstream}", `git -C ${clone} pull --ff-only`], ["refs/remotes/origin/HEAD", `git -C ${clone} checkout --detach origin/HEAD`]]) {
    const r = g(["rev-list", "--count", `HEAD..${tip}`]);
    if (r.code !== 0) continue;
    if (Number(r.out.trim()) > 0) die(`refused: ${clone} is ${r.out.trim()} commit(s) behind its fetched ${tip}`, fix);
    break;
  }
  const atPin = new Set(zlist(g(["ls-tree", "-z", "-r", "--name-only", "--full-tree", pin]).out));
  const absent = Object.values(BUNDLE).filter(s => !atPin.has(s));
  if (absent.length) die(`refused: bundle source(s) absent at the pin ${sha10(pin)}: ${absent.join(", ")}`, reVendor);
  const patched = Object.entries(manifest.files).filter(([, f]) => {
    const r = g(["show", `${pin}:${f.source}`], "buffer");
    return r.code !== 0 || sha256(r.out) !== f.sha256;
  }).map(([name]) => name);
  if (patched.length)
    die(`refused: patched against upstream ${sha10(pin)}: ${patched.join(", ")}\n` +
        `  rule: the manifest's digests must be picasso's bytes at its own pin — a regenerated manifest does not launder a patch`, reVendor);
  const changed = new Set(zlist(g(["diff", "-z", "--name-only", "--no-renames", `${pin}..HEAD`]).out));
  const moved = Object.values(BUNDLE).filter(s => changed.has(s));
  if (moved.length)
    die(`refused: picasso moved ${moved.length} bundled source(s) past the pin (${sha10(pin)} -> ${sha10(head)}):\n  ${moved.join("\n  ")}`,
        `re-vendor at ${sha10(head)}: ${reVendor}`);
  console.log(pin === head
    ? `checks-vendor: FRESH — the pin is ${clone}'s HEAD (${sha10(head)}); pull that clone before trusting recency`
    : `checks-vendor: FRESH FOR THIS WAVE — picasso moved past the pin (${sha10(pin)} -> ${sha10(head)}) without touching a bundled source`);
}

// The battery's proof that the REAL bundle travels: export this working tree
// into a spaced temp path (URL-special characters are where self-respawning
// tools broke), then verify, refuse a patch, scan imports, run the self-tests.
function probeIn(tmp) {
  const missing = Object.values(BUNDLE).filter(s => !existsSync(join(ROOT, s)));
  if (missing.length) return `bundle source(s) missing from this checkout: ${missing.join(", ")}`;
  const dir = join(tmp, "vendor", "picasso");
  writeBundle(dir, "0".repeat(40), src => readFileSync(join(ROOT, src)));
  const checker = join(dir, "checks-vendor.mjs");
  const node = argv => {
    const r = spawnSync(process.execPath, argv, { cwd: tmp, encoding: "utf8" });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  let r = node([checker]);
  if (r.code !== 0) return `the exported checker refused its own fresh export:\n${r.out}`;
  appendFileSync(join(dir, "ratchet.mjs"), "\n");
  r = node([checker]);
  if (r.code !== 1 || !r.out.includes("patched: ratchet.mjs")) return `an appended byte was not refused as 'patched: ratchet.mjs' (exit ${r.code}):\n${r.out}`;
  writeFileSync(join(dir, "ratchet.mjs"), readFileSync(join(ROOT, BUNDLE["ratchet.mjs"])));
  const imports = Object.keys(BUNDLE).flatMap(name => importProblems(name, readFileSync(join(dir, name), "utf8")));
  if (imports.length) return `bundled file(s) name a module a flat host dir cannot resolve:\n  ${imports.join("\n  ")}`;
  for (const name of [...PURE, "checks-vendor.mjs"]) {
    r = node([join(dir, name), "--self-test"]);
    const why = r.out.split("\n").filter(l => /FAIL|Error/.test(l)).join("\n") || r.out.slice(-800);
    if (r.code !== 0) return `${name} --self-test fails from the host copy at ${dir}:\n${why}`;
  }
  return null;
}

function cmdProbe() {
  const tmp = mkdtempSync(join(tmpdir(), "picasso checks-"));
  let problem;
  try { problem = probeIn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (problem) die(`refused: probe — ${problem}`, "keep every bundled file standalone and runnable from any path (node builtins, ./<bundle member>, playwright, @axe-core/playwright), then re-run node tools/checks-vendor.mjs --probe");
  console.log(`checks-vendor: probe clean — ${Object.keys(BUNDLE).length} file(s) exported, drift refused, imports resolve in the bundle, ${PURE.length + 1} standalone self-test(s) green`);
}

// ---- self-test: synthetic fixtures only, so it runs identically in a host ----
function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("checks-vendor --self-test");
  const tmp = mkdtempSync(join(tmpdir(), "picasso-cv-"));
  try {
    lawCases(ok, tmp);
    gitCases(ok, tmp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(failures.length ? `checks-vendor: ${failures.length} self-test failure(s)` : "checks-vendor: self-test clean");
  if (failures.length) process.exit(1);
}

function lawCases(ok, tmp) {
  ok("the hasher is sha256 (pinned vector)", sha256("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  const valid = { schema: SCHEMA, upstream: "a".repeat(40),
    files: Object.fromEntries(Object.entries(BUNDLE).map(([n, source]) => [n, { source, sha256: "0".repeat(64) }])) };
  ok("shape: a valid manifest passes", shapeRefusal(valid) === null);
  ok("shape refuses a non-object", [null, [], "x", 1].every(m => shapeRefusal(m) !== null));
  const refuses = (name, mutate) => { const m = structuredClone(valid); mutate(m); ok(`shape refuses ${name}`, shapeRefusal(m) !== null); };
  refuses("a wrong schema", m => { m.schema = "picasso/checks-manifest@2"; });
  refuses("an upstream that is not 40-hex", m => { m.upstream = "abc123"; });
  refuses("files missing a bundle member (the bundle is atomic)", m => { delete m.files["ratchet.mjs"]; });
  refuses("an extra member", m => { m.files["extra.mjs"] = { source: "tools/extra.mjs", sha256: "0".repeat(64) }; });
  refuses("a source that is not the bundle's", m => { m.files["ratchet.mjs"].source = "tools/task-coverage.mjs"; });
  refuses("a non-hex sha256", m => { m.files["ratchet.mjs"].sha256 = "z".repeat(64); });

  const d = join(tmp, "drift");
  const m = writeBundle(d, "a".repeat(40), src => `// ${src}\n`);
  const has = (probs, line) => probs.includes(line);
  ok("drift: a fresh bundle is clean (VENDOR.json is not swept into the corpus)", driftProblems(d, m).length === 0);
  writeFileSync(join(d, "extra.mjs"), "x");
  ok("drift: an extra file is undeclared", has(driftProblems(d, m), "undeclared: extra.mjs"));
  rmSync(join(d, "extra.mjs"));
  mkdirSync(join(d, "sub")); writeFileSync(join(d, "sub", "x.json"), "{}");
  ok("drift: a file in a subdirectory is undeclared", has(driftProblems(d, m), "undeclared: sub/x.json"));
  rmSync(join(d, "sub"), { recursive: true });
  rmSync(join(d, "size-budget.mjs"));
  ok("drift: a declared file removed is deleted", has(driftProblems(d, m), "deleted: size-budget.mjs"));
  writeFileSync(join(d, "size-budget.mjs"), "// tools/size-budget.mjs\n");
  appendFileSync(join(d, "ratchet.mjs"), "x");
  ok("drift: changed bytes are patched", has(driftProblems(d, m), "patched: ratchet.mjs"));
  writeFileSync(join(d, "ratchet.mjs"), "// tools/ratchet.mjs\n");
  rmSync(join(d, "lint-budget.mjs")); mkdirSync(join(d, "lint-budget.mjs"));
  ok("drift: a declared member replaced by a directory is not a regular file", has(driftProblems(d, m), "not a regular file: lint-budget.mjs"));
  rmSync(join(d, "lint-budget.mjs"), { recursive: true }); writeFileSync(join(d, "lint-budget.mjs"), "// tools/lint-budget.mjs\n");
  // A link to byte-identical bytes still refuses: node resolves a linked entry's
  // ./ratchet.mjs beside its TARGET, a directory no gate reads.
  mkdirSync(join(tmp, "shadow")); writeFileSync(join(tmp, "shadow", "ratchet.mjs"), "// tools/ratchet.mjs\n");
  rmSync(join(d, "ratchet.mjs")); symlinkSync(join(tmp, "shadow", "ratchet.mjs"), join(d, "ratchet.mjs"));
  ok("drift: a symlinked member refuses even when its target holds the bundle's bytes", has(driftProblems(d, m), "not a regular file: ratchet.mjs"));
  rmSync(join(d, "ratchet.mjs")); writeFileSync(join(d, "ratchet.mjs"), "// tools/ratchet.mjs\n");
  ok("drift: a symlinked member case restores clean", driftProblems(d, m).length === 0);
  const mj = join(tmp, "shadow", MANIFEST);
  copyFileSync(join(d, MANIFEST), mj); rmSync(join(d, MANIFEST)); symlinkSync(mj, join(d, MANIFEST));
  ok("drift: a symlinked VENDOR.json is not a regular file", has(driftProblems(d, m), `not a regular file: ${MANIFEST}`));
  rmSync(join(d, MANIFEST)); copyFileSync(mj, join(d, MANIFEST));

  const IMP = "imp" + "ort", EXP = "exp" + "ort";
  const scan = text => importProblems("x.mjs", text);
  ok("imports: builtins, bundle siblings and the two browser packages pass",
    scan(`${IMP} { a } from "node:fs";\n${IMP} { b } from "./ratchet.mjs";\n${IMP} { chromium } from "playwright";\n` +
      `${IMP} AxeBuilder from '@axe-core/playwright';\n${EXP} { c } from "./a11y-ratchet.mjs";`).length === 0);
  ok("imports: a relative path out of the bundle refuses, named", scan(`${IMP} { j } from "../tools/ratchet.mjs";`).some(p => p.includes("'../tools/ratchet.mjs'")));
  ok("imports: a non-bundle sibling refuses (side-effect form)", scan(`${IMP} "./task-coverage.mjs";`).length === 1);
  ok("imports: an undeclared package refuses", scan(`${IMP} x from "lodash";`).length === 1);
  ok("imports: a re-export from outside refuses", scan(`${EXP} * from "../lib/x.mjs";`).length === 1);
  ok("imports: a multi-line named form is still seen", scan(`${IMP} {\n  a,\n  b,\n} from "./gone.mjs";`).length === 1);
  ok("imports: a multi-line clause carrying a comment with a quote is still seen",
    scan(`${IMP} {\n  a, // it's the shared one\n} from "../tools/ratchet.mjs";`).length === 1);
  ok("imports: a literal dynamic specifier is judged", scan(`await ${IMP}("./gone.mjs");`).length === 1 && scan(`await ${IMP}("node:fs");`).length === 0);
  ok("imports: a computed dynamic specifier refuses", scan(`await ${IMP}(name);`).length === 1);
  ok("imports: the meta property is not a module", scan(`const u = ${IMP}.meta.url;`).length === 0);
}

function gitCases(ok, tmp) {
  // Fixture git: never the caller's hooks, signing, identity or global config.
  const env = { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const G = (cwd, ...args) => spawnSync("git", ["-c", "user.name=selftest", "-c", "user.email=selftest@localhost",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main", ...args],
  { cwd, encoding: "utf8", env });
  const rev = (cwd, ref) => G(cwd, "rev-parse", ref).stdout.trim();
  const run = (script, argv, cwd = tmp, env = process.env) => {
    const r = spawnSync(process.execPath, [script, ...argv], { cwd, encoding: "utf8", env });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };

  // A picasso-shaped upstream (a spaced path) whose checker is this very file.
  const up = join(tmp, "picasso up");
  mkdirSync(up); G(up, "init", "-q");
  writeFileSync(join(up, "README.md"), "picasso\n");
  G(up, "add", "README.md"); G(up, "commit", "-qm", "c0");
  const c0 = rev(up, "HEAD");
  for (const src of Object.values(BUNDLE)) {
    mkdirSync(dirname(join(up, src)), { recursive: true });
    writeFileSync(join(up, src), src === BUNDLE["checks-vendor.mjs"] ? readFileSync(SELF) : `// ${src} v1\n`);
  }
  const upChecker = join(up, "tools/checks-vendor.mjs");
  const host = join(tmp, "host", "docs", "gates", "picasso");
  const exp = () => run(upChecker, ["--export", host]);

  let r = exp();
  ok("export refuses bundle sources absent at HEAD", r.code === 1 && r.out.includes("absent at HEAD") && !existsSync(host));
  G(up, "add", "."); G(up, "commit", "-qm", "c1");
  const c1 = rev(up, "HEAD");
  r = exp();
  ok("export refuses an unpushed HEAD (the pin must be findable)", r.code === 1 && r.out.includes("no remote-tracking ref") && !existsSync(host));
  const remote = join(tmp, "remote.git");
  G(tmp, "init", "-q", "--bare", remote);
  G(up, "remote", "add", "origin", remote); G(up, "push", "-q", "-u", "origin", "main");

  const nested = join(up, "nested", "tools");
  mkdirSync(nested, { recursive: true }); writeFileSync(join(nested, "checks-vendor.mjs"), readFileSync(SELF));
  r = run(join(nested, "checks-vendor.mjs"), ["--export", host]);
  ok("export refuses a ROOT that is not the git toplevel (a copy cannot re-export)", r.code === 1 && r.out.includes("not a git toplevel") && !existsSync(host));
  rmSync(join(up, "nested"), { recursive: true });
  writeFileSync(join(tmp, "a-file"), "x");
  r = run(upChecker, ["--export", join(tmp, "a-file")]);
  ok("export into an existing file refuses with a rule, not a crash", r.code === 1 && r.out.includes("needs a directory"));

  mkdirSync(host, { recursive: true }); writeFileSync(join(host, "old-gate.mjs"), "x");
  r = exp();
  ok("export refuses a leftover file BEFORE writing anything", r.code === 1 && r.out.includes("old-gate.mjs") &&
    !existsSync(join(host, MANIFEST)) && !existsSync(join(host, "ratchet.mjs")));
  rmSync(join(host, "old-gate.mjs"));

  appendFileSync(join(up, "tools/ratchet.mjs"), "// local edit\n");
  r = exp();
  ok("export warns on a local edit and writes HEAD's bytes, not the working tree's",
    r.code === 0 && r.out.includes("NOT exported") && readFileSync(join(host, "ratchet.mjs"), "utf8") === "// tools/ratchet.mjs v1\n");
  G(up, "checkout", "-q", "--", "tools/ratchet.mjs");
  const manifest = JSON.parse(readFileSync(join(host, MANIFEST), "utf8"));
  ok("export pins upstream to HEAD", manifest.upstream === c1);

  const hostChecker = join(host, "checks-vendor.mjs");
  r = run(hostChecker, [], join(tmp, "host"));
  ok("the exported checker, run bare from another cwd, passes its bundle", r.code === 0 && r.out.includes("OK — 7 bundled file(s)"));
  appendFileSync(join(host, "a11y-ratchet.mjs"), "x");
  r = run(hostChecker, []);
  ok("a hand-patched bundled file refuses bare, with the re-vendor fix", r.code === 1 && r.out.includes("patched: a11y-ratchet.mjs") && r.out.includes("--export"));

  // A patch laundered through a regenerated manifest passes bare — freshness catches it.
  const laundered = structuredClone(manifest);
  laundered.files["a11y-ratchet.mjs"].sha256 = sha256(readFileSync(join(host, "a11y-ratchet.mjs")));
  writeFileSync(join(host, MANIFEST), JSON.stringify(laundered));
  const fresh = clone => run(hostChecker, ["--freshness", clone]);
  r = fresh(up);
  ok("freshness refuses a regenerated manifest over a patch", run(hostChecker, []).code === 0 && r.code === 1 && r.out.includes("patched against upstream"));
  writeFileSync(join(host, "a11y-ratchet.mjs"), "// tools/a11y-ratchet.mjs v1\n");
  writeFileSync(join(host, MANIFEST), JSON.stringify(manifest));

  // The judge must not be the judged: a neutered host checker under a regenerated
  // manifest passes its own --freshness; picasso's checker (--bundle) refuses it.
  const hostCheckerBytes = readFileSync(hostChecker);
  writeFileSync(hostChecker, `console.log("checks-vendor: FRESH");\n`);
  const neutered = structuredClone(manifest);
  neutered.files["checks-vendor.mjs"].sha256 = sha256(readFileSync(hostChecker));
  writeFileSync(join(host, MANIFEST), JSON.stringify(neutered));
  r = run(upChecker, ["--freshness", up, "--bundle", host]);
  ok("freshness run by picasso's own checker (--bundle) refuses a neutered host checker under a regenerated manifest",
    fresh(up).code === 0 && r.code === 1 && /upstream [0-9a-f]{10}: checks-vendor\.mjs/.test(r.out));
  writeFileSync(hostChecker, hostCheckerBytes);
  writeFileSync(join(host, MANIFEST), JSON.stringify(manifest));

  // The same forgery through a link: every byte the checker hashes is picasso's,
  // and node runs the target, whose ./ratchet.mjs no gate reads.
  const shadow = join(tmp, "host", "docs", "gates", "shadow");
  mkdirSync(shadow); copyFileSync(join(host, "console-ratchet.mjs"), join(shadow, "console-ratchet.mjs"));
  rmSync(join(host, "console-ratchet.mjs")); symlinkSync("../shadow/console-ratchet.mjs", join(host, "console-ratchet.mjs"));
  r = run(upChecker, ["--freshness", up, "--bundle", host]);
  ok("freshness (--bundle) refuses a symlinked member whose target holds picasso's bytes",
    r.code === 1 && r.out.includes("not a regular file: console-ratchet.mjs"));
  // The repair must not write through a link to a file outside the bundle.
  const hostTool = join(tmp, "host", "host-tool.mjs"), hostJson = join(tmp, "host", "host.json");
  writeFileSync(hostTool, "host-owned\n"); writeFileSync(hostJson, JSON.stringify(manifest));
  rmSync(join(host, "ratchet.mjs")); symlinkSync(hostTool, join(host, "ratchet.mjs"));
  rmSync(join(host, MANIFEST)); symlinkSync(hostJson, join(host, MANIFEST));
  r = exp();
  ok("export refuses bundle names that would be written through a link (VENDOR.json included), before writing anything",
    r.code === 1 && r.out.includes("\n  ratchet.mjs") && r.out.includes(`\n  ${MANIFEST}`) &&
    readFileSync(hostTool, "utf8") === "host-owned\n" && readFileSync(hostJson, "utf8") === JSON.stringify(manifest));
  for (const n of ["console-ratchet.mjs", "ratchet.mjs", MANIFEST]) rmSync(join(host, n));
  rmSync(shadow, { recursive: true }); rmSync(hostTool); rmSync(hostJson);
  r = exp();
  ok("the linked-member cases restore to a clean export", r.code === 0 && run(hostChecker, []).code === 0);
  writeFileSync(join(host, MANIFEST), JSON.stringify(manifest));

  r = fresh(up);
  ok("freshness: pin == HEAD reads FRESH", r.code === 0 && r.out.includes("FRESH —"));
  writeFileSync(join(up, "README.md"), "picasso v2\n"); G(up, "commit", "-qam", "c2");
  const c2 = rev(up, "HEAD");
  r = fresh(up);
  ok("freshness: a move touching no bundled source reads FRESH FOR THIS WAVE", r.code === 0 && r.out.includes("FRESH FOR THIS WAVE"));
  writeFileSync(join(up, "tools/a11y-ratchet.mjs"), "// v2\n"); G(up, "commit", "-qam", "c3");
  r = fresh(up);
  ok("freshness: a moved bundled source refuses, named, with the export command", r.code === 1 && r.out.includes("tools/a11y-ratchet.mjs") && r.out.includes("--export"));
  G(up, "reset", "-q", "--hard", c2);
  G(up, "mv", "tools/size-budget.mjs", "tools/size-budget-2.mjs"); G(up, "commit", "-qm", "rename");
  r = fresh(up);
  ok("freshness: a renamed bundled source refuses (both sides of a rename are owed)", r.code === 1 && r.out.includes("tools/size-budget.mjs"));
  G(up, "reset", "-q", "--hard", c2);
  G(up, "checkout", "-q", "--detach", c0);
  r = fresh(up);
  ok("freshness: a clone behind the pin refuses (a downgrade)", r.code === 1 && r.out.includes("does not descend from the pin"));
  G(up, "checkout", "-q", "main");

  const behind = join(tmp, "clone behind");
  G(tmp, "clone", "-q", remote, behind);
  G(up, "push", "-q", "origin", "main"); G(behind, "fetch", "-q");
  r = fresh(behind);
  ok("freshness: a clone behind its own fetched upstream refuses", r.code === 1 && r.out.includes("behind its fetched"));

  writeFileSync(join(host, MANIFEST), JSON.stringify({ ...manifest, upstream: c0 }));
  r = fresh(up);
  ok("freshness: a bundled source absent at the pin refuses", r.code === 1 && r.out.includes("absent at the pin"));
  writeFileSync(join(host, MANIFEST), JSON.stringify({ ...manifest, upstream: "f".repeat(40) }));
  r = fresh(up);
  ok("freshness: a pin the clone cannot see refuses", r.code === 1 && r.out.includes("is not a commit in"));

  // A pin no origin ref holds is a commit only this clone has: a patch laundered
  // through it reads FRESH to picasso's own, genuine checker.
  writeFileSync(join(up, "tools/a11y-ratchet.mjs"), "// local only\n"); G(up, "commit", "-qam", "local");
  writeFileSync(join(host, "a11y-ratchet.mjs"), "// local only\n");
  const localPin = structuredClone(manifest);
  localPin.upstream = rev(up, "HEAD");
  localPin.files["a11y-ratchet.mjs"].sha256 = sha256("// local only\n");
  writeFileSync(join(host, MANIFEST), JSON.stringify(localPin));
  r = run(upChecker, ["--freshness", up, "--bundle", host]);
  ok("freshness refuses a pin on no origin ref (a local commit launders a patch)", r.code === 1 && r.out.includes("no remote-tracking ref of origin"));
  const scratch = join(tmp, "scratch.git");
  G(tmp, "init", "-q", "--bare", scratch); G(up, "remote", "add", "scratch", scratch); G(up, "push", "-q", "scratch", "HEAD:refs/heads/x");
  r = exp();
  ok("export refuses a HEAD that only a non-origin remote holds", r.code === 1 && r.out.includes("no remote-tracking ref of origin"));
  G(up, "reset", "-q", "--hard", c2);
  writeFileSync(join(host, "a11y-ratchet.mjs"), "// tools/a11y-ratchet.mjs v1\n");
  writeFileSync(join(host, MANIFEST), JSON.stringify(manifest));

  // Bare packages resolve up the bundle's ancestors: a forged package one level
  // above the bundle is read by no gate and survives a clean install.
  const hostRoot = join(tmp, "host");
  G(hostRoot, "init", "-q");
  const forged = join(hostRoot, "docs", "gates", "node_modules", "@axe-core", "playwright");
  mkdirSync(forged, { recursive: true }); writeFileSync(join(forged, "index.js"), "export default class {}\n");
  r = run(hostChecker, []);
  const r2 = run(upChecker, ["--freshness", up, "--bundle", host]);
  ok("a node_modules between the bundle and the repo root refuses (drift gate and --freshness --bundle)",
    r.code === 1 && r.out.includes("shadowing node_modules: docs/gates/node_modules") && r2.code === 1 && r2.out.includes("docs/gates/node_modules"));
  renameSync(join(hostRoot, "docs", "gates", "node_modules"), join(hostRoot, "docs", "node_modules"));
  ok("a node_modules two levels above the bundle refuses too", run(hostChecker, []).out.includes("shadowing node_modules: docs/node_modules"));
  rmSync(join(hostRoot, "docs", "node_modules"), { recursive: true });
  mkdirSync(join(hostRoot, "node_modules", "playwright"), { recursive: true });
  ok("the repo root's own node_modules is the install, not a shadow", run(hostChecker, []).code === 0);
  // Node resolves a bare specifier to the nearest package.json's own exports when
  // it names itself that package, before it reads any node_modules.
  const pj = join(hostRoot, "docs", "gates", "package.json");
  writeFileSync(pj, JSON.stringify({ name: "@axe-core/playwright", exports: "./axe.mjs" }));
  r = run(hostChecker, []);
  const r3 = run(upChecker, ["--freshness", up, "--bundle", host]);
  ok("a package.json above the bundle that names itself a bundled package refuses (drift gate and --freshness --bundle)",
    r.code === 1 && r.out.includes("docs/gates/package.json names itself @axe-core/playwright") && r3.code === 1 && r3.out.includes("self-referencing package scope"));
  writeFileSync(pj, "﻿" + JSON.stringify({ name: "playwright", exports: "./pw.mjs" }));
  ok("a BOM-prefixed package.json is read as node reads it (it self-references too)", run(hostChecker, []).out.includes("docs/gates/package.json names itself playwright"));
  writeFileSync(pj, `{"name":"docs-site"} x`);
  ok("a package scope this reader cannot parse refuses rather than reading as no name", run(hostChecker, []).out.includes("unparseable package scope"));
  writeFileSync(pj, JSON.stringify({ name: "docs-site", exports: "./x.mjs" }));
  ok("a package.json above the bundle with any other name is not a self-reference", run(hostChecker, []).code === 0);
  rmSync(pj);
  const noGit = join(tmp, "no git"); mkdirSync(noGit);
  r = run(hostChecker, [], tmp, { ...process.env, PATH: noGit });
  ok("inside a git work tree, a git that cannot answer refuses instead of reading as no repo", r.code === 1 && r.out.includes("git cannot name the repo root"));
  rmSync(join(hostRoot, "node_modules"), { recursive: true }); rmSync(join(hostRoot, ".git"), { recursive: true });

  // A submodule's root is not the install: the superproject's is.
  const gates = join(tmp, "gates"), superHost = join(tmp, "super host");
  cpSync(host, join(gates, "picasso"), { recursive: true });
  mkdirSync(join(gates, "node_modules", "playwright"), { recursive: true }); writeFileSync(join(gates, "node_modules", "playwright", "index.js"), "x\n");
  G(gates, "init", "-q"); G(gates, "add", "-A"); G(gates, "commit", "-qm", "gates");
  mkdirSync(superHost); G(superHost, "init", "-q"); G(superHost, "-c", "protocol.file.allow=always", "submodule", "add", "-q", gates, "docs/gates");
  r = run(join(superHost, "docs", "gates", "picasso", "checks-vendor.mjs"), []);
  ok("a node_modules at a submodule's root is a shadow of the superproject's install", r.code === 1 && r.out.includes("shadowing node_modules: docs/gates/node_modules"));

  // A hard-linked member is a regular file; the repair must not write through it.
  const hardTool = join(hostRoot, "hard-tool.mjs"), hardJson = join(hostRoot, "hard.json");
  writeFileSync(hardTool, "host-owned\n"); writeFileSync(hardJson, "{}\n");
  rmSync(join(host, "ratchet.mjs")); linkSync(hardTool, join(host, "ratchet.mjs"));
  rmSync(join(host, MANIFEST)); linkSync(hardJson, join(host, MANIFEST));
  r = exp();
  ok("export over a hard-linked member and VENDOR.json replaces both entries and leaves the linked host files alone",
    r.code === 0 && readFileSync(hardTool, "utf8") === "host-owned\n" && readFileSync(hardJson, "utf8") === "{}\n" && run(hostChecker, []).code === 0);
  rmSync(hardTool); rmSync(hardJson);

  rmSync(join(host, MANIFEST));
  r = run(hostChecker, []);
  ok("a deleted VENDOR.json refuses bare (absence is not an escape)", r.code === 1 && r.out.includes(`no ${MANIFEST}`));
}

const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); return i < 0 ? undefined : args[i + 1] ?? ""; };
if (args.includes("--self-test")) selfTest();
else if (args.includes("--probe")) cmdProbe();
else if (flag("--export") !== undefined) cmdExport(flag("--export"));
else if (flag("--freshness") !== undefined) cmdFreshness(flag("--freshness"), flag("--bundle"));
else if (args.length === 0) cmdDrift();
else die("usage: checks-vendor.mjs [--export <dir> | --freshness <picasso-clone> [--bundle <dir>] | --probe | --self-test]");
