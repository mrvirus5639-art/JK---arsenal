(() => {
  'use strict';
  const api = window.spindle || demoApi();
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, kids) => { const e = document.createElement(tag); if (cls) e.className = cls; if (kids) e.append(...kids); return e; };

  // ---------- libraries ----------
  const SOURCES = {
    steam: { label: 'Steam', short: 'STEAM' }, epic: { label: 'Epic', short: 'EPIC GAMES' }, gog: { label: 'GOG', short: 'GOG' },
    folder: { label: 'Folders', short: 'FOLDER' }, custom: { label: 'Mine', short: 'ADDED BY YOU' },
    movie: { label: 'Movies', short: 'MOVIE' }, show: { label: 'TV', short: 'TV SHOW' }, album: { label: 'Albums', short: 'ALBUM' },
  };
  const LIBS = {
    games: {
      label: 'Games', noun: 'game', play: 'Play', disc: null,
      sorts: [['recent', 'Recently played'], ['name', 'A–Z'], ['size', 'Size on disk'], ['source', 'Store']],
      empty: ['No games on the shelf yet', 'Spindle reads Steam, Epic Games and GOG installs on its own. For other games, point it at the folder that holds them, or add a single .exe.'],
    },
    movies: {
      label: 'Movies', noun: 'movie', play: 'Watch', disc: 'DVD VIDEO',
      sorts: [['name', 'A–Z'], ['added', 'Recently added'], ['year', 'Release year'], ['recent', 'Recently watched'], ['size', 'Size on disk']],
      empty: ['No movies found', 'Spindle looks in your Videos folder. Add the folders where you keep films and TV shows — files like “Movie Name (2019).mkv” or “Show S01E02.mp4” are recognised, and poster.jpg / folder.jpg images are used as covers.'],
    },
    music: {
      label: 'Music', noun: 'album', play: 'Play album', disc: 'COMPACT DISC',
      sorts: [['artist', 'Artist'], ['name', 'Album A–Z'], ['added', 'Recently added'], ['year', 'Year'], ['recent', 'Recently played']],
      empty: ['No music found', 'Spindle looks in your Music folder. Add the folders where your albums live — each folder of tracks becomes one CD, using its tags and cover art.'],
    },
  };
  const LIB_KEYS = Object.keys(LIBS);
  const MODES = ['disc', 'case', 'save'];
  const state = {
    lib: 'games', games: [], view: [], selId: null, mode: 'case', sort: 'recent', filter: 'all', q: '', zoom: 1, showHidden: false, folders: [], pad: false,
    data: {}, per: { games: { mode: 'case', sort: 'recent', filter: 'all' }, movies: { mode: 'case', sort: 'name', filter: 'all' }, music: { mode: 'case', sort: 'artist', filter: 'all' } },
  };
  const byId = new Map();
  const L = () => LIBS[state.lib];

  // ---------- helpers ----------
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  const fmtSize = (b) => !b ? null : b >= 1e9 ? (b / 1e9).toFixed(b >= 1e11 ? 0 : 1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';
  const fmtDur = (s) => { if (!s && s !== 0) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const fmtLong = (s) => { if (!s) return null; if (s < 60) return Math.round(s) + ' s'; const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const ago = (t) => {
    if (!t) return null; const s = (Date.now() - t) / 1000;
    if (s < 3600) return 'just now'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400); if (d < 30) return d === 1 ? 'yesterday' : d + ' days ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const subOf = (g) => g.kind === 'music' ? g.artist : g.source === 'show' ? `TV · ${(g.tracks || []).length} EPISODES` : g.kind === 'movies' ? (g.year ? String(g.year) : 'MOVIE') : (SOURCES[g.source] || {}).short || '';
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
      if (g.kind === 'music' && g.artist) { const a2 = el('em'); a2.textContent = g.artist; node.append(a2); }
    }
  }
  function paintAll(g) {
    document.querySelectorAll('.art').forEach((n) => { if (n.dataset.gid === g.id) paint(n, g); });
    if (g.id === state.selId) setBg(g);
    if (player.album && player.album.id === g.id) updatePlayerBar();
  }
  function artNode(g, cls) { const n = el('div', 'art ' + cls); n.dataset.gid = g.id; n.style.setProperty('--h', hue(g.id)); paint(n, g); return n; }

  // ---------- physical objects ----------
  function discEl(g) {
    const spin = el('div', 'disc-spin', [el('div', 'disc-surface'), artNode(g, 'disc-label'), el('div', 'disc-ring')]);
    const mark = el('div', 'disc-mark'); mark.textContent = (LIBS[g.kind || 'games'] || {}).disc || (SOURCES[g.source] || {}).short || ''; spin.append(mark);
    return el('div', 'disc', [spin, el('div', 'disc-glare')]);
  }
  function caseEl(g) {
    return el('div', 'case', [el('div', 'case-disc', [discEl(g)]), el('div', 'case-body', [artNode(g, 'case-art'), el('div', 'case-spine'), el('div', 'case-gloss')])]);
  }
  function saveEl(g) {
    const title = el('div', 'fl-title'); const sp = el('span'); sp.textContent = g.kind === 'music' ? `${g.title} — ${g.artist}` : g.title; title.append(sp);
    const sh = el('div', 'fl-shutter', [el('b'), el('i')]);
    const body = el('div', 'fl-body', [el('div', 'fl-recess'), sh, el('div', 'fl-label', [el('div', 'fl-band'), artNode(g, 'fl-art'), title]),
      el('div', 'fl-hole'), el('div', 'fl-hole r'), el('div', 'fl-arrow')]);
    const f = el('div', 'floppy', [body]); f.style.setProperty('--h', hue(g.id)); return f;
  }
  const objEl = (g, mode) => (mode === 'disc' ? discEl(g) : mode === 'save' ? saveEl(g) : caseEl(g));

  // ---------- filters ----------
  function filterDefs() {
    const items = state.games.filter((g) => state.showHidden || !g.hidden);
    const defs = [{ key: 'all', label: 'All', test: () => true }];
    if (state.lib === 'games') {
      for (const k of ['steam', 'epic', 'gog', 'folder', 'custom']) defs.push({ key: k, label: SOURCES[k].label, test: (g) => g.source === k });
    } else {
      if (state.lib === 'movies') { defs.push({ key: 'movie', label: 'Movies', test: (g) => g.source === 'movie' }, { key: 'show', label: 'TV', test: (g) => g.source === 'show' }); }
      const groups = [...new Set(items.map((g) => g.group).filter(Boolean))];
      if (groups.length > 1) for (const gr of groups) defs.push({ key: 'g:' + gr, label: gr, test: (g) => g.group === gr });
    }
    for (const d of defs) d.count = items.filter(d.test).length;
    return defs.filter((d) => d.key === 'all' || d.count);
  }

  // ---------- view ----------
  function computeView() {
    const q = state.q.trim().toLowerCase();
    const f = filterDefs().find((d) => d.key === state.filter) || { test: () => true };
    const v = state.games.filter((g) => (state.showHidden || !g.hidden) && f.test(g) &&
      (!q || g.title.toLowerCase().includes(q) || (g.artist || '').toLowerCase().includes(q) || (g.tracks || []).some((t) => (t.title || '').toLowerCase().includes(q))));
    const name = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    const sorters = {
      name, recent: (a, b) => (b.lastPlayed - a.lastPlayed) || name(a, b), size: (a, b) => (b.size - a.size) || name(a, b),
      source: (a, b) => a.source.localeCompare(b.source) || name(a, b), added: (a, b) => ((b.added || 0) - (a.added || 0)) || name(a, b),
      year: (a, b) => ((b.year || 0) - (a.year || 0)) || name(a, b),
      artist: (a, b) => (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' }) || ((a.year || 0) - (b.year || 0)) || name(a, b),
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
      if (player.album && player.album.id === g.id) t.classList.add('playing');
      const cap = el('div', 'cap'); const tt = el('span', 't'); tt.textContent = g.title; const ss = el('span', 's'); ss.textContent = subOf(g);
      cap.append(tt, ss); t.append(el('div', 'stage', [objEl(g, state.mode)]), cap); t.title = g.kind === 'music' ? `${g.title} — ${g.artist}` : g.title;
      frag.append(t); io.observe(t);
    }
    grid.append(frag);
    const empty = state.games.length === 0;
    document.body.classList.toggle('is-empty', empty); $('#empty').hidden = !empty;
    if (empty) renderEmpty();
    if (!state.view.find((g) => g.id === state.selId)) state.selId = state.view[0] ? state.view[0].id : null;
    select(state.selId, { force: true, noScroll: true });
    renderFilters();
  }
  function renderEmpty() {
    const [h, p] = L().empty; $('#emptyTitle').textContent = state.scanning ? 'Scanning…' : h; $('#emptyText').textContent = p;
    const f = $('#emptyFolders'); f.textContent = state.folders.length ? 'Looking in: ' + state.folders.join(' · ') : '';
    $('#emptyAddGame').hidden = state.lib !== 'games';
  }

  function renderFilters() {
    const nav = $('#filters'); nav.replaceChildren();
    for (const d of filterDefs()) {
      const b = el('button', 'chip' + (state.filter === d.key ? ' on' : '')); b.dataset.f = d.key;
      const n = el('i'); n.textContent = d.count; b.append(d.label, n); nav.append(b);
    }
  }
  const filterKeys = () => filterDefs().map((d) => d.key);

  let heroFor = null;
  function select(id, opts = {}) {
    const prev = state.selId; state.selId = id; state.per[state.lib].selId = id;
    document.querySelectorAll('.tile.sel').forEach((t) => t.classList.remove('sel'));
    const tile = id && [...document.querySelectorAll('.tile')].find((t) => t.dataset.id === id);
    if (tile) { tile.classList.add('sel'); if (!opts.noScroll) tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const g = id && byId.get(id);
    if (!g) { $('#heroObj').replaceChildren(); $('#heroList').replaceChildren(); $('#hero').classList.remove('with-list'); return; }
    ensureArt(g);
    if (opts.force || prev !== id || heroFor !== state.mode + id) {
      heroFor = state.mode + id;
      const o = objEl(g, state.mode); if (state.mode === 'disc' && (g.kind !== 'music' || isPlaying(g))) o.classList.add('spin');
      $('#heroObj').replaceChildren(o);
    }
    $('#hero').dataset.src = g.source;
    $('#heroSrc').textContent = g.kind === 'music' ? (g.artist || '').toUpperCase() : (SOURCES[g.source] || {}).short || '';
    const h1 = $('#heroTitle'); if (h1.contentEditable !== 'true') h1.textContent = g.title;
    const meta = $('#heroMeta'); meta.replaceChildren();
    const add = (label, val) => { if (!val) return; const s = el('span'); const b = el('b'); b.textContent = val; s.append(label ? label + ' ' : '', b); meta.append(s); };
    if (g.kind === 'music') {
      add('', g.year ? String(g.year) : null); add('', `${g.tracks.length} track${g.tracks.length > 1 ? 's' : ''}`); add('', fmtLong(g.duration));
      add('Played', ago(g.lastPlayed));
    } else if (g.kind === 'movies') {
      add('', g.year ? String(g.year) : null); if (g.source === 'show') add('', g.subtitle);
      add('Watched', ago(g.lastPlayed) || 'never'); add('Size', fmtSize(g.size));
    } else { add('Last played', ago(g.lastPlayed) || 'never'); add('Size', fmtSize(g.size)); }
    if (g.installDir) { const s = el('span', 'path'); s.textContent = g.installDir; meta.append(s); }
    const pb = $('#playBtn'); pb.lastChild.textContent = g.kind === 'music' && isPlaying(g) && !player.audio.paused ? 'Pause' : g.source === 'show' ? 'Watch' : L().play;
    $('#shuffleBtn').hidden = g.kind !== 'music';
    $('#hideBtn').textContent = g.hidden ? 'Unhide' : 'Hide';
    $('#removeBtn').hidden = g.source !== 'custom';
    renderList(g);
    setBg(g);
  }
  function renderList(g) {
    const list = $('#heroList'); list.replaceChildren();
    const has = !!(g.tracks && g.tracks.length);
    $('#hero').classList.toggle('with-list', has); if (!has) return;
    g.tracks.forEach((t, i) => {
      const row = el('button', 'trk'); row.dataset.i = i;
      if (isPlaying(g) && player.idx === i) row.classList.add('now');
      const n = el('span', 'n'); n.textContent = g.source === 'show' ? '▶' : i + 1;
      const ti = el('span', 'ti'); ti.textContent = t.title;
      if (g.kind === 'music' && t.artist && t.artist !== g.artist) { const a = el('em'); a.textContent = t.artist; ti.append(a); }
      const d = el('span', 'd'); d.textContent = fmtDur(t.duration);
      row.append(n, ti, d); list.append(row);
    });
    const now = list.querySelector('.now'); if (now) now.scrollIntoView({ block: 'nearest' });
  }

  let bgFlip = false, bgUrl = null;
  function setBg(g) {
    const a = art.get(g.id); const url = a && a.done ? a.hero : null;
    if (url === bgUrl) return; bgUrl = url;
    const [on, off] = bgFlip ? [$('#bgA'), $('#bgB')] : [$('#bgB'), $('#bgA')]; bgFlip = !bgFlip;
    if (url) { on.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; on.classList.add('on'); } else on.classList.remove('on');
    off.classList.remove('on');
  }

  // ---------- music player ----------
  const player = { audio: new Audio(), album: null, idx: 0, order: null, shuffle: false };
  player.audio.preload = 'auto';
  const isPlaying = (g) => !!(player.album && g && player.album.id === g.id);
  function playAlbum(g, idx = 0, shuffle = false) {
    player.album = g; player.shuffle = shuffle;
    player.order = g.tracks.map((_, i) => i);
    if (shuffle) { for (let i = player.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [player.order[i], player.order[j]] = [player.order[j], player.order[i]]; } idx = player.order[0]; }
    playTrack(idx); api.played && api.played(g.id); g.lastPlayed = Date.now();
    document.querySelectorAll('.tile.playing').forEach((t) => t.classList.remove('playing'));
    const tile = [...document.querySelectorAll('.tile')].find((t) => t.dataset.id === g.id); if (tile) tile.classList.add('playing');
  }
  function playTrack(i) {
    const g = player.album; if (!g || !g.tracks[i]) return;
    player.idx = i; player.audio.src = g.tracks[i].url;
    player.audio.play().catch(() => toast('This file can’t be played here — try opening the folder.'));
    updatePlayerBar(); if (state.selId === g.id) { select(g.id, { force: true, noScroll: true }); }
  }
  function step(d) {
    if (!player.album) return;
    const pos = player.order.indexOf(player.idx) + d;
    if (d < 0 && player.audio.currentTime > 3) { player.audio.currentTime = 0; return; }
    if (pos >= 0 && pos < player.order.length) playTrack(player.order[pos]);
    else if (d > 0) { player.audio.pause(); player.audio.currentTime = 0; updatePlayerBar(); }
  }
  const togglePause = () => { if (!player.album) return; if (player.audio.paused) player.audio.play(); else player.audio.pause(); };
  player.audio.addEventListener('ended', () => step(1));
  player.audio.addEventListener('play', () => { updatePlayerBar(); refreshPlayingUi(); });
  player.audio.addEventListener('pause', () => { updatePlayerBar(); refreshPlayingUi(); });
  player.audio.addEventListener('timeupdate', () => {
    const a = player.audio; if (!a.duration) return;
    if (!seeking) $('#pSeek').value = String((a.currentTime / a.duration) * 1000);
    $('#pTime').textContent = `${fmtDur(a.currentTime)} / ${fmtDur(a.duration)}`;
  });
  function refreshPlayingUi() {
    document.body.classList.toggle('audio-on', !!player.album && !player.audio.paused);
    const g = cur(); if (g && g.kind === 'music') { const pb = $('#playBtn'); pb.lastChild.textContent = isPlaying(g) && !player.audio.paused ? 'Pause' : L().play; }
  }
  function updatePlayerBar() {
    const g = player.album; const bar = $('#player');
    bar.hidden = !g; document.body.classList.toggle('has-player', !!g); if (!g) return;
    const t = g.tracks[player.idx] || {};
    $('#pTitle').textContent = t.title || ''; $('#pSub').textContent = `${t.artist || g.artist} — ${g.title}`;
    $('#pPlay').classList.toggle('paused', player.audio.paused);
    $('#pShuffle').classList.toggle('on', player.shuffle);
    const a = art.get(g.id); const th = $('#pArt'); th.style.backgroundImage = a && a.cover ? `url("${a.cover.replace(/"/g, '%22')}")` : ''; th.style.setProperty('--h', hue(g.id));
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || '', artist: t.artist || g.artist, album: g.title, artwork: a && a.cover && !a.cover.startsWith('file:') ? [{ src: a.cover, sizes: '600x600' }] : [] });
      } catch {}
    }
    document.querySelectorAll('#heroList .trk').forEach((r) => r.classList.toggle('now', isPlaying(cur()) && +r.dataset.i === player.idx));
  }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', togglePause); navigator.mediaSession.setActionHandler('pause', togglePause);
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1)); navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    } catch {}
  }
  let seeking = false;
  $('#pSeek').addEventListener('input', () => { seeking = true; });
  $('#pSeek').addEventListener('change', (e) => { const a = player.audio; if (a.duration) a.currentTime = (e.target.value / 1000) * a.duration; seeking = false; });
  $('#pVol').addEventListener('input', (e) => { player.audio.volume = +e.target.value; api.saveSettings({ volume: player.audio.volume }); });
  $('#pPlay').onclick = togglePause; $('#pPrev').onclick = () => step(-1); $('#pNext').onclick = () => step(1);
  $('#pShuffle').onclick = () => { if (player.album) { const keep = player.idx; playAlbum(player.album, keep, !player.shuffle); } };
  $('#pStop').onclick = () => { player.audio.pause(); player.audio.removeAttribute('src'); player.album = null; updatePlayerBar(); refreshPlayingUi(); renderGrid(); };
  $('#pArt').onclick = () => { if (player.album) { if (state.lib !== 'music') switchLib('music').then(() => select(player.album.id)); else select(player.album.id); } };

  // ---------- actions ----------
  const cur = () => byId.get(state.selId);
  async function play(index) {
    const g = cur(); if (!g) return;
    if (g.kind === 'music') {
      if (index == null && isPlaying(g)) { togglePause(); return; }
      playAlbum(g, index || 0); return;
    }
    toast((g.kind === 'movies' ? 'Opening ' : 'Launching ') + (g.source === 'show' && g.tracks[index || 0] ? g.tracks[index || 0].title : g.title) + '…');
    const r = await api.launch(g.id, index || 0);
    if (!r || !r.ok) toast((r && r.error) || 'Couldn’t start that.');
    else if (r.game) upsert(r.game, { keepOrder: true });
  }
  function upsert(g, opts = {}) {
    const list = state.data[g.kind || 'games'] || state.games;
    const i = list.findIndex((x) => x.id === g.id);
    if (i >= 0) list[i] = g; else list.push(g);
    byId.set(g.id, g);
    if (player.album && player.album.id === g.id) player.album = g;
    if ((g.kind || 'games') !== state.lib) return;
    if (opts.keepOrder) { ensureArt(g); select(state.selId, { force: true, noScroll: true }); }
    else renderGrid();
  }
  function saveLibSettings() { api.saveSettings({ lib: state.lib, libs: { [state.lib]: { mode: state.mode, sort: state.sort, filter: state.filter } } }); }
  function setMode(m) {
    if (!MODES.includes(m)) return; state.mode = m; state.per[state.lib].mode = m; document.body.dataset.mode = m;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    saveLibSettings(); renderGrid();
  }
  const cycleMode = () => setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
  function setFilter(f) { state.filter = f; state.per[state.lib].filter = f; saveLibSettings(); renderGrid(); }
  function cycleFilter(d) { const ks = filterKeys(); const i = ks.indexOf(state.filter); setFilter(ks[(i + d + ks.length) % ks.length]); }
  function setZoom(z) { state.zoom = Math.min(1.6, Math.max(.7, z)); document.documentElement.style.setProperty('--z', state.zoom); api.saveSettings({ zoom: state.zoom }); }

  async function load(kind, force) {
    if (!force && state.data[kind]) return;
    state.scanning = true; if (kind === state.lib && !state.games.length) renderEmpty();
    if (kind !== 'games' && !state.data[kind]) toast(`Scanning your ${LIBS[kind].label.toLowerCase()}…`);
    const r = await api.scan(kind);
    state.scanning = false;
    for (const g of state.data[kind] || []) byId.delete(g.id);
    state.data[kind] = r.games || []; state.foldersBy = state.foldersBy || {}; state.foldersBy[kind] = r.folders || [];
    for (const g of state.data[kind]) { g.kind = g.kind || kind; byId.set(g.id, g); art.delete(g.id); }
  }
  async function rescan(msg) { await load(state.lib, true); applyLib(); if (msg) toast(msg); }
  function applyLib() {
    const p = state.per[state.lib];
    state.games = state.data[state.lib] || []; state.folders = (state.foldersBy || {})[state.lib] || [];
    state.mode = MODES.includes(p.mode) ? p.mode : 'case'; state.sort = p.sort; state.filter = p.filter || 'all'; state.selId = p.selId || null;
    if (state.filter !== 'all' && !filterKeys().includes(state.filter)) state.filter = 'all';
    document.body.dataset.mode = state.mode; document.body.dataset.lib = state.lib;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    document.querySelectorAll('#libs button').forEach((b) => b.classList.toggle('on', b.dataset.lib === state.lib));
    const sel = $('#sort'); sel.replaceChildren(...L().sorts.map(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; return o; }));
    if (!L().sorts.some(([v]) => v === state.sort)) state.sort = L().sorts[0][0];
    sel.value = state.sort; $('#q').placeholder = 'Search ' + L().label.toLowerCase();
    heroFor = null; renderGrid(); hints();
  }
  async function switchLib(kind) {
    if (!LIBS[kind]) return; state.lib = kind; state.q = ''; $('#q').value = '';
    applyLib(); api.saveSettings({ lib: kind });
    if (!state.data[kind]) { await load(kind); if (state.lib === kind) applyLib(); }
  }
  const cycleLib = (d) => switchLib(LIB_KEYS[(LIB_KEYS.indexOf(state.lib) + d + LIB_KEYS.length) % LIB_KEYS.length]);

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
    if (state.lib === 'games') item('Add a game (.exe)…', '', addGame);
    item(`Add a ${state.lib === 'games' ? 'games' : state.lib === 'movies' ? 'movies / TV' : 'music'} folder…`, '', addFolder);
    item('Scan again', 'F5', () => rescan('Library refreshed'));
    item(state.showHidden ? `Don’t show hidden ${L().noun}s` : `Show hidden ${L().noun}s`, '', () => { state.showHidden = !state.showHidden; renderGrid(); });
    item('Full screen', 'F11', () => api.fullscreen());
    if (state.folders.length) {
      m.append(el('hr')); const s = el('div', 'sub'); s.textContent = `Your ${L().label.toLowerCase()} folders`; m.append(s);
      for (const f of state.folders) {
        const row = el('div', 'folder'); const b = el('b'); b.textContent = f; const x = el('button'); x.textContent = 'Remove';
        x.onclick = async () => { await api.removeFolder(f, state.lib); closeMenu(); rescan('Folder removed'); }; row.append(b, x); m.append(row);
      }
    }
  }
  const closeMenu = () => { $('#menu').hidden = true; };
  async function addGame() { const id = await api.addGame(); if (id) { await rescan('Added to your shelf'); select(id); } }
  async function addFolder() { if (await api.addFolder(state.lib)) { toast('Folder added — scanning'); rescan(); } }

  // ---------- wiring ----------
  $('#libs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchLib(b.dataset.lib); });
  $('#grid').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) select(t.dataset.id); });
  $('#grid').addEventListener('dblclick', (e) => { if (e.target.closest('.tile')) play(); });
  $('#grid').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.08 : 0.93)); } }, { passive: false });
  $('#filters').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setFilter(b.dataset.f); });
  $('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; state.per[state.lib].sort = state.sort; saveLibSettings(); renderGrid(); });
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
  $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#menu'); if (m.hidden) { buildMenu(); m.hidden = false; } else closeMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  $('#heroObj').addEventListener('dblclick', () => play());
  $('#heroList').addEventListener('click', (e) => { const r = e.target.closest('.trk'); if (r) play(+r.dataset.i); });
  $('#playBtn').onclick = () => play();
  $('#shuffleBtn').onclick = () => { const g = cur(); if (g && g.kind === 'music') playAlbum(g, 0, true); };
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
    const typing = e.target.matches('input:not([type=range]), select, [contenteditable="true"]');
    if (e.key === 'Escape') { closeMenu(); if (typing) { e.target.blur(); if (e.target.id === 'q' && state.q) { e.target.value = state.q = ''; renderGrid(); } } return; }
    if (e.key === 'F5') { e.preventDefault(); rescan('Library refreshed'); return; }
    if (typing) { if (e.target.id === 'q' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.target.blur(); } return; }
    state.pad = false; hints();
    const k = e.key;
    if (e.ctrlKey && k === 'Tab') { e.preventDefault(); cycleLib(e.shiftKey ? -1 : 1); return; }
    if (e.altKey && ['1', '2', '3'].includes(k)) { e.preventDefault(); switchLib(LIB_KEYS[+k - 1]); return; }
    if (k === 'ArrowLeft') move('left'); else if (k === 'ArrowRight') move('right'); else if (k === 'ArrowUp') move('up'); else if (k === 'ArrowDown') move('down');
    else if (k === 'Enter') play();
    else if (k === ' ' && player.album) togglePause();
    else if (k === 'MediaTrackNext' || (k === '.' && player.album)) step(1); else if (k === 'MediaTrackPrevious' || (k === ',' && player.album)) step(-1);
    else if (k === '/' || (e.ctrlKey && k.toLowerCase() === 'f')) { e.preventDefault(); $('#q').focus(); }
    else if (k === '1' || k === '2' || k === '3') setMode(MODES[+k - 1]);
    else if (k === 'Tab') { e.preventDefault(); cycleMode(); }
    else if (k === '[' || k === 'q') cycleFilter(-1); else if (k === ']' || k === 'e') cycleFilter(1);
    else if (k === 'PageUp') cycleLib(-1); else if (k === 'PageDown') cycleLib(1);
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
      edge('b', b(1), () => { closeMenu(); if (state.q) { $('#q').value = state.q = ''; renderGrid(); } else if (player.album) togglePause(); });
      edge('x', b(2), cycleMode);
      edge('y', b(3), () => $('#q').focus());
      edge('lb', b(4), () => cycleFilter(-1)); edge('rb', b(5), () => cycleFilter(1));
      edge('lt', b(6), () => cycleLib(-1)); edge('rt', b(7), () => cycleLib(1));
      edge('select', b(8), () => rescan('Library refreshed'));
      edge('start', b(9), () => api.fullscreen());
      edge('ls', b(10), () => step(-1)); edge('rs', b(11), () => step(1));
    }
    requestAnimationFrame(poll);
  }
  window.addEventListener('gamepadconnected', () => { state.pad = true; hints(); toast('Controller connected'); });

  function hints() {
    const h = $('#hints'); h.replaceChildren();
    const playWord = state.lib === 'movies' ? 'Watch' : 'Play';
    const rows = state.pad
      ? [['a', 'A', playWord], ['x', 'X', 'Style'], ['y', 'Y', 'Search'], ['', 'LB RB', 'Filter'], ['', 'LT RT', 'Games · Movies · Music'], ['b', 'B', state.lib === 'music' ? 'Pause' : 'Back']]
      : [['k', '← → ↑ ↓', 'Move'], ['k', 'Enter', playWord], ...(state.lib === 'music' ? [['k', 'Space', 'Pause'], ['k', ', .', 'Track']] : []), ['k', 'Tab', 'Style'], ['k', '/', 'Search'], ['k', 'Q E', 'Filter'], ['k', 'Ctrl + Tab', 'Library'], ['k', 'Ctrl + wheel', 'Size']];
    for (const [c, key, label] of rows) { const s = el('span'); const g = el('span', c === 'k' ? 'k' : 'g ' + c); g.textContent = key; s.append(g, label); h.append(s); }
  }

  if (api.onGameUpdated) api.onGameUpdated((g) => { if (byId.get(g.id)) upsert(g, { keepOrder: true }); });
  if (api.onToast) api.onToast(toast);

  // ---------- boot ----------
  (async () => {
    hints();
    if (api.version) api.version().then((v) => { $('#ver').textContent = 'v' + String(v).replace(/\.0$/, ''); });
    const first = await api.scan('games');
    const s = first.settings || {};
    for (const k of LIB_KEYS) state.per[k] = { ...state.per[k], ...((s.libs || {})[k] || {}) };
    if (s.mode && !(s.libs && s.libs.games)) state.per.games.mode = s.mode; // settings from Spindle 1.0
    state.data.games = first.games; state.foldersBy = { games: first.folders || [] };
    for (const g of first.games) { g.kind = 'games'; byId.set(g.id, g); }
    state.zoom = s.zoom || 1; document.documentElement.style.setProperty('--z', state.zoom);
    player.audio.volume = typeof s.volume === 'number' ? s.volume : 0.8; $('#pVol').value = String(player.audio.volume);
    const startLib = LIBS[s.lib] ? s.lib : 'games';
    if (startLib === 'games') { state.lib = 'games'; applyLib(); } else await switchLib(startLib);
    requestAnimationFrame(poll);
  })();

  // ---------- browser preview (opened outside the app) ----------
  function demoApi() {
    const mk = (kind, list) => list.map(([t, src, extra], i) => ({ id: `demo:${kind}:${i}`, kind, source: src, title: t, installDir: '', size: (i + 2) * 3.1e9, lastPlayed: Date.now() - i * 86400e3 * 2.3, added: Date.now() - i * 3e8, art: { cover: [], wide: [], hero: [], logo: [] }, icon: null, hidden: false, ...(extra || {}) }));
    const data = {
      games: mk('games', [['Hollow Knight', 'steam'], ['Hades', 'steam'], ['Celeste', 'epic'], ['Disco Elysium', 'gog'], ['Balatro', 'folder']]),
      movies: mk('movies', [['Interstellar', 'movie', { year: 2014 }], ['Spirited Away', 'movie', { year: 2001 }], ['Dark', 'show', { subtitle: '3 seasons · 26 episodes', tracks: [{ title: 'S01E01 · Secrets' }, { title: 'S01E02 · Lies' }] }]]),
      music: mk('music', [['Random Access Memories', 'album', { artist: 'Daft Punk', year: 2013, duration: 4475, tracks: [{ title: 'Give Life Back to Music', duration: 275, url: '' }, { title: 'The Game of Love', duration: 321, url: '' }] }]]),
    };
    const all = () => Object.values(data).flat(); const find = (id) => all().find((g) => g.id === id);
    return {
      scan: async (k = 'games') => ({ games: data[k], settings: {}, folders: [] }), launch: async (id) => ({ ok: true, game: find(id) }), played: async () => {}, openFolder: async () => {}, saveSettings: async () => {},
      addGame: async () => null, addFolder: async () => false, removeFolder: async () => {}, setCover: async () => null,
      rename: async (id, t) => { const g = find(id); g.title = t; return g; }, setHidden: async (id, h) => { const g = find(id); g.hidden = h; return g; },
      removeCustom: async () => {}, fullscreen: async () => {},
    };
  }
})();
