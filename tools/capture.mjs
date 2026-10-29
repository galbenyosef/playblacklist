// capture.mjs — byte-exact capture of playblacklist.com ("Blacklist - Tactical
// multiplayer FPS", Unity 6 WebGL build on a hcdn/Hostinger host).
//
// usage: node tools/capture.mjs [--out <dir>]
//
// Closure method (PLAN §4), iterated to fixpoint:
//   1. site pages + their static files (HTML/CSS/JS/images), /api/build and
//      /api/launch captured as static JSON snapshots (the only way a static
//      server can reproduce them; both are marked `dynamic` in the manifest),
//   2. the Unity build the /api/build descriptor names (loader/data/framework/
//      wasm — the origin serves the *.br payloads browser-decoded, so the
//      capture holds the plain streams; see README),
//   3. StreamingAssets: maps.json (deployed map scene bundles) + the weapons
//      index bundle's AssetBundleManifest (all 131 weapon bundle names,
//      parsed once with UnityPy — see WEAPON_BUNDLES below),
//   4. a scan round over every captured text file for root-relative refs,
//      fetching referenced-but-missing files until a round finds none,
//   5. rank icon probe img/ranks/rank_01.svg .. rank_200.svg (the template
//      literal in js/site.js + js/nav.js cannot be enumerated statically).
// Cross-checked against the live browser network log while booting the game
// (boot -> guest -> lobby -> match -> gameplay): every request the client
// makes is one of the captured files.
//
// The capture layer is byte-exact; this script never rewrites it afterwards.
// A refresh re-runs it into a clean tree (PLAN §3: legacy/<date>/ first).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = process.argv.includes("--out")
  ? path.resolve(process.argv[process.argv.indexOf("--out") + 1])
  : path.resolve(here, "..");

const ORIGIN = "https://playblacklist.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // hcdn hotlink-protects /game/**: requests without a browser UA/Referer get
  // HTTP 403 with a compressed error page.
  Referer: ORIGIN + "/play",
  Accept: "*/*",
};

// Pages are routes on the origin, captured as <route>/index.html so a static
// server with directory-index support reproduces the served URLs.
const SITE = [
  { url: "/", disk: "index.html" },
  { url: "/play", disk: "play/index.html" },
  { url: "/about", disk: "about/index.html" },
  { url: "/leaderboard", disk: "leaderboard/index.html" },
  { url: "/account", disk: "account/index.html" },
  // dynamic endpoint snapshots (static servers cannot run them; shape stable)
  { url: "/api/build", disk: "api/build", dynamic: true },
  { url: "/api/launch", disk: "api/launch", dynamic: true },
  { url: "/favicon.svg", disk: "favicon.svg" },
  { url: "/css/site.css?v=20261009a", disk: "css/site.css" },
  { url: "/css/play.css?v=20261007b", disk: "css/play.css" },
  { url: "/js/site.js?v=20261007b", disk: "js/site.js" },
  { url: "/js/launch.js?v=20261007b", disk: "js/launch.js" },
  { url: "/js/nav.js?v=20261008a", disk: "js/nav.js" },
  { url: "/js/play.js?v=20261007b", disk: "js/play.js" },
  { url: "/js/ads.js?v=20261009a", disk: "js/ads.js" },
  { url: "/js/leaderboard.js?v=20261008b", disk: "js/leaderboard.js" },
  { url: "/js/account.js?v=20261008a", disk: "js/account.js" },
  { url: "/img/hero-squad.webp", disk: "img/hero-squad.webp" },
  { url: "/img/community-leader-1200.jpg", disk: "img/community-leader-1200.jpg" },
  { url: "/img/community-leader.jpg", disk: "img/community-leader.jpg" },
  { url: "/img/backdrop.jpg", disk: "img/backdrop.jpg" },
];

const ARSENAL = [
  "combat44.png", "fireaxe-gold.png", "m249-acid.png", "m32-urban.png",
  "m4a1.png", "m700-galaxy.png", "m870.png", "mac11-hazard.png",
  "mk16.png", "mp5n-urban.png",
];
const MAPS = [
  "ancient.jpg", "forge.jpg", "greywoot.jpg", "hangar.jpg",
  "orbital.jpg", "shipment.jpg", "urban-warfare.jpg", "zook.jpg",
];

// The Unity build files, as named by /api/build (captured first, then expanded).
const BUILD_FILES = ["loaderUrl", "dataUrl", "frameworkUrl", "codeUrl"];

// All weapon bundle names, read from the AssetBundleManifest inside
// /game/StreamingAssets/Bundles/weapons/weapons with UnityPy (2026-10-29).
// The client resolves weapons through that manifest, so this is the full
// weapon closure; refresh by re-parsing the manifest if the index changes.
const WEAPON_BUNDLES = [
  "w1_0.bundle", "w1_1.bundle", "w1_10.bundle", "w1_11.bundle", "w1_12.bundle", "w1_13.bundle",
  "w1_14.bundle", "w1_15.bundle", "w1_16.bundle", "w1_17.bundle", "w1_18.bundle", "w1_19.bundle",
  "w1_2.bundle", "w1_20.bundle", "w1_3.bundle", "w1_4.bundle", "w1_5.bundle", "w1_6.bundle",
  "w1_7.bundle", "w1_8.bundle", "w1_9.bundle", "w2_0.bundle", "w2_13.bundle", "w2_14.bundle",
  "w2_15.bundle", "w2_16.bundle", "w2_17.bundle", "w3_0.bundle", "w3_1.bundle", "w3_12.bundle", "w3_13.bundle",
  "w3_14.bundle", "w3_15.bundle", "w3_16.bundle", "w3_17.bundle", "w3_18.bundle", "w3_19.bundle",
  "w3_20.bundle", "w3_21.bundle", "w3_22.bundle", "w3_23.bundle", "w3_24.bundle", "w3_25.bundle",
  "w3_26.bundle", "w3_27.bundle", "w3_28.bundle", "w3_29.bundle", "w3_3.bundle", "w3_30.bundle",
  "w3_31.bundle", "w3_33.bundle", "w3_34.bundle", "w3_36.bundle", "w3_37.bundle", "w3_38.bundle",
  "w3_39.bundle", "w3_4.bundle", "w3_40.bundle", "w3_41.bundle", "w3_42.bundle", "w3_43.bundle",
  "w3_48.bundle", "w3_5.bundle", "w3_8.bundle", "w4_0.bundle", "w4_1.bundle", "w4_100.bundle",
  "w4_102.bundle", "w4_103.bundle", "w4_104.bundle", "w4_105.bundle", "w4_106.bundle", "w4_107.bundle",
  "w4_13.bundle", "w4_2.bundle", "w4_20.bundle", "w4_25.bundle", "w4_26.bundle", "w4_27.bundle",
  "w4_28.bundle", "w4_29.bundle", "w4_3.bundle", "w4_32.bundle", "w4_33.bundle", "w4_34.bundle",
  "w4_35.bundle", "w4_36.bundle", "w4_37.bundle", "w4_38.bundle", "w4_39.bundle", "w4_4.bundle",
  "w4_5.bundle", "w4_6.bundle", "w4_65.bundle", "w4_66.bundle", "w4_67.bundle", "w4_68.bundle",
  "w4_69.bundle", "w4_70.bundle", "w4_71.bundle", "w4_72.bundle", "w4_73.bundle", "w4_74.bundle",
  "w4_76.bundle", "w4_77.bundle", "w4_78.bundle", "w4_79.bundle", "w4_80.bundle", "w4_81.bundle",
  "w4_82.bundle", "w4_83.bundle", "w4_84.bundle", "w4_86.bundle", "w4_87.bundle", "w4_88.bundle",
  "w4_89.bundle", "w4_94.bundle", "w4_95.bundle", "w4_96.bundle", "w4_97.bundle", "w4_98.bundle",
  "w5_0.bundle", "w5_1.bundle", "w5_15.bundle", "w5_16.bundle", "w5_17.bundle", "w5_18.bundle",
  "w5_19.bundle", "w5_21.bundle", "w5_22.bundle", "w5_23.bundle", "w5_24.bundle", "w5_25.bundle",
  "w5_7.bundle", "weapons_common.bundle",
];

// Sanity hashes for the biggest payloads, taken independently (curl, identity
// encoding = browser-decoded bytes). The capture must reproduce them exactly.
const EXPECT = {
  "game/Build/game.data.br": "be379da6cccdde1aaa747d81b1134959a08c4185d955a808a504ed67a92feb48",
  "game/Build/game.wasm.br": "2aad7a308edd1392f99df516ce02616996ab14b58719b4633c71888f0dd4c4fc",
  "game/Build/game.framework.js.br": "254a022d1abab85bbe735cd1c31edee5b25209dc3d56960a83fbeb7c55951e12",
  "game/Build/game.loader.js": "442a71053f53a13f62a3d7f5bcfe63dd29d80b18db8c02b8537fc88cec71ea13",
  "game/StreamingAssets/Bundles/maps.json": "a4cc1cc4f11ecbc2c2bf5ac7d2ff1e99dd20283aefb2caa64fd1e8d98bf6b1fd",
  "game/StreamingAssets/Bundles/maps_common.bundle": "ce4e13c919c01699883da9c1b5aed6a9c55f50a728bf6b741b543d8b35bb9c2a",
  "game/StreamingAssets/Bundles/weapons/weapons": "237188f51e64bef40ff0a45454e95a4f57d66d9b58c4696b07276d8814a9c85a",
};

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(ORIGIN + url, { headers: HEADERS });
      if (r.status === 200) return { status: 200, buf: Buffer.from(await r.arrayBuffer()) };
      if (i === tries) return { status: r.status, buf: null };
      await sleep(500 * i);
    } catch (e) {
      if (i === tries) return { status: 0, buf: null, error: String(e) };
      await sleep(800 * i);
    }
  }
}

const files = new Map(); // disk rel -> { bytes, sha256, dynamic? }
const extra = new Map(); // url -> disk rel   (from scans, not in SITE)
const unresolved = [];
const unreachable = [];
const external = new Set();
let requests = 0;

async function capture(url, disk, dynamic = false, record = true) {
  requests++;
  const r = await get(url);
  if (r.status !== 200) {
    if (record) unreachable.push({ status: r.status, path: disk, url });
    return false;
  }
  const p = path.join(proj, disk);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, r.buf);
  const entry = { bytes: r.buf.length, sha256: sha256(r.buf) };
  if (dynamic) entry.dynamic = true;
  files.set(disk, entry);
  return true;
}

// --- 1. site pages + static files -------------------------------------------
for (const f of SITE) await capture(f.url, f.disk, !!f.dynamic);
for (const n of ARSENAL) await capture(`/img/weapons/${n}`, `img/weapons/${n}`);
for (const n of MAPS) await capture(`/img/maps/${n}`, `img/maps/${n}`);

// rank icons: js/site.js badge() and js/nav.js build /img/ranks/rank_<NN>.svg
// from a template literal (01..200); probe the whole bounded set.
let rankCount = 0;
for (let lv = 1; lv <= 200; lv++) {
  const n = `rank_${String(lv).padStart(2, "0")}.svg`;
  if (await capture(`/img/ranks/${n}`, `img/ranks/${n}`)) rankCount++;
}
console.log(`rank icons: ${rankCount}/200 present`);

// --- 2. Unity build ---------------------------------------------------------
const buildRaw = fs.readFileSync(path.join(proj, "api/build"), "utf8");
const build = JSON.parse(buildRaw);
for (const key of BUILD_FILES) {
  const url = build[key];
  if (!url) continue;
  const disk = url.replace(/^\//, "");
  await capture(url, disk);
}
// --- 3. streaming assets ----------------------------------------------------
await capture("/game/StreamingAssets/Bundles/maps.json", "game/StreamingAssets/Bundles/maps.json");
const mapsRaw = JSON.parse(fs.readFileSync(path.join(proj, "game/StreamingAssets/Bundles/maps.json"), "utf8"));
for (const m of mapsRaw.maps) {
  const n = `gs_${m.scene.replace(/^GS_/, "").toLowerCase()}.bundle`;
  await capture(`/game/StreamingAssets/Bundles/${n}`, `game/StreamingAssets/Bundles/${n}`);
}
// maps.json also names a shared bundle (`common`); the client loads it with
// the scene bundles, so it is part of the map closure (added 2026-10-29).
if (mapsRaw.common) {
  const n = `${mapsRaw.common}.bundle`;
  await capture(`/game/StreamingAssets/Bundles/${n}`, `game/StreamingAssets/Bundles/${n}`);
}
await capture("/game/StreamingAssets/Bundles/weapons/weapons", "game/StreamingAssets/Bundles/weapons/weapons");
let weaponOk = 0;
for (const n of WEAPON_BUNDLES) {
  if (await capture(`/game/StreamingAssets/Bundles/weapons/${n}`, `game/StreamingAssets/Bundles/weapons/${n}`)) weaponOk++;
}
console.log(`weapon bundles: ${weaponOk}/${WEAPON_BUNDLES.length} captured`);

// --- 4. scan rounds to fixpoint ---------------------------------------------
const TEXT_EXT = /\.(html|css|js|json|svg|txt|xml)$/i;
const REF_PATTERNS = [
  /(?:src|href)\s*=\s*["'](\/[^"'\s>]+)/g,          // src="/x", href="/x"
  /url\(\s*["']?(\/[^"')\s]+)/g,                     // css url(/x)
  /["'`](\/(?:js|css|img|game|api|fonts)\/[^"'`\s]+)["'`]/g, // quoted literals
];
for (let round = 1; round <= 4; round++) {
  const seen = new Set(files.keys());
  const candidates = new Map();
  for (const disk of files.keys()) {
    const p = path.join(proj, disk);
    if (!TEXT_EXT.test(disk) || !fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, "utf8");
    for (const rx of REF_PATTERNS) {
      rx.lastIndex = 0;
      for (const m of s.matchAll(rx)) {
        const raw = m[1];
        if (raw.startsWith("//") || raw.includes("${")) continue;
        if (raw.startsWith("/api/v1/")) { external.add(raw); continue; }
        if (/^(https?:)?\/\//.test(raw)) { external.add(raw); continue; }
        const clean = raw.split("?")[0].split("#")[0];
        if (!clean || clean.endsWith("/")) continue;
        const urlDisk = clean.replace(/^\//, "");
        if (urlDisk === "play" || urlDisk === "about" || urlDisk === "leaderboard" || urlDisk === "account") continue;
        if (seen.has(urlDisk) || candidates.has(urlDisk)) continue;
        candidates.set(urlDisk, clean);
      }
    }
  }
  if (!candidates.size) { console.log(`scan round ${round}: no new refs`); break; }
  let added = 0;
  for (const [disk, url] of candidates) {
    const ok = await capture(url, disk, false, false);
    if (ok) { added++; extra.set(url, disk); }
    else if (!unreachable.some((u) => u.path === disk)) unreachable.push({ status: 404, path: disk, url });
  }
  console.log(`scan round ${round}: ${candidates.size} candidate refs, ${added} fetched`);
  if (!added) break;
}

// unresolved = referenced but never captured and not 404-proven
const captured = new Set(files.keys());
for (const [url, disk] of extra) if (!captured.has(disk)) unresolved.push({ url, disk });

// --- 5. integrity spot checks ------------------------------------------------
let expectBad = 0;
for (const [rel, want] of Object.entries(EXPECT)) {
  const got = files.get(rel);
  if (!got) { console.error(`EXPECT MISSING ${rel}`); expectBad++; continue; }
  if (got.sha256 !== want) { console.error(`EXPECT MISMATCH ${rel}: ${got.sha256}`); expectBad++; }
}

// --- 6. records --------------------------------------------------------------
const manifest = { generated: new Date().toISOString(), origin: ORIGIN, files: {} };
let bytes = 0;
for (const [rel, e] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  manifest.files[rel] = e;
  bytes += e.bytes;
}
fs.mkdirSync(path.join(proj, ".upstream"), { recursive: true });
fs.writeFileSync(path.join(proj, ".upstream", "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const report = {
  start: ORIGIN + "/",
  origin: ORIGIN,
  gated: false,
  sessionRenewal: "none — guest session (POST /api/v1/guest/check) created at capture time; the capture itself needs no session",
  requests,
  fetched: files.size,
  bytes,
  paths: [...files.keys()].sort(),
  unresolved,
  unreachable,
  external: [...external].sort(),
};
fs.writeFileSync(path.join(proj, "_mirror-report.json"), JSON.stringify(report, null, 2) + "\n");

console.log(
  `captured ${files.size} files, ${(bytes / 1048576).toFixed(1)} MB (${(bytes / 1000 / 1000).toFixed(1)} MB decimal); ` +
    `${unreachable.length} unreachable, ${unresolved.length} unresolved, ${external.size} external refs; ` +
    `expect-check ${expectBad ? `${expectBad} FAILED` : "OK"}`
);
