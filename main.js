'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const scanner = require('./scanner');

let win = null;
let games = new Map();

// ---------- persisted library (lives in %APPDATA%\Spindle) ----------
const libPath = () => path.join(app.getPath('userData'), 'library.json');
const coversDir = () => path.join(app.getPath('userData'), 'covers');
const DEFAULT_LIB = { folders: [], custom: [], overrides: {}, played: {}, artCache: {}, settings: { mode: 'case', sort: 'recent', filter: 'all', zoom: 1 } };
let lib = load();
function load() {
  try { const j = JSON.parse(fs.readFileSync(libPath(), 'utf8')); return { ...DEFAULT_LIB, ...j, settings: { ...DEFAULT_LIB.settings, ...(j.settings || {}) } }; }
  catch { return JSON.parse(JSON.stringify(DEFAULT_LIB)); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(libPath()), { recursive: true }); fs.writeFileSync(libPath(), JSON.stringify(lib, null, 2)); } catch {}
  }, 200);
}

// ---------- scanning ----------
function customGames() {
  return lib.custom.map((c) => ({
    id: c.id, source: 'custom', title: c.title, installDir: path.dirname(c.exe), exe: c.exe, size: 0, lastPlayed: 0,
    art: scanner.mergeArt(), launch: { type: 'exe', exe: c.exe, args: c.args || '', cwd: path.dirname(c.exe) },
  }));
}

async function iconFor(exe) {
  if (!exe || !fs.existsSync(exe)) return null;
  try { const img = await app.getFileIcon(exe, { size: 'large' }); return img.isEmpty() ? null : img.toDataURL(); } catch { return null; }
}

function publicGame(g) {
  const o = lib.overrides[g.id] || {};
  const cached = lib.artCache[g.id];
  let art = g.art;
  if (cached && cached.art) art = scanner.mergeArt(g.art, cached.art);
  if (o.cover) art = scanner.mergeArt({ cover: [o.cover] }, art);
  return {
    id: g.id, source: g.source, title: o.title || g.title, installDir: g.installDir, size: g.size,
    lastPlayed: Math.max(g.lastPlayed || 0, lib.played[g.id] || 0), art, icon: g.icon || null, hidden: !!o.hidden,
  };
}

async function scan() {
  const found = await scanner.scanAll({ folders: lib.folders });
  found.push(...customGames());
  games = new Map(found.map((g) => [g.id, g]));
  // Icons for exe-based games (cheap, local)
  await Promise.all(found.filter((g) => g.exe).map(async (g) => { g.icon = await iconFor(g.exe); }));
  setTimeout(enrichArt, 300);
  return [...games.values()].map(publicGame);
}

// ---------- online art for games that have none locally (best effort) ----------
const norm = (s) => String(s).toLowerCase().replace(/[™®©]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
async function getJson(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try { const r = await net.fetch(url, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function steamAppIdFor(title) {
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`);
  const items = (j && j.items) || [];
  const t = norm(title);
  const hit = items.find((i) => norm(i.name) === t) || items.find((i) => { const n = norm(i.name); return n.startsWith(t + ' ') || t.startsWith(n + ' '); });
  return hit ? String(hit.id) : null;
}
let enriching = false;
async function enrichArt() {
  if (enriching) return; enriching = true;
  const WEEK = 7 * 864e5;
  const todo = [...games.values()].filter((g) => g.source !== 'steam' && !(lib.overrides[g.id] || {}).cover &&
    !(lib.artCache[g.id] && (lib.artCache[g.id].art || Date.now() - lib.artCache[g.id].at < WEEK)));
  for (const g of todo) {
    let art = null;
    if (g.source === 'gog' && g.gogId) {
      const j = await getJson(`https://api.gog.com/v2/games/${g.gogId}`);
      const L = (j && j._links) || {};
      if (L.boxArtImage) art = { cover: [L.boxArtImage.href], hero: L.galaxyBackgroundImage ? [L.galaxyBackgroundImage.href] : [] };
    }
    if (!art) {
      const appid = await steamAppIdFor((lib.overrides[g.id] || {}).title || g.title);
      if (appid) art = scanner.steamRemoteArt(appid);
    }
    lib.artCache[g.id] = art ? { art, at: Date.now() } : { at: Date.now() };
    save();
    if (art && win && !win.isDestroyed()) win.webContents.send('game-updated', publicGame(g));
  }
  enriching = false;
}

// ---------- launching ----------
function launch(id) {
  const g = games.get(id); if (!g) return { ok: false, error: 'Game not found' };
  lib.played[id] = Date.now(); save();
  const L = g.launch;
  try {
    if (L.type === 'uri') shell.openExternal(L.uri);
    else {
      if (!L.exe || !fs.existsSync(L.exe)) return { ok: false, error: 'The game\u2019s .exe wasn\u2019t found.' };
      const args = (L.args || '').match(/"[^"]*"|\S+/g) || [];
      spawn(L.exe, args.map((a) => a.replace(/^"|"$/g, '')), { cwd: L.cwd || path.dirname(L.exe), detached: true, stdio: 'ignore', windowsHide: false }).unref();
    }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  if (lib.settings.minimizeOnLaunch !== false && win) setTimeout(() => win.minimize(), 900);
  return { ok: true, game: publicGame(g) };
}

// ---------- IPC ----------
ipcMain.handle('scan', async () => ({ games: await scan(), settings: lib.settings, folders: lib.folders }));
ipcMain.handle('launch', (_e, id) => launch(id));
ipcMain.handle('open-folder', (_e, id) => { const g = games.get(id); if (g && g.installDir) shell.openPath(g.installDir); });
ipcMain.handle('settings', (_e, s) => { lib.settings = { ...lib.settings, ...s }; save(); return lib.settings; });
ipcMain.handle('add-game', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick the game\u2019s .exe', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'lnk', 'url'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const exe = r.filePaths[0];
  const title = path.basename(path.dirname(exe)).replace(/[._]+/g, ' ').trim() || path.basename(exe, path.extname(exe));
  const id = `custom:${exe.toLowerCase()}`;
  if (!lib.custom.find((c) => c.id === id)) lib.custom.push({ id, title, exe });
  save(); return id;
});
ipcMain.handle('add-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a folder that holds game folders (e.g. D:\\Games)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return false;
  if (!lib.folders.includes(r.filePaths[0])) lib.folders.push(r.filePaths[0]);
  save(); return true;
});
ipcMain.handle('remove-folder', (_e, f) => { lib.folders = lib.folders.filter((x) => x !== f); save(); return true; });
ipcMain.handle('set-cover', async (_e, id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a cover image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(coversDir(), { recursive: true });
  const dest = path.join(coversDir(), id.replace(/[^a-z0-9]+/gi, '_') + '_' + Date.now() + path.extname(r.filePaths[0]));
  fs.copyFileSync(r.filePaths[0], dest);
  lib.overrides[id] = { ...(lib.overrides[id] || {}), cover: pathToFileURL(dest).href }; save();
  const g = games.get(id); return g ? publicGame(g) : null;
});
ipcMain.handle('rename', (_e, id, title) => {
  lib.overrides[id] = { ...(lib.overrides[id] || {}), title: String(title || '').trim() || undefined }; save();
  const g = games.get(id); return g ? publicGame(g) : null;
});
ipcMain.handle('set-hidden', (_e, id, hidden) => {
  lib.overrides[id] = { ...(lib.overrides[id] || {}), hidden: !!hidden }; save();
  const g = games.get(id); return g ? publicGame(g) : null;
});
ipcMain.handle('remove-custom', (_e, id) => { lib.custom = lib.custom.filter((c) => c.id !== id); save(); return true; });
ipcMain.handle('fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0b0d12', autoHideMenuBar: true,
    title: 'Spindle', icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
