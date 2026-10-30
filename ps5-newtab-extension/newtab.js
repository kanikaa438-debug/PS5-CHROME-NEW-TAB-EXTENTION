'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => c != null && n.append(c));
  return n;
}
const icon = cls => el('i', { class: cls, 'aria-hidden': 'true' });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const errMsg = e => (e && e.name === 'QuotaExceededError') ? 'Not enough browser storage space. Delete some saved wallpapers and try again.' : ((e && e.message) || 'Something went wrong.');

/* ---------- constants ---------- */
const DB_NAME = 'PS5_NewTab_DB', DB_VERSION = 2;
const SETTINGS_KEY = 'ps5_settings_v2', SITES_KEY = 'ps5_user_sites';
const CATS = ['favorites', 'bookmarks'];
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'];
const MAX_FILE = 25 * 1024 * 1024, WP_MAX_DIM = 2560, AVATAR_SIZE = 256;
const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1f2937"/><circle cx="50" cy="38" r="18" fill="#9ca3af"/><path d="M14 100c2-26 18-38 36-38s34 12 36 38z" fill="#9ca3af"/></svg>');
const ICONS = {
  globe: ['Globe', 'fa-solid fa-globe text-blue-400'], star: ['Star', 'fa-solid fa-star text-yellow-400'],
  bookmark: ['Bookmark', 'fa-solid fa-bookmark text-indigo-300'], gamepad: ['Gamepad', 'fa-solid fa-gamepad text-green-400'],
  music: ['Music', 'fa-solid fa-music text-pink-400'], code: ['Code', 'fa-solid fa-code text-cyan-400'],
  news: ['News', 'fa-solid fa-newspaper text-gray-200'], cart: ['Shopping', 'fa-solid fa-cart-shopping text-orange-400'],
  mail: ['Mail', 'fa-solid fa-envelope text-sky-400'], heart: ['Heart', 'fa-solid fa-heart text-red-400']
};
const DEFAULT_FAVORITES = [
  { id: 'youtube', title: 'YouTube', tagline: 'Watch videos, music, and streams', icon: 'fa-brands fa-youtube text-red-500', accentColor: 'rgba(220, 38, 38, 0.55)', url: 'https://www.youtube.com', isDefault: true },
  { id: 'github', title: 'GitHub', tagline: 'Where the world builds software', icon: 'fa-brands fa-github text-white', accentColor: 'rgba(99, 102, 241, 0.5)', url: 'https://github.com', isDefault: true },
  { id: 'reddit', title: 'Reddit', tagline: 'Dive into anything & community discussions', icon: 'fa-brands fa-reddit-alien text-orange-500', accentColor: 'rgba(234, 88, 12, 0.55)', url: 'https://www.reddit.com', isDefault: true },
  { id: 'google', title: 'Google Search', tagline: "Search the world's information", icon: 'fa-brands fa-google text-blue-400', accentColor: 'rgba(37, 99, 235, 0.55)', url: 'https://www.google.com', isDefault: true },
  { id: 'twitch', title: 'Twitch', tagline: 'Live streaming & esports broadcasts', icon: 'fa-brands fa-twitch text-purple-400', accentColor: 'rgba(147, 51, 234, 0.55)', url: 'https://www.twitch.tv', isDefault: true }
];
const DEFAULT_BOOKMARKS = [
  { id: 'netflix', title: 'Netflix', tagline: 'Watch TV shows & movies online', icon: 'fa-solid fa-film text-red-600', accentColor: 'rgba(185, 28, 28, 0.6)', url: 'https://www.netflix.com', isDefault: true },
  { id: 'twitter', title: 'X / Twitter', tagline: "See what's happening right now", icon: 'fa-brands fa-x-twitter text-white', accentColor: 'rgba(56, 189, 248, 0.5)', url: 'https://x.com', isDefault: true }
];

const ALL_DEFAULTS = [...DEFAULT_FAVORITES, ...DEFAULT_BOOKMARKS];
const findDefault = id => ALL_DEFAULTS.find(s => s.id === id) || null;
const defaultCat = id => DEFAULT_FAVORITES.some(s => s.id === id) ? 'favorites' : 'bookmarks';
const LOGO_KEY = 'ps5_logo_cache_v1';

/* ---------- state ---------- */
let settings, sitesData, items = [], activeIndex = 0, currentCategory = 'favorites';
let db = null, storageOk = true, hasLegacyStore = false;
let audioCtx = null, cardEls = [], titleTimer = 0;
let shownWp = null, bgToken = 0, activeLayer = 0, layerUrl = ['', ''], galleryToken = 0, thumbUrls = [];
const visibleDefaults = cat => (cat === 'favorites' ? DEFAULT_FAVORITES : DEFAULT_BOOKMARKS).filter(s => !sitesData.hidden.includes(s.id));
let pendingWp = null, siteEditId = null, savingSite = false, avatarUrl = '', crop = null, cfResolve = null, toastTimer = 0;
const modalStack = [];

/* ---------- URL safety ---------- */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s || /\s/.test(s)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (hasScheme && !/^https?:\/\//i.test(s) && !/^[^\s/:]+:\d+(\/|$|\?|#)/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
    if (!u.hostname.includes('.') && !u.hostname.includes(':') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch { return null; }
}
const urlKey = u => u.replace(/\/+$/, '').toLowerCase();
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Website'; } }
function niceName(url) {
  const p = hostOf(url).split('.');
  const second = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'];
  const base = (p.length > 2 && second.includes(p[p.length - 2]) && p[p.length - 1].length === 2) ? p[p.length - 3] : (p[p.length - 2] || p[0] || 'Website');
  return base.charAt(0).toUpperCase() + base.slice(1);
}
function accentFor(url) { let h = 0; const k = hostOf(url); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return `hsla(${h % 360}, 70%, 50%, .5)`; }

/* ---------- website logos (real favicons) ---------- */
let logoCache = {};
try { logoCache = JSON.parse(localStorage.getItem(LOGO_KEY) || '{}') || {}; } catch { logoCache = {}; }
const saveLogoCache = () => { try { localStorage.setItem(LOGO_KEY, JSON.stringify(logoCache)); } catch {} };
const logoPending = new Map();
function logoSources(url) {
  let u; try { u = new URL(url); } catch { return []; }
  const list = [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=${encodeURIComponent(u.origin)}&size=128`,
    `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`
  ];
  // Chrome's own favicon cache: works offline and for sites you already visited.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) list.push(chrome.runtime.getURL('/_favicon/') + `?pageUrl=${encodeURIComponent(u.origin + '/')}&size=64`);
  return list;
}
const probeImage = src => new Promise(res => {
  const im = new Image(); im.referrerPolicy = 'no-referrer';
  const t = setTimeout(() => { im.onload = im.onerror = null; res(null); }, 7000);
  im.onload = () => { clearTimeout(t); res({ src, w: im.naturalWidth }); };
  im.onerror = () => { clearTimeout(t); res(null); };
  im.src = src;
});
function resolveLogo(url) {
  const key = hostOf(url);
  if (logoPending.has(key)) return logoPending.get(key);
  const p = (async () => {
    const ok = (await Promise.all(logoSources(url).map(probeImage))).filter(Boolean);
    const best = ok.find(r => r.w >= 32) || ok.sort((a, b) => b.w - a.w)[0];
    if (best) logoCache[key] = best.src; else delete logoCache[key];
    saveLogoCache();
    return best ? best.src : null;
  })();
  logoPending.set(key, p);
  p.finally(() => logoPending.delete(key));
  return p;
}
function attachLogo(wrap, item) {
  const key = hostOf(item.url);
  const apply = src => {
    const im = new Image(); im.alt = ''; im.draggable = false; im.referrerPolicy = 'no-referrer';
    im.onload = () => { wrap.replaceChildren(im); wrap.classList.remove('fallback'); };
    im.onerror = () => {
      if (logoCache[key] !== src) return;
      delete logoCache[key]; saveLogoCache();
      resolveLogo(item.url).then(n => { if (n && n !== src) apply(n); });
    };
    im.src = src;
  };
  if (logoCache[key]) apply(logoCache[key]);
  else resolveLogo(item.url).then(n => { if (n) apply(n); });
}
function logoEl(item, size = '') {
  const wrap = el('span', { class: 'logo-tile fallback ' + size }, icon(item.icon));
  attachLogo(wrap, item);
  return wrap;
}

function openUrl(url) {
  const safe = normalizeUrl(url);
  if (!safe) return toast('That link is not a safe http(s) address.', 'error');
  playAudioEffect('select');
  window.location.assign(safe);
}
function submitSearch(q) {
  q = q.trim();
  if (!q) return;
  if (/^(javascript|data|vbscript|file|blob|about|chrome|view-source):/i.test(q)) return toast('Only http and https links are allowed.', 'error');
  const domainLike = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#]\S*)?$/i;
  let target = null;
  if (/^https?:\/\//i.test(q)) { target = normalizeUrl(q); if (!target) return toast('That URL is not valid.', 'error'); }
  else if (domainLike.test(q)) target = normalizeUrl(q);
  playAudioEffect('select');
  window.location.assign(target || 'https://www.google.com/search?q=' + encodeURIComponent(q));
}

/* ---------- IndexedDB ---------- */
function initDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB is not supported in this browser.'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
    };
    req.onblocked = () => toast('Close other New Tab pages so the storage upgrade can finish.', 'error');
    req.onerror = () => reject(req.error || new Error('Could not open storage.'));
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => { db.close(); db = null; storageOk = false; toast('Storage was updated in another tab. Reload this page.', 'error'); };
      hasLegacyStore = db.objectStoreNames.contains('posters');
      resolve();
    };
  });
}
function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Browser storage is unavailable.'));
    let t, out;
    try { t = db.transaction(stores, mode); out = fn(t); } catch (e) { return reject(e); }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error || new Error('Storage error.'));
    t.onabort = () => reject(t.error || new Error('Storage transaction was aborted.'));
  });
}
const dbPut = rec => tx('images', 'readwrite', t => t.objectStore('images').put(rec));
const dbGet = id => tx('images', 'readonly', t => t.objectStore('images').get(id));
const dbDel = id => tx('images', 'readwrite', t => t.objectStore('images').delete(id));
const dbKeys = () => tx('images', 'readonly', t => t.objectStore('images').getAllKeys());
const dbAll = () => tx('images', 'readonly', t => t.objectStore('images').getAll());
const newImgId = () => 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function migrateLegacy() {
  if (!hasLegacyStore) return;
  const keys = await tx('posters', 'readonly', t => t.objectStore('posters').getAllKeys());
  let moved = 0;
  for (const key of keys) {
    try {
      const data = await tx('posters', 'readonly', t => t.objectStore('posters').get(key));
      if (typeof data !== 'string' || !data.startsWith('data:image/')) { await tx('posters', 'readwrite', t => t.objectStore('posters').delete(key)); continue; }
      const blob = await (await fetch(data)).blob();
      const rec = { id: newImgId(), kind: 'wallpaper', owner: String(key).startsWith('custom_') ? String(key) : null, name: 'Imported wallpaper', blob, created: Date.now() };
      await dbPut(rec);
      settings.siteWallpapers[key] = rec.id;
      await tx('posters', 'readwrite', t => t.objectStore('posters').delete(key));
      moved++;
    } catch (e) { console.warn('Legacy wallpaper not migrated:', key, e); }
  }
  if (moved) { settings.scope = 'perSite'; saveSettings(); }
}
async function reconcile() {
  const have = new Set(await dbKeys());
  let dirty = false;
  if (settings.activeWallpaper && !have.has(settings.activeWallpaper)) { settings.activeWallpaper = null; dirty = true; }
  for (const [k, v] of Object.entries(settings.siteWallpapers)) if (!have.has(v)) { delete settings.siteWallpapers[k]; dirty = true; }
  if (dirty) saveSettings();
}

/* ---------- settings & sites (localStorage) ---------- */
function defaultSettings() { return { sound: true, motion: 'system', scope: 'global', activeWallpaper: null, siteWallpapers: {}, category: 'favorites' }; }
function loadSettings() {
  const d = defaultSettings();
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (typeof raw.sound === 'boolean') d.sound = raw.sound;
      if (['system', 'reduce', 'full'].includes(raw.motion)) d.motion = raw.motion;
      if (raw.scope === 'perSite') d.scope = 'perSite';
      if (typeof raw.activeWallpaper === 'string') d.activeWallpaper = raw.activeWallpaper;
      if (raw.category === 'bookmarks') d.category = 'bookmarks';
      if (raw.siteWallpapers && typeof raw.siteWallpapers === 'object')
        for (const [k, v] of Object.entries(raw.siteWallpapers)) if (typeof v === 'string') d.siteWallpapers[k] = v;
    }
  } catch { try { localStorage.removeItem(SETTINGS_KEY); } catch {} d.corrupt = true; }
  return d;
}
let settingsWarned = false;
function saveSettings() {
  try { const { corrupt, ...s } = settings; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; }
  catch (e) { if (!settingsWarned) { settingsWarned = true; toast('Could not save settings: browser storage is blocked or full.', 'error'); } return false; }
}
function loadSites() {
  const out = { favorites: [], bookmarks: [], hidden: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SITES_KEY) || 'null');
    if (raw && typeof raw === 'object') { if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.filter(h => typeof h === 'string' && findDefault(h));
    for (const cat of CATS) {
      if (!Array.isArray(raw[cat])) continue;
      const seen = new Set();
      for (const s of raw[cat]) {
        if (!s || typeof s.id !== 'string' || !/^custom_[\w-]+$/.test(s.id) || seen.has(s.id)) continue;
        const url = normalizeUrl(s.url);
        if (!url) continue;
        seen.add(s.id);
        out[cat].push({ id: s.id, title: String(s.title || '').slice(0, 40) || hostOf(url), tagline: String(s.tagline || '').slice(0, 100) || 'Custom Bookmark', url, iconKey: ICONS[s.iconKey] ? s.iconKey : 'globe' });
      }
    }
    }
  } catch { out.corrupt = true; }
  return out;
}
function commitSites(mutator) {
  const copy = JSON.parse(JSON.stringify({ favorites: sitesData.favorites, bookmarks: sitesData.bookmarks, hidden: sitesData.hidden }));
  mutator(copy);
  try { localStorage.setItem(SITES_KEY, JSON.stringify(copy)); sitesData = copy; return true; } catch { return false; }
}
function findCustom(id) {
  for (const cat of CATS) { const i = sitesData[cat].findIndex(s => s.id === id); if (i >= 0) return { cat, index: i, site: sitesData[cat][i] }; }
  return null;
}
const newSiteId = () => 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- audio ---------- */
function playAudioEffect(type = 'hover') {
  if (!settings || !settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const tone = (wave, f0, f1, dur, vol) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = wave; o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + dur);
      g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now + dur);
    };
    if (type === 'hover') tone('sine', 580, 1160, 0.045, 0.03);
    else if (type === 'select') { tone('triangle', 440, 880, 0.12, 0.05); tone('sine', 220, 440, 0.12, 0.05); }
    else if (type === 'cancel') tone('sine', 320, 120, 0.08, 0.07);
    else if (type === 'swoosh') tone('sine', 200, 600, 0.09, 0.05);
  } catch {}
}
function setSound(on, save = true) {
  settings.sound = on;
  $('#topSoundIcon').className = on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark text-gray-500';
  $('#soundStatus').replaceChildren(icon(on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'), document.createTextNode(on ? ' Audio On' : ' Audio Muted'));
  $('#optSound').checked = on;
  if (on) playAudioEffect('select');
  if (save) saveSettings();
}

/* ---------- motion ---------- */
const motionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => settings.motion === 'reduce' || (settings.motion === 'system' && motionMQ.matches);
function applyMotion() { document.documentElement.classList.toggle('reduce-motion', reduced()); if (reduced()) $('#bgParallax').style.transform = ''; }

/* ---------- toast ---------- */
function toast(msg, type = 'info', action = null, ms = 4500) {
  const t = $('#toast'), a = $('#toastAction');
  clearTimeout(toastTimer);
  $('#toastMsg').textContent = msg;
  t.className = 'show ' + type;
  a.hidden = !action;
  a.onclick = action ? () => { hideToast(); action.fn(); } : null;
  if (action) a.textContent = action.label;
  toastTimer = setTimeout(hideToast, action ? Math.max(ms, 8000) : ms);
}
function hideToast() { $('#toast').classList.remove('show'); }

/* ---------- modals ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function openModal(id) {
  const m = document.getElementById(id);
  if (modalStack.includes(id)) return;
  m._opener = document.activeElement;
  modalStack.push(id);
  m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    const target = m.querySelector('[autofocus],input.field,input[type=text]') || m.querySelector(FOCUSABLE);
    if (target) target.focus({ preventScroll: true });
  });
}
function closeModal(id) {
  const i = modalStack.indexOf(id);
  if (i < 0) return;
  modalStack.splice(i, 1);
  const m = document.getElementById(id);
  m.classList.remove('open'); m.setAttribute('aria-hidden', 'true');
  if (id === 'confirmModal' && cfResolve) { const r = cfResolve; cfResolve = null; r(false); }
  if (id === 'searchModal') $('#searchInput').value = '';
  if (id === 'siteModal') siteEditId = null;
  if (id === 'profileModal') resetCrop();
  playAudioEffect('cancel');
  const o = m._opener;
  if (o && document.contains(o) && !o.hidden) o.focus({ preventScroll: true });
}
async function requestClose(id) {
  if (id === 'settingsModal' && pendingWp) {
    if (!(await confirmDialog({ title: 'Discard unsaved wallpaper?', message: 'The previewed wallpaper has not been saved and will be discarded.', ok: 'Discard' }))) return;
    clearPending();
  }
  closeModal(id);
}
function confirmDialog({ title, message, ok = 'Delete', danger = true }) {
  return new Promise(resolve => {
    if (cfResolve) cfResolve(false);
    cfResolve = resolve;
    $('#cfTitle').textContent = title; $('#cfMsg').textContent = message;
    const b = $('#cfOk'); b.textContent = ok; b.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    if (modalStack.includes('confirmModal')) { modalStack.splice(modalStack.indexOf('confirmModal'), 1); }
    openModal('confirmModal');
    requestAnimationFrame(() => $('#cfCancel').focus());
  });
}

/* ---------- image processing ---------- */
function validateFile(file) {
  if (!file) throw new Error('No file selected.');
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('Unsupported format. Use JPG, PNG, WebP, GIF, AVIF or BMP.');
  if (file.size === 0) throw new Error('That file is empty.');
  if (file.size > MAX_FILE) throw new Error('Image is too large (max 25 MB).');
}
async function decodeImage(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch {} }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  catch { throw new Error('This image could not be read. It may be corrupted.'); }
  finally { URL.revokeObjectURL(url); }
}
const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not encode the image.')), type, q));
async function encode(c) {
  let b = await canvasBlob(c, 'image/webp', 0.9);
  if (b.type !== 'image/webp') b = await canvasBlob(c, 'image/jpeg', 0.9);
  return b;
}
async function processWallpaper(file) {
  validateFile(file);
  const src = await decodeImage(file);
  try {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    if (!w || !h) throw new Error('This image has no readable size.');
    const s = Math.min(1, WP_MAX_DIM / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0b0d13'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
    return await encode(c);
  } finally { if (src.close) src.close(); }
}

/* ---------- background / wallpaper ---------- */
const resolveWpId = item => (settings.scope === 'perSite' && item && settings.siteWallpapers[item.id]) || settings.activeWallpaper || null;
async function applyBackground() {
  const item = items[activeIndex];
  $('#ambientGlow').style.background = `radial-gradient(circle at 75% 30%, ${(item && item.accentColor) || 'rgba(59,130,246,.55)'} 0%, rgba(13,16,23,.95) 60%, rgba(7,9,14,1) 100%)`;
  const id = resolveWpId(item);
  if (id === shownWp) return;
  const my = ++bgToken;
  const layers = [$('#bgLayer1'), $('#bgLayer2')];
  if (!id) {
    layers.forEach(l => l.classList.remove('show')); shownWp = null;
    setTimeout(() => { if (my === bgToken) layers.forEach((l, i) => { l.style.backgroundImage = ''; if (layerUrl[i]) { URL.revokeObjectURL(layerUrl[i]); layerUrl[i] = ''; } }); }, 900);
    return;
  }
  let url = '';
  try {
    const rec = await dbGet(id);
    if (my !== bgToken) return;
    if (!rec || !rec.blob) { purgeWallpaperRefs(id); return applyBackground(); }
    url = URL.createObjectURL(rec.blob);
    const img = new Image(); img.src = url; await img.decode();
    if (my !== bgToken) { URL.revokeObjectURL(url); return; }
    const next = 1 - activeLayer, old = layerUrl[next];
    layers[next].style.backgroundImage = `url("${url}")`;
    layerUrl[next] = url;
    layers[next].classList.add('show'); layers[activeLayer].classList.remove('show');
    if (old) setTimeout(() => URL.revokeObjectURL(old), 900);
    activeLayer = next; shownWp = id;
  } catch (e) {
    if (url) URL.revokeObjectURL(url);
    if (my !== bgToken) return;
    layers.forEach(l => l.classList.remove('show')); shownWp = null;
    toast('Could not load the wallpaper. Showing the default.', 'error');
  }
}
function purgeWallpaperRefs(id) {
  if (settings.activeWallpaper === id) settings.activeWallpaper = null;
  for (const [k, v] of Object.entries(settings.siteWallpapers)) if (v === id) delete settings.siteWallpapers[k];
  saveSettings();
}
function applyWallpaper(id) {
  const cur = items[activeIndex], perSite = settings.scope === 'perSite' && cur;
  if (perSite) settings.siteWallpapers[cur.id] = id; else settings.activeWallpaper = id;
  saveSettings(); applyBackground(); renderSettings();
  toast(perSite ? `Wallpaper set for ${cur.title}.` : 'Wallpaper applied.', 'success');
}
async function deleteWallpaper(id) {
  if (!(await confirmDialog({ title: 'Delete wallpaper?', message: 'This permanently removes the saved wallpaper from this browser. This cannot be undone.' }))) return;
  try { await dbDel(id); } catch (e) { return toast('Could not delete: ' + errMsg(e), 'error'); }
  purgeWallpaperRefs(id);
  applyBackground(); renderSettings();
  toast('Wallpaper deleted.', 'success');
}
function clearPending() { if (pendingWp) { URL.revokeObjectURL(pendingWp.url); pendingWp = null; } renderPending(); }
async function startWallpaperUpload(file) {
  if (!storageOk) return toast('Browser storage is unavailable, so wallpapers cannot be saved.', 'error');
  if (pendingWp && !(await confirmDialog({ title: 'Replace the unsaved preview?', message: 'You have a previewed wallpaper that has not been saved. Picking another image discards it.', ok: 'Replace' }))) return;
  toast('Processing image…');
  try {
    const blob = await processWallpaper(file);
    clearPending();
    pendingWp = { blob, url: URL.createObjectURL(blob), name: file.name };
    hideToast(); openSettings('secWallpaper');
  } catch (e) { toast(errMsg(e), 'error'); }
}
async function commitPending(apply) {
  if (!pendingWp) return;
  const rec = { id: newImgId(), kind: 'wallpaper', owner: null, name: pendingWp.name, blob: pendingWp.blob, created: Date.now() };
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await dbPut(rec);
  } catch (e) { return toast('Wallpaper was not saved: ' + errMsg(e), 'error'); }
  clearPending();
  if (apply) applyWallpaper(rec.id); else { renderSettings(); toast('Wallpaper saved to your gallery.', 'success'); }
}

/* ---------- profile picture ---------- */
function setAvatarUrl(url) {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = url || '';
  $('#userAvatar').src = avatarUrl || DEFAULT_AVATAR;
  $('#pfPreview').src = avatarUrl || DEFAULT_AVATAR;
  $('#pfRemove').hidden = !avatarUrl;
  $('#pfChangeText').textContent = avatarUrl ? 'Change picture' : 'Upload picture';
}
async function loadAvatar() {
  if (!db) return setAvatarUrl(null);
  try { const rec = await dbGet('avatar'); setAvatarUrl(rec && rec.blob ? URL.createObjectURL(rec.blob) : null); }
  catch { setAvatarUrl(null); }
}
function drawCrop(c, size) {
  const ctx = c.getContext('2d'); c.width = c.height = size;
  const w = crop.src.naturalWidth || crop.src.width, h = crop.src.naturalHeight || crop.src.height;
  const base = Math.max(size / w, size / h) * crop.zoom, dw = w * base, dh = h * base;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(crop.src, (size - dw) / 2 + crop.x * (dw - size) / 2, (size - dh) / 2 + crop.y * (dh - size) / 2, dw, dh);
}
function resetCrop() {
  if (crop && crop.src.close) crop.src.close();
  crop = null; $('#pfCrop').hidden = true; $('#pfView').hidden = false; $('#avatarInput').value = '';
}
async function startAvatarCrop(file) {
  if (!storageOk) return toast('Browser storage is unavailable, so the picture cannot be saved.', 'error');
  try {
    validateFile(file);
    const src = await decodeImage(file);
    if (crop && crop.src.close) crop.src.close();
    crop = { src, zoom: 1, x: 0, y: 0 };
    ['cropZoom', 'cropX', 'cropY'].forEach((id, i) => { $('#' + id).value = i ? 0 : 1; });
    $('#pfView').hidden = true; $('#pfCrop').hidden = false;
    drawCrop($('#cropCanvas'), AVATAR_SIZE);
  } catch (e) { toast(errMsg(e), 'error'); }
}
async function saveAvatar() {
  if (!crop) return;
  const btn = $('#pfSave'); btn.disabled = true;
  try {
    const c = document.createElement('canvas'); drawCrop(c, AVATAR_SIZE);
    const blob = await encode(c);
    await dbPut({ id: 'avatar', kind: 'avatar', owner: null, name: 'avatar', blob, created: Date.now() });
    setAvatarUrl(URL.createObjectURL(blob));
    resetCrop(); toast('Profile picture saved.', 'success');
  } catch (e) { toast('Picture was not saved: ' + errMsg(e), 'error'); }
  finally { btn.disabled = false; }
}
async function removeAvatar() {
  if (!(await confirmDialog({ title: 'Remove profile picture?', message: 'Your custom picture will be deleted from this browser and the default avatar will be used.', ok: 'Remove' }))) return;
  try { await dbDel('avatar'); setAvatarUrl(null); toast('Profile picture removed.', 'success'); }
  catch (e) { toast('Could not remove: ' + errMsg(e), 'error'); }
}

/* ---------- carousel ---------- */
function loadItems() {
  items = [
    ...visibleDefaults(currentCategory).map(s => ({ ...s, cat: currentCategory })),
    ...sitesData[currentCategory].map(s => ({ ...s, cat: currentCategory, icon: ICONS[s.iconKey][1], accentColor: accentFor(s.url), isDefault: false }))
  ];
  activeIndex = clamp(activeIndex, 0, items.length - 1);
}
function renderCarousel() {
  const box = $('#carouselContainer');
  box.replaceChildren(); cardEls = [];
  const touch = window.matchMedia('(hover:none)');
  items.forEach((item, i) => {
    const main = el('button', { type: 'button', class: 'card-main', 'aria-label': item.title + (item.isDefault ? '' : ' (custom shortcut)') }, el('span', { class: 'card-border' }, logoEl(item)));
    main.addEventListener('click', () => { if (touch.matches && activeIndex !== i) setActive(i, { scroll: true }); else openUrl(item.url); });
    const card = el('div', { class: 'game-card', role: 'listitem' }, main);
    card.append(el('button', { type: 'button', class: 'card-del', title: 'Delete shortcut', 'aria-label': 'Delete ' + item.title, onclick: e => { e.stopPropagation(); deleteSite(item.id); } }, icon('fa-solid fa-xmark')));
    card.addEventListener('mouseenter', () => { if (activeIndex !== i) setActive(i); });
    box.append(card); cardEls.push(card);
  });
  const add = el('div', { class: 'game-card', role: 'listitem' }, el('button', { type: 'button', class: 'card-main', 'aria-label': 'Add website', onclick: () => openSiteModal(null, currentCategory) },
    el('span', { class: 'card-border add-tile' }, icon('fa-solid fa-plus'), el('span', { text: 'Add New' }))));
  box.append(add);
  setActive(activeIndex, { sound: false, scroll: true, force: true });
}
function setActive(i, { sound = true, scroll = false, force = false } = {}) {
  if (!items.length) {
    cardEls.forEach(c => c.classList.remove('active'));
    $('#activeTitle').textContent = 'No shortcuts'; $('#activeTagline').textContent = 'Press “Add New” to add your first website.';
    $('#playBtn').hidden = $('#editSiteBtn').hidden = $('#deleteSiteBtn').hidden = true;
    applyBackground(); return;
  }
  i = clamp(i, 0, items.length - 1);
  if (i === activeIndex && !force) return;
  if (sound && i !== activeIndex) playAudioEffect('hover');
  activeIndex = i;
  const item = items[i];
  cardEls.forEach((c, idx) => c.classList.toggle('active', idx === i));
  if (scroll && cardEls[i]) cardEls[i].scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  const tc = $('#titleContainer'); tc.classList.add('swap'); clearTimeout(titleTimer);
  titleTimer = setTimeout(() => {
    const cur = items[activeIndex]; if (!cur) return;
    $('#activeTitle').textContent = cur.title; $('#activeTagline').textContent = cur.tagline;
    const a = $('#playBtn'); a.href = normalizeUrl(cur.url) || '#';
    tc.classList.remove('swap');
  }, 110);
  $('#deleteSiteBtn').hidden = false; $('#editSiteBtn').hidden = item.isDefault; $('#playBtn').hidden = false;
  applyBackground();
  if ($('#settingsModal').classList.contains('open')) renderSettings();
}
function updateTabs() {
  for (const cat of CATS) {
    const b = $(cat === 'favorites' ? '#tabFavorites' : '#tabBookmarks'), on = cat === currentCategory;
    b.className = 'text-xl sm:text-2xl tracking-wide transition-all duration-300 pb-1 ' + (on ? 'font-bold text-white border-b-2 border-white' : 'font-semibold text-gray-400 hover:text-white opacity-70 hover:opacity-100');
    b.setAttribute('aria-pressed', on);
  }
}
function switchCategory(cat) {
  if (currentCategory === cat) return;
  currentCategory = cat; settings.category = cat; saveSettings();
  playAudioEffect('swoosh'); updateTabs(); activeIndex = 0; loadItems(); renderCarousel();
}

/* ---------- shortcut add / edit / delete / move ---------- */
function openSiteModal(site, cat) {
  siteEditId = site ? site.id : null;
  $('#siteModalTitle').textContent = site ? 'Edit Website' : 'Add Website';
  $('#sfTitle').value = site ? site.title : ''; $('#sfTagline').value = site && site.tagline !== 'Custom Bookmark' ? site.tagline : '';
  $('#sfUrl').value = site ? site.url : ''; $('#sfIcon').value = site ? site.iconKey : 'globe';
  $('#sfCat').value = cat || currentCategory; $('#sfCatWrap').hidden = !!site;
  $('#sfFile').value = ''; $('#sfRemoveWp').checked = false;
  $('#sfRemoveWrap').hidden = !(site && settings.siteWallpapers[site.id]);
  ['sfTitleErr', 'sfUrlErr', 'sfFileErr'].forEach(id => $('#' + id).textContent = '');
  openModal('siteModal');
}
function fieldErr(id, msg) { $('#' + id + 'Err').textContent = msg; const f = $('#' + id); if (f) f.focus(); }
async function removeIfOwned(imgId, owner) {
  try { const r = await dbGet(imgId); if (r && r.owner === owner) await dbDel(imgId); } catch {}
}
async function submitSite() {
  if (savingSite) return;
  ['sfTitleErr', 'sfUrlErr', 'sfFileErr'].forEach(id => $('#' + id).textContent = '');
  const url = normalizeUrl($('#sfUrl').value);
  if (!url) return fieldErr('sfUrl', 'Enter a valid http:// or https:// address, e.g. facebook.com.');
  const title = $('#sfTitle').value.trim() || niceName(url), tagline = $('#sfTagline').value.trim() || 'Custom Bookmark';
  const all = [...visibleDefaults('favorites'), ...visibleDefaults('bookmarks'), ...sitesData.favorites, ...sitesData.bookmarks];
  const dup = all.find(s => s.id !== siteEditId && urlKey(s.url) === urlKey(url));
  if (dup && !(await confirmDialog({ title: 'Duplicate shortcut', message: `“${dup.title}” already uses this address. Save anyway?`, ok: 'Save anyway', danger: false }))) return;
  const file = $('#sfFile').files[0];
  let blob = null;
  if (file) {
    if (!storageOk) return fieldErr('sfFile', 'Browser storage is unavailable.');
    try { blob = await processWallpaper(file); } catch (e) { return fieldErr('sfFile', errMsg(e)); }
  }
  savingSite = true; $('#sfSubmit').disabled = true;
  try {
    const editing = !!siteEditId, id = siteEditId || newSiteId();
    const cat = editing ? findCustom(id).cat : $('#sfCat').value;
    const prevMap = settings.siteWallpapers[id];
    const iconKey = ICONS[$('#sfIcon').value] ? $('#sfIcon').value : 'globe';
    let rec = null;
    if (blob) { rec = { id: newImgId(), kind: 'wallpaper', owner: id, name: file.name, blob, created: Date.now() }; await dbPut(rec); }
    const item = { id, title, tagline, url, iconKey };
    const ok = commitSites(d => { if (editing) { d[cat][d[cat].findIndex(s => s.id === id)] = item; } else d[cat].push(item); });
    if (!ok) { if (rec) await dbDel(rec.id).catch(() => {}); throw new Error('Could not save the shortcut: browser storage is blocked or full.'); }
    if (rec) { settings.siteWallpapers[id] = rec.id; if (prevMap) await removeIfOwned(prevMap, id); }
    else if (editing && $('#sfRemoveWp').checked && prevMap) { delete settings.siteWallpapers[id]; await removeIfOwned(prevMap, id); }
    saveSettings();
    closeModal('siteModal');
    if (cat !== currentCategory) { currentCategory = cat; settings.category = cat; saveSettings(); updateTabs(); }
    loadItems(); activeIndex = Math.max(0, items.findIndex(s => s.id === id)); shownWp = '__refresh';
    renderCarousel(); renderSettings();
    toast(editing ? 'Shortcut updated.' : 'Shortcut added.', 'success');
  } catch (e) { toast(errMsg(e), 'error'); }
  finally { savingSite = false; $('#sfSubmit').disabled = false; }
}
async function deleteSite(id) {
  const loc = findCustom(id);
  if (!loc) return deleteDefault(id);
  if (!(await confirmDialog({ title: `Delete “${loc.site.title}”?`, message: 'The shortcut and its own wallpaper (if any) will be removed. You can undo right after.' }))) return;
  const { cat, index, site } = loc, mapped = settings.siteWallpapers[id];
  let owned = null;
  try {
    if (mapped) { const r = await dbGet(mapped); if (r && r.owner === id) { owned = r; await dbDel(r.id); } }
  } catch (e) { return toast('Could not delete: ' + errMsg(e), 'error'); }
  if (!commitSites(d => { d[cat].splice(index, 1); })) {
    if (owned) await dbPut(owned).catch(() => {});
    return toast('Could not save the change: browser storage is blocked.', 'error');
  }
  delete settings.siteWallpapers[id]; saveSettings();
  const wasActive = items[activeIndex] && items[activeIndex].id === id;
  loadItems(); if (wasActive) activeIndex = clamp(activeIndex, 0, items.length - 1);
  shownWp = '__refresh'; renderCarousel(); renderSettings();
  toast(`Deleted “${site.title}”.`, 'info', {
    label: 'Undo', fn: async () => {
      try { if (owned) await dbPut(owned); } catch (e) { return toast('Undo failed: ' + errMsg(e), 'error'); }
      commitSites(d => { d[cat].splice(Math.min(index, d[cat].length), 0, site); });
      if (mapped && owned) settings.siteWallpapers[id] = mapped; else if (mapped && !owned) settings.siteWallpapers[id] = mapped;
      saveSettings(); if (cat !== currentCategory) { currentCategory = cat; updateTabs(); }
      loadItems(); activeIndex = Math.max(0, items.findIndex(s => s.id === id)); shownWp = '__refresh'; renderCarousel(); renderSettings();
      toast('Shortcut restored.', 'success');
    }
  });
}
async function deleteDefault(id) {
  const def = findDefault(id); if (!def) return;
  if (!(await confirmDialog({ title: `Delete “${def.title}”?`, message: 'It will be removed from this page. You can undo right after, or bring built-in websites back later from Settings.' }))) return;
  const mapped = settings.siteWallpapers[id], cat = defaultCat(id);
  if (!commitSites(d => { if (!d.hidden.includes(id)) d.hidden.push(id); })) return toast('Could not save the change: browser storage is blocked.', 'error');
  delete settings.siteWallpapers[id]; saveSettings();
  loadItems(); shownWp = '__refresh'; renderCarousel(); renderSettings();
  toast(`Deleted “${def.title}”.`, 'info', { label: 'Undo', fn: () => {
    commitSites(d => { d.hidden = d.hidden.filter(h => h !== id); });
    if (mapped) settings.siteWallpapers[id] = mapped;
    saveSettings();
    if (cat !== currentCategory) { currentCategory = cat; settings.category = cat; saveSettings(); updateTabs(); }
    loadItems(); activeIndex = Math.max(0, items.findIndex(s => s.id === id)); shownWp = '__refresh'; renderCarousel(); renderSettings();
    toast('Shortcut restored.', 'success');
  } });
}
function restoreDefaults() {
  if (!commitSites(d => { d.hidden = []; })) return toast('Could not save the change: browser storage is blocked.', 'error');
  loadItems(); shownWp = '__refresh'; renderCarousel(); renderSettings();
  toast('Built-in websites restored.', 'success');
}
function moveSite(id, dir) {
  const loc = findCustom(id); if (!loc) return;
  const j = loc.index + dir; if (j < 0 || j >= sitesData[loc.cat].length) return;
  if (!commitSites(d => { const l = d[loc.cat]; [l[loc.index], l[j]] = [l[j], l[loc.index]]; })) return toast('Could not save the new order.', 'error');
  if (loc.cat === currentCategory) { const keep = items[activeIndex].id; loadItems(); activeIndex = Math.max(0, items.findIndex(s => s.id === keep)); renderCarousel(); }
  renderSettings();
}

/* ---------- settings panel ---------- */
function openSettings(sectionId) {
  renderSettings(); openModal('settingsModal');
  if (sectionId) requestAnimationFrame(() => { const s = document.getElementById(sectionId); if (s) s.scrollIntoView({ block: 'start' }); });
}
function renderPending() {
  $('#wpPending').hidden = !pendingWp;
  if (pendingWp) { $('#wpPendingImg').src = pendingWp.url; $('#wpPendingName').textContent = pendingWp.name; }
}
async function renderGallery() {
  const grid = $('#wpGallery'), my = ++galleryToken;
  grid.setAttribute('aria-busy', 'true');
  let recs = [];
  if (db) { try { recs = (await dbAll()).filter(r => r.kind === 'wallpaper' && !r.owner).sort((a, b) => b.created - a.created); } catch {} }
  if (my !== galleryToken) return;
  thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls = [];
  const cur = items[activeIndex];
  const sel = settings.scope === 'perSite' ? ((cur && settings.siteWallpapers[cur.id]) || null) : settings.activeWallpaper;
  const tiles = [];
  tiles.push(el('div', { class: 'wp-tile' }, el('button', { type: 'button', class: 'wp-apply' + (!sel ? ' sel' : ''), 'aria-label': 'Use the default wallpaper', 'aria-pressed': !sel,
    style: 'background:radial-gradient(circle at 75% 30%, rgba(59,130,246,.45), #0b0d13 70%)', onclick: () => {
      if (settings.scope === 'perSite' && cur) { delete settings.siteWallpapers[cur.id]; saveSettings(); applyBackground(); renderSettings(); toast('Using the default wallpaper for this shortcut.', 'success'); } else restoreDefaultWallpaper();
    } }, !sel ? el('span', { class: 'tick' }, icon('fa-solid fa-check')) : null, el('span', { class: 'cap', text: 'Default' }))));
  for (const r of recs) {
    const url = URL.createObjectURL(r.blob); thumbUrls.push(url);
    const on = sel === r.id;
    tiles.push(el('div', { class: 'wp-tile' },
      el('button', { type: 'button', class: 'wp-apply' + (on ? ' sel' : ''), 'aria-label': 'Apply wallpaper ' + r.name, 'aria-pressed': on, onclick: () => applyWallpaper(r.id) },
        el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }), on ? el('span', { class: 'tick' }, icon('fa-solid fa-check')) : null, el('span', { class: 'cap truncate', text: r.name })),
      el('button', { type: 'button', class: 'wp-del', title: 'Delete wallpaper', 'aria-label': 'Delete wallpaper ' + r.name, onclick: () => deleteWallpaper(r.id) }, icon('fa-solid fa-trash-can'))));
  }
  grid.replaceChildren(...tiles); grid.setAttribute('aria-busy', 'false');
  $('#wpEmpty').hidden = recs.length > 0;
}
function renderShortcutList() {
  const box = $('#scList'); box.replaceChildren();
  for (const cat of CATS) {
    box.append(el('h4', { text: cat === 'favorites' ? 'Favorites' : 'Bookmarks' }));
    const defs = visibleDefaults(cat), list = sitesData[cat];
    if (!defs.length && !list.length) { box.append(el('p', { class: 'hint mb-2', text: 'No shortcuts here.' }), el('button', { type: 'button', class: 'btn', onclick: () => openSiteModal(null, cat) }, icon('fa-solid fa-plus'), 'Add a website')); continue; }
    defs.forEach(s => box.append(el('div', { class: 'row-item' },
      logoEl(s, 'logo-sm'),
      el('div', { class: 't' }, el('b', { text: s.title }), el('span', { text: s.url })),
      el('button', { type: 'button', class: 'mini del', title: 'Delete', 'aria-label': 'Delete ' + s.title, onclick: () => deleteSite(s.id) }, icon('fa-solid fa-trash-can')))));
    list.forEach((s, i) => box.append(el('div', { class: 'row-item' },
      logoEl({ ...s, icon: ICONS[s.iconKey][1] }, 'logo-sm'),
      el('div', { class: 't' }, el('b', { text: s.title }), el('span', { text: s.url })),
      el('button', { type: 'button', class: 'mini', title: 'Edit', 'aria-label': 'Edit ' + s.title, onclick: () => openSiteModal(s, cat) }, icon('fa-solid fa-pen')),
      el('button', { type: 'button', class: 'mini', title: 'Move up', 'aria-label': 'Move ' + s.title + ' up', disabled: i === 0, onclick: () => moveSite(s.id, -1) }, icon('fa-solid fa-arrow-up')),
      el('button', { type: 'button', class: 'mini', title: 'Move down', 'aria-label': 'Move ' + s.title + ' down', disabled: i === list.length - 1, onclick: () => moveSite(s.id, 1) }, icon('fa-solid fa-arrow-down')),
      el('button', { type: 'button', class: 'mini del', title: 'Delete', 'aria-label': 'Delete ' + s.title, onclick: () => deleteSite(s.id) }, icon('fa-solid fa-trash-can')))));
  }
  if (sitesData.hidden.length) box.append(el('button', { type: 'button', class: 'btn mt-3', onclick: restoreDefaults }, icon('fa-solid fa-rotate-left'), `Restore built-in websites (${sitesData.hidden.length})`));
}
function renderSettings() {
  const cur = items[activeIndex];
  $('#scopeSel').value = settings.scope; $('#optSound').checked = settings.sound; $('#motionSel').value = settings.motion;
  $('#scopeHint').textContent = settings.scope === 'global'
    ? 'One wallpaper is used for every shortcut in Favorites and Bookmarks.'
    : `Applying to: ${cur ? cur.title : 'no shortcut selected'}. Shortcuts without their own wallpaper use the global one.`;
  $('#wpClearSite').hidden = !(settings.scope === 'perSite' && cur && settings.siteWallpapers[cur.id]);
  $('#storageWarn').hidden = storageOk;
  renderPending(); renderGallery(); renderShortcutList();
}
function restoreDefaultWallpaper() {
  settings.activeWallpaper = null; settings.scope = 'global'; saveSettings(); applyBackground(); renderSettings();
  toast('Default wallpaper restored.', 'success');
}
function restoreAppearance() {
  settings.activeWallpaper = null; settings.scope = 'global'; settings.motion = 'system';
  saveSettings(); applyMotion(); applyBackground(); renderSettings();
  toast('Default appearance restored. Shortcuts and profile picture were kept.', 'success');
}
async function resetAll() {
  const ok = await confirmDialog({ title: 'Reset all dashboard data?', ok: 'Delete everything',
    message: 'This permanently deletes, from this browser only:\n• all custom shortcuts (built-in ones are restored)\n• all saved wallpapers\n• your profile picture\n• all settings\n\nBuilt-in websites stay. This cannot be undone.' });
  if (!ok) return;
  try { if (db) await tx(hasLegacyStore ? ['images', 'posters'] : ['images'], 'readwrite', t => { t.objectStore('images').clear(); if (hasLegacyStore) t.objectStore('posters').clear(); }); }
  catch (e) { return toast('Reset failed: ' + errMsg(e), 'error'); }
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(SITES_KEY); } catch {}
  clearPending();
  settings = defaultSettings(); sitesData = { favorites: [], bookmarks: [], hidden: [] }; logoCache = {}; try { localStorage.removeItem(LOGO_KEY); } catch {} currentCategory = 'favorites'; activeIndex = 0; shownWp = '__refresh';
  setAvatarUrl(null); applyMotion(); setSound(true, false); updateTabs(); loadItems(); renderCarousel(); renderSettings();
  toast('All dashboard data was reset.', 'success');
}

/* ---------- clock ---------- */
function updateClock() { const d = new Date(), p = n => String(n).padStart(2, '0'); const t = `${p(d.getHours())}:${p(d.getMinutes())}`; const c = $('#clock'); if (c.textContent !== t) c.textContent = t; }

/* ---------- events ---------- */
const isEditable = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const ACTIONS = {
  'tab': b => switchCategory(b.dataset.cat),
  'toggle-sound': () => setSound(!settings.sound),
  'open-search': () => { playAudioEffect('select'); openModal('searchModal'); },
  'upload-wallpaper': () => { playAudioEffect('select'); if (!storageOk) return toast('Browser storage is unavailable, so wallpapers cannot be saved.', 'error'); $('#devicePosterInput').click(); },
  'add-site': () => { playAudioEffect('select'); openSiteModal(null, currentCategory); },
  'open-settings': () => { playAudioEffect('select'); openSettings(); },
  'open-profile': () => { playAudioEffect('select'); openModal('profileModal'); },
  'close': b => requestClose(b.closest('.modal').id),
  'edit-current': () => { const it = items[activeIndex], s = it && findCustom(it.id); if (s) openSiteModal(s.site, s.cat); },
  'delete-current': () => { const it = items[activeIndex]; if (it) deleteSite(it.id); },
  'wp-save-apply': () => commitPending(true), 'wp-save': () => commitPending(false), 'wp-discard': () => { clearPending(); },
  'wp-restore': restoreDefaultWallpaper,
  'wp-clear-site': () => { const it = items[activeIndex]; if (!it) return; delete settings.siteWallpapers[it.id]; saveSettings(); applyBackground(); renderSettings(); },
  'restore-appearance': restoreAppearance, 'reset-all': resetAll,
  'pf-change': () => $('#avatarInput').click(), 'pf-remove': removeAvatar, 'pf-save': saveAvatar, 'pf-cancel': resetCrop
};
function bindEvents() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (b && ACTIONS[b.dataset.action]) { e.preventDefault(); ACTIONS[b.dataset.action](b); }
    else if (e.target.id === 'playBtn' || e.target.closest('#playBtn')) {
      e.preventDefault(); const i = items[activeIndex]; if (i) openUrl(i.url);
    }
  });
  $$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) requestClose(m.id); }));
  $('#cfOk').addEventListener('click', () => { const r = cfResolve; cfResolve = null; closeModal('confirmModal'); if (r) r(true); });
  $('#cfCancel').addEventListener('click', () => closeModal('confirmModal'));
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); submitSearch($('#searchInput').value); });
  $('#siteForm').addEventListener('submit', e => { e.preventDefault(); submitSite(); });
  $('#devicePosterInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) startWallpaperUpload(f); });
  $('#avatarInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) startAvatarCrop(f); e.target.value = ''; });
  $('#userAvatar').addEventListener('error', () => { $('#userAvatar').src = DEFAULT_AVATAR; });
  $('#scopeSel').addEventListener('change', e => { settings.scope = e.target.value; saveSettings(); applyBackground(); renderSettings(); });
  $('#optSound').addEventListener('change', e => setSound(e.target.checked));
  $('#motionSel').addEventListener('change', e => { settings.motion = e.target.value; saveSettings(); applyMotion(); });
  [['cropZoom', 'zoom'], ['cropX', 'x'], ['cropY', 'y']].forEach(([id, k]) => $('#' + id).addEventListener('input', e => { if (crop) { crop[k] = parseFloat(e.target.value); drawCrop($('#cropCanvas'), AVATAR_SIZE); } }));
  (motionMQ.addEventListener ? motionMQ.addEventListener.bind(motionMQ, 'change') : motionMQ.addListener.bind(motionMQ))(applyMotion);
  const sel = $('#sfIcon'); for (const [k, [label]] of Object.entries(ICONS)) sel.append(el('option', { value: k, text: label }));

  let raf = 0;
  window.addEventListener('pointermove', e => {
    if (reduced() || e.pointerType === 'touch' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; $('#bgParallax').style.transform = `translate(${(0.5 - e.clientX / innerWidth) * 18}px, ${(0.5 - e.clientY / innerHeight) * 12}px)`; });
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (modalStack.length) {
      const top = modalStack[modalStack.length - 1];
      if (e.key === 'Escape') { e.preventDefault(); top === 'confirmModal' ? closeModal(top) : requestClose(top); }
      else if (e.key === 'Tab') {
        const f = $$(FOCUSABLE, document.getElementById(top)).filter(n => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (!document.getElementById(top).contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive(activeIndex + 1, { scroll: true }); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(activeIndex - 1, { scroll: true }); }
    else if (e.key === 'Enter') { if (e.target.closest && e.target.closest('a,button,summary')) return; e.preventDefault(); const it = items[activeIndex]; if (it) openUrl(it.url); }
    else if (e.key === '/') { e.preventDefault(); ACTIONS['open-search'](); }
  });
}

/* ---------- init ---------- */
async function init() {
  settings = loadSettings(); sitesData = loadSites();
  currentCategory = settings.category;
  bindEvents(); applyMotion(); setSound(settings.sound, false); updateTabs(); updateClock(); setInterval(updateClock, 10000);
  if (settings.corrupt) toast('Saved settings were unreadable and have been reset.', 'error');
  else if (sitesData.corrupt) toast('Saved shortcuts were unreadable and were skipped.', 'error');
  try { await initDB(); await migrateLegacy(); await reconcile(); }
  catch (e) { console.warn('Storage unavailable:', e); db = null; storageOk = false; toast('Browser storage is unavailable. Wallpapers and profile pictures cannot be saved.', 'error', null, 8000); }
  await loadAvatar();
  loadItems(); renderCarousel();
}
document.addEventListener('DOMContentLoaded', init);