// derive.mjs — rebuild the derived layers (readable/ + src/ + split-spec.json)
// from the playblacklist capture (PLAN §3/§5). BLACKLIST (playblacklist.com)
// is capture-class: a Unity 6 WebGL game behind a small hand-written site.
// §0.4 fork-over-mirror was checked on 2026-10-12 — neither the page nor any
// captured JS references a public source repo (zero github.com/gitlab.com
// references in the capture; the only repo-shaped strings are backend API
// paths), so the mirror stands.
//
// What is derivable here (Unity build rule — README):
//   * app JS   — the site's own hand-written scripts (js/*.js): sliced.
//   * loader   — game/Build/game.loader.js (Unity's createUnityInstance
//                bootstrap): vendor glue, prettified whole, never sliced.
//   * framework— game/Build/game.framework.js.br, the Unity engine framework,
//                stored browser-decoded upstream under a .br name: vendor,
//                prettified whole, never sliced.
//   * styles   — css/*.css (wholeFile stylesheet sections).
//   * inline   — each captured HTML's inline <script>/<style> blocks get
//                prettified twins + readable/inline-map.json (byte ranges +
//                sha256); index.html and leaderboard/index.html carry the
//                105-byte prelaunch gate.
//   * payloads — game.data/wasm (browser-decoded binary), all *.bundle asset
//                bundles, the images and the two live-endpoint JSON snapshots
//                are hashed notRendered records, never rendered.
// The game logic ships compiled inside game.data/game.wasm — nothing in the
// wasm is decompiled; the reversed layer is the app shell + the Unity glue,
// and that is the honest scope (README records it).
//
// The capture is untouched; every source file is re-hashed against
// .upstream/manifest.json before it is rendered, so a drifted capture fails
// loudly instead of being silently re-derived.
//
// Pipeline:
//   each capture *.js -> pinned prettier 3.9.6 (module API — the CLI respects
//                        .gitignore and can silently echo its input), single
//                        pass, verified idempotent -> readable/<name>.pretty.js
//                        (capture-relative name, nested dirs flattened with __)
//   app scripts        -> statement-aligned slices src/<tag>-NN.js at top-level
//                        declaration boundaries, ~250-350 line windows
//                        (oversized single declarations stay whole), exact
//                        2-line provenance header; every slice is parse-checked
//                        with `node --input-type=module --check -` and
//                        round-trips byte-exact to its readable line range
// usage: node tools/derive.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, "..");
const PINNED = "3.9.6";
const MIN_WINDOW = 250;
const MAX_WINDOW = 350;
const TODAY = "2026-10-13";
const ROOT = ""; // root-served capture: served path == disk rel

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const readLines = (abs) => {
  const t = fs.readFileSync(abs, "utf8");
  const l = t.split("\n");
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
};
const linesOf = (text) => text.replace(/\n$/, "").split("\n");
const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;

// capture-relative name -> tag (dirs flattened with __). The Unity framework is
// stored browser-decoded under a .br name; the .br suffix is not part of the
// readable tag/pretty name.
const tagOf = (capRel) => {
  const rel = capRel.replace(/\.br$/i, "");
  return rel.replace(/\.(js|css)$/i, "").split("/").join("__");
};
const prettyRelFor = (capRel) => {
  const rel = capRel.replace(/\.br$/i, "");
  return "readable/" + tagOf(capRel) + (/\.css$/i.test(rel) ? ".pretty.css" : ".pretty.js");
};

// ── pinned prettier (module API, exactly 3.9.6) ─────────────────────────
async function loadPrettier() {
  const candidates = [
    process.env.PRETTIER_MJS,
    path.join(proj, "node_modules", "prettier", "index.mjs"),
    "D:/repos/mirrors/metropolygonia/node_modules/prettier/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(c), "package.json"), "utf8"));
      if (pkg.version !== PINNED) continue;
      const mod = (await import(pathToFileURL(c).href)).default;
      if (mod.version === PINNED) return { mod, at: c };
    } catch {
      /* try next */
    }
  }
  throw new Error(`pinned prettier ${PINNED} not found (set PRETTIER_MJS to its index.mjs)`);
}

// format to a fixed point (prettier 3.9.6 is not idempotent on every input:
// two of the site scripts settle on the 3rd pass — member-chain line breaking).
// The stored twin is the stable text, and audit re-renders with this same loop,
// so byte-exactness is by construction. Returns { text, passes }.
async function formatStable(prettier, text, parser) {
  let prev = text;
  let out = await prettier.format(prev, { parser });
  let passes = 1;
  while (out !== prev && passes < 6) {
    prev = out;
    out = await prettier.format(prev, { parser });
    passes++;
  }
  if (out !== prev) throw new Error(`prettier ${parser} did not reach a fixed point in 6 passes`);
  return { text: out, passes };
}

// ── parse check: the exact standalone gate (ESM stdin) ──────────────────
function parses(text) {
  const r = spawnSync(process.execPath, ["--input-type=module", "--check", "-"], {
    input: text,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, why: (r.stderr || "").trim().split("\n").slice(-3).join(" | ") };
}

// ── markers for titles (top tokens, lowercase; fleet convention) ────────
const STOP = new Set(
  ("function return typeof undefined object string number boolean prototype length value default " +
    "exports import this that with from then else case break continue delete instanceof constructor " +
    "arguments void null true false call apply name type text target window document globalthis self " +
    "require module async await yield static class const let var new for while switch throw try catch " +
    "finally extends super using debugger of in do if has own hasown get set")
    .split(" ")
    .filter(Boolean),
);
function markers(text, n = 2) {
  // URLs/identifiers living inside string literals (paths, asset names) are
  // not code tokens — strip quoted strings before counting
  const code = text.replace(/`[^`]*`|"[^"\n]*"|'[^'\n]*'/g, " ");
  const counts = new Map();
  for (const m of code.matchAll(/[A-Za-z][A-Za-z0-9_]{2,}/g)) {
    const w = m[0].toLowerCase();
    if (STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}
const markerText = (ms) => ms.map(([w, c]) => `${w}(${c})`).join(", ");

// ── windowize: cut only at statement starts; ≤350 lines, a single ───────
// ── oversized declaration is a window of its own ────────────────────────
function windowize(stmts) {
  const out = [];
  let cur = null;
  for (const s of stmts) {
    if (!cur) {
      cur = { first: s, last: s, count: 1, startLine: s.startLine, endLine: s.endLine };
      continue;
    }
    const projected = s.endLine - cur.startLine + 1;
    if (projected > MAX_WINDOW) {
      out.push(cur);
      cur = { first: s, last: s, count: 1, startLine: s.startLine, endLine: s.endLine };
    } else {
      cur.last = s;
      cur.count++;
      cur.endLine = s.endLine;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ── inline block scan (byte-exact, over the raw HTML buffer) ────────────
function scanBlocks(buf) {
  const blocks = [];
  for (const [open, close, kind] of [
    ["<script", "</script", "script"],
    ["<style", "</style", "style"],
  ]) {
    let p = 0;
    let n = 0;
    while (true) {
      const i = buf.indexOf(open, p);
      if (i < 0) break;
      const after = buf[i + open.length];
      const boundary =
        after === 0x3e || after === 0x2f || after === 0x20 || after === 0x09 || after === 0x0a || after === 0x0d;
      if (!boundary) {
        p = i + open.length;
        continue;
      }
      const tagEnd = buf.indexOf(">", i);
      if (tagEnd < 0) break;
      const j = buf.indexOf(close, tagEnd + 1);
      if (j < 0) throw new Error(`unterminated <${kind}> opened at byte ${i}`);
      const tag = buf.subarray(i, tagEnd + 1).toString("utf8");
      const external = /\bsrc\s*=\s*["']/i.test(tag);
      if (external) {
        blocks.push({ kind, external: true, tag, openStart: i });
      } else {
        n++;
        const content = buf.subarray(tagEnd + 1, j);
        blocks.push({
          kind: /\btype\s*=\s*["']importmap["']/i.test(tag) ? "importmap" : kind,
          external: false,
          block: n,
          tag,
          openStart: i,
          contentStart: tagEnd + 1,
          contentEnd: j,
          bytes: content.length,
          sha256: sha256(content),
          text: content.toString("utf8"),
        });
      }
      p = j + close.length;
    }
  }
  return blocks.sort((a, b) => a.openStart - b.openStart);
}

// ── curated content-anchored classification (guards fail loudly) ────────
// Unity build rule (README): the loader and the engine framework are vendor
// glue shipped by the Unity build — indexed whole in readable/, never sliced.
const VENDOR_GUARDS = {
  "game__Build__game.loader": [/createUnityInstance/, /UnityWebData1\.0/],
  "game__Build__game.framework": [/unityFramework/, /WebAssembly/],
};
function vendorClass(rel, tag) {
  const guards = VENDOR_GUARDS[tag] || null;
  let what;
  if (rel === "game/Build/game.loader.js") what = "Unity 6 WebGL loader — createUnityInstance bootstrap (generated by the Unity build)";
  else if (rel === "game/Build/game.framework.js.br") what = "Unity 6 WebGL engine framework — emscripten runtime + engine glue (stored browser-decoded under a .br name)";
  else what = `third-party library ${rel} (vendor)`;
  return {
    title: `${tag} — ${what} (whole-file, never sliced)`,
    desc:
      `Third-party code captured byte-exact from the origin (${what}) — Unity build rule: indexed whole-file ` +
      `in readable/, never sliced or rewritten.`,
    guard: guards ? (t) => guards.every((re) => re.test(t)) : null,
    guardWhy: guards ? guards.map(String).join(" + ") : null,
    what,
  };
}

const isVendor = (rel) => /^game\/Build\//.test(rel);
const isDerivable = (rel) => /\.(js)$/i.test(rel) || /^game\/Build\/.*\.js\.br$/i.test(rel) || /\.css$/i.test(rel);

async function main() {
  const { mod: prettier, at } = await loadPrettier();
  console.log(`pinned prettier ${PINNED} (${at})`);

  const manifest = JSON.parse(fs.readFileSync(path.join(proj, ".upstream", "manifest.json"), "utf8"));
  const captured = Object.keys(manifest.files).map((r) => r.split(path.sep).join("/")).sort();
  const captureBytes = (rel) => {
    const abs = path.join(proj, rel);
    if (!fs.existsSync(abs)) throw new Error(`capture file missing: ${rel}`);
    const buf = fs.readFileSync(abs);
    if (sha256(buf) !== manifest.files[rel].sha256)
      throw new Error(`${rel} on disk does not match .upstream/manifest.json — re-verify the capture first`);
    return buf;
  };

  const readableDir = path.join(proj, "readable");
  const srcDir = path.join(proj, "src");
  fs.mkdirSync(readableDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });
  const written = { readable: new Set(), src: new Set() };

  const sources = [];
  const sections = [];
  const notRendered = [];
  const inlineFiles = [];
  let slicedTotal = 0;

  const jsRelsAll = captured.filter((r) => /\.js$/i.test(r) || /^game\/Build\/.*\.js\.br$/i.test(r));
  const cssRels = captured.filter((r) => /\.css$/i.test(r));
  const htmlRels = captured.filter((r) => /\.html$/i.test(r));
  // reading order: the site shell first, then the Unity loader and framework
  const rank = (rel) => (/^js\//.test(rel) ? 0 : /game\.loader\.js$/.test(rel) ? 1 : 2);
  const jsRels = jsRelsAll.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  // non-code payloads ride along in the manifest but are never rendered
  for (const rel of captured) {
    if (isDerivable(rel) || /\.html$/i.test(rel)) continue;
    const buf = captureBytes(rel);
    notRendered.push({
      capture: rel,
      kind: /\.(json)$/i.test(rel) || rel === "api/build" || rel === "api/launch" ? "data" : /^img\//.test(rel) ? "image" : "payload",
      bytes: buf.length,
      sha256: sha256(buf),
      rendered: false,
      reason: "non-code payload — recorded with bytes + sha256, no pretty/slice pass",
    });
  }

  // ── 1) JS: vendor -> wholeFile; app -> statement-aligned slices ─────────
  for (const rel of jsRels) {
    const buf = captureBytes(rel);
    const text = buf.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buf)) throw new Error(`${rel} does not round-trip through utf8`);
    const { text: pretty, passes } = await formatStable(prettier, text, "babel");
    if (pretty === text)
      throw new Error(`${rel}: prettier output is byte-identical to the capture — nothing to derive`);
    const sourceFile = prettyRelFor(rel);
    fs.writeFileSync(path.join(proj, sourceFile), pretty);
    written.readable.add(path.basename(sourceFile));
    const lines = linesOf(pretty);
    const tag = tagOf(rel);

    if (isVendor(rel)) {
      const cls = vendorClass(rel, tag);
      if (cls.guard && !cls.guard(pretty))
        throw new Error(`${rel}: whole-file guard failed (${cls.guardWhy}) — readable changed shape`);
      sections.push({
        file: `${tag}-vendor.js`,
        wholeFile: true,
        title: cls.title,
        desc: `Lines 1-${lines.length} of ${sourceFile}: ${cls.desc}`,
        note: "whole-file (Unity build rule): indexed in readable/, never sliced",
        startLine: 1,
        endLine: lines.length,
        sourceFile,
      });
      sources.push({
        sourceFile,
        capture: rel,
        captureKind: "file",
        captureSha256: manifest.files[rel].sha256,
        captureBytes: buf.length,
        prettyLines: lines.length,
        prettyBytes: Buffer.byteLength(pretty, "utf8"),
        prettyPasses: passes,
        idempotent: true,
        tag,
        slices: 0,
        derived: "readable only (Unity glue, wholeFile)",
        what: cls.what,
      });
      console.log(`derive: ${rel} -> ${sourceFile} (${lines.length} lines, wholeFile vendor)`);
      continue;
    }

    // ── app script: statement-aligned slicing ───────────────────────────
    const dbg = await prettier.__debug.parse(pretty, { parser: "babel" });
    const top = (dbg.ast.program || dbg.ast).body;
    const stmts = top.map((n) => ({
      node: n,
      startLine: lineOf(pretty, n.start),
      endLine: lineOf(pretty, n.end),
      text: pretty.slice(n.start, n.end),
    }));
    for (let i = 1; i < stmts.length; i++)
      if (stmts[i].startLine <= stmts[i - 1].endLine)
        throw new Error(`${rel}: statements ${i - 1}/${i} share a line — cannot slice at line boundaries`);

    const slices = [];
    for (const w of windowize(stmts))
      slices.push({ kind: "slice", A: w.startLine, B: w.endLine, count: w.count });
    const blocks = [...slices];
    blocks.sort((a, b) => a.A - b.A);
    for (let i = 0; i < blocks.length; i++) {
      if (i === 0) blocks[i].A = 1;
      if (i + 1 < blocks.length) blocks[i].B = blocks[i + 1].A - 1;
      else blocks[i].B = lines.length;
    }

    let nn = 0;
    for (const b of blocks) {
      nn++;
      const num = String(nn).padStart(2, "0");
      const body = lines.slice(b.A - 1, b.B).join("\n") + "\n";
      const ms = markers(body);
      const topWord = ms.length ? ms[0][0] : tag.toLowerCase();
      const oversized = b.count === 1 && b.B - b.A + 1 > MAX_WINDOW;
      const file = `${tag}-${num}.js`;
      const sliceText =
        `// ${tag} ${num} — ${topWord}\n` +
        `// Lines ${b.A}-${b.B} of ${sourceFile} (statement-aligned).\n` +
        body;
      const chk = parses(sliceText);
      if (!chk.ok) throw new Error(`generated src/${file} does not parse standalone: ${chk.why}`);
      fs.writeFileSync(path.join(srcDir, file), sliceText);
      written.src.add(file);
      sections.push({
        file,
        title: `${tag} ${num} — ${topWord}`,
        desc: `${oversized ? "Oversized single declaration (kept whole). " : ""}Lines ${b.A}-${b.B}. Markers: ${markerText(ms)}.`,
        startLine: b.A,
        endLine: b.B,
        sourceFile,
      });
    }
    slicedTotal += nn;
    sources.push({
      sourceFile,
      capture: rel,
      captureKind: "file",
      captureSha256: manifest.files[rel].sha256,
      captureBytes: buf.length,
      prettyLines: lines.length,
      prettyBytes: Buffer.byteLength(pretty, "utf8"),
      prettyPasses: passes,
      idempotent: true,
      tag,
      slices: nn,
      derived: `readable + ${nn} statement-aligned slice(s)`,
    });
    console.log(`derive: ${rel} -> ${sourceFile} (${lines.length} lines, ${nn} slices)`);
  }

  // ── 2) CSS: readable pretty, wholeFile section (stylesheet rule) ────────
  for (const rel of cssRels) {
    const buf = captureBytes(rel);
    const text = buf.toString("utf8");
    const { text: pretty, passes } = await formatStable(prettier, text, "css");
    if (pretty === text) throw new Error(`${rel}: prettier output is byte-identical to the capture`);
    const sourceFile = prettyRelFor(rel);
    fs.writeFileSync(path.join(proj, sourceFile), pretty);
    written.readable.add(path.basename(sourceFile));
    const lines = linesOf(pretty);
    const tag = tagOf(rel);
    sections.push({
      file: `${tag}.css`,
      wholeFile: true,
      title: `${tag} — stylesheet (whole-file, never sliced)`,
      desc: `Lines 1-${lines.length} of ${sourceFile}. Whole-file (stylesheet rule): the capture stylesheet is indexed whole in readable/, never sliced.`,
      note: "whole-file (stylesheet, not sliced): CSS is indexed whole in readable/",
      startLine: 1,
      endLine: lines.length,
      sourceFile,
    });
    sources.push({
      sourceFile,
      capture: rel,
      captureKind: "file",
      captureSha256: manifest.files[rel].sha256,
      captureBytes: buf.length,
      prettyLines: lines.length,
      prettyBytes: Buffer.byteLength(pretty, "utf8"),
      prettyPasses: passes,
      idempotent: true,
      tag,
      slices: 0,
      derived: "readable only (stylesheet, wholeFile)",
    });
    console.log(`derive: ${rel} -> ${sourceFile} (${lines.length} lines, wholeFile stylesheet)`);
  }

  // ── 3) HTML: inline <script>/<style> scan + twins ──────────────────────
  const inlineMap = { sources: [], generated: TODAY, note: "", blocks: [] };
  for (const rel of htmlRels) {
    const buf = captureBytes(rel);
    const blocks = scanBlocks(buf);
    const inline = blocks.filter((b) => !b.external);
    const external = blocks.filter((b) => b.external);
    inlineFiles.push(rel);
    for (const b of external) console.log(`derive: ${rel}: external ${b.kind} (not derived): ${b.tag.slice(0, 90)}`);
    if (!inline.length) {
      console.log(`derive: ${rel}: no inline <script>/<style> content blocks — no inline twins`);
      continue;
    }
    inlineMap.sources.push(rel);
    const entryTag = rel.replace(/\.html$/i, "").split("/").join("__");
    for (const b of inline) {
      const isImportmap = b.kind === "importmap";
      const parser = isImportmap ? "json" : b.kind === "style" ? "css" : "babel";
      const DATA_TYPES = new Set(["application/ld+json", "application/json", "importmap", "speculationrules"]);
      const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(b.tag)?.[1] ?? "").toLowerCase();
      if (b.kind === "script" && DATA_TYPES.has(type)) {
        notRendered.push({
          capture: rel,
          kind: "inline-data",
          type,
          byteStart: b.contentStart,
          byteEnd: b.contentEnd,
          bytes: b.bytes,
          sha256: b.sha256,
          rendered: false,
          reason: `typed data block (<script type="${type}">) — data, not JS/CSS; recorded with range + sha256, no pretty pass`,
        });
        continue;
      }
      const tag = `${entryTag}-inline-${b.block}`;
      const twinExt = isImportmap ? "json" : b.kind === "style" ? "css" : "js";
      const prettyFile = `${tag}.pretty.${twinExt}`;
      const { text: pretty, passes } = await formatStable(prettier, b.text, parser);
      if (pretty === b.text) throw new Error(`readable/${prettyFile} would be byte-identical to its capture source`);
      fs.writeFileSync(path.join(readableDir, prettyFile), pretty);
      written.readable.add(prettyFile);
      const lines = linesOf(pretty);
      const prettyBuf = Buffer.from(pretty, "utf8");
      sections.push({
        file: `${tag}.${twinExt}`,
        wholeFile: true,
        title: `${tag} — inline ${b.kind} block (whole-file, never sliced)`,
        desc: `Lines 1-${lines.length} of readable/${prettyFile}. Whole-file: the document's inline ${b.kind} block (${b.bytes} B at bytes ${b.contentStart}-${b.contentEnd} of ${rel}) is indexed whole and never sliced.`,
        note: `whole-file (inline ${b.kind} block, not sliced)`,
        startLine: 1,
        endLine: lines.length,
        sourceFile: `readable/${prettyFile}`,
      });
      inlineMap.blocks.push({
        file: `readable/${prettyFile}`,
        source: rel,
        section: `${tag}.${twinExt}`,
        kind: b.kind,
        block: b.block,
        byteStart: b.contentStart,
        byteEnd: b.contentEnd,
        bytes: b.bytes,
        sha256: b.sha256,
      });
      sources.push({
        sourceFile: `readable/${prettyFile}`,
        capture: rel,
        captureKind: `inline-${b.kind}`,
        captureByteStart: b.contentStart,
        captureByteEnd: b.contentEnd,
        captureSha256: b.sha256,
        captureBytes: b.bytes,
        prettyLines: lines.length,
        prettyBytes: prettyBuf.length,
        prettySha256: sha256(prettyBuf),
        prettyPasses: passes,
        idempotent: true,
        tag,
        slices: 0,
        derived: "readable only (inline block, wholeFile)",
      });
      console.log(`derive: ${rel}: inline ${b.kind} #${b.block} -> readable/${prettyFile} (${lines.length} lines)`);
    }
  }
  if (inlineMap.blocks.length) {
    inlineMap.note =
      "byte ranges + sha256 of every inline <script>/<style> content block in the captured HTML documents; " +
      "twins are the prettified (prettier 3.9.6, module API) renderings and are never shipped to a browser.";
    fs.writeFileSync(path.join(readableDir, "inline-map.json"), JSON.stringify(inlineMap, null, 2) + "\n");
  }

  // ── 4) prune orphan derived files (capture untouched) ──────────────────
  let pruned = 0;
  const keepReadable = new Set([...written.readable, "inline-map.json"]);
  for (const f of fs.readdirSync(readableDir)) {
    if ((/\.pretty\.(js|css)$/i.test(f) || f === "inline-map.json") && !keepReadable.has(f)) {
      fs.rmSync(path.join(readableDir, f));
      pruned++;
      console.log(`derive: pruned orphan derived file readable/${f}`);
    }
  }
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith(".js") || written.src.has(f)) continue;
    fs.rmSync(path.join(srcDir, f));
    pruned++;
    console.log(`derive: pruned orphan derived file src/${f}`);
  }

  // ── 5) split-spec.json (2-space indent + trailing newline) ─────────────
  const appJs = sources.filter((s) => s.derived.startsWith("readable +"));
  const vendorJsS = sources.filter((s) => /wholeFile\)$/.test(s.derived) && s.capture.endsWith(".js"));
  const cssSources = sources.filter((s) => s.sourceFile.endsWith(".pretty.css") && s.capture.endsWith(".css"));
  const firstSlice = sections.find((s) => !s.wholeFile && !s.skipped);
  const spec = {
    project: "playblacklist",
    kind: "statement-aligned-slices",
    defaultFile: `src/${firstSlice ? firstSlice.file : ""}`,
    note:
      "BLACKLIST (https://playblacklist.com/) is capture-class: a Unity 6 WebGL game (loader/data/framework/wasm " +
      "plus StreamingAssets asset bundles) behind a small hand-written site (js/*.js, css/*.css). §0.4 " +
      "fork-over-mirror was checked on 2026-10-13 — neither the page nor any captured JS references a public " +
      "source repo (zero github.com/gitlab.com references in the capture; the repo-shaped strings are backend API " +
      "paths only), so the mirror stands. Derived pipeline: capture → pinned prettier 3.9.6 (module API, default " +
      "options, formatted to a fixed point — ≤6 passes, prettier 3.9.6 is not idempotent on every input and two " +
      "site scripts settle on the 3rd pass; never the CLI: it respects .gitignore and can silently echo its " +
      "input) → readable/<name>.pretty.js per captured JS file (capture-relative name, nested dirs flattened with " +
      "__; every pretty provably NOT byte-identical to its capture source) → statement-aligned slices " +
      "src/<name>-NN.js of every APP script (top-level declaration boundaries only, ~250-350 line windows; " +
      "oversized single declarations stay whole) with an exact 2-line provenance header. Every slice parses " +
      "standalone under `node --input-type=module --check -` and round-trips byte-exact to its recorded readable " +
      "line range. Unity build rule (README): the Unity loader (game/Build/game.loader.js) and the Unity engine " +
      "framework (game/Build/game.framework.js.br, stored browser-decoded under a .br name) are vendor glue — " +
      "wholeFile sections, never sliced; the game logic ships compiled inside game.data.br/game.wasm.br and all " +
      "asset bundles, which are hashed notRendered records, never rendered. Inline <script>/<style> scan: " +
      "index.html and leaderboard/index.html carry the 105-byte prelaunch gate — twins " +
      "readable/<page>-inline-N.pretty.js + readable/inline-map.json with byte ranges + sha256. Capture bytes " +
      "are untouched by everything above; re-cut with `node tools/derive.mjs` after any capture refresh. " +
      "`node tools/audit.js` is the gate.",
    renderOptions: {
      _default:
        "prettier 3.9.6, module API, default options, formatted to a fixed point (≤6 passes; prettier 3.9.6 is not idempotent on every input — js/leaderboard.js and js/account.js settle on the 3rd pass) — never the CLI: it respects .gitignore and can silently echo its input",
      js: "parser babel, no plugins",
      css: "parser css, no plugins",
    },
    source:
      `readable/: ${sources.filter((s) => s.sourceFile?.endsWith(".pretty.js")).length} JS pretties ` +
      `(${appJs.length} app script(s) sliced, ${vendorJsS.length} Unity glue wholeFile) + ` +
      `${cssSources.length} CSS pretties + ${inlineMap.blocks.length} inline twin(s); ` +
      `src/: ${appJs.reduce((n, s) => n + s.slices, 0)} statement-aligned slices across ${appJs.length} app script(s); ` +
      `${sections.filter((s) => s.wholeFile).length} wholeFile section(s); ` +
      `capture: ${captured.length} files under .upstream/manifest.json; inline scan: ${inlineFiles.length} document(s) ` +
      `(${inlineMap.blocks.length} inline content block(s)); notRendered: ${notRendered.length} payload(s).`,
    inline: {
      scanned: inlineFiles,
      contentBlocks: inlineMap.blocks.length,
      notRendered: notRendered.length,
      note: inlineMap.blocks.length
        ? "index.html and leaderboard/index.html carry the 105-byte prelaunch gate inline <script> — both " +
          "prettified into readable/<page>-inline-N.pretty.js twins and recorded in readable/inline-map.json."
        : "no inline <script>/<style> content blocks in the captured documents.",
    },
    sources,
    sections,
    notRendered,
  };
  fs.writeFileSync(path.join(proj, "split-spec.json"), JSON.stringify(spec, null, 2) + "\n");

  // ── 6) self-check (tools/audit.js is the authoritative gate) ────────────
  let bad = 0;
  const bySource = new Map();
  for (const s of sections) {
    if (!bySource.has(s.sourceFile)) bySource.set(s.sourceFile, []);
    bySource.get(s.sourceFile).push(s);
  }
  for (const [sourceFile, list] of bySource) {
    const lines = readLines(path.join(proj, sourceFile));
    const sorted = [...list].sort((a, b) => a.startLine - b.startLine);
    if (sorted[0].startLine !== 1) {
      console.error(`TILING FAIL ${sourceFile}: starts at line ${sorted[0].startLine}`);
      bad++;
    }
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i].startLine !== sorted[i - 1].endLine + 1) {
        console.error(`TILING FAIL ${sourceFile}: gap/overlap at ${sorted[i].file}`);
        bad++;
      }
    if (sorted[sorted.length - 1].endLine !== lines.length) {
      console.error(`TILING FAIL ${sourceFile}: does not reach EOF (${lines.length})`);
      bad++;
    }
  }
  let parsed = 0;
  let ranged = 0;
  let roundOK = 0;
  for (const s of sections) {
    if (s.wholeFile || s.skipped) continue;
    ranged++;
    const abs = path.join(srcDir, s.file);
    const text = fs.readFileSync(abs, "utf8");
    const nl2 = text.indexOf("\n", text.indexOf("\n") + 1);
    const body = text.slice(nl2 + 1);
    const expected = readLines(path.join(proj, s.sourceFile)).slice(s.startLine - 1, s.endLine).join("\n") + "\n";
    if (body !== expected) {
      console.error(`ROUND-TRIP FAIL ${s.file}`);
      bad++;
    } else roundOK++;
    if (!parses(text).ok) {
      console.error(`PARSE FAIL src/${s.file}`);
      bad++;
    } else parsed++;
  }
  let prettyParsed = 0;
  for (const s of sources) {
    if (!s.sourceFile?.endsWith(".pretty.js")) continue;
    if (!parses(fs.readFileSync(path.join(proj, s.sourceFile), "utf8")).ok) {
      console.error(`PARSE FAIL ${s.sourceFile}`);
      bad++;
    } else prettyParsed++;
  }
  console.log(
    `derive: ${written.readable.size} readable file(s), ${written.src.size} src slices ` +
      `(${parsed}/${ranged} parse standalone, ${roundOK}/${ranged} round-trip byte-exact), ` +
      `${sections.filter((s) => s.wholeFile).length} wholeFile, ` +
      `${prettyParsed} pretty js parse clean, ${notRendered.length} notRendered, ${pruned} orphan(s) pruned — ` +
      `self-check ${bad ? bad + " FAILURE(S)" : "clean"}`,
  );
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
