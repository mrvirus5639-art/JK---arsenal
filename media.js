// Spindle — finds local movies, TV shows and music albums in the folders you choose.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.wmv', '.mpg', '.mpeg', '.ts', '.m2ts', '.flv', '.vob']);
const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.wma', '.aiff', '.aif', '.ape', '.alac']);
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const MIN_MOVIE_BYTES = 40 * 1024 * 1024; // skip short clips, samples, trailers
const SKIP_DIRS = /^(sample|samples|extras|featurettes|behind the scenes|deleted scenes|trailers?|subs|subtitles|\$recycle\.bin|system volume information|\..*)$/i;

const fileUrl = (p) => pathToFileURL(p).href;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const readdir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const statSafe = (p) => { try { return fs.statSync(p); } catch { return null; } };

function walk(root, onDir, maxDepth = 5) {
  const go = (dir, depth) => {
    const ents = readdir(dir);
    onDir(dir, ents, depth);
    if (depth >= maxDepth) return;
    for (const e of ents) if (e.isDirectory() && !SKIP_DIRS.test(e.name)) go(path.join(dir, e.name), depth + 1);
  };
  go(root, 0);
}

// Find an image next to a file/folder by common media-center names (Kodi, Jellyfin, Plex, Windows Media Player)
function findImage(dir, ents, names) {
  const files = ents.filter((e) => e.isFile()).map((e) => e.name);
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  for (const n of names) for (const ext of IMG_EXT) { const hit = lower.get((n + ext).toLowerCase()); if (hit) return path.join(dir, hit); }
  return null;
}

// ---------- titles ----------
const TAG = /\b(2160p|1080p|1080i|720p|480p|4k|uhd|hdr10?\+?|dv|bluray|blu-ray|bdrip|brrip|webrip|web-?dl|web|hdrip|dvdrip|dvdscr|hdtv|x26[45]|h\.?26[45]|hevc|avc|xvid|divx|aac|ac3|dts|ddp?5\.1|atmos|10bit|remux|proper|repack|extended|unrated|imax|yify|yts|rarbg|multi|dual)\b.*$/i;
function cleanTitle(raw) {
  let s = raw.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/[._]+/g, ' ');
  let year = null;
  // the release year is the LAST plausible year that isn't the start of the name ("Blade Runner 2049 2017", "2001 A Space Odyssey 1968")
  const years = [...s.matchAll(/[([]?\b((?:19|20)\d{2})\b[)\]]?/g)].filter((m) => m.index > 1 && Number(m[1]) <= new Date().getFullYear() + 1);
  const y = years[years.length - 1];
  if (y) { s = s.slice(0, y.index).trim(); year = Number(y[1]); }
  s = s.replace(TAG, '').replace(/\(\s*\)/g, '').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title: s || raw, year };
}
const EP = /^(.*?)[\s._-]*[sS](\d{1,2})[\s._-]*[eE](\d{1,3})(?:[\s._-]*(.*))?$/;
const EP_X = /^(.*?)[\s._-]+(\d{1,2})x(\d{2,3})(?:[\s._-]*(.*))?$/;

// ---------- movies & TV ----------
function scanMovies(folders = []) {
  const movies = []; const shows = new Map();
  for (const root of folders) {
    const group = path.basename(root) || root;
    walk(root, (dir, ents) => {
      const vids = ents.filter((e) => e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()) && !/\bsample\b/i.test(e.name));
      for (const v of vids) {
        const file = path.join(dir, v.name); const st = statSafe(file); if (!st) continue;
        const base = path.basename(v.name, path.extname(v.name));
        const m = base.match(EP) || base.match(EP_X);
        if (m) {
          // TV episode → group into one item per show
          let show = cleanTitle(m[1] || '').title;
          if (!show || show.length < 2) { const parent = path.basename(dir); show = cleanTitle(/^season\s*\d+$/i.test(parent) ? path.basename(path.dirname(dir)) : parent).title; }
          const key = show.toLowerCase();
          if (!shows.has(key)) shows.set(key, { show, group, dir: /^season\s*\d+$/i.test(path.basename(dir)) ? path.dirname(dir) : dir, eps: [], size: 0, mtime: 0 });
          const s = shows.get(key);
          const epName = m[4] ? cleanTitle(m[4]).title : '';
          s.eps.push({ season: +m[2], episode: +m[3], title: `S${String(m[2]).padStart(2, '0')}E${String(m[3]).padStart(2, '0')}${epName ? ' · ' + epName : ''}`, file });
          s.size += st.size; s.mtime = Math.max(s.mtime, st.mtimeMs);
          continue;
        }
        if (st.size < MIN_MOVIE_BYTES) continue;
        const generic = /^(movie|video|film|main|feature|vts_\d+_\d+)$/i.test(base);
        const parentName = path.basename(dir);
        const fromFolder = generic || vids.length === 1 && cleanTitle(parentName).year && !cleanTitle(base).year;
        const { title, year } = cleanTitle(fromFolder ? parentName : base);
        const alone = vids.length === 1;
        const cover = findImage(dir, ents, [`${base}-poster`, `${base}.poster`, base, ...(alone ? ['poster', 'folder', 'cover', 'movie'] : [])]);
        const hero = findImage(dir, ents, [`${base}-fanart`, `${base}-backdrop`, ...(alone ? ['fanart', 'backdrop', 'background'] : [])]);
        movies.push({
          id: `movie:${file.toLowerCase()}`, kind: 'movies', source: 'movie', group, title, year, file,
          installDir: dir, size: st.size, added: st.mtimeMs, lastPlayed: 0,
          art: { cover: cover ? [fileUrl(cover)] : [], wide: [], hero: hero ? [fileUrl(hero)] : [], logo: [] },
        });
      }
    }, 5);
  }
  for (const s of shows.values()) {
    s.eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
    const ents = readdir(s.dir);
    const cover = findImage(s.dir, ents, ['poster', 'folder', 'cover', 'show']);
    const hero = findImage(s.dir, ents, ['fanart', 'backdrop', 'background']);
    const seasons = new Set(s.eps.map((e) => e.season)).size;
    movies.push({
      id: `show:${s.dir.toLowerCase()}|${s.show.toLowerCase()}`, kind: 'movies', source: 'show', group: s.group, title: s.show, year: null,
      subtitle: `${seasons} season${seasons > 1 ? 's' : ''} · ${s.eps.length} episode${s.eps.length > 1 ? 's' : ''}`,
      installDir: s.dir, size: s.size, added: s.mtime, lastPlayed: 0,
      tracks: s.eps.map((e) => ({ title: e.title, file: e.file })),
      art: { cover: cover ? [fileUrl(cover)] : [], wide: [], hero: hero ? [fileUrl(hero)] : [], logo: [] },
    });
  }
  return movies;
}

// ---------- music ----------
let mm = null;
async function metaLib() { if (mm === null) { try { mm = await import('music-metadata'); } catch { mm = false; } } return mm || null; }

async function mapLimit(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}

// cache: { [file]: { m: mtimeMs, t: {title, artist, album, albumartist, year, track, disk, duration} } }
async function readTags(file, st, cache) {
  const c = cache[file];
  if (c && c.m === st.mtimeMs) return c.t;
  const lib = await metaLib(); let t = null;
  if (lib) {
    try {
      const r = await lib.parseFile(file, { duration: true, skipCovers: true });
      const cm = r.common || {};
      t = { title: cm.title || null, artist: cm.artist || null, album: cm.album || null, albumartist: cm.albumartist || null,
        year: cm.year || null, track: (cm.track && cm.track.no) || null, disk: (cm.disk && cm.disk.no) || null,
        duration: (r.format && r.format.duration) || null };
    } catch { t = null; }
  }
  cache[file] = { m: st.mtimeMs, t }; return t;
}
async function embeddedCover(file, coversDir) {
  const lib = await metaLib(); if (!lib) return null;
  const out = path.join(coversDir, 'emb_' + crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16));
  for (const ext of ['.jpg', '.png']) if (fs.existsSync(out + ext)) return out + ext;
  try {
    const r = await lib.parseFile(file, { duration: false, skipCovers: false });
    const pics = (r.common && r.common.picture) || [];
    const pic = pics.find((p) => /front/i.test(p.type || '')) || pics[0];
    if (!pic || !pic.data) return null;
    const ext = /png/i.test(pic.format || '') ? '.png' : '.jpg';
    fs.mkdirSync(coversDir, { recursive: true }); fs.writeFileSync(out + ext, Buffer.from(pic.data)); return out + ext;
  } catch { return null; }
}
const trackTitleFromFile = (name) => path.basename(name, path.extname(name)).replace(/^\s*(\d{1,3}[\s._-]+)+/, '').replace(/[._]+/g, ' ').trim() || name;

async function scanMusic(folders = [], opts = {}) {
  const cache = opts.tagCache || {}; const coversDir = opts.coversDir || path.join(require('os').tmpdir(), 'spindle-covers');
  const dirs = [];
  for (const root of folders) {
    const group = path.basename(root) || root;
    walk(root, (dir, ents, depth) => {
      const auds = ents.filter((e) => e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()));
      if (auds.length) dirs.push({ dir, ents, auds, depth, root, group });
    }, 6);
  }
  const albums = [];
  await mapLimit(dirs, 4, async (d) => {
    const files = d.auds.map((e) => path.join(d.dir, e.name)).sort(natural);
    const tracks = await mapLimit(files, 6, async (file) => {
      const st = statSafe(file); if (!st) return null;
      const t = await readTags(file, st, cache);
      return { file, url: fileUrl(file), size: st.size, mtime: st.mtimeMs, tags: t };
    });
    const ok = tracks.filter(Boolean);
    if (!ok.length) return;
    // Albums split by tag when one folder holds several albums (e.g. a "Singles" folder)
    const groups = new Map();
    for (const tr of ok) {
      const t = tr.tags || {};
      const key = d.depth === 0 && t.album ? t.album.toLowerCase() : '__folder__';
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(tr);
    }
    for (const [key, trs] of groups) {
      const tags = trs.map((x) => x.tags || {});
      const pick = (f) => { const c = {}; for (const t of tags) if (t[f]) c[t[f]] = (c[t[f]] || 0) + 1; return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null; };
      const folderName = path.basename(d.dir);
      const parentName = d.depth >= 1 ? path.basename(path.dirname(d.dir)) : null;
      let album = pick('album'); let artist = pick('albumartist') || pick('artist');
      if (!album) album = d.depth === 0 ? 'Loose tracks' : folderName.replace(/^\s*(.+?)\s+-\s+(.+)$/, (m, a, b) => { if (!artist) artist = a; return b; });
      if (!artist && parentName && d.depth >= 2) artist = parentName;
      const year = Number(pick('year')) || null;
      trs.sort((a, b) => ((a.tags && a.tags.disk) || 1) - ((b.tags && b.tags.disk) || 1) || ((a.tags && a.tags.track) || 0) - ((b.tags && b.tags.track) || 0) || natural(a.file, b.file));
      let cover = groups.size === 1 ? findImage(d.dir, d.ents, ['cover', 'folder', 'front', 'album', 'albumart', 'albumartlarge', 'artwork', album]) : null;
      if (!cover && groups.size === 1) { const anyImg = d.ents.filter((e) => e.isFile() && IMG_EXT.includes(path.extname(e.name).toLowerCase()) && !/back|cd|disc|inlay|small/i.test(e.name)); if (anyImg.length === 1) cover = path.join(d.dir, anyImg[0].name); }
      if (!cover) cover = await embeddedCover(trs[0].file, coversDir);
      const duration = trs.reduce((s, x) => s + ((x.tags && x.tags.duration) || 0), 0);
      albums.push({
        id: `album:${d.dir.toLowerCase()}${key === '__folder__' ? '' : '|' + key}`, kind: 'music', source: 'album', group: d.group,
        title: album, artist: artist || 'Unknown artist', year, subtitle: artist || 'Unknown artist',
        installDir: d.dir, size: trs.reduce((s, x) => s + x.size, 0), added: Math.max(...trs.map((x) => x.mtime)), lastPlayed: 0, duration,
        tracks: trs.map((x) => ({ title: (x.tags && x.tags.title) || trackTitleFromFile(x.file), artist: (x.tags && x.tags.artist) || artist || '', duration: (x.tags && x.tags.duration) || null, url: x.url, file: x.file })),
        art: { cover: cover ? [fileUrl(cover)] : [], wide: [], hero: [], logo: [] },
      });
    }
  });
  return albums;
}

module.exports = { cleanTitle, scanMovies, scanMusic, VIDEO_EXT, AUDIO_EXT };
