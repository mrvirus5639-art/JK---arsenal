// Spindle — finds locally installed PC games (Steam, Epic, GOG, your own folders).
// Pure Node, no Electron imports, so it can be tested on its own.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const isWin = process.platform === 'win32';
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const fileUrl = (p) => pathToFileURL(p).href;

// ---------- Valve KeyValues (.vdf / .acf) ----------
function parseVdf(text) {
  let i = 0; const n = text.length;
  const ws = () => {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\uFEFF') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const str = () => {
    let s = '';
    if (text[i] === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) { const e = text[i + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; i += 2; }
        else s += text[i++];
      }
      i++; return s;
    }
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return s;
  };
  const obj = () => {
    const o = {};
    for (;;) {
      ws();
      if (i >= n) return o;
      if (text[i] === '}') { i++; return o; }
      const k = str().toLowerCase(); ws();
      if (text[i] === '{') { i++; o[k] = obj(); } else o[k] = str();
    }
  };
  return obj();
}

// ---------- Windows registry via reg.exe ----------
function regQuery(key, recursive = false) {
  if (!isWin) return Promise.resolve('');
  return new Promise((resolve) => {
    const args = ['query', key]; if (recursive) args.push('/s');
    execFile('reg', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}
function parseRegOutput(text) {
  const keys = {}; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) { cur = raw.trim(); keys[cur] = {}; continue; }
    const m = raw.match(/^\s{2,}(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/) || raw.match(/^\s{2,}(.+?)\s{2,}(REG_\w+)\s*$/);
    if (m && cur) keys[cur][m[1].toLowerCase()] = (m[3] || '').trim();
  }
  return keys;
}
async function regValue(key, name) {
  const k = parseRegOutput(await regQuery(key));
  for (const v of Object.values(k)) if (v[name.toLowerCase()] != null) return v[name.toLowerCase()];
  return null;
}

// ---------- Steam ----------
const STEAM_SKIP_IDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100', '961940', '1054830',
  '1113280', '1245040', '1420170', '1580130', '1887720', '2348590', '2805730', '3658110', '250820', '1826330']);
const STEAM_SKIP_NAME = /^(proton\b|steam linux runtime|steamworks common|steamvr\b)|redistributable|\bsdk\b|dedicated server/i;

async function findSteamRoot(override) {
  const c = [];
  if (override) c.push(override);
  const hkcu = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (hkcu) c.push(hkcu.replace(/\//g, '\\'));
  const hklm = await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (hklm) c.push(hklm);
  c.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  return c.find((p) => exists(path.join(p, 'steamapps'))) || null;
}

function steamLibraries(root) {
  const libs = [root];
  for (const f of [path.join(root, 'steamapps', 'libraryfolders.vdf'), path.join(root, 'config', 'libraryfolders.vdf')]) {
    const t = readText(f); if (!t) continue;
    const lf = parseVdf(t).libraryfolders || {};
    for (const v of Object.values(lf)) {
      if (typeof v === 'string' && /[\\/]/.test(v)) libs.push(v);
      else if (v && typeof v === 'object' && v.path) libs.push(v.path);
    }
  }
  const seen = new Set();
  return libs.map((p) => p.replace(/\\\\/g, '\\')).filter((p) => {
    const k = path.resolve(p).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return exists(path.join(p, 'steamapps'));
  });
}

// Steam's local art cache: old layout <appid>_library_600x900.jpg, new layout librarycache/<appid>/**/library_600x900.jpg
function steamLocalArt(root, appid) {
  const lc = path.join(root, 'appcache', 'librarycache');
  const art = { cover: [], wide: [], hero: [], logo: [] };
  const kind = (name) => {
    const b = name.toLowerCase();
    if (/^library_600x900(_2x)?\.(jpg|png)$/.test(b) || /^\d+_library_600x900(_2x)?\.(jpg|png)$/.test(b) || b === 'library_capsule.jpg') return 'cover';
    if (/^(\d+_)?header\.(jpg|png)$/.test(b)) return 'wide';
    if (/^(\d+_)?library_hero(_blur)?\.(jpg|png)$/.test(b) && !b.includes('blur')) return 'hero';
    if (/^(\d+_)?logo(_2x)?\.png$/.test(b)) return 'logo';
    return null;
  };
  const push = (p) => { const k = kind(path.basename(p)); if (k) art[k].push(fileUrl(p)); };
  for (const suffix of ['library_600x900_2x.jpg', 'library_600x900.jpg', 'header.jpg', 'library_hero.jpg', 'logo.png']) {
    const p = path.join(lc, `${appid}_${suffix}`); if (exists(p)) push(p);
  }
  const walk = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1); else if (e.isFile()) push(p);
    }
  };
  walk(path.join(lc, String(appid)), 0);
  for (const k of Object.keys(art)) art[k].sort((a, b) => (b.includes('_2x') ? 1 : 0) - (a.includes('_2x') ? 1 : 0));
  return art;
}
function steamRemoteArt(appid) {
  const a = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}`;
  const b = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`;
  return {
    cover: [`${a}/library_600x900_2x.jpg`, `${b}/library_600x900_2x.jpg`, `${b}/library_600x900.jpg`],
    wide: [`${a}/header.jpg`, `${b}/header.jpg`],
    hero: [`${a}/library_hero.jpg`, `${b}/library_hero.jpg`],
    logo: [`${a}/logo.png`],
  };
}
const mergeArt = (...arts) => {
  const o = { cover: [], wide: [], hero: [], logo: [] };
  for (const a of arts) if (a) for (const k of Object.keys(o)) o[k].push(...(a[k] || []));
  return o;
};

async function scanSteam(opts = {}) {
  const root = await findSteamRoot(opts.steamRoot);
  if (!root) return [];
  const games = [];
  for (const lib of steamLibraries(root)) {
    const sa = path.join(lib, 'steamapps');
    let files = []; try { files = fs.readdirSync(sa).filter((f) => /^appmanifest_\d+\.acf$/i.test(f)); } catch {}
    for (const f of files) {
      const st = (parseVdf(readText(path.join(sa, f)) || '').appstate) || {};
      const appid = st.appid; const name = st.name;
      if (!appid || !name || STEAM_SKIP_IDS.has(appid) || STEAM_SKIP_NAME.test(name)) continue;
      games.push({
        id: `steam:${appid}`, source: 'steam', title: name, appid,
        installDir: path.join(sa, 'common', st.installdir || ''),
        size: Number(st.sizeondisk) || 0,
        lastPlayed: Number(st.lastplayed) ? Number(st.lastplayed) * 1000 : 0,
        art: mergeArt(steamLocalArt(root, appid), steamRemoteArt(appid)),
        launch: { type: 'uri', uri: `steam://rungameid/${appid}` },
      });
    }
  }
  return games;
}

// ---------- Epic Games ----------
function scanEpic(opts = {}) {
  const dir = opts.epicManifests || path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = []; try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); } catch { return []; }
  const games = [];
  for (const f of files) {
    let j; try { j = JSON.parse(readText(path.join(dir, f))); } catch { continue; }
    if (!j || !j.DisplayName || j.bIsIncompleteInstall) continue;
    if (j.MainGameAppName && j.AppName && j.MainGameAppName !== j.AppName) continue; // DLC
    const cats = (j.AppCategories || []).map((c) => String(c).toLowerCase());
    if (cats.length && !cats.includes('games')) continue;
    const exe = j.LaunchExecutable ? path.join(j.InstallLocation || '', j.LaunchExecutable) : null;
    const id = `${j.CatalogNamespace}:${j.CatalogItemId}:${j.AppName}`;
    games.push({
      id: `epic:${j.AppName}`, source: 'epic', title: j.DisplayName,
      installDir: j.InstallLocation || '', exe, size: Number(j.InstallSize) || 0, lastPlayed: 0,
      art: mergeArt(),
      launch: { type: 'uri', uri: `com.epicgames.launcher://apps/${encodeURIComponent(id)}?action=launch&silent=true` },
    });
  }
  return games;
}

// ---------- GOG ----------
async function scanGog() {
  const out = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', true);
  const games = [];
  for (const v of Object.values(parseRegOutput(out))) {
    if (!v.gamename || !v.gameid) continue;
    if (v.dependson && v.dependson.trim()) continue; // DLC
    const exe = v.exe || (v.path && v.exefile ? path.join(v.path, v.exefile) : null);
    games.push({
      id: `gog:${v.gameid}`, source: 'gog', title: v.gamename, gogId: v.gameid,
      installDir: v.path || '', exe, size: 0, lastPlayed: 0, art: mergeArt(),
      launch: { type: 'exe', exe, args: v.launchparam || '', cwd: v.workingdir || v.path },
    });
  }
  return games;
}

// ---------- Your own folders (DRM-free / standalone games) ----------
const EXE_SKIP = /^(unins|uninstall|setup|install|vc_?redist|dxsetup|dxwebsetup|crash|unitycrashhandler|ue4prereq|cefprocess|quicksfv|notification_helper|easyanticheat|eac|be(service|launcher)|launcherpatcher|dotnet|oalinst|physx|redist|update|updater|config|settings|helper)/i;
function listExes(dir, depth = 0, acc = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3 && !/^(redist|_commonredist|directx|vcredist|support|__installer|engine\b)/i.test(e.name)) listExes(p, depth + 1, acc);
    else if (e.isFile() && /\.exe$/i.test(e.name) && !EXE_SKIP.test(e.name)) {
      let size = 0; try { size = fs.statSync(p).size; } catch {}
      acc.push({ p, size, depth });
    }
  }
  return acc;
}
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function pickExe(folder) {
  const exes = listExes(folder);
  if (!exes.length) return null;
  const want = squash(path.basename(folder));
  const named = exes.filter((e) => { const n = squash(path.basename(e.p, '.exe')); return n && (want.includes(n) || n.includes(want)); });
  const pool = named.length ? named : exes;
  pool.sort((a, b) => (a.depth - b.depth) || (b.size - a.size));
  // Prefer shipping builds (UE: Binaries/Win64/<Game>-Win64-Shipping.exe) only when no top-level match exists
  return pool[0].p;
}
function prettyName(folder) {
  return path.basename(folder).replace(/[._]+/g, ' ').replace(/\s*[-–]\s*(gog|repack|fitgirl|dodi|elamigos).*$/i, '').replace(/\s+/g, ' ').trim();
}
function scanFolders(folders = []) {
  const games = [];
  for (const root of folders) {
    let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const exe = pickExe(dir);
      if (!exe) continue;
      games.push({
        id: `dir:${dir.toLowerCase()}`, source: 'folder', title: prettyName(dir),
        installDir: dir, exe, size: 0, lastPlayed: 0, art: mergeArt(),
        launch: { type: 'exe', exe, args: '', cwd: path.dirname(exe) },
      });
    }
  }
  return games;
}

async function scanAll(opts = {}) {
  const safe = async (fn) => { try { return await fn(); } catch (e) { return []; } };
  const parts = await Promise.all([
    safe(() => scanSteam(opts)), safe(() => scanEpic(opts)), safe(() => scanGog(opts)), safe(() => scanFolders(opts.folders)),
  ]);
  const seen = new Set();
  return parts.flat().filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

module.exports = { parseVdf, parseRegOutput, steamLibraries, steamLocalArt, steamRemoteArt, mergeArt, scanSteam, scanEpic, scanGog, scanFolders, pickExe, scanAll };
