// update.mjs — read-only drift probe: re-fetch the live entry and every
// captured file, compare against .upstream/manifest.json. Never rewrites
// the capture.
// usage: node tools/update.mjs [--json]
//
// Notes for this host (hcdn / Hostinger):
//   - /game/** is hotlink-protected: requests without a browser User-Agent and
//     a Referer get HTTP 403, so both headers are sent.
//   - The Unity *.br payloads are stored browser-decoded upstream (identity),
//     names aside; fetch() auto-decodes any transfer encoding, so comparisons
//     are against the decoded bytes the client consumes.
//   - Route pages are captured as <route>/index.html and the origin does not
//     serve the /index.html form (404) — the probe falls back to the bare
//     route before calling a page changed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, "..");
const ORIGIN = "https://playblacklist.com";
const ENTRY = "index.html";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: ORIGIN + "/play",
};
const MAX_PROBES = 800;

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
async function getBuf(url) {
  const r = await fetch(url, { headers: UA });
  return { status: r.status, buf: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
}

// The /play page HTML embeds a per-request CSP nonce (`<script nonce="…">`);
// normalize it — everything else must be byte-identical.
const normalize = (s) => s.replace(/ nonce="[^"]*"/g, "").replace(/\bnonce\s*=\s*"[^"]*"/g, "");

const manifest = JSON.parse(fs.readFileSync(path.join(proj, ".upstream", "manifest.json"), "utf8"));

const live = {};
// Root-served capture: the entry document is what the origin serves at "/" too.
const entryUrl = ORIGIN + "/" + ENTRY;
const entry = await getBuf(entryUrl);
if (entry.status !== 200) {
  console.error(`live entry ${entryUrl} -> HTTP ${entry.status}`);
  process.exit(2);
}
live[ENTRY] = { bytes: entry.buf.length, sha256: sha(entry.buf), buf: entry.buf };

// Probe every captured file directly — the manifest is the authoritative
// closure, so this covers deep imports an entry-document scan would miss.
const rels = Object.keys(manifest.files)
  .filter((r) => r !== ENTRY)
  .sort()
  .slice(0, MAX_PROBES);
for (const rel of rels) {
  let r = await getBuf(ORIGIN + "/" + rel);
  // Route captured as <route>/index.html: the origin serves the bare route.
  if (r.status !== 200 && rel.endsWith("/index.html")) r = await getBuf(ORIGIN + "/" + rel.slice(0, -"/index.html".length));
  if (r.status === 200 && !live[rel]) live[rel] = { bytes: r.buf.length, sha256: sha(r.buf), buf: r.buf };
}

const rows = [];
for (const [n, m] of Object.entries(manifest.files).sort()) {
  const l = live[n];
  if (!l) {
    rows.push({ file: n, state: "live-missing" });
    continue;
  }
  if (m.dynamic) continue; // live endpoint snapshot: upstream presence is the only stable signal
  if (n.endsWith(".html")) {
    const cap = path.join(proj, n);
    if (!fs.existsSync(cap)) continue;
    const a = normalize((l.buf ?? Buffer.alloc(0)).toString("utf8"));
    const b = normalize(fs.readFileSync(cap, "utf8"));
    if (a !== b) rows.push({ file: n, state: "changed" });
  } else if (m.sha256 !== l.sha256) {
    rows.push({ file: n, state: "changed", mirror: m.sha256.slice(0, 12), live: l.sha256.slice(0, 12) });
  }
}
const changed = rows.filter((r) => r.state === "changed").length;
const missing = rows.filter((r) => r.state === "live-missing").length;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ origin: ORIGIN, checked: Object.keys(manifest.files).length, changed, missing, rows }, null, 2));
} else if (!rows.length) {
  console.log(`up to date: ${Object.keys(manifest.files).length} captured files identical upstream`);
} else {
  console.log(`DRIFT: ${changed} changed, ${missing} live-missing (of ${Object.keys(manifest.files).length} captured)`);
  for (const r of rows.slice(0, 40)) console.log(`  ${r.state.padEnd(14)} ${r.file}`);
  process.exit(1);
}
