#!/usr/bin/env node
/**
 * VENDOR-SYNC — the fence against vendored-tool drift.
 *
 * template/tools/ holds byte-identical copies of picasso's tools, vendored for
 * consumers. The claim "vendored at a pinned upstream commit" (template/README,
 * template/AGENTS.md) is only honest if two things hold, and this gate checks
 * both:
 *   1. every vendored file is byte-identical to its root counterpart — a
 *      tool-law edit that didn't re-vendor is drift the fence refuses;
 *   2. template/VENDOR-PIN records the upstream commit the copy came from
 *      (--stamp rewrites it at re-vendor time; provenance for after-fork copies).
 *
 * Usage:
 *   vendor-sync.mjs               check sync + pin presence
 *   vendor-sync.mjs --stamp       re-stamp the pin at current HEAD
 *   vendor-sync.mjs --self-test
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const pinPath = () => process.env.PICASSO_PIN_PATH || join(ROOT, "template/VENDOR-PIN");

function die(msg) { console.error(`vendor-sync: ${msg}`); process.exit(1); }

export function checkSync({ rootTools, templateTools }) {
  const problems = [];
  const rootFiles = existsSync(rootTools) ? readdirSync(rootTools).filter(f => f.endsWith(".mjs")).sort() : [];
  const vendored = existsSync(templateTools) ? readdirSync(templateTools).filter(f => f.endsWith(".mjs")).sort() : [];
  if (rootFiles.length === 0) problems.push(`no tools found under ${rootTools}`);
  for (const f of rootFiles) {
    if (!vendored.includes(f)) { problems.push(`template/tools/${f} is MISSING — the root tool was never vendored`); continue; }
    if (readFileSync(join(rootTools, f), "utf8") !== readFileSync(join(templateTools, f), "utf8"))
      problems.push(`template/tools/${f} DRIFTED from tools/${f} — a tool-law edit must re-vendor\n  fix: cp tools/${f} template/tools/${f} && node tools/vendor-sync.mjs --stamp`);
  }
  for (const f of vendored)
    if (!rootFiles.includes(f)) problems.push(`template/tools/${f} has no root counterpart — orphaned vendor`);
  return problems;
}

function cmdStamp() {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: ROOT });
  if (sha.status !== 0 || !sha.stdout) die(`cannot resolve HEAD: ${(sha.stdout || "") + (sha.stderr || "")}`);
  const n = readdirSync(join(ROOT, "template/tools")).filter(f => f.endsWith(".mjs")).length;
  writeFileSync(pinPath(), `upstream: ${sha.stdout.trim()}\nvendored: ${new Date().toISOString()}\nfiles: ${n}\n`);
  console.log(`vendor-sync: pin stamped at ${sha.stdout.trim().slice(0, 7)} (${n} files)`);
}

function selfTest() {
  const failures = [];
  const ok = (name, cond) => { if (cond) console.log(`  ok ${name}`); else { failures.push(name); console.log(`  FAIL ${name}`); } };
  console.log("vendor-sync --self-test");

  const dir = mkdtempSync(join(tmpdir(), "picasso-vs-"));
  const mk = (sub, files) => {
    mkdirSync(join(dir, sub), { recursive: true });
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, sub, n), c);
  };
  mk("a", { "one.mjs": "law v1\n", "two.mjs": "law x\n" });
  mk("b", { "one.mjs": "law v1\n", "two.mjs": "law x\n" });
  ok("identical trees pass", checkSync({ rootTools: join(dir, "a"), templateTools: join(dir, "b") }).length === 0);

  mk("c", { "one.mjs": "law v2\n", "two.mjs": "law x\n" });
  ok("a drifted file is refused, named", checkSync({ rootTools: join(dir, "a"), templateTools: join(dir, "c") })
    .some(p => p.includes("one.mjs DRIFTED")));

  mk("d", { "two.mjs": "law x\n" });
  ok("a missing vendored file is refused", checkSync({ rootTools: join(dir, "a"), templateTools: join(dir, "d") })
    .some(p => p.includes("one.mjs is MISSING")));

  mk("e", { "one.mjs": "law v1\n", "two.mjs": "law x\n", "ghost.mjs": "orphan\n" });
  ok("an orphaned vendor file is refused", checkSync({ rootTools: join(dir, "a"), templateTools: join(dir, "e") })
    .some(p => p.includes("ghost.mjs has no root counterpart")));

  ok("empty root tools refused", checkSync({ rootTools: join(dir, "nope"), templateTools: join(dir, "b") }).length > 0);

  // --stamp writes the pin (against the real repo, pin path redirected).
  const SELF = new URL(import.meta.url).pathname;
  const pinTmp = join(dir, "VENDOR-PIN");
  const r = spawnSync("node", [SELF, "--stamp"], { encoding: "utf8", env: { ...process.env, PICASSO_PIN_PATH: pinTmp } });
  const pin = existsSync(pinTmp) ? readFileSync(pinTmp, "utf8") : "";
  ok("--stamp records the real upstream HEAD", r.status === 0 && /^upstream: [0-9a-f]{40}$/m.test(pin) && /files: \d+/.test(pin));

  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `vendor-sync: ${failures.length} self-test failure(s)` : "vendor-sync: self-test clean");
  if (failures.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) selfTest();
else if (args.includes("--stamp")) cmdStamp();
else {
  const problems = checkSync({ rootTools: join(ROOT, "tools"), templateTools: join(ROOT, "template/tools") });
  if (!existsSync(pinPath()))
    problems.push(`template/VENDOR-PIN is missing — the vendored-pin claim needs provenance\n  fix: node tools/vendor-sync.mjs --stamp`);
  if (problems.length) die(problems.join("\n"));
  console.log(`vendor-sync: template/tools in sync; pin ${readFileSync(pinPath(), "utf8").split("\n")[0].replace("upstream: ", "").slice(0, 7)}`);
}
