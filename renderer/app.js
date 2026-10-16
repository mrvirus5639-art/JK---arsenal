(() => {
  'use strict';
  const api = window.spindle || demoApi();
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, kids) => { const e = document.createElement(tag); if (cls) e.className = cls; if (kids) e.append(...kids); return e; };

  const SOURCES = {
    all: { label: 'All' }, steam: { label: 'Steam', short: 'STEAM' }, epic: { label: 'Epic', short: 'EPIC GAMES' },
    gog: { label: 'GOG', short: 'GOG' }, folder: { label: 'Folders', short: 'FOLDER' }, custom: { label: 'Mine', short: 'ADDED BY YOU' },
  };
  const MODES = ['disc', 'case', 'save'];
  const state = { games: [], view: [], selId: null, mode: 'case', sort: 'recent', filter: 'all', q: '', zoom: 1, showHidden: false, folders: [], pad: false };
  const byId = new Map();

  // ---------- helpers ----------
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const fmtSize = (b) => !b ? null : b >= 1e9 ? (b / 1e9).toFixed(b >= 1e11 ? 0 : 1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';
  const ago = (t) => {
    if (!t) return null; const s = (Date.now() - t) / 1000;
    if (s < 3600) return 'just now'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400); if (d < 30) return d === 1 ? 'yesterday' : d + ' days ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  let toastT; const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); };

  // ---------- art resolution (tries each candidate URL until one loads) ----------
  const art = new Map();
  const probe = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 16 ? url : null); i.onerror = () => res(null); i.src = url; });
  const firstOk = async (list) => { for (const u of list || []) { const ok = await probe(u); if (ok) return ok; } return null; };
  const artKey = (g) => JSON.stringify(g.art);
  function ensureArt(g) {
    const k = artKey(g); const cur = art.get(g.id);
    if (cur && cur.key === k) return cur.p;
    const entry = { key: k, done: false, cover: null, hero: null };
    entry.p = (async () => {
      entry.cover = (await firstOk(g.art.cover)) || (await firstOk(g.art.wide));
      entry.hero = (await firstOk(g.art.hero)) || entry.cover;
      entry.done = true; paintAll(g); return entry;
    })();
    art.set(g.id, entry); return entry.p;
  }
  function paint(node, g) {
    const a = art.get(g.id);
    if (!a || !a.done) { node.classList.add('loading'); return; }
    node.classList.remove('loading');
    if (a.cover) { node.classList.remove('noart'); node.replaceChildren(); node.style.backgroundImage = `url("${a.cover.replace(/"/g, '%22')}")`; return; }
    node.classList.add('noart'); node.style.backgroundImage = '';
    if (!node.childElementCount) {
      if (g.icon) { const i = new Image(); i.className = 'ico'; i.src = g.icon; i.alt = ''; node.append(i); }
      const s = el('span'); s.textContent = g.title; node.append(s);
    }
  }
  function paintAll(g) {
    document.querySelectorAll('.art').forEach((n) => { if (n.dataset.gid === g.id) paint(n, g); });
    if (g.id === state.selId) setBg(g);
  }
  function artNode(g, cls) { const n = el('div', 'art ' + cls); n.dataset.gid = g.id; n.style.setProperty('--h', hue(g.id)); paint(n, g); return n; }

  // ---------- physical objects ----------
  function discEl(g) {
    const spin = el('div', 'disc-spin', [el('div', 'disc-surface'), artNode(g, 'disc-label'), el('div', 'disc-ring')]);
    const mark = el('div', 'disc-mark'); mark.textContent = (SOURCES[g.source] || {}).short || ''; spin.append(mark);
    return el('div', 'disc', [spin, el('div', 'disc-glare')]);
  }
  function caseEl(g) {
    return el('div', 'case', [el('div', 'case-disc', [discEl(g)]), el('div', 'case-body', [artNode(g, 'case-art'), el('div', 'case-spine'), el('div', 'case-gloss')])]);
  }
  function saveEl(g) {
    const title = el('div', 'fl-title'); const sp = el('span'); sp.textContent = g.title; title.append(sp);
    const sh = el('div', 'fl-shutter', [el('b'), el('i')]);
    const body = el('div', 'fl-body', [el('div', 'fl-recess'), sh, el('div', 'fl-label', [el('div', 'fl-band'), artNode(g, 'fl-art'), title]),
      el('div', 'fl-hole'), el('div', 'fl-hole r'), el('div', 'fl-arrow')]);
    const f = el('div', 'floppy', [body]); f.style.setProperty('--h', hue(g.id)); return f;
  }
  const objEl = (g, mode) => (mode === 'disc' ? discEl(g) : mode === 'save' ? saveEl(g) : caseEl(g));

  // ---------- view ----------
  function computeView() {
    const q = state.q.trim().toLowerCase();
    let v = state.games.filter((g) => (state.showHidden || !g.hidden) && (state.filter === 'all' || g.source === state.filter) && (!q || g.title.toLowerCase().includes(q)));
    const name = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    const sorters = {
      name, recent: (a, b) => (b.lastPlayed - a.lastPlayed) || name(a, b), size: (a, b) => (b.size - a.size) || name(a, b),
      source: (a, b) => a.source.localeCompare(b.source) || name(a, b),
    };
    v.sort(sorters[state.sort] || name); state.view = v;
  }

  let io;
  function renderGrid() {
    computeView();
    const grid = $('#grid'); grid.replaceChildren();
    if (io) io.disconnect();
    io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { const g = byId.get(e.target.dataset.id); if (g) ensureArt(g); io.unobserve(e.target); } }), { root: grid, rootMargin: '400px' });
    const frag = document.createDocumentFragment();
    for (const g of state.view) {
      const t = el('div', 'tile'); t.dataset.id = g.id; t.dataset.src = g.source; if (g.hidden) t.classList.add('hidden-game');
      const cap = el('div', 'cap'); const tt = el('span', 't'); tt.textContent = g.title; const ss = el('span', 's'); ss.textContent = (SOURCES[g.source] || {}).short || '';
      cap.append(tt, ss); t.append(el('div', 'stage', [objEl(g, state.mode)]), cap); t.title = g.title;
      frag.append(t); io.observe(t);
    }
    grid.append(frag);
    const empty = state.games.length === 0;
    document.body.classList.toggle('is-empty', empty); $('#empty').hidden = !empty;
    if (!state.view.find((g) => g.id === state.selId)) state.selId = state.view[0] ? state.view[0].id : null;
    select(state.selId, { force: true, noScroll: true });
    renderFilters();
  }

  function renderFilters() {
    const counts = { all: 0 }; for (const g of state.games) if (state.showHidden || !g.hidden) { counts.all++; counts[g.source] = (counts[g.source] || 0) + 1; }
    const nav = $('#filters'); nav.replaceChildren();
    for (const k of Object.keys(SOURCES)) {
      if (k !== 'all' && !counts[k]) continue;
      const b = el('button', 'chip' + (state.filter === k ? ' on' : '')); b.dataset.f = k;
      const n = el('i'); n.textContent = counts[k] || 0; b.append(SOURCES[k].label, n); nav.append(b);
    }
  }
  const filterKeys = () => [...document.querySelectorAll('#filters .chip')].map((b) => b.dataset.f);

  let heroFor = null;
  function select(id, opts = {}) {
    const prev = state.selId; state.selId = id;
    document.querySelectorAll('.tile.sel').forEach((t) => t.classList.remove('sel'));
    const tile = id && [...document.querySelectorAll('.tile')].find((t) => t.dataset.id === id);
    if (tile) { tile.classList.add('sel'); if (!opts.noScroll) tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const g = id && byId.get(id);
    if (!g) { $('#heroObj').replaceChildren(); return; }
    ensureArt(g);
    if (opts.force || prev !== id || heroFor !== state.mode + id) {
      heroFor = state.mode + id;
      const o = objEl(g, state.mode); if (state.mode === 'disc') o.classList.add('spin');
      $('#heroObj').replaceChildren(o);
    }
    $('#hero').dataset.src = g.source;
    $('#heroSrc').textContent = (SOURCES[g.source] || {}).short || '';
    const h1 = $('#heroTitle'); if (h1.contentEditable !== 'true') h1.textContent = g.title;
    const meta = $('#heroMeta'); meta.replaceChildren();
    const add = (label, val) => { if (!val) return; const s = el('span'); const b = el('b'); b.textContent = val; s.append(label + ' ', b); meta.append(s); };
    add('Last played', ago(g.lastPlayed) || 'never'); add('Size', fmtSize(g.size));
    if (g.installDir) { const s = el('span'); s.textContent = g.installDir; s.style.opacity = '.7'; meta.append(s); }
    $('#hideBtn').textContent = g.hidden ? 'Unhide' : 'Hide';
    $('#removeBtn').hidden = g.source !== 'custom';
    setBg(g);
  }

  let bgFlip = false, bgUrl = null;
  function setBg(g) {
    const a = art.get(g.id); const url = a && a.done ? a.hero : null;
    if (url === bgUrl) return; bgUrl = url;
    const [on, off] = bgFlip ? [$('#bgA'), $('#bgB')] : [$('#bgB'), $('#bgA')]; bgFlip = !bgFlip;
    if (url) { on.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; on.classList.add('on'); } else on.classList.remove('on');
    off.classList.remove('on');
  }

  // ---------- actions ----------
  const cur = () => byId.get(state.selId);
  async function play() {
    const g = cur(); if (!g) return;
    toast('Launching ' + g.title + '…');
    const r = await api.launch(g.id);
    if (!r || !r.ok) toast((r && r.error) || 'Couldn’t start that game.');
    else if (r.game) upsert(r.game, { keepOrder: true });
  }
  function upsert(g, opts = {}) {
    const i = state.games.findIndex((x) => x.id === g.id);
    if (i >= 0) state.games[i] = g; else state.games.push(g);
    byId.set(g.id, g);
    if (opts.keepOrder) { ensureArt(g); select(state.selId, { force: true, noScroll: true }); }
    else renderGrid();
  }
  function setMode(m) {
    if (!MODES.includes(m)) return; state.mode = m; document.body.dataset.mode = m;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    api.saveSettings({ mode: m }); renderGrid();
  }
  const cycleMode = () => setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
  function setFilter(f) { state.filter = f; api.saveSettings({ filter: f }); renderGrid(); }
  function cycleFilter(d) { const ks = filterKeys(); const i = ks.indexOf(state.filter); setFilter(ks[(i + d + ks.length) % ks.length]); }
  function setZoom(z) { state.zoom = Math.min(1.6, Math.max(.7, z)); document.documentElement.style.setProperty('--z', state.zoom); api.saveSettings({ zoom: state.zoom }); }
  async function rescan(msg) {
    const r = await api.scan();
    state.games = r.games; state.folders = r.folders || [];
    byId.clear(); for (const g of state.games) byId.set(g.id, g);
    art.clear(); renderGrid(); if (msg) toast(msg);
  }

  // grid navigation
  const cols = () => { const t = getComputedStyle($('#grid')).gridTemplateColumns; return t && t !== 'none' ? t.split(' ').length : 1; };
  function move(dir) {
    if (!state.view.length) return;
    let i = Math.max(0, state.view.findIndex((g) => g.id === state.selId));
    const c = cols();
    if (dir === 'left') i--; else if (dir === 'right') i++; else if (dir === 'up') i -= c; else if (dir === 'down') i += c;
    i = Math.min(state.view.length - 1, Math.max(0, i));
    select(state.view[i].id);
  }

  // ---------- menu ----------
  function buildMenu() {
    const m = $('#menu'); m.replaceChildren();
    const item = (label, hint, fn) => { const b = el('button'); b.append(label); if (hint) { const s = el('span'); s.textContent = hint; b.append(s); } b.onclick = () => { closeMenu(); fn(); }; m.append(b); };
    item('Add a game (.exe)…', '', addGame);
    item('Add a games folder…', '', addFolder);
    item('Scan again', 'F5', () => rescan('Library refreshed'));
    item(state.showHidden ? 'Don’t show hidden games' : 'Show hidden games', '', () => { state.showHidden = !state.showHidden; renderGrid(); });
    item('Full screen', 'F11', () => api.fullscreen());
    if (state.folders.length) {
      m.append(el('hr')); const s = el('div', 'sub'); s.textContent = 'Your game folders'; m.append(s);
      for (const f of state.folders) {
        const row = el('div', 'folder'); const b = el('b'); b.textContent = f; const x = el('button'); x.textContent = 'Remove';
        x.onclick = async () => { await api.removeFolder(f); closeMenu(); rescan('Folder removed'); }; row.append(b, x); m.append(row);
      }
    }
  }
  const closeMenu = () => { $('#menu').hidden = true; };
  async function addGame() { const id = await api.addGame(); if (id) { await rescan('Added to your shelf'); select(id); } }
  async function addFolder() { if (await api.addFolder()) rescan('Folder added — scanning'); }

  // ---------- wiring ----------
  $('#grid').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) select(t.dataset.id); });
  $('#grid').addEventListener('dblclick', (e) => { if (e.target.closest('.tile')) play(); });
  $('#grid').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.08 : 0.93)); } }, { passive: false });
  $('#filters').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setFilter(b.dataset.f); });
  $('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; api.saveSettings({ sort: state.sort }); renderGrid(); });
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
  $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#menu'); if (m.hidden) { buildMenu(); m.hidden = false; } else closeMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  $('#heroObj').addEventListener('dblclick', play);
  $('#playBtn').onclick = play;
  $('#folderBtn').onclick = () => cur() && api.openFolder(cur().id);
  $('#coverBtn').onclick = async () => { const g = cur(); if (!g) return; const r = await api.setCover(g.id); if (r) { upsert(r, { keepOrder: true }); renderGrid(); } };
  $('#hideBtn').onclick = async () => { const g = cur(); if (!g) return; const r = await api.setHidden(g.id, !g.hidden); if (r) { upsert(r); toast(r.hidden ? 'Hidden — find it again from the ⋯ menu' : 'Back on the shelf'); } };
  $('#removeBtn').onclick = async () => { const g = cur(); if (g && g.source === 'custom') { await api.removeCustom(g.id); rescan('Removed'); } };
  $('#renameBtn').onclick = () => {
    const h = $('#heroTitle'); const g = cur(); if (!g) return;
    h.contentEditable = 'true'; h.focus(); document.getSelection().selectAllChildren(h);
    const done = async (commit) => {
      h.contentEditable = 'false'; h.removeEventListener('keydown', onKey); h.removeEventListener('blur', onBlur);
      if (commit && h.textContent.trim() && h.textContent.trim() !== g.title) { const r = await api.rename(g.id, h.textContent.trim()); if (r) upsert(r); }
      else h.textContent = g.title;
    };
    const onKey = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
    const onBlur = () => done(true);
    h.addEventListener('keydown', onKey); h.addEventListener('blur', onBlur);
  };
  $('#empty').addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (!a) return; ({ 'add-folder': addFolder, 'add-game': addGame, rescan: () => rescan('Scanned') })[a.dataset.act](); });

  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, select, [contenteditable="true"]');
    if (e.key === 'Escape') { closeMenu(); if (typing) { e.target.blur(); if (e.target.id === 'q' && state.q) { e.target.value = state.q = ''; renderGrid(); } } return; }
    if (e.key === 'F5') { e.preventDefault(); rescan('Library refreshed'); return; }
    if (typing) { if (e.target.id === 'q' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.target.blur(); } return; }
    state.pad = false; hints();
    const k = e.key;
    if (k === 'ArrowLeft') move('left'); else if (k === 'ArrowRight') move('right'); else if (k === 'ArrowUp') move('up'); else if (k === 'ArrowDown') move('down');
    else if (k === 'Enter') play();
    else if (k === '/' || (e.ctrlKey && k.toLowerCase() === 'f')) { e.preventDefault(); $('#q').focus(); }
    else if (k === '1' || k === '2' || k === '3') setMode(MODES[+k - 1]);
    else if (k === 'Tab') { e.preventDefault(); cycleMode(); }
    else if (k === '[' || k === 'q') cycleFilter(-1); else if (k === ']' || k === 'e') cycleFilter(1);
    else if ((k === '+' || k === '=') && e.ctrlKey) { e.preventDefault(); setZoom(state.zoom * 1.1); }
    else if (k === '-' && e.ctrlKey) { e.preventDefault(); setZoom(state.zoom / 1.1); }
    else if (k === 'Home') state.view[0] && select(state.view[0].id);
    else if (k === 'End') state.view.length && select(state.view[state.view.length - 1].id);
    else return;
    e.preventDefault();
  });

  // ---------- controller (Xbox / PlayStation / Switch Pro via the Gamepad API) ----------
  const pad = { prev: {}, next: {} };
  function poll(t) {
    const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((p) => p && p.connected);
    if (gp && document.hasFocus()) {
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed); const ax = gp.axes || [];
      const dirs = { left: b(14) || ax[0] < -0.55, right: b(15) || ax[0] > 0.55, up: b(12) || ax[1] < -0.55, down: b(13) || ax[1] > 0.55 };
      const wake = () => { if (!state.pad) { state.pad = true; hints(); } };
      for (const [k, v] of Object.entries(dirs)) {
        if (v) { if (!pad.prev[k]) { wake(); move(k); pad.next[k] = t + 360; } else if (t > pad.next[k]) { move(k); pad.next[k] = t + 85; } }
        pad.prev[k] = v;
      }
      const edge = (name, down, fn) => { if (down && !pad.prev[name]) { wake(); fn(); } pad.prev[name] = down; };
      edge('a', b(0), () => { if (document.activeElement === $('#q')) $('#q').blur(); else play(); });
      edge('b', b(1), () => { closeMenu(); if (state.q) { $('#q').value = state.q = ''; renderGrid(); } });
      edge('x', b(2), cycleMode);
      edge('y', b(3), () => $('#q').focus());
      edge('lb', b(4), () => cycleFilter(-1)); edge('rb', b(5), () => cycleFilter(1));
      edge('lt', b(6), () => setZoom(state.zoom / 1.1)); edge('rt', b(7), () => setZoom(state.zoom * 1.1));
      edge('select', b(8), () => rescan('Library refreshed'));
      edge('start', b(9), () => api.fullscreen());
    }
    requestAnimationFrame(poll);
  }
  window.addEventListener('gamepadconnected', () => { state.pad = true; hints(); toast('Controller connected'); });

  function hints() {
    const h = $('#hints'); h.replaceChildren();
    const rows = state.pad
      ? [['a', 'A', 'Play'], ['x', 'X', 'Change style'], ['y', 'Y', 'Search'], ['', 'LB RB', 'Store'], ['', 'LT RT', 'Size'], ['b', 'B', 'Back']]
      : [['k', '← → ↑ ↓', 'Move'], ['k', 'Enter', 'Play'], ['k', 'Tab', 'Change style'], ['k', '/', 'Search'], ['k', 'Q E', 'Store'], ['k', 'Ctrl + wheel', 'Size'], ['k', 'F11', 'Full screen']];
    for (const [c, key, label] of rows) { const s = el('span'); const g = el('span', c === 'k' ? 'k' : 'g ' + c); g.textContent = key; s.append(g, label); h.append(s); }
  }

  if (api.onGameUpdated) api.onGameUpdated((g) => { const old = byId.get(g.id); if (old) upsert(g, { keepOrder: true }); });

  // ---------- boot ----------
  (async () => {
    hints();
    const r = await api.scan();
    const s = r.settings || {};
    state.games = r.games; state.folders = r.folders || []; for (const g of state.games) byId.set(g.id, g);
    state.sort = s.sort || 'recent'; state.filter = s.filter || 'all'; $('#sort').value = state.sort;
    state.zoom = s.zoom || 1; document.documentElement.style.setProperty('--z', state.zoom);
    state.mode = MODES.includes(s.mode) ? s.mode : 'case'; document.body.dataset.mode = state.mode;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    if (state.filter !== 'all' && !state.games.some((g) => g.source === state.filter)) state.filter = 'all';
    renderGrid();
    requestAnimationFrame(poll);
  })();

  // ---------- browser preview (opened outside the app) ----------
  function demoApi() {
    const names = ['Hollow Knight', 'Hades', 'Celeste', 'Forza Horizon 5', 'Disco Elysium', 'Stardew Valley', 'Cyberpunk 2077', 'Outer Wilds', 'The Witcher 3: Wild Hunt', 'Portal 2', 'Balatro', 'F1 24'];
    const src = ['steam', 'steam', 'epic', 'steam', 'gog', 'steam', 'gog', 'epic', 'gog', 'steam', 'folder', 'steam'];
    const games = names.map((t, i) => ({ id: 'demo:' + i, source: src[i], title: t, installDir: '', size: (i + 2) * 3.1e9, lastPlayed: Date.now() - i * 86400e3 * 2.3, art: { cover: [], wide: [], hero: [], logo: [] }, icon: null, hidden: false }));
    const find = (id) => games.find((g) => g.id === id);
    return {
      scan: async () => ({ games, settings: {}, folders: [] }), launch: async (id) => ({ ok: true, game: find(id) }), openFolder: async () => {}, saveSettings: async () => {},
      addGame: async () => null, addFolder: async () => false, removeFolder: async () => {}, setCover: async () => null,
      rename: async (id, t) => { const g = find(id); g.title = t; return g; }, setHidden: async (id, h) => { const g = find(id); g.hidden = h; return g; },
      removeCustom: async () => {}, fullscreen: async () => {},
    };
  }
})();
