// =====================================================================
// game.js : GAME (loop, cameras, HUD, UI screens, progression, events,
//           race AI, replay/photo, save, netcode)
// =====================================================================
import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, mulberry32, fmtTime, fmtCR, KMH, CARS, MAKES, CAT_INFO, CLASS_COLORS, piClass, UPGRADES, UPGRADE_KEYS, defaultTune, applyBuild,
  upgradeCost, carStats, EVENT_TYPES, DRIVATARS, QUICKCHAT, HORNS, CLOTHING, SEASONS, SEASON_WEATHER, WHEEL_STYLES, PAINT_TYPES, DECALS, weekSeason, BARN_CAR_IDS, SURF,
} from './data.js';
import { Vehicle, collideWorld, collideVehicles, Input, AudioSys, ACTIONS, ASSIST_DEFAULTS } from './sim.js';
import { World, PostFX, buildCarModel, WORLD_HALF, REGIONS, WEATHER_TYPES, FILTERS, edgeSample, mergeGeos } from './world.js';

const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PHYS_HZ = 120, PHYS_DT = 1 / PHYS_HZ, MAX_STEPS = 8;
const VERSION = '1.0.0';

// ---------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  preset: 'auto', resScale: 1, shadows: 'high', drawDistance: 'medium', particles: 'high', postfx: true, motionBlur: 0.6, chromatic: 0.5, speedLines: 0.6, godrays: true, traffic: 'medium', aiCount: 7, adaptiveRes: true,
  fov: 68, dynamicFov: 1, camShake: 0.7, camera: 'chase', units: 'kmh', hudScale: 1, hud: { speedo: true, minimap: true, chain: true, race: true, markers: true, nameplates: true, notifications: true, line: true, damage: true, perf: false },
  colorblind: 'off', subtitleSize: 1, reduceFlash: false,
  volMaster: 0.8, volMusic: 0.45, volSfx: 0.8, volEngine: 0.9, radio: 'pulse',
  trigDeadzone: 0.04, trigSaturation: 0.98, stickDeadzone: 0.08, stickSaturation: 0.95, steerLinearity: 1.25, kbSteerSpeed: 1, padSens: 1, padInvertY: false, mouseSens: 1, mouseInvertY: false, rumble: 0.8,
  assists: { ...ASSIST_DEFAULTS }, difficulty: 2, ghostOnline: true, playerName: '', touchControls: 'auto', touchSteer: 'buttons',
};
const LOW_PRESET = { resScale: 0.6, shadows: 'off', drawDistance: 'low', particles: 'low', postfx: false, godrays: false, traffic: 'low', aiCount: 3, motionBlur: 0, chromatic: 0, speedLines: 0.3 };
const MED_PRESET = { resScale: 0.85, shadows: 'low', drawDistance: 'medium', particles: 'medium', postfx: true, godrays: false, traffic: 'medium', aiCount: 5, motionBlur: 0.4, chromatic: 0.3 };
const HIGH_PRESET = { resScale: 1, shadows: 'high', drawDistance: 'high', particles: 'high', postfx: true, godrays: true, traffic: 'medium', aiCount: 7, motionBlur: 0.6, chromatic: 0.5 };
const ULTRA_PRESET = { resScale: 1, shadows: 'ultra', drawDistance: 'ultra', particles: 'high', postfx: true, godrays: true, traffic: 'high', aiCount: 9, motionBlur: 0.7, chromatic: 0.5 };
export const PRESETS = { low: LOW_PRESET, medium: MED_PRESET, high: HIGH_PRESET, ultra: ULTRA_PRESET };
function loadSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem('fh6_settings') || '{}'); } catch { s = {}; }
  const out = { ...structuredClone(DEFAULT_SETTINGS), ...s }; out.hud = { ...DEFAULT_SETTINGS.hud, ...(s.hud || {}) }; out.assists = { ...ASSIST_DEFAULTS, ...(s.assists || {}) };
  return out;
}
const S = loadSettings();
function saveSettings() { try { localStorage.setItem('fh6_settings', JSON.stringify(S)); } catch (e) { console.warn('settings save failed', e); } }
function applyPreset(name) { if (PRESETS[name]) Object.assign(S, PRESETS[name]); S.preset = name; }

// ---------------------------------------------------------------------
// SAVE SYSTEM (3 slots + export/import)
// ---------------------------------------------------------------------
const SLOT_COUNT = 3; const slotKey = (i) => 'fh6_slot_' + i;
let P = null; let slotIdx = 0; let uidCounter = 1;
function newProfile(name) {
  return {
    v: 1, name: name || 'Driver', created: Date.now(), played: 0, credits: 75000, xp: 0, level: 1, skillPts: 3, wheelspins: 1, superWheelspins: 0,
    cars: [], current: null, events: {}, traps: {}, zones: {}, danger: {}, barns: [], roads: {}, driftz: {}, trails: {}, perks: {}, photos: 0, accolades: {},
    stats: { distance: 0, wins: 0, races: 0, podiums: 0, bestChain: 0, bestDrift: 0, topSpeed: 0, smashed: 0, nearMiss: 0, airTime: 0, longestJump: 0, skillScore: 0, creditsEarned: 0, onlineRaces: 0 },
    character: { name: name || 'Driver', hat: 0, top: 0, color: 0, horn: 0, banner: 'HORIZON' }, festival: { color: 0, name: 'Horizon Festival' },
    season: { week: -1, points: 0, champDone: {} }, introDone: false, auctions: [], auctionT: 0, listings: [], ghosts: {}, pos: null, tod: 11, unlockedHorns: [0, 1], unlockedClothes: { hat: [0, 1], top: [0, 1] },
  };
}
function addCar(id, opts = {}) {
  const spec = CARS[id]; if (!spec) return null;
  const c = { uid: Date.now().toString(36) + (uidCounter++), id, up: opts.up || {}, tune: defaultTune(spec), livery: opts.livery || { paint: 'gloss', color: MAKES[spec.make]?.col ?? 0xcc2222, decal: 'none', decalColor: 0xffffff, color2: 0x111111, number: 1 + (id % 99), wheel: id % 8, rim: 0xbbbbbb, tint: 0.3, caliper: 0xd02020 }, fav: false, odo: 0, mastery: [], wins: 0, added: Date.now() };
  P.cars.push(c); return c;
}
function curCar() { return P.cars.find((c) => c.uid === P.current) || P.cars[0]; }
function saveGame(silent = false) {
  if (!P) return; try {
    if (player) { P.pos = [player.pos.x, player.pos.y, player.pos.z, player.yaw()]; } P.tod = world ? world.tod : P.tod;
    P.saved = Date.now(); localStorage.setItem(slotKey(slotIdx), JSON.stringify(P)); localStorage.setItem('fh6_lastSlot', String(slotIdx));
    if (!silent) toast('Game saved', 'save');
    const ind = $('#saveInd'); if (ind) { ind.classList.add('on'); setTimeout(() => ind.classList.remove('on'), 1500); }
  } catch (e) { console.warn('save failed', e); toast('Save failed: storage full or blocked', 'warn'); }
}
function slotSummary(i) { try { const s = JSON.parse(localStorage.getItem(slotKey(i)) || 'null'); if (!s) return null; return { name: s.name, level: s.level, credits: s.credits, cars: s.cars.length, played: s.played, saved: s.saved }; } catch { return { corrupt: true }; } }
function loadSlot(i) {
  const s = JSON.parse(localStorage.getItem(slotKey(i)) || 'null'); if (!s) return false;
  const base = newProfile(s.name); P = { ...base, ...s, stats: { ...base.stats, ...(s.stats || {}) }, character: { ...base.character, ...(s.character || {}) }, season: { ...base.season, ...(s.season || {}) } };
  if (Array.isArray(P.roads) || !P.roads) P.roads = {}; ['driftz', 'trails', 'perks', 'traps', 'zones', 'danger', 'events'].forEach((k) => { if (!P[k] || Array.isArray(P[k])) P[k] = {}; }); P.cars = P.cars.filter((c) => CARS[c.id]); P.cars.forEach((c) => { c.tune = { ...defaultTune(CARS[c.id]), ...(c.tune || {}) }; c.up = c.up || {}; c.mastery = c.mastery || []; });
  slotIdx = i; return true;
}
// Save a file to the user's device. Uses the Android bridge inside the APK, otherwise a download link.
function saveDownload(name, dataUrlOrText, mime = 'application/octet-stream') {
  try {
    const isUrl = /^data:/.test(dataUrlOrText);
    if (window.FH6Android && window.FH6Android.saveFile) {
      const b64 = isUrl ? dataUrlOrText.split(',')[1] : btoa(unescape(encodeURIComponent(dataUrlOrText)));
      return window.FH6Android.saveFile(name, b64, mime) !== false;
    }
    const a = document.createElement('a'); let url = dataUrlOrText;
    if (!isUrl) url = URL.createObjectURL(new Blob([dataUrlOrText], { type: mime }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); if (!isUrl) setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) { console.warn('download failed', e); return false; }
}
function exportSlot(i) {
  const data = localStorage.getItem(slotKey(i)); if (!data) { toast('Slot is empty', 'warn'); return; }
  if (!saveDownload(`fh6_save_slot${i + 1}.json`, data, 'application/json')) { toast('Export failed', 'warn'); return; }
  toast('Save exported', 'save');
}
function importSlot(i, done) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const o = JSON.parse(r.result); if (!o || !Array.isArray(o.cars) || typeof o.credits !== 'number') throw new Error('not a save'); localStorage.setItem(slotKey(i), JSON.stringify(o)); toast('Save imported into slot ' + (i + 1), 'save'); done && done(); } catch (e) { toast('Import failed: ' + e.message, 'warn'); } }; r.readAsText(f); };
  inp.click();
}

// ---------------------------------------------------------------------
// DOM / UI framework with controller spatial navigation
// ---------------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat(5)) { if (c == null || c === false) continue; e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  return e;
}
const UI = {
  stack: [], root: null, focus: null,
  open(name, opts = {}) { const sc = SCREENS[name]; if (!sc) { console.error('no screen', name); return; } audio.ui('ok'); this.stack.push({ name, opts, focusIdx: 0, tab: opts.tab || 0 }); this.openF = frameN; this.render(); },
  replace(name, opts = {}) { this.stack.pop(); this.open(name, opts); },
  back() { const top = this.top(); if (!top) return; const sc = SCREENS[top.name]; if (sc.noBack) return; if (sc.onBack && sc.onBack(top) === false) return; audio.ui('back'); this.stack.pop(); if (sc.onClose) sc.onClose(top); this.render(); },
  closeAll() { while (this.stack.length) { const t = this.stack.pop(); const sc = SCREENS[t.name]; sc.onClose && sc.onClose(t); } this.render(); },
  top() { return this.stack[this.stack.length - 1]; },
  isOpen() { return this.stack.length > 0; },
  render(keepFocus = false) {
    const root = this.root; const top = this.top(); const prevFocusId = keepFocus && this.focus ? this.focus.dataset.fid : null;
    root.innerHTML = ''; root.classList.toggle('open', !!top);
    if (!top) { this.focus = null; return; }
    const sc = SCREENS[top.name]; root.className = 'open ' + (sc.cls || 'panel') + (keepFocus ? ' noanim' : '');
    const content = sc.render(top); root.appendChild(content);
    const fs = $$('.f', root); fs.forEach((f, i) => { f.dataset.fid = f.dataset.fid || ('f' + i); f.addEventListener('mouseenter', () => this.setFocus(f, false)); });
    let target = prevFocusId ? fs.find((f) => f.dataset.fid === prevFocusId) : null; if (!target) target = fs.find((f) => f.classList.contains('autofocus')) || fs[0];
    this.setFocus(target || null, false);
  },
  refresh() { this.render(true); },
  setFocus(f, sound = true) { if (this.focus) this.focus.classList.remove('focus'); this.focus = f; if (f) { f.classList.add('focus'); if (sound) { audio.ui('move'); f.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } } },
  move(dir) {
    const fs = $$('.f', this.root).filter((f) => f.offsetParent !== null); if (!fs.length) return; if (!this.focus || !fs.includes(this.focus)) { this.setFocus(fs[0]); return; }
    const a = this.focus.getBoundingClientRect(); const ax = a.left + a.width / 2, ay = a.top + a.height / 2; let best = null, bs = 1e9;
    for (const f of fs) { if (f === this.focus) continue; const b = f.getBoundingClientRect(); const bx = b.left + b.width / 2, by = b.top + b.height / 2; const dx = bx - ax, dy = by - ay;
      let main, cross; if (dir === 'up') { main = -dy; cross = Math.abs(dx); } else if (dir === 'down') { main = dy; cross = Math.abs(dx); } else if (dir === 'left') { main = -dx; cross = Math.abs(dy); } else { main = dx; cross = Math.abs(dy); }
      if (main <= 2) continue; const sc = main + cross * 2.2; if (sc < bs) { bs = sc; best = f; } }
    if (best) this.setFocus(best);
  },
  update() {
    if (!this.isOpen()) return; const top = this.top(); const sc = SCREENS[top.name];
    if (sc.update) sc.update(top);
    if (input.capture || this.openF === frameN) return;
    const f = this.focus;
    for (const d of ['up', 'down', 'left', 'right']) if (input.menuPressed(d)) {
      if (f && (d === 'left' || d === 'right') && f.dataset.adj) { f.dispatchEvent(new CustomEvent('adj', { detail: d === 'left' ? -1 : 1 })); audio.ui('move'); continue; }
      if (sc.onDir && sc.onDir(top, d) === true) continue; this.move(d);
    }
    if (input.menuPressed('ok') && f) { f.click(); }
    if (input.menuPressed('back')) this.back();
    if (input.menuPressed('tabL') && sc.tabs) { top.tab = (top.tab - 1 + sc.tabs.length) % sc.tabs.length; audio.ui('tab'); this.render(); }
    if (input.menuPressed('tabR') && sc.tabs) { top.tab = (top.tab + 1) % sc.tabs.length; audio.ui('tab'); this.render(); }
    if (input.menuPressed('alt') && sc.onAlt) sc.onAlt(top); if (input.menuPressed('alt2') && sc.onAlt2) sc.onAlt2(top);
  },
};
// widgets
function btn(label, onclick, opts = {}) { return h('button', { class: 'f btn ' + (opts.cls || '') + (opts.autofocus ? ' autofocus' : ''), disabled: opts.disabled, onmousedown: (e) => e.preventDefault(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); }, onclick: (e) => { if (opts.disabled) return; audio.unlock(); onclick(e); } }, opts.icon ? h('span', { class: 'ico' }, opts.icon) : null, h('span', {}, label), opts.sub ? h('small', {}, opts.sub) : null); }
function slider(label, get, set, min, max, step, fmt = (v) => (+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0), opts = {}) {
  const val = h('b', {}, fmt(get())); const fill = h('i', { style: { width: ((get() - min) / (max - min) * 100) + '%' } });
  const bar = h('div', { class: 'bar' }, fill);
  const upd = (v) => { v = clamp(Math.round(v / step) * step, min, max); set(v); val.textContent = fmt(v); fill.style.width = ((v - min) / (max - min) * 100) + '%'; opts.onChange && opts.onChange(v); };
  const row = h('div', { class: 'f row slider' + (opts.disabled ? ' disabled' : ''), 'data-adj': '1', tabindex: 0 }, h('span', { class: 'lbl' }, label), bar, val);
  row.addEventListener('adj', (e) => { if (!opts.disabled) upd(get() + e.detail * step); });
  bar.addEventListener('pointerdown', (e) => { if (opts.disabled) return; const r = bar.getBoundingClientRect(); const go = (ev) => upd(min + clamp((ev.clientX - r.left) / r.width, 0, 1) * (max - min)); go(e); const mv = (ev) => go(ev); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
  row.addEventListener('click', () => {}); return row;
}
function choice(label, options, get, set, opts = {}) {
  const names = options.map((o) => (Array.isArray(o) ? o[1] : String(o))); const vals = options.map((o) => (Array.isArray(o) ? o[0] : o));
  const val = h('b', {}, '‹ ' + names[Math.max(0, vals.indexOf(get()))] + ' ›');
  const row = h('div', { class: 'f row choice' + (opts.disabled ? ' disabled' : ''), 'data-adj': '1', tabindex: 0 }, h('span', { class: 'lbl' }, label), val);
  const upd = (d) => { if (opts.disabled) return; let i = vals.indexOf(get()); i = (i + d + vals.length) % vals.length; set(vals[i]); val.textContent = '‹ ' + names[i] + ' ›'; opts.onChange && opts.onChange(vals[i]); };
  row.addEventListener('adj', (e) => upd(e.detail)); row.addEventListener('click', (e) => { const r = row.getBoundingClientRect(); upd(e.clientX && e.clientX < r.left + r.width * 0.55 ? -1 : 1); });
  return row;
}
function toggle(label, get, set, opts = {}) { return choice(label, [[false, 'Off'], [true, 'On']], () => !!get(), set, opts); }
function tabsBar(sc, top) { return h('div', { class: 'tabs' }, h('span', { class: 'hint' }, padHint('tabL')), ...sc.tabs.map((t, i) => h('span', { class: 'tab' + (i === top.tab ? ' on' : ''), onclick: () => { top.tab = i; audio.ui('tab'); UI.render(); } }, t)), h('span', { class: 'hint' }, padHint('tabR'))); }
function padHint(k) { const pad = input && input.device === 'gamepad'; const m = { tabL: pad ? 'LB' : 'Q', tabR: pad ? 'RB' : 'E', ok: pad ? 'A' : 'Enter', back: pad ? 'B' : 'Esc', alt: pad ? 'X' : 'X', alt2: pad ? 'Y' : 'Y' }; return m[k] || k; }
function footer(items) { return h('div', { class: 'footer' }, items.map(([k, t]) => h('span', {}, h('kbd', {}, padHint(k)), ' ', t))); }
function panel(title, sub, ...body) { return h('div', { class: 'pwrap' }, h('div', { class: 'phead' }, h('h1', {}, title), sub ? h('div', { class: 'psub' }, sub) : null), h('div', { class: 'pbody' }, ...body)); }

// notifications
function toast(msg, kind = 'info', ms = 3200) {
  if (!S.hud.notifications && kind === 'info') return; const box = $('#toasts'); if (!box) return;
  const t = h('div', { class: 'toast ' + kind }, msg); box.appendChild(t); setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 500);
  while (box.children.length > 5) box.firstChild.remove();
}
function banner(title, sub = '', ms = 2600, cls = '') { const b = $('#banner'); b.innerHTML = ''; b.className = 'show ' + cls; b.appendChild(h('div', { class: 't' }, title)); if (sub) b.appendChild(h('div', { class: 's' }, sub)); clearTimeout(banner._t); banner._t = setTimeout(() => { b.className = ''; }, ms); }
function subtitle(text, ms = 3500) { const s = $('#subs'); s.textContent = text; s.style.fontSize = (18 * S.subtitleSize) + 'px'; s.classList.add('on'); clearTimeout(subtitle._t); subtitle._t = setTimeout(() => s.classList.remove('on'), ms); }
function hex(c) { return '#' + new THREE.Color(c).getHexString(); }

// ---------------------------------------------------------------------
// CORE STATE
// ---------------------------------------------------------------------
let renderer, scene, camera, world, fx, input, audio;
let player = null, playerModel = null, playerVoice = null, playerRec = null, playerLights = null;
let mode = 'boot'; // boot | title | intro | free | event | photo | replay
let simPaused = false; let acc = 0; let lastT = 0; let frameN = 0;
const racers = []; // AI racers during events: {veh, model, ai, name, voice}
const perf = { fps: 60, ft: 16, phys: 0, rend: 0, frames: 0, t: 0, lowT: 0 };
let gameTime = 0; let saveTimer = 60; let autoSaveTimer = 0; let auctionTimer = 0;
const camRig = { mode: 0, modes: ['chase', 'far', 'hood', 'bumper', 'cockpit'], pos: new THREE.Vector3(), look: new THREE.Vector3(), yawOff: 0, pitchOff: 0, shake: 0, fovCur: 68, lookBack: false, init: false, orbit: 0, heading: 0 };
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const groundTmp = {};

function buildPlayerParams(rec) { const spec = CARS[rec.id]; const p = applyBuild(spec, rec.up, rec.tune); return p; }
function assistsForVehicle() { return { ...S.assists }; }
function spawnPlayer(rec, x, y, z, yaw) {
  const spec = CARS[rec.id]; const p = buildPlayerParams(rec);
  if (playerModel) { scene.remove(playerModel.group); playerModel.dispose(); }
  if (playerVoice) { playerVoice.stop(); playerVoice = null; }
  player = new Vehicle(p, { id: 0, assists: assistsForVehicle() }); player.rec = rec; playerRec = rec;
  const gy = world.height(x, z); player.place(x, Math.max(y, gy + p.cgh + p.tireR + 0.3), z, yaw);
  playerModel = buildCarModel(spec, rec.livery, { wing: (rec.up.aero | 0) >= 2 }); scene.add(playerModel.group);
  // headlights
  playerLights = []; for (const sx of [-1, 1]) { const L = new THREE.SpotLight(0xfff1d8, 0, 110, 0.55, 0.5, 1.2); L.position.set(sx * spec.wid * 0.32, 0.1, spec.len / 2); const tg = new THREE.Object3D(); tg.position.set(sx * 0.6, -1.2, spec.len / 2 + 25); playerModel.group.add(tg); L.target = tg; playerModel.group.add(L); playerLights.push(L); }
  if (audio.ready) playerVoice = audio.createEngine(p, {});
  camRig.init = false; skill.reset(true);
  return player;
}
function refreshPlayerCar(keepState = true) {
  if (!player || !playerRec) return; const st = keepState ? player.getState() : null; const dmg = player.damage; const pos = player.pos.clone(), yaw = player.yaw();
  spawnPlayer(playerRec, pos.x, pos.y, pos.z, yaw); if (st) { player.setState(st); player.savePrev(); } player.damage = dmg;
}
function placeOnRoad(x, z, out = {}) {
  const q = world.roadQuery(x, z, {}); if (q && q.d < 80) { const S0 = edgeSample(q.edge, q.s, {}); const yaw = Math.atan2(S0.dx, S0.dz); out.x = S0.x; out.z = S0.z; out.y = S0.y; out.yaw = yaw; return out; }
  out.x = x; out.z = z; out.y = world.height(x, z); out.yaw = 0; return out;
}
function resetCar() {
  if (!player) return; const yaw0 = player.yaw(); const o = placeOnRoad(player.pos.x, player.pos.z);
  let yaw = o.yaw; if (Math.cos(yaw - yaw0) < 0) yaw += Math.PI;
  player.place(o.x, o.y + player.cgh + player.p.tireR + 0.5, o.z, yaw); skill.breakChain('Reset'); camRig.init = false; toast('Car reset to road');
}

// ---------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------
function webglAvailable() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; } }
function fatal(msg) { const el = $('#fatal'); el.innerHTML = ''; el.appendChild(h('div', {}, h('h1', {}, 'FORZA HORIZON 6'), h('p', {}, msg), h('p', { class: 'small' }, 'Tip: enable hardware acceleration in your browser settings, update graphics drivers, or try a recent Chrome, Edge, or Firefox.'))); el.style.display = 'flex'; $('#loading').style.display = 'none'; }
function setLoading(t, p) { const l = $('#loadText'); if (l) l.textContent = t; const b = $('#loadBar'); if (b && p != null) b.style.width = (p * 100) + '%'; }
export async function boot() {
  if (!webglAvailable()) { fatal('WebGL is not available on this device or browser, so the 3D world cannot be rendered.'); return; }
  setLoading('Starting renderer…', 0.05); await nextFrame();
  try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }); }
  catch (e) { fatal('Could not create a WebGL context: ' + e.message); return; }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; renderer.domElement.id = 'gl'; document.body.prepend(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); toast('Graphics context lost — recovering…', 'warn'); });
  // auto preset from GPU string
  if (S.preset === 'auto') {
    let gpu = ''; try { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { }
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); const weak = /SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|Intel/i.test(gpu) || mobile;
    applyPreset(weak ? (mobile || /SwiftShader|llvmpipe|Software/i.test(gpu) ? 'low' : 'medium') : 'high'); S.preset = 'auto:' + S.preset; S.gpu = gpu; saveSettings();
  }
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(S.fov, innerWidth / innerHeight, 0.15, 12000);
  input = new Input(S); audio = new AudioSys(S);
  input.onPadChange = (kind, g) => toast(kind === 'connected' ? 'Controller connected: ' + g.id.slice(0, 40) : 'Controller disconnected', 'pad');
  setLoading('Generating island terrain & road network…', 0.15); await nextFrame();
  try { world = new World(scene, renderer, S, 6); } catch (e) { console.error(e); fatal('World generation failed: ' + e.message); return; }
  world.weather.onThunder = () => audio.thunder();
  setLoading('Streaming festival area…', 0.55); await nextFrame();
  for (let i = 0; i < 30; i++) world.stream(0, 0, 40);
  fx = new PostFX(renderer); applyVideoSettings();
  setLoading('Preparing events…', 0.8); await nextFrame();
  buildEvents(); buildBarns(); buildMapCanvas();
  UI.root = $('#screen'); initHUD(); initTouch(); net.init();
  addEventListener('resize', onResize); onResize();
  // audio unlock on first gesture
  const unlock = () => { audio.unlock(); if (audio.ready) { audio.applyVolumes(); if (!playerVoice && player) playerVoice = audio.createEngine(player.p, {}); if (!audio.music && S.radio !== 'off') audio.startMusic(S.radio); $('#audioHint')?.classList.add('hide'); } };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, unlock, { passive: true }));
  addEventListener('beforeunload', () => { if (P && mode !== 'title') saveGame(true); });
  window.__fh6OnPause = () => { try { if (P && mode !== 'title') saveGame(true); if ((mode === 'free' || mode === 'event') && !UI.isOpen() && !net.inSession()) UI.open(mode === 'event' ? 'pauseEvent' : 'pause'); } catch (e) { console.warn(e); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden && P && mode !== 'title') saveGame(true); if (audio.ctx) { if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume(); } });
  setLoading('Ready', 1); await nextFrame();
  $('#loading').classList.add('done'); setTimeout(() => { $('#loading').style.display = 'none'; }, 700);
  mode = 'title'; UI.open('title');
  lastT = performance.now(); requestAnimationFrame(loop);
  window.__fh6 = { get renderer() { return renderer; }, get camera() { return camera; }, get scene() { return scene; }, get player() { return player; }, get world() { return world; }, get mode() { return mode; }, get P() { return P; }, S, UI, net, startEvent: (id) => startEvent(EVENTS.find((e) => e.id === id)), get ev() { return activeEvent; }, input, finishEvent: () => activeEvent && finishEvent(true), skill };
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }
function onResize() { renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1) * S.resScale * (perf.dynScale || 1)); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); fx && fx.setSize(); document.documentElement.style.setProperty('--hud', S.hudScale); }
function applyVideoSettings() { world.applyShadowQuality(); fx.enabled = !!S.postfx; onResize(); document.body.dataset.cb = S.colorblind; document.documentElement.style.setProperty('--hud', S.hudScale); world.traffic.enabled = S.traffic !== 'off'; }

// start a profile (new or loaded) and enter free roam
function enterWorld() {
  P.played = P.played || 0; if (!P.cars.length) addCar(starterIds()[0]);
  if (!P.current) P.current = P.cars[0].uid;
  const rec = curCar(); const pos = P.pos;
  let x = 0, y = 0, z = 30, yaw = 0; if (pos && isFinite(pos[0])) { [x, y, z, yaw] = pos; } else { const o = placeOnRoad(0, -300); x = o.x; z = o.z; y = o.y; yaw = o.yaw + Math.PI; }
  for (let i = 0; i < 20; i++) world.stream(x, z, 40);
  spawnPlayer(rec, x, y + 0.5, z, yaw); world.tod = P.tod ?? 11;
  updateSeason(); mode = 'free'; UI.closeAll(); camRig.init = false; hudShow(true);
  banner(P.festival.name || 'Horizon Festival', 'Welcome back, ' + P.character.name, 2500);
  if (!audio.ready) $('#audioHint')?.classList.remove('hide');
}
function starterIds() {
  const pick = (cat, maxPrice) => CARS.filter((c) => c.cat === cat && c.price <= maxPrice && !c.barn)[0]?.id;
  return [pick('HATCH', 40000) ?? 0, pick('MUSCLE', 60000) ?? 1, pick('RALLY', 70000) ?? pick('SPORT', 60000) ?? 2].filter((v, i, a) => v != null && a.indexOf(v) === i);
}
function updateSeason() {
  const season = weekSeason(); const wk = Math.floor(Date.now() / (7 * 86400000));
  if (P.season.week !== wk) { P.season = { week: wk, points: 0, champDone: {} }; }
  world.weather.probs = SEASON_WEATHER[season]; world.weather.seasonSnow = season === 'Winter' ? 0.75 : 0;
  if (season === 'Winter') world.weather.snowCover = Math.max(world.weather.snowCover, 0.7);
  world.season = season;
}

// ---------------------------------------------------------------------
// MAIN LOOP (fixed-timestep physics, interpolated rendering)
// ---------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - lastT) / 1000; lastT = now; if (!(dt > 0)) dt = 1 / 60; dt = Math.min(dt, 0.25);
  frameN++; gameTime += dt;
  try {
    if (perf.needResize) { perf.needResize = false; onResize(); }
    input.update(dt, player ? player.speed : 0);
    handleGlobalInput(dt);
    UI.update();
    const t0 = performance.now();
    // ---- physics ----
    simPaused = UI.isOpen() && !net.inSession() && !SCREENS[UI.top().name].live;
    const simulate = player && (mode === 'free' || mode === 'event') && !simPaused;
    if (simulate) {
      if (!world.isReady(player.pos.x, player.pos.z)) { player.frozen = true; $('#streamHold').classList.add('on'); }
      else if (player.frozen && !holdFrozen) { player.frozen = false; $('#streamHold').classList.remove('on'); }
      acc += dt; let steps = 0;
      while (acc >= PHYS_DT && steps < MAX_STEPS) { physTick(PHYS_DT); acc -= PHYS_DT; steps++; }
      if (steps >= MAX_STEPS) acc = 0; // cap: drop backlog instead of spiralling
      const alpha = acc / PHYS_DT; player.interpolate(alpha); for (const r of racers) r.veh.interpolate(alpha); net.interpolate();
    } else if (player) { player.interpolate(1); }
    perf.phys = lerp(perf.phys, performance.now() - t0, 0.1);
    // ---- world & visuals ----
    const focus = player ? player.renderPos : tmpV.set(0, 30, 0);
    world.stream(camera.position.x * 0.3 + focus.x * 0.7, camera.position.z * 0.3 + focus.z * 0.7, S.drawDistance === 'low' ? 3 : 5);
    if (mode === 'replay') replay.update(dt); else if (mode === 'photo') photo.update(dt); else updateCamera(dt);
    world.freezeTime = mode === 'photo' || (activeEvent && activeEvent.fixedTod != null);
    world.update(simulate ? dt : (mode === 'title' || mode === 'intro' || UI.isOpen() ? dt : 0), camera.position, player);
    if (playerModel && player) { playerModel.update(player, dt); updatePlayerLights(); }
    for (const r of racers) r.model.update(r.veh, dt);
    if (simulate) { effects(dt); skill.update(dt); eventUpdate(dt); discovery(dt); }
    if (player && (simulate || mode === 'replay')) updateAudio(dt); else if (playerVoice) playerVoice.update(0, 0, 0, 0, 0);
    net.update(dt);
    updateHUD(dt);
    // ---- render ----
    const t1 = performance.now();
    const pfx = postParams(dt);
    renderer.info.reset(); fx.render(scene, camera, world.sunDir || tmpV.set(0, 1, 0), pfx);
    perf.rend = lerp(perf.rend, performance.now() - t1, 0.1);
    perfUpdate(dt, now);
    if (P && mode !== 'title') { P.played += dt; autoSaveTimer += dt; auctionTimer += dt; if (auctionTimer > 1) { auctionTick(auctionTimer); auctionTimer = 0; } if (autoSaveTimer > 90 && mode === 'free' && !UI.isOpen()) { autoSaveTimer = 0; saveGame(true); } }
  } catch (e) {
    console.error(e); if (!loop._errShown) { loop._errShown = true; toast('Recovered from an error: ' + e.message, 'warn', 6000); }
  }
}
let holdFrozen = false;
function physTick(h) {
  // ---- player controls ----
  const st = input.state; const canDrive = !UI.isOpen() && !(activeEvent && activeEvent.countdown > 0) && !rewind.active && !quickChat.open;
  const pi = player.input;
  if (canDrive) { pi.throttle = st.throttle; pi.brake = st.brake; pi.steer = st.steer; pi.handbrake = st.handbrake; pi.clutch = st.clutch; }
  else { pi.throttle = activeEvent && activeEvent.countdown > 0 ? st.throttle : 0; pi.brake = activeEvent && activeEvent.countdown > 0 ? 0 : (UI.isOpen() ? 0.3 : 0); pi.steer = 0; pi.handbrake = activeEvent && activeEvent.countdown > 0 ? 1 : (UI.isOpen() ? 1 : 0); }
  if (shiftQ.up) { pi.shiftUp = 1; shiftQ.up = 0; } if (shiftQ.down) { pi.shiftDown = 1; shiftQ.down = 0; }
  // auto-brake assist from racing line
  pi.autoBrake = lineAssist.autoBrake || 0;
  if (rewind.active) { rewind.tick(); return; }
  net.beforeTick(h);
  player.savePrev(); player.step(h, world, world.env);
  collideWorld(player, world, h, onPlayerHit);
  // AI racers
  for (const r of racers) { r.veh.savePrev(); r.ai.control(r, h); r.veh.step(h, world, world.env); collideWorld(r.veh, world, h, (hit) => onAIHit(r, hit)); collideVehicles(player, r.veh, onCarHit); }
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) collideVehicles(racers[i].veh, racers[j].veh, null);
  // traffic
  if (world.traffic.list.length) for (const t of world.traffic.list) collideVehicles(player, t, onCarHit);
  net.afterTick(h);
  rewind.record(); replay.record(h);
  // auto-recover if upside down for long
  if (player.upsideTime > 3 && player.speed < 3) resetCar();
}
const shiftQ = { up: 0, down: 0 };
function onPlayerHit(hit) {
  if (hit.type === 'smash') {
    const c = hit.col; world.smashCollider(c, player.vel); c.dead = true; audio.smash(); P.stats.smashed++;
    skill.add('Wreckage', 'smash', 150 + Math.round(player.speed * 4)); input.rumble(0.35, 0.5, 120); camRig.shake += 0.25; replay.mark('Smash');
    if (activeEvent && activeEvent.onSmash) activeEvent.onSmash(c);
  } else if (hit.type === 'wall') {
    const sev = hit.speed || 0; if (sev > 2) { audio.impact(sev); input.rumble(clamp(sev / 20, 0.2, 1), 0.4, 200); camRig.shake += clamp(sev / 25, 0, 0.8); perf.dmgFlash = clamp(sev / 25, 0, 0.7) * (S.reduceFlash ? 0.3 : 1); }
    if (sev > 4) skill.breakChain('Collision');
    for (let i = 0; i < Math.min(14, sev); i++) world.glow.emit(hit.x ?? player.pos.x, player.pos.y, hit.z ?? player.pos.z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.25, 1, 0.6, 0.2, 1, 0.4, -0.2, 9);
  }
}
function onAIHit(r, hit) { if (hit.type === 'smash') { world.smashCollider(hit.col, r.veh.vel); hit.col.dead = true; } }
function onCarHit(hit) {
  const sev = hit.speed; if (sev > 2) { audio.impact(sev * 0.8); input.rumble(clamp(sev / 15, 0.2, 1), 0.6, 180); camRig.shake += clamp(sev / 20, 0, 0.6); }
  if (sev > 3) { skill.breakChain('Collision'); const other = hit.a === player ? hit.b : hit.a; if (other.isTraffic) other.nearMissDone = true; if (activeEvent && activeEvent.cleanRacing !== undefined) activeEvent.cleanRacing = false; }
}

// ---------------------------------------------------------------------
// GLOBAL HOTKEYS
// ---------------------------------------------------------------------
function handleGlobalInput(dt) {
  if (input.capture) return;
  if (mode === 'free' || mode === 'event') {
    if (!UI.isOpen()) {
      if (input.pressed('pause')) { UI.open(mode === 'event' ? 'pauseEvent' : 'pause'); return; }
      if (input.pressed('map') && mode === 'free') { UI.open('map'); return; }
      if (input.pressed('camera')) { camRig.mode = (camRig.mode + 1) % camRig.modes.length; S.camera = camRig.modes[camRig.mode]; toast('Camera: ' + S.camera); }
      if (input.pressed('shiftUp')) shiftQ.up = 1; if (input.pressed('shiftDown')) shiftQ.down = 1;
      if (input.pressed('reset')) resetCar();
      if (input.pressed('horn')) { audio.horn(P.character.horn); net.sendHorn(); }
      if (input.pressed('lights')) { manualLights = !manualLights; toast('Headlights ' + (manualLights ? 'on' : 'auto')); }
      if (input.pressed('photo')) { photo.enter(); return; }
      if (input.pressed('replay')) { replay.enter(); return; }
      if (input.pressed('anna') && mode === 'free') { const ne = nearestEvent(); if (ne) { setWaypoint(ne.start.x, ne.start.z, ne.name); } }
      camRig.lookBack = !!input.held('lookBack');
      rewind.handle(dt);
      quickChat.handle();
    }
  }
  if (input.pressed('pause') && (mode === 'photo')) photo.exit();
  if (input.pressed('pause') && (mode === 'replay')) replay.exit();
  if (input.keys.has('F3') && !handleGlobalInput._f3) { S.hud.perf = !S.hud.perf; saveSettings(); } handleGlobalInput._f3 = input.keys.has('F3');
  if (input.keys.has('F1') && !handleGlobalInput._f1 && !UI.isOpen()) UI.open('help'); handleGlobalInput._f1 = input.keys.has('F1');
}
let manualLights = false;
function updatePlayerLights() {
  const on = manualLights || world.night > 0.35 || world.weather.p.fog > 0.5 || isInTunnel(); const braking = player.input.brake > 0.1;
  playerModel.setLights(on, braking); for (const L of playerLights) L.intensity = on ? 90 : 0;
}
function isInTunnel() { const q = world.roadQuery(player.pos.x, player.pos.z, groundTmp); return !!(q && q.d < 0 && (q.flags & 2)); }

// ---------------------------------------------------------------------
// EFFECTS: smoke, dust, roostertails, splash, snow spray, skidmarks, sparks, backfire
// ---------------------------------------------------------------------
const SURF_DUST = { dirt: [0.55, 0.42, 0.28], gravel: [0.6, 0.57, 0.52], sand: [0.82, 0.72, 0.52], snow: [0.95, 0.97, 1], mud: [0.3, 0.22, 0.14], grass: [0.35, 0.45, 0.2], salt: [0.95, 0.94, 0.9], rock: [0.5, 0.48, 0.45] };
function vehicleEffects(v, model, key, dt, near) {
  if (!v || !v.wheels) return { loose: 0, bump: 0, water: 0, kerb: 0 };
  const R = v.quat; const lat = tmpV3.set(1, 0, 0).applyQuaternion(R);
  const spd = v.speed; let loose = 0; let bump = 0; let water = 0; let kerb = 0;
  v.wheels.forEach((w, i) => {
    const sk = key + i; if (!w.contact) { world.skids.lift(sk); return; }
    const p = w.cp; const sname = w.surf ? w.surf.name.toLowerCase() : 'tarmac'; const sid = sname;
    const slip = w.slipVel || 0; const paved = sid === 'tarmac' || sid === 'concrete';
    if (w.surf && w.surf.bump) bump += w.surf.bump; if (w.water > 0.02) water += w.water; if (w.kerb) kerb = 1;
    if (paved) {
      if (slip > 5 && spd > 1) { // skid & smoke
        world.skids.add(sk, p.x, p.y, p.z, lat.x, lat.z, 0.24, clamp((slip - 4) / 12, 0.15, 0.75));
        if (near && Math.random() < clamp((slip - 6) / 10, 0, 1) * (world.env.wet > 0.5 ? 0.25 : 1)) world.particles.emit(p.x, p.y + 0.25, p.z, v.vel.x * 0.2 + (Math.random() - 0.5), 0.6 + Math.random(), v.vel.z * 0.2 + (Math.random() - 0.5), 1.1, 0.88, 0.88, 0.9, 0.45, 2.2, 2.2, -0.15);
      } else world.skids.lift(sk);
      if (world.env.wet > 0.35 && spd > 12 && near && Math.random() < 0.5) world.particles.emit(p.x, p.y + 0.15, p.z, -v.vel.x * 0.05, 0.6, -v.vel.z * 0.05, 0.9, 0.75, 0.8, 0.85, 0.25 * world.env.wet, 0.9, 1.8, 2);
    } else {
      loose++;
      const col = SURF_DUST[sid] || SURF_DUST.dirt; const rate = clamp(spd / 25 + slip / 10, 0, 1.5);
      if (sid !== 'grass' || slip > 4) world.skids.add(sk, p.x, p.y, p.z, lat.x, lat.z, 0.28, sid === 'snow' ? 0.35 : 0.22, col[0] * 0.5, col[1] * 0.5, col[2] * 0.5); else world.skids.lift(sk);
      if (near && Math.random() < rate * 0.8) {
        const kick = sid === 'snow' ? 0.6 : 0.35; const up = sid === 'snow' ? 1.8 : 1.2;
        world.particles.emit(p.x, p.y + 0.2, p.z, -v.vel.x * kick * 0.3 + (Math.random() - 0.5) * 2, up + Math.random() * (1 + slip * 0.1), -v.vel.z * kick * 0.3 + (Math.random() - 0.5) * 2, sid === 'snow' ? 0.9 : 1.4, col[0], col[1], col[2], sid === 'mud' ? 0.8 : 0.5, sid === 'snow' ? 1.2 : 2.5, 2.4, sid === 'mud' || sid === 'snow' ? 4 : 0.2);
        if ((sid === 'gravel' || sid === 'mud' || sid === 'dirt') && slip > 3 && w.driven) world.particles.emit(p.x, p.y + 0.3, p.z, -v.vel.x * 0.1 + (Math.random() - 0.5) * 3, 3 + Math.random() * 3, -v.vel.z * 0.1 + (Math.random() - 0.5) * 3, 0.25, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 0.9, 0.9, 0.1, 9.8); // roostertail chunks
      }
    }
    if (w.water > 0.05 && spd > 3 && near) for (let k = 0; k < 2; k++) world.particles.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 4 + lat.x * (w.left ? 3 : -3), 2 + Math.random() * 3 + spd * 0.05, (Math.random() - 0.5) * 4 + lat.z * (w.left ? 3 : -3), 0.7, 0.85, 0.92, 1, 0.6, 0.8, 1.5, 9.8);
  });
  if (v.inWater > 0.2 && spd > 2 && near) for (let k = 0; k < 3; k++) world.particles.emit(v.pos.x + (Math.random() - 0.5) * 2, world.waterLevel + 0.2, v.pos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5, 1.2, 0.85, 0.92, 1, 0.6, 1, 1.5, 9.8);
  // exhaust: backfire flames and smoke
  if (model && model.exhaust && v.p.asp !== 'EV') {
    const ex = v.events; for (const e of ex) if (e.t === 'pop' || e.t === 'bov') { /* handled in audio */ }
    if (v._pop && near) { for (const e of model.exhaust) { const wp = tmpV2.copy(e).applyQuaternion(R).add(v.renderPos); const back = tmpV.set(0, 0, -1).applyQuaternion(R); for (let k = 0; k < 3; k++) world.glow.emit(wp.x, wp.y, wp.z, back.x * 6 + (Math.random() - 0.5), back.y * 6 + Math.random() * 0.5, back.z * 6 + (Math.random() - 0.5), 0.35 + Math.random() * 0.3, 1, 0.55, 0.15, 1, 0.09, 1.5, 0); } v._pop = 0; }
    if (near && v.engine.throttle > 0.8 && v.engine.rpm < v.p.pRpm * 0.5 && Math.random() < 0.15) { const e = model.exhaust[0]; const wp = tmpV2.copy(e).applyQuaternion(R).add(v.renderPos); world.particles.emit(wp.x, wp.y, wp.z, 0, 0.4, 0, 0.5, 0.35, 0.35, 0.38, 0.25, 1.2, 1.2, -0.1); }
  }
  return { loose, bump, water, kerb };
}
const fxState = { loose: 0, bump: 0, kerb: 0 };
function effects(dt) {
  const r = vehicleEffects(player, playerModel, 'p', dt, true); Object.assign(fxState, r);
  for (const rc of racers) { const near = rc.veh.pos.distanceToSquared(camera.position) < 120 * 120; vehicleEffects(rc.veh, rc.model, 'a' + rc.veh.id, dt, near); }
  for (const rm of net.remoteList()) if (rm.veh) vehicleEffects(rm.veh, rm.model, 'r' + rm.id, dt, rm.veh.pos.distanceToSquared(camera.position) < 100 * 100);
  // rumble: kerbs, off-road, shifting
  if (r.kerb && player.speed > 5) input.rumble(0.15, 0.5, 60); else if (r.loose >= 2 && player.speed > 5) input.rumble(0.12 + r.bump * 2, 0.1, 60);
  for (const e of player.events) { if (e.t === 'shift') { audio.shift(e.up); input.rumble(0.3, 0.1, 70); } else if (e.t === 'bov') audio.bov(e.amt); else if (e.t === 'scrape') { audio.impact(e.amt * 0.4); for (let k = 0; k < 6; k++) world.glow.emit(player.pos.x, player.pos.y - player.cgh, player.pos.z, (Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5, 0.2, 1, 0.7, 0.3, 1, 0.35, -0.1, 9); } }
  player.events.length = 0; for (const rc of racers) rc.veh.events.length = 0;
}

// ---------------------------------------------------------------------
// CAMERA
// ---------------------------------------------------------------------
function updateCamera(dt) {
  if (mode === 'title' || mode === 'intro') { titleCam(dt); return; }
  if (!player) return;
  const top = UI.top(); if (top && SCREENS[top.name].showroom) { showroomCam(dt); return; }
  const v = player; const R = v.renderQuat; const pos = v.renderPos; const spec = CARS[playerRec.id];
  const fwd = tmpV.set(0, 0, 1).applyQuaternion(R); const flatF = tmpV2.set(fwd.x, 0, fwd.z).normalize();
  const md = camRig.modes[camRig.mode]; const kmh = v.speed * 3.6;
  // look input
  const st = input.state; camRig.yawOff += st.lookX * dt * 3.2 + (st.mouseDX || 0); camRig.pitchOff = clamp(camRig.pitchOff + st.lookY * dt * 1.5 + (st.mouseDY || 0) * 0.5, -0.4, 0.6);
  if (Math.abs(st.lookX) < 0.05 && !(input.mouse.down || st.mouseDX)) { camRig.yawOff *= 1 - Math.min(1, dt * 2.5); camRig.pitchOff *= 1 - Math.min(1, dt * 2.5); }
  let yawLook = camRig.yawOff + (camRig.lookBack ? Math.PI : 0);
  const fovBase = S.fov; let fov = fovBase;
  if (md === 'chase' || md === 'far') {
    const dist = (md === 'far' ? 7.6 : 5.6) + spec.len * 0.55 + (spec.cat === 'TRUCK' ? 1.5 : 0); const ht = (md === 'far' ? 2.6 : 1.8) + spec.hgt * 0.5;
    // heading follows velocity when moving (shows drift angle)
    let hd = Math.atan2(flatF.x, flatF.z); if (v.speed > 4) { const vh = Math.atan2(v.vel.x, v.vel.z); let d = vh - hd; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.cos(d) > 0) hd += d * 0.55; }
    if (!camRig.init) { camRig.heading = hd; }
    let dh = hd - camRig.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); camRig.heading += dh * Math.min(1, dt * 4.5);
    const H = camRig.heading + yawLook; const back = tmpV3.set(-Math.sin(H), 0, -Math.cos(H));
    const want = new THREE.Vector3().copy(pos).addScaledVector(back, dist * (1 + camRig.pitchOff * 0.3)); want.y += ht + camRig.pitchOff * 3;
    const g = world.height(want.x, want.z) + 0.8; if (want.y < g) want.y = g;
    if (!camRig.init) { camRig.pos.copy(want); camRig.init = true; }
    camRig.pos.lerp(want, 1 - Math.exp(-dt * (v.speed > 40 ? 14 : 10))); camRig.pos.y = Math.max(camRig.pos.y, g);
    camera.position.copy(camRig.pos); camRig.look.copy(pos).addScaledVector(flatF, 2.5); camRig.look.y += 0.9; camera.up.set(0, 1, 0); camera.lookAt(camRig.look);
    fov += S.dynamicFov * clamp(kmh / 320, 0, 1) * 16;
  } else {
    const y0 = playerModel.y0, BH = playerModel.BH; let off;
    if (md === 'hood') off = new THREE.Vector3(0, y0 + BH * 0.98 + 0.12, spec.len * 0.12);
    else if (md === 'bumper') off = new THREE.Vector3(0, y0 + 0.35, spec.len / 2 + 0.15);
    else off = new THREE.Vector3(spec.cat === 'BIKE' ? 0 : 0.36, y0 + BH * 0.82, spec.cat === 'BIKE' ? 0.05 : -spec.wb * 0.02);
    camera.position.copy(off.applyQuaternion(R).add(pos));
    const q = tmpQ.copy(R); const lookQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + yawLook);
    camera.quaternion.copy(q).multiply(lookQ); camera.rotateX(-camRig.pitchOff * 0.5);
    if (spec.cat === 'BIKE' && playerModel.lean) camera.rotateZ(playerModel.lean * 0.6);
    fov += S.dynamicFov * clamp(kmh / 320, 0, 1) * 9; camRig.init = false;
    cockpit.show(md === 'cockpit', off);
  }
  if (!(md === 'cockpit')) cockpit.show(false);
  // shake: speed, surface, impacts
  const sh = S.camShake * (clamp((kmh - 120) / 250, 0, 1) * 0.02 + fxState.bump * 0.6 * clamp(kmh / 80, 0, 1) + camRig.shake * 0.15);
  if (sh > 0.0005) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh; }
  camRig.shake = Math.max(0, camRig.shake - dt * 2.5);
  camRig.fovCur = lerp(camRig.fovCur, fov, 1 - Math.exp(-dt * 4)); if (Math.abs(camera.fov - camRig.fovCur) > 0.01) { camera.fov = camRig.fovCur; camera.updateProjectionMatrix(); }
}
const cockpit = {
  mesh: null,
  show(on, off) {
    if (!this.mesh && on) { const g = new THREE.Group(); const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.5), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 })); dash.position.set(-0.36, -0.28, 0.75); g.add(dash); const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: 0x111111 })); wheel.position.set(0, -0.2, 0.45); wheel.rotation.x = -0.35; g.add(wheel); this.wheel = wheel; const pillarM = new THREE.MeshStandardMaterial({ color: 0x0c0c0e }); for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), pillarM); p.position.set(-0.36 + sx * 0.72, 0.05, 0.75); p.rotation.x = -0.5; g.add(p); } this.mesh = g; }
    if (!this.mesh) return; if (on && this.mesh.parent !== playerModel.group) { playerModel.group.add(this.mesh); }
    this.mesh.visible = !!on; if (on && off) { this.mesh.position.copy(new THREE.Vector3(0.36, playerModel.y0 + playerModel.BH * 0.82, -CARS[playerRec.id].wb * 0.02)); this.wheel.rotation.z = -player.input.steer * 2.2; }
  },
};
let titleT = 0; const TITLE_SHOTS = [[[-200, 60, -120], [0, 25, -90]], [[2400, 230, -200], [2700, 120, 100]], [[-3300, 40, -400], [-3050, 15, 0]], [[400, 120, 2300], [300, 40, 2700]], [[-200, 420, -2300], [-300, 300, -2700]], [[2500, 280, -2500], [2700, 250, -2700]]];
function titleCam(dt) {
  titleT += dt; const i = Math.floor(titleT / 9) % TITLE_SHOTS.length; const t = (titleT % 9) / 9; const [a, b] = TITLE_SHOTS[i];
  const p = new THREE.Vector3(...a); const l = new THREE.Vector3(...b); const side = new THREE.Vector3().subVectors(l, p).cross(new THREE.Vector3(0, 1, 0)).normalize();
  p.addScaledVector(side, (t - 0.5) * 120); p.y = Math.max(p.y, world.height(p.x, p.z) + 20);
  camera.position.copy(p); camera.lookAt(l); if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  if (frameN % 30 === 0) for (let k = 0; k < 2; k++) world.stream(l.x, l.z, 10);
}
function showroomCam(dt) {
  camRig.orbit += dt * 0.25 + input.state.lookX * dt * 1.5 + (input.state.mouseDX || 0) * 0.02; const spec = CARS[playerRec.id]; const d = spec.len * 1.35 + 3.6;
  const c = player.renderPos; camera.position.set(c.x + Math.sin(camRig.orbit) * d, c.y + 1.2 + spec.hgt * 0.3, c.z + Math.cos(camRig.orbit) * d);
  const g = world.height(camera.position.x, camera.position.z) + 0.6; if (camera.position.y < g) camera.position.y = g;
  const fx0 = c.x - camera.position.x, fz0 = c.z - camera.position.z; const fl = Math.hypot(fx0, fz0) || 1; const off = innerWidth > 900 ? d * 0.3 : 0; camera.lookAt(c.x + (fz0 / fl) * off, c.y + 0.2, c.z - (fx0 / fl) * off); if (Math.abs(camera.fov - 50) > 0.1) { camera.fov = 50; camera.updateProjectionMatrix(); } camRig.init = false;
}
function postParams(dt) {
  const kmh = player ? player.speed * 3.6 : 0; const inDrive = mode === 'free' || mode === 'event'; const k = inDrive && !UI.isOpen() ? clamp((kmh - 90) / 230, 0, 1) : 0;
  perf.dmgFlash = Math.max(0, (perf.dmgFlash || 0) - dt * 2);
  const o = { blur: S.motionBlur * k * 1.2, ca: S.chromatic * (k * 0.012 + (perf.dmgFlash || 0) * 0.02), vig: 0.3 + k * 0.25, speedLines: S.speedLines * clamp((kmh - 180) / 150, 0, 1) * (inDrive ? 1 : 0), raysOn: S.godrays, flash: (world.weather.flash || 0) * (S.reduceFlash ? 0.15 : 0.5) + (perf.flash || 0), damageFlash: perf.dmgFlash || 0, filter: 0 };
  perf.flash = Math.max(0, (perf.flash || 0) - dt * 3);
  if (mode === 'photo') Object.assign(o, photo.post()); if (mode === 'replay') o.filter = replay.filter;
  return o;
}

// ---------------------------------------------------------------------
// AUDIO MIX
// ---------------------------------------------------------------------
function updateAudio(dt) {
  if (!audio.ready) return; const v = player; const e = v.engine;
  if (!playerVoice) playerVoice = audio.createEngine(v.p, {});
  const vol = mode === 'replay' ? 0.7 : 1;
  if (playerVoice) playerVoice.update(e.rpm, e.throttle ?? v.input.throttle, e.load ?? 0, e.boost, vol, null, dt);
  // crackle on lift-off at high rpm
  if ((v.p.cyl >= 6 || v.p.asp === "T" || v.p.asp === "TT") && v.p.asp !== 'EV' && v.input.throttle < 0.1 && e.rpm > v.p.pRpm * 0.6 && Math.random() < dt * 9) { audio.pop(); v._pop = 1; }
  let squeal = 0, grav = 0; v.wheels.forEach((w) => { if (!w.contact) return; const sid = w.surf ? w.surf.name.toLowerCase() : 'tarmac'; if (sid === 'tarmac' || sid === 'concrete') squeal = Math.max(squeal, clamp((w.slipVel - 3) / 10, 0, 1)); else grav = Math.max(grav, clamp(v.speed / 30, 0, 1)); });
  audio.layer('squeal', squeal * 0.35 * (world.env.wet > 0.5 ? 0.4 : 1), 900 + squeal * 400);
  audio.layer('wind', clamp(v.speed / 70, 0, 1) ** 2 * 0.25, 400 + v.speed * 12);
  audio.layer('gravel', grav * 0.25, 1800); audio.layer('rain', world.weather.p.rain * 0.3, 3000); audio.layer('rumble', fxState.bump * 1.5 * clamp(v.speed / 20, 0, 1), 120);
  // AI engines (nearest 3 spatial)
  const near = racers.slice().sort((a, b) => a.veh.pos.distanceToSquared(camera.position) - b.veh.pos.distanceToSquared(camera.position));
  near.forEach((r, i) => { if (i < 3) { if (!r.voice) r.voice = audio.createEngine(r.veh.p, { spatial: true }); const d = r.veh.pos.distanceTo(camera.position); r.voice && r.voice.update(r.veh.engine.rpm, r.veh.input.throttle, 0.5, r.veh.engine.boost, clamp(1 - d / 120, 0, 1) * 0.6, r.veh.pos, dt); } else if (r.voice) { r.voice.stop(); r.voice = null; } });
  if (audio.ctx && audio.ctx.listener) { const L = audio.ctx.listener; const f = tmpV.set(0, 0, -1).applyQuaternion(camera.quaternion); if (L.positionX) { L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; } }
}

// ---------------------------------------------------------------------
// SKILL CHAINS
// ---------------------------------------------------------------------
const SKILL_TIERS = { drift: [[0, 'Drift'], [1500, 'Great Drift'], [4000, 'Awesome Drift'], [9000, 'Ultimate Drift']], air: [[0, 'Air'], [700, 'Great Air'], [1600, 'Awesome Air'], [3000, 'Ultimate Air']] };
function tierName(kind, pts) { const t = SKILL_TIERS[kind]; let n = t[0][1]; for (const [m, nm] of t) if (pts >= m) n = nm; return n; }
const skill = {
  total: 0, count: 0, mult: 1, idle: 0, items: [], driftPts: 0, driftT: 0, airPeak: 0, speedT: 0, lastBank: 0, broke: 0, nearCD: 0, eventScore: 0,
  maxMult() { return 10 + (P && P.perks && P.perks.mult ? 2 : 0); },
  bankTime() { return P && P.perks && P.perks.bank ? 4.5 : 3; },
  reset(hard) { if (hard) { this.total = 0; this.count = 0; this.mult = 1; this.items = []; } this.idle = 0; this.driftPts = 0; this.driftT = 0; this.airPeak = 0; this.speedT = 0; },
  add(name, kind, pts) {
    if (!S.hud.chain && !activeEvent) { /* still counted */ }
    this.count++; this.mult = Math.min(this.maxMult(), 1 + Math.floor(this.count / 2)); this.total += pts; this.idle = 0;
    this.items.unshift({ name, pts, t: 2.4 }); if (this.items.length > 5) this.items.pop();
    if (activeEvent && activeEvent.onSkill) activeEvent.onSkill(kind, pts * this.mult);
    P.stats.skills = (P.stats.skills || 0) + 1; audio.ui && audio.tone && audio.tone(520 + Math.min(this.count, 20) * 30, 0.06, 'triangle', 0.05);
    const ch = $('#chain'); ch.classList.remove('pulse'); void ch.offsetWidth; ch.classList.add('pulse');
  },
  bank() {
    if (this.total <= 0) return; const val = Math.round(this.total * this.mult); this.lastBank = val;
    P.skillCarry = (P.skillCarry || 0) + val; const pts = Math.floor(P.skillCarry / 15000); P.skillCarry -= pts * 15000;
    if (pts > 0) { P.skillPts += pts; toast(`+${pts} Skill Point${pts > 1 ? 's' : ''}`, 'skill'); }
    const cr = Math.round(val * 0.02); addCredits(cr, false); addXP(Math.round(val * 0.01));
    if (val > (P.stats.bestChain || 0)) P.stats.bestChain = val;
    if (activeEvent && activeEvent.onBank) activeEvent.onBank(val);
    this.flash = { text: 'BANKED ' + val.toLocaleString(), t: 1.6, good: true }; this.reset(true);
  },
  breakChain(reason) {
    if (this.total <= 0) return; if (activeEvent && activeEvent.onBreak) activeEvent.onBreak();
    this.flash = { text: reason ? reason.toUpperCase() + ' — CHAIN LOST' : 'CHAIN LOST', t: 1.6, good: false }; this.reset(true); audio.tone && audio.tone(160, 0.25, 'sawtooth', 0.06);
  },
  update(dt) {
    const v = player; if (!v || v.frozen) return; const kmh = v.speed * 3.6;
    // drift
    const ang = Math.abs(v.driftAngle);
    if (v.onGround && v.speed > 9 && ang > 0.22 && ang < 1.9) { this.driftT += dt; this.driftPts += dt * v.speed * ang * 22 * (P.perks && P.perks.drift ? 1.2 : 1); this.idle = 0; this.drifting = true; }
    else if (this.drifting) { if (this.driftT > 0.8) this.add(tierName('drift', this.driftPts), 'drift', Math.round(this.driftPts)); this.drifting = false; this.driftT = 0; this.driftPts = 0; }
    // air & jumps
    if (!v.onGround) { if (v.airTime > 0.35) this.airPeak = v.airTime; if (!this.airStart) this.airStart = v.pos.clone(); }
    else if (this.airStart) { const air = this.airPeak; const dist = Math.hypot(v.pos.x - this.airStart.x, v.pos.z - this.airStart.z); this.airStart = null; this.airPeak = 0;
      if (air > 0.6) { this.add(tierName('air', air * 600), 'air', Math.round(air * 600)); if (dist > 25) this.add('Jump', 'jump', Math.round(dist * 12)); replay.mark('Big Air'); if (activeEvent && activeEvent.onJump) activeEvent.onJump(dist); P.stats.longestJump = Math.max(P.stats.longestJump || 0, dist); input.rumble(clamp(air / 2, 0.3, 1), 0.8, 200); camRig.shake += 0.3; } }
    // speed
    if (kmh > 240) { this.speedT += dt; this.idle = 0; if (this.speedT > 3) { this.add(kmh > 320 ? 'Ultimate Speed' : 'Speed', 'speed', Math.round(kmh * 2)); this.speedT = 0; } } else this.speedT = Math.max(0, this.speedT - dt);
    // near misses (traffic + AI)
    this.nearCD -= dt; if (v.speed > 15 && this.nearCD <= 0) {
      const check = (o) => { if (o.nearMissDone) return; const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z; const d2 = dx * dx + dz * dz; if (d2 > 30) { if (d2 > 400) o._nm = 0; return; } const rel = Math.hypot(o.vel.x - v.vel.x, o.vel.z - v.vel.z); if (d2 < 9 && rel > 8) { o._nm = 1; } };
      for (const t of world.traffic.list) check(t); for (const r of racers) check(r.veh);
      const finish = (o) => { if (o._nm === 1 && !o.nearMissDone) { const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z; if (dx * dx + dz * dz > 16) { o.nearMissDone = true; o._nm = 2; this.add('Near Miss', 'near', 250); this.nearCD = 0.3; replay.mark('Near Miss'); if (o.isTraffic) setTimeout(() => { o.nearMissDone = false; }, 6000); else setTimeout(() => { o.nearMissDone = false; o._nm = 0; }, 3000); } } };
      for (const t of world.traffic.list) finish(t); for (const r of racers) finish(r.veh);
    }
    // bank
    if (this.total > 0 && !this.drifting && v.onGround) { this.idle += dt; if (this.idle > this.bankTime()) this.bank(); }
    for (const it of this.items) it.t -= dt; this.items = this.items.filter((i) => i.t > 0);
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) this.flash = null; }
  },
};
function addCredits(n, show = true) { if (!n) return; P.credits += n; P.stats.creditsEarned = (P.stats.creditsEarned || 0) + Math.max(0, n); if (show) toast((n > 0 ? '+' : '') + fmtCR(n), 'cr'); }
function xpForLevel(l) { return 2000 + l * 650; }
function addXP(n) {
  P.xp += n; let lv = false; while (P.xp >= xpForLevel(P.level)) { P.xp -= xpForLevel(P.level); P.level++; P.wheelspins++; lv = true; if (P.level % 5 === 0) P.superWheelspins++; }
  if (lv) { banner('LEVEL ' + P.level, 'Festival level up — Wheelspin awarded', 2600, 'gold'); audio.tone && audio.tone(880, 0.3, 'triangle', 0.08); }
}

// ---------------------------------------------------------------------
// REWIND (last 10s, 60Hz)
// ---------------------------------------------------------------------
const rewind = {
  buf: [], max: 600, active: false, tickN: 0, uses: 0,
  record() { if (this.active) return; if ((this.tickN++ & 1) !== 0) return; const e = { p: player.getState(), r: racers.map((r) => r.veh.getState()), ev: activeEvent ? activeEvent.snapshot() : null }; this.buf.push(e); if (this.buf.length > this.max) this.buf.shift(); },
  handle(dt) {
    const want = (input.held('rewind') || input.touch.rewind) && S.assists.rewind && !(activeEvent && activeEvent.noRewind) && !net.inSession();
    if (want && !this.active && this.buf.length > 10) { this.active = true; this.uses++; skill.breakChain(); $('#rewindFx').classList.add('on'); }
    if (!want && this.active) { this.active = false; $('#rewindFx').classList.remove('on'); for (const w of player.wheels) w.omega = player.speed / player.p.tireR; }
  },
  tick() { const e = this.buf.pop(); if (!e) { this.active = false; $('#rewindFx').classList.remove('on'); return; } player.savePrev(); player.setState(e.p); racers.forEach((r, i) => { if (e.r[i]) { r.veh.savePrev(); r.veh.setState(e.r[i]); } }); if (e.ev && activeEvent) activeEvent.restore(e.ev); world.skids.lift('p0'); world.skids.lift('p1'); world.skids.lift('p2'); world.skids.lift('p3'); },
  clear() { this.buf.length = 0; this.active = false; $('#rewindFx')?.classList.remove('on'); },
};

// ---------------------------------------------------------------------
// GPS / RACING LINE RIBBON
// ---------------------------------------------------------------------
function chevronTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(8, 50); g.lineTo(32, 18); g.lineTo(56, 50); g.lineTo(44, 50); g.lineTo(32, 34); g.lineTo(20, 50); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
class Ribbon {
  constructor(n, width, tex, opacity = 0.8) {
    this.n = n; this.w = width; const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2); const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, fog: true });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.visible = false; scene.add(this.mesh); this.geo = g;
  }
  set(pts, start, colorFn, scroll = 0) {
    const n = this.n; const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array, uv = this.geo.attributes.uv.array; let along = 0;
    let last = start; const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = Math.min(pts.length - 1, start + i); last = k; const p = pts[k]; const q = pts[Math.min(pts.length - 1, k + 1)]; const pr = pts[Math.max(0, k - 1)];
      let dx = q[0] - pr[0], dz = q[2] - pr[2]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const lx = -dz * this.w * 0.5, lz = dx * this.w * 0.5;
      if (i > 0) { const pp = pts[Math.min(pts.length - 1, start + i - 1)]; along += Math.hypot(p[0] - pp[0], p[2] - pp[2]); }
      const y = p[1] + 0.14;
      pos.set([p[0] - lx, y, p[2] - lz, p[0] + lx, y, p[2] + lz], i * 6);
      colorFn(k, c, i / n); col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
      const v = along / this.w * 0.6 - scroll; uv.set([0, v, 1, v], i * 4);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
}
let gpsRibbon = null, lineRibbon = null; let waypoint = null; let gpsRoute = null; let gpsT = 0; const lineAssist = { autoBrake: 0 };
function setWaypoint(x, z, name) { waypoint = { x, z, name }; gpsRoute = null; gpsT = 0; toast('GPS route set: ' + (name || 'Waypoint'), 'gps'); }
function clearWaypoint() { waypoint = null; gpsRoute = null; gpsRibbon && gpsRibbon.hide(); }
function densify(pts, step = 3) { // resample polyline to ~step metres, with terrain/road heights
  const out = []; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const L = Math.hypot(b[0] - a[0], b[2] - a[2]); const n = Math.max(1, Math.ceil(L / step)); for (let j = 0; j < n; j++) { const t = j / n; const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t; out.push([x, a[1] + (b[1] - a[1]) * t, z, a[3] || 5]); } }
  out.push(pts[pts.length - 1].slice()); for (const p of out) { const gg = world.ground(p[0], p[2], groundTmp, p[1] + 3); p[1] = gg && isFinite(gg.h) ? gg.h : world.height(p[0], p[2]); } return out;
}
function nearestIdx(pts, x, z, hint = 0, win = 80) { let bi = hint, bd = 1e18; const lo = Math.max(0, hint - win), hi = Math.min(pts.length - 1, hint + win * 3); for (let i = lo; i <= hi; i++) { const d = (pts[i][0] - x) ** 2 + (pts[i][2] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return [bi, Math.sqrt(bd)]; }
function fullNearest(pts, x, z) { let bi = 0, bd = 1e18; for (let i = 0; i < pts.length; i += 2) { const d = (pts[i][0] - x) ** 2 + (pts[i][2] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
function updateGuides(dt) {
  if (!gpsRibbon) { const tex = chevronTex(); gpsRibbon = new Ribbon(110, 3.2, tex, 0.7); lineRibbon = new Ribbon(130, 1.6, tex, 0.85); }
  lineAssist.autoBrake = 0;
  if (!player || !(mode === 'free' || mode === 'event') || UI.isOpen()) { gpsRibbon.hide(); lineRibbon.hide(); return; }
  const px = player.pos.x, pz = player.pos.z;
  // GPS route to waypoint (free roam) or to event objective
  const target = mode === 'event' && activeEvent && activeEvent.gpsTarget ? activeEvent.gpsTarget() : waypoint;
  if (target && !(activeEvent && activeEvent.line && S.assists.line > 0)) {
    gpsT -= dt; if (!gpsRoute || gpsT <= 0 || gpsRoute.tx !== target.x) { gpsRoute = { pts: densify(world.route(px, pz, target.x, target.z, true), 3), idx: 0, tx: target.x }; gpsT = 5; }
    const [i, d] = nearestIdx(gpsRoute.pts, px, pz, gpsRoute.idx, 60); gpsRoute.idx = i; if (d > 40) gpsT = 0;
    if (mode === 'free' && Math.hypot(target.x - px, target.z - pz) < 25 && waypoint) { toast('Arrived: ' + (waypoint.name || 'Waypoint'), 'gps'); clearWaypoint(); return; }
    gpsRibbon.set(gpsRoute.pts, i + 2, (k, c) => c.setRGB(0.2, 0.75, 1), gameTime * 1.5);
  } else gpsRibbon.hide();
  // racing line with braking colours
  const ev = activeEvent; if (ev && ev.line && S.assists.line > 0) {
    const L = ev.line; const [i] = nearestIdx(L.pts, px, pz, ev.lineIdx || 0, 50); ev.lineIdx = i; const v = player.speed;
    const look = Math.min(L.pts.length - 1, i + Math.round(clamp(v * 1.3, 15, 60) / 3)); const tAhead = L.speed[look] * (player.gripEst || 1);
    if (S.assists.autoBrake > 0) lineAssist.autoBrake = clamp((v - tAhead) / 6, 0, 1);
    const brakingOnly = S.assists.line === 1;
    lineRibbon.set(L.pts, i + 3, (k, c) => { const ts = L.speed[k] * (player.gripEst || 1); const over = v - ts; const pl = PAL(); if (over > 3) c.setRGB(...pl.bad); else if (over > -4) c.setRGB(...pl.warn); else if (brakingOnly) c.setRGB(0, 0, 0); else c.setRGB(...pl.good); }, 0);
    lineRibbon.mat.opacity = brakingOnly ? 0.85 : 0.75; lineRibbon.mat.blending = brakingOnly ? THREE.AdditiveBlending : THREE.NormalBlending;
  } else lineRibbon.hide();
}
// target speeds along a polyline from curvature
function lineSpeeds(pts, mu = 1.15) {
  const n = pts.length; const sp = new Float32Array(n); const closed = false;
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 4)], b = pts[i], c = pts[Math.min(n - 1, i + 4)]; const abx = b[0] - a[0], abz = b[2] - a[2], bcx = c[0] - b[0], bcz = c[2] - b[2]; const la = Math.hypot(abx, abz), lb = Math.hypot(bcx, bcz), lc = Math.hypot(c[0] - a[0], c[2] - a[2]); const cross = Math.abs(abx * bcz - abz * bcx); const R = cross > 1e-6 ? (la * lb * lc) / (2 * cross) : 1e4; sp[i] = Math.min(95, Math.sqrt(mu * 9.81 * Math.max(R, 5))); }
  // backward pass for braking distance (decel ~ 8 m/s^2)
  for (let i = n - 2; i >= 0; i--) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]); sp[i] = Math.min(sp[i], Math.sqrt(sp[i + 1] ** 2 + 2 * 7.5 * d)); }
  return sp;
}

// ---------------------------------------------------------------------
// ROAD DISCOVERY
// ---------------------------------------------------------------------
let discT = 0; let roadBinsTotal = 0;
function discovery(dt) {
  discT -= dt; if (discT > 0) return; discT = 0.3;
  const q = world.roadQuery(player.pos.x, player.pos.z, groundTmp); if (!q || q.d > 2) return;
  const e = q.edge; const bins = Math.max(1, Math.ceil(e.len / 50)); const b = Math.min(bins - 1, Math.floor(q.s / 50));
  let s = P.roads[e.id]; if (!s || s.length !== bins) s = '0'.repeat(bins);
  if (s[b] === '0') { s = s.slice(0, b) + '1' + s.slice(b + 1); P.roads[e.id] = s; P.stats.roadBins = (P.stats.roadBins || 0) + 1; if (!s.includes('0') && !P.roadDone?.[e.id]) { P.roadDone = P.roadDone || {}; P.roadDone[e.id] = 1; toast('Road completed: ' + (e.name || 'Unnamed road') + ' +500 XP', 'xp'); addXP(500); } }
  if (e.hidden && !P.shortcuts?.[e.id]) { P.shortcuts = P.shortcuts || {}; P.shortcuts[e.id] = 1; banner('SHORTCUT FOUND', e.name, 2400); addXP(800); }
  const reg = world.regionName(player.pos.x, player.pos.z); if (reg !== discovery.reg) { discovery.reg = reg; if (gameTime > 3) subtitle(reg, 2600); }
}
function roadPercent() { if (!roadBinsTotal) roadBinsTotal = world.edges.reduce((s, e) => s + Math.max(1, Math.ceil(e.len / 50)), 0); let c = 0; for (const k in P.roads) for (const ch of P.roads[k]) if (ch === '1') c++; return c / roadBinsTotal; }

// ---------------------------------------------------------------------
// EVENT DEFINITIONS (built from the road graph)
// ---------------------------------------------------------------------
let EVENTS = []; const STUNTS = { traps: [], zones: [], drift: [], danger: [], trails: [] }; const RAMPS = []; let BARNS = [];
function gridNode(i, j) { const x = -500 + i * 200, z = 1900 + j * 200; for (const k in world.nodes) { const n = world.nodes[k]; if (n.x === x && n.z === z) return k; } return null; }
function gridWalk(corners) { const out = []; for (let c = 0; c < corners.length; c++) { const [i, j] = corners[c]; if (c === 0) { out.push(gridNode(i, j)); continue; } let [pi, pj] = corners[c - 1]; while (pi !== i || pj !== j) { pi += Math.sign(i - pi); if (pi === i) pj += Math.sign(j - pj); out.push(gridNode(pi, pj)); } } return out; }
function edgeBetween(a, b, pref) {
  const n = world.nodes[a]; if (!n) return null; const cands = n.edges.filter((e) => (e.a === a && e.b === b) || (e.b === a && e.a === b)); if (!cands.length) return null;
  if (pref) { const p = cands.find((e) => (typeof pref === 'function' ? pref(e) : e.name === pref || e.type === pref)); if (p) return p; }
  return cands.find((e) => e.type !== 'dirt' && e.type !== 'gravel') || cands[0];
}
function pathLine(nodes, pref) {
  const pts = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = nodes[k], b = nodes[k + 1]; const e = edgeBetween(a, b, Array.isArray(pref) ? pref[k] : pref);
    if (!e) { console.warn('no edge', a, b); continue; } const fwd = e.a === a;
    for (let i = 0; i < e.n; i++) { const j = fwd ? i : e.n - 1 - i; if (pts.length && i === 0) continue; pts.push([e.xs[j], e.hs[j], e.zs[j], e.hw]); }
  }
  return pts;
}
function makeLine(pts, closed = false, mu = 1.15) {
  if (closed) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 1) pts.pop(); }
  const cum = new Float32Array(pts.length); for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  const len = cum[pts.length - 1] + (closed ? Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][2] - pts[pts.length - 1][2]) : 0);
  const speed = lineSpeeds(closed ? pts.concat(pts.slice(0, 40)) : pts, mu).slice(0, pts.length);
  return { pts, cum, len, speed, closed };
}
function xcLine(wps) { const raw = wps.map(([x, z]) => [x, world.height(x, z), z, 10]); const d = densify(raw, 5); d.forEach((p) => { p[3] = 10; p[1] = Math.max(p[1], world.waterLevel + 0.3); }); return d; }
const RACE_DEFS = [
  { id: 'ring', name: 'Festival Ring Circuit', type: 'road', path: ['HUB_E', 'HUB_W', 'HUB_E'], pref: 'track', closed: true, laps: 3, desc: 'Three laps of the festival ring under the main stage lights.' },
  { id: 'canyonx', name: 'Canyon Expressway Sprint', type: 'road', path: ['HUB_E', 'CAN_W', 'CAN_MID', 'CAN_E'], pref: 'main', desc: 'Flat-out highway into the red-rock canyon.' },
  { id: 'cumbre', name: 'Cumbre Switchbacks Hillclimb', type: 'road', path: ['ALP_S', 'PASS'], pref: 'Cumbre Switchbacks', desc: 'Seven alpine hairpins up to the pass.' },
  { id: 'obs', name: 'Observatory Hillclimb', type: 'road', path: ['PASS', 'OBS_B', 'OBS_T'], fixedTod: 20.5, desc: 'Ridgeback Road and the summit climb at dusk.' },
  { id: 'costa', name: 'Costa Highway Sprint', type: 'road', path: ['JUNG', 'COAST_N', 'COAST_M', 'COAST_S', 'PORT'], pref: 'highway', desc: 'Ocean views from the jungle to the port.' },
  { id: 'grand', name: 'Horizon Grand Circuit', type: 'road', path: ['HUB_E', 'CAN_W', 'CAN_MID', 'CAN_E', 'SALT_E', 'SALT_N', 'STAD_S', 'STAD_N', 'HUB', 'HUB_E'], pref: (e) => e.type !== 'dirt' && e.type !== 'gravel' && e.type !== 'track', closed: true, laps: 1, desc: 'An epic lap through canyon, salt flats and stadium.' },
  { id: 'salthw', name: 'Salt Highway Sprint', type: 'road', path: ['STAD_S', 'SALT_N', 'DRAG_W'], desc: 'Wide open highway onto the salt.' },
  { id: 'mesa', name: 'Mesa Mountain Descent', type: 'road', path: ['OBS_B', 'CAN_E', 'CAN_MID'], pref: 'main', desc: 'Downhill from the observatory into the canyon.' },
  { id: 'valle', name: 'Valle Coastal Run', type: 'road', path: ['HUB', 'HUB_W', 'FARM_A', 'COAST_M', 'COAST_N', 'JUNG'], pref: (e) => e.type !== 'dirt' && e.type !== 'track', desc: 'Farmland sweepers to the coast.' },
  { id: 'citygp', name: 'Downtown Night Circuit', type: 'street', grid: [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], closed: true, laps: 2, fixedTod: 23, desc: 'Neon-lit street circuit in the city grid.' },
  { id: 'portrun', name: 'Port Link Street Sprint', type: 'street', gridThen: [[[8, 4], [0, 4]], ['PORT']], fixedTod: 22, desc: 'Across downtown and down to the docks.' },
  { id: 'uptown', name: 'Uptown Street Sprint', type: 'street', grid: [[4, 8], [4, 4], [8, 4], [8, 0], [4, 0]], fixedTod: 0.5, desc: 'Midnight run through uptown blocks.' },
  { id: 'selva', name: 'Selva Rally Stage', type: 'dirt', path: ['JUNG', 'COAST_N'], pref: 'Selva Rally Stage', desc: 'Tight jungle gravel stage.' },
  { id: 'canyonfloor', name: 'Canyon Floor Scramble', type: 'dirt', path: ['CAN_W', 'CAN_E'], pref: 'Canyon Floor Trail', desc: 'Dust and crests along the canyon floor.' },
  { id: 'fireroad', name: 'Fire Road Climb', type: 'dirt', path: ['ALP_S', 'PASS'], pref: 'Fire Road', desc: 'Loose gravel through the pine forest.' },
  { id: 'valledirt', name: 'Valle Dirt Run', type: 'dirt', path: ['FARM_A', 'COAST_S'], pref: 'Valle Dirt Run', desc: 'Farm tracks to the coastline.' },
  { id: 'farmloop', name: 'Farm Trail Circuit', type: 'dirt', path: ['HUB_W', 'FARM_A', 'FARM_N', 'ALP_S', 'HUB', 'HUB_W'], pref: [null, 'dirt', 'dirt', 'main', 'main'], closed: true, laps: 2, desc: 'Mixed-surface loop around the farms.' },
  { id: 'selvaloop', name: 'Selva Loop Scramble', type: 'dirt', path: ['JUNG', 'J2', 'JUNG'], pref: ['Selva Loop', 'Selva Road'], closed: true, laps: 2, desc: 'Gravel out, tarmac back, twice.' },
  { id: 'ranch', name: 'Ranch Road Dash', type: 'dirt', path: ['HUB', 'CITY_NW'], pref: 'Ranch Road', desc: 'From the festival to the city outskirts.' },
  { id: 'xc_mesa', name: 'Red Rock Cross Country', type: 'cross', xc: [[1750, 200], [2050, 500], [2350, 420], [2650, 600], [2950, 380], [3150, 200]], desc: 'No roads. Pick your own line through the canyon.' },
  { id: 'xc_farm', name: 'Farmland Cross Country', type: 'cross', xc: [[-400, 150], [-800, 450], [-1300, 600], [-1600, 200], [-1450, -350], [-1000, -600], [-600, -300]], desc: 'Through crops, fences and hay bales.' },
  { id: 'xc_jungle', name: 'Jungle Cross Country', type: 'cross', xc: [[-1600, -2600], [-1900, -2300], [-2200, -2100], [-2450, -1850], [-2700, -1500]], desc: 'Dense jungle between the rally stages.' },
  { id: 'xc_salt', name: 'Salt Flats Cross Country', type: 'cross', xc: [[2700, 2400], [3000, 2200], [3300, 2500], [3100, 2800], [2700, 2750], [2500, 2550]], closed: true, laps: 2, desc: 'Flat-out across the white salt.' },
  { id: 'stadium', name: 'Stadium Oval', type: 'stadium', path: ['STAD_N', 'STAD_S', 'STAD_N'], pref: 'track', closed: true, laps: 4, desc: 'Banked oval in front of the grandstands.' },
  { id: 'stadium_night', name: 'Stadium Night Sprint', type: 'stadium', path: ['STAD_N', 'STAD_S', 'STAD_N'], pref: 'track', closed: true, laps: 6, fixedTod: 22, desc: 'Floodlit oval, six laps.' },
  { id: 'drag400', name: 'Quarter Mile Drag', type: 'drag', drag: 402, desc: '402 m on the salt flats drag strip.' },
  { id: 'drag800', name: 'Half Mile Drag', type: 'drag', drag: 805, desc: '805 m. Top speed matters.' },
  { id: 'show_train', name: 'Showcase: Horizon Express', type: 'showcase', path: ['HUB', 'HUB_W', 'FARM_A', 'COAST_M'], showcase: 'train', desc: 'Beat the freight train across the valley.' },
  { id: 'show_plane', name: 'Showcase: Coastal Jet', type: 'showcase', path: ['COAST_N', 'COAST_M', 'COAST_S', 'PORT'], pref: 'highway', showcase: 'plane', desc: 'Race a jet down the Costa Highway.' },
  { id: 'arcade_smash', name: 'Horizon Arcade: Piñata Pop', type: 'arcade', arcade: 'smash', target: 25, time: 120, center: [0, -560], desc: 'Smash 25 piñatas around the festival in 2 minutes.' },
  { id: 'arcade_drift', name: 'Horizon Arcade: Ring Drift Party', type: 'arcade', arcade: 'drift', target: 60000, time: 90, center: [0, 220], desc: 'Score 60,000 drift points in 90 seconds.' },
  { id: 'arcade_near', name: 'Horizon Arcade: Freeway Near Miss', type: 'arcade', arcade: 'near', target: 15, time: 120, center: [120, 700], desc: 'Score 15 near misses on the Sol Freeway.' },
  { id: 'driftclub', name: 'Cumbre Drift Club', type: 'drift', path: ['ALP_S', 'PASS'], pref: 'Cumbre Switchbacks', target: 40000, desc: 'Score attack: drift the switchbacks.' },
];
const BARN_SPOTS = [[-1680, 760], [-2280, -2860], [2980, 950], [-850, -2300], [3300, 2750], [-2800, 1700], [1650, -2300], [-1900, -1100], [1400, 1500], [-300, 3250], [2250, -1300], [-2700, 400], [3100, -800]];
function buildEvents() {
  EVENTS = [];
  for (const d of RACE_DEFS) {
    try {
      let pts = null; const mu = d.type === 'dirt' || d.type === 'cross' ? 0.82 : 1.15;
      if (d.path) pts = pathLine(d.path, d.pref);
      else if (d.grid) pts = pathLine(gridWalk(d.grid), 'city');
      else if (d.gridThen) { const nodes = gridWalk(d.gridThen[0]).concat(d.gridThen[1]); pts = pathLine(nodes, (e) => e.type === 'city' || e.type === 'highway'); }
      else if (d.xc) { pts = xcLine(d.closed ? d.xc.concat([d.xc[0]]) : d.xc); }
      else if (d.drag) { const e = world.findEdge('Salt Flats Drag Strip'); pts = []; for (let i = 0; i < e.n; i++) pts.push([e.xs[i], e.hs[i], e.zs[i], e.hw]); }
      else if (d.type === 'arcade') { pts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, x = d.center[0] + Math.sin(a) * 140, z = d.center[1] + Math.cos(a) * 140; pts.push([x, world.height(x, z), z, 8]); } }
      if (!pts || pts.length < 8) { console.warn('event skipped', d.id); continue; }
      const line = makeLine(pts, !!d.closed, mu);
      const ev = { ...d, line, laps: d.closed ? (d.laps || 1) : 1, region: world.regionName(pts[0][0], pts[0][2]), start: { x: pts[0][0], z: pts[0][2] } };
      if (d.drag) ev.dragLen = d.drag;
      const total = line.len * ev.laps; ev.km = total / 1000;
      ev.reward = Math.round((8000 + total * 3.2) / 500) * 500; ev.xp = Math.round(600 + total * 0.25);
      if (d.type === 'arcade') { ev.start = { x: d.center[0], z: d.center[1] }; ev.reward = 15000; ev.xp = 1500; }
      if (d.type === 'drag') { ev.reward = 10000; ev.xp = 800; }
      if (d.type === 'showcase') { ev.reward = 40000; ev.xp = 3000; }
      EVENTS.push(ev);
    } catch (e) { console.warn('event build failed', d.id, e); }
  }
  // ---- PR stunts ----
  const at = (name, f, nth = 0) => { const e = world.findEdge(name, nth); if (!e) return null; const s = e.len * f; const o = edgeSample(e, s, {}); return { e, s, x: o.x, y: o.y, z: o.z, yaw: Math.atan2(o.dx, o.dz), lx: o.lx, lz: o.lz }; };
  [['Canyon Expressway', 0.62, 0, 260], ['Costa Highway', 0.5, 0, 250], ['Salt Highway', 0.55, 0, 280], ['Sol Freeway', 0.55, 0, 250], ['Port Link', 0.45, 0, 240], ['Red Rock Run', 0.5, 0, 200], ['Ridgeback Road', 0.55, 0, 210], ['Stadium Way', 0.5, 0, 170], ['Valle Road W', 0.5, 0, 210], ['Costa Highway S', 0.4, 0, 245]].forEach(([n, f, k, tgt], i) => { const a = at(n, f, k); if (a) STUNTS.traps.push({ id: 'trap' + i, name: n.split(' ')[0] + ' Speed Trap', ...a, target: tgt, cd: 0 }); });
  [['Costa Highway S', 0.15, 0.75, 230], ['Canyon South', 0.1, 0.9, 190], ['Valle Road W', 0.1, 0.8, 200], ['Mesa Mountain Road', 0.2, 0.6, 150], ['Salt Highway', 0.1, 0.9, 260], ['Cumbre Descent', 0.1, 0.9, 165]].forEach(([n, f0, f1, tgt], i) => { const a = at(n, f0), b = at(n, f1); if (a && b) STUNTS.zones.push({ id: 'zone' + i, name: n + ' Speed Zone', a, b, e: a.e, s0: a.s, s1: b.s, target: tgt }); });
  [['Cumbre Switchbacks', 0.05, 0.95, 30000], ['Observatory Climb', 0.05, 0.95, 22000], ['Selva Loop', 0.1, 0.5, 18000], ['Festival Ring', 0.05, 0.95, 15000], ['Fire Road', 0.2, 0.7, 20000], ['Mesa Shortcut', 0.1, 0.8, 18000]].forEach(([n, f0, f1, tgt], i) => { const a = at(n, f0), b = at(n, f1); if (a && b) STUNTS.drift.push({ id: 'drift' + i, name: n + ' Drift Zone', a, b, e: a.e, s0: a.s, s1: b.s, target: tgt }); });
  [['Canyon Floor Trail', 0.45, 90], ['Ranch Road', 0.4, 80], ['Farm Trail', 0.5, 70], ['Valle Dirt Run', 0.3, 85], ['Cliff Run', 0.5, 95], ['Selva Rally Stage', 0.6, 70], ['Strip Access', 0.5, 110]].forEach(([n, f, tgt], i) => { const a = at(n, f); if (a) { const r = { id: 'danger' + i, name: n + ' Danger Sign', ...a, target: tgt, len: 14, rise: 2.4, hw: 3.4 }; STUNTS.danger.push(r); RAMPS.push(r); } });
  [['Mesa Trailblazer', [2400, 200], [2200, -2600], 95], ['Valley Trailblazer', [-1200, -900], [-3050, 1400], 85], ['Salt Trailblazer', [2600, 2300], [3450, 2950], 30], ['Jungle Trailblazer', [-1500, -2700], [-3100, -1000], 70], ['Festival Trailblazer', [0, -300], [300, 1900], 55]].forEach(([n, a, b, t], i) => STUNTS.trails.push({ id: 'trail' + i, name: n, x: a[0], z: a[1], bx: b[0], bz: b[1], target: t }));
  patchGroundForRamps(); buildStuntMeshes();
}
function patchGroundForRamps() {
  const g0 = world.ground.bind(world); const h0 = world.height.bind(world);
  const rampAt = (x, z) => { for (const r of RAMPS) { const dx = x - r.x, dz = z - r.z; if (dx * dx + dz * dz > 400) continue; const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw); const al = dx * fx + dz * fz, lat = dx * fz - dz * fx; if (al < -r.len / 2 || al > r.len / 2 || Math.abs(lat) > r.hw) continue; const t = (al + r.len / 2) / r.len; return [r, r.y + r.rise * t * t * (3 - 2 * t) * 0.35 + r.rise * t * 0.65, fx, fz, t]; } return null; };
  world.ground = (x, z, out, y) => {
    const res = g0(x, z, out, y); if (!RAMPS.length) return res; const ra = rampAt(x, z);
    if (ra) { const [r, hr, fx, fz, t] = ra; if (hr > out.h) { const sl = r.rise / r.len * (1 + t * 0.5); const inv = 1 / Math.sqrt(1 + sl * sl); out.h = hr; out.nx = -fx * sl * inv; out.nz = -fz * sl * inv; out.ny = inv; out.surf = SURF.concrete; out.water = 0; } }
    return out;
  };
  world.rampAt = rampAt;
}
function buildStuntMeshes() {
  const grp = new THREE.Group(); scene.add(grp); world.stuntGroup = grp;
  const sign = (x, y, z, yaw, col, txt) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(6, 6, 244, 116); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText(txt, 128, 78); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide })); m.position.set(x, y + 5, z); m.rotation.y = yaw; grp.add(m); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5), new THREE.MeshStandardMaterial({ color: 0x888888 })); p.position.set(x, y + 2.5, z); grp.add(p); return m; };
  for (const t of STUNTS.traps) { const o = 13; sign(t.x + t.lx * o, t.y, t.z + t.lz * o, t.yaw, '#e01870', 'SPEED TRAP'); }
  for (const t of STUNTS.zones) { sign(t.a.x + t.a.lx * 12, t.a.y, t.a.z + t.a.lz * 12, t.a.yaw, '#ff7a00', 'SPEED ZONE'); }
  for (const t of STUNTS.drift) { sign(t.a.x + t.a.lx * 11, t.a.y, t.a.z + t.a.lz * 11, t.a.yaw, '#8a2be2', 'DRIFT ZONE'); }
  for (const t of STUNTS.trails) { sign(t.x + 8, world.height(t.x + 8, t.z), t.z, 0, '#1e90ff', 'TRAILBLAZER'); }
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xd8b020, roughness: 0.6 });
  for (const r of RAMPS) {
    const g = new THREE.BufferGeometry(); const L = r.len, W = r.hw * 2, Hh = r.rise; const v = [-W / 2, 0, -L / 2, W / 2, 0, -L / 2, W / 2, 0, L / 2, -W / 2, 0, L / 2, -W / 2, Hh, L / 2, W / 2, Hh, L / 2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 4, 3, 0, 1, 5, 0, 5, 4, 1, 2, 5, 3, 4, 5, 3, 5, 2, 0, 3, 2, 0, 2, 1]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, rampMat); m.position.set(r.x, r.y - 0.02, r.z); m.rotation.y = r.yaw; m.castShadow = true; m.receiveShadow = true; grp.add(m);
    sign(r.x + r.lx * 9 - Math.sin(r.yaw) * 30, r.y, r.z + r.lz * 9 - Math.cos(r.yaw) * 30, r.yaw, '#f2c200', '⚠ DANGER');
  }
  // event start beacons (tall coloured light pillars)
  world.eventBeacons = [];
  for (const ev of EVENTS) { const col = new THREE.Color(EVENT_TYPES[ev.type]?.color || '#ff2e88'); const m = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); const y = world.height(ev.start.x, ev.start.z); m.position.set(ev.start.x, y + 30, ev.start.z); grp.add(m); const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6.2, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(ev.start.x, y + 0.25, ev.start.z); grp.add(ring); world.eventBeacons.push({ ev, m, ring }); }
}
function buildBarns() {
  BARNS = BARN_CAR_IDS.map((id, i) => { const [x, z] = BARN_SPOTS[i % BARN_SPOTS.length]; return { i, id, x, z, y: world.height(x, z) }; });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a22, roughness: 0.95 }); const roof = new THREE.MeshStandardMaterial({ color: 0x444036, roughness: 0.8, metalness: 0.2 });
  for (const b of BARNS) {
    const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 12), wood); body.position.y = 3; g.add(body); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.2, 3.5, 4, 1), roof); r.rotation.y = Math.PI / 4; r.scale.set(1, 1, 1.2); r.position.y = 7.6; g.add(r);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.5), new THREE.MeshStandardMaterial({ color: 0x2a1508 })); door.position.set(0, 2.25, 6.01); g.add(door); g.position.set(b.x, b.y, b.z); g.rotation.y = (b.i * 1.7) % 6.28; world.stuntGroup.add(g); b.mesh = g;
    world.addCollider({ k: 1, x: b.x, z: b.z, hx: 5, hz: 6, c: Math.cos(-g.rotation.y), s: Math.sin(-g.rotation.y), y0: b.y - 1, y1: b.y + 8 });
  }
}

// ---------------------------------------------------------------------
// RACE AI (drivatars)
// ---------------------------------------------------------------------
class AIDriver {
  constructor(skill, seed) { this.skill = skill; this.rnd = mulberry32(seed); this.lane = (this.rnd() - 0.5) * 0.7; this.idx = 0; this.stuckT = 0; this.laneT = 0; this.aggr = 0.85 + this.rnd() * 0.3; this.mistakeT = 5 + this.rnd() * 20; this.mistake = 0; }
  control(r, h) {
    const v = r.veh; const ev = activeEvent; const inp = v.input; if (!ev || !ev.line) return;
    if (ev.countdown > 0) { inp.throttle = ev.countdown < 1 ? 0.6 : 0; inp.brake = 0; inp.handbrake = 1; inp.steer = 0; return; }
    if (r.finished) { inp.throttle = 0; inp.brake = 0.4; inp.handbrake = 0; inp.steer *= 0.9; return; }
    const L = ev.line; const n = L.pts.length; const spd = v.speed;
    const [i] = nearestIdx(L.pts, v.pos.x, v.pos.z, this.idx, 20); this.idx = i;
    const step = (k) => (L.closed ? (k % n + n) % n : Math.min(n - 1, k));
    const look = Math.round((5 + spd * 0.42) / 5); const T = L.pts[step(i + look)]; const T2 = L.pts[step(i + look + 1)];
    let dx = T2[0] - T[0], dz = T2[2] - T[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // lane offset & overtaking
    this.laneT -= h; if (this.laneT <= 0) { this.laneT = 1 + this.rnd() * 2; let blocked = false; for (const o of racers) { if (o.veh === v) continue; const ox = o.veh.pos.x - v.pos.x, oz = o.veh.pos.z - v.pos.z; const f = v.forward(); const along = ox * f.x + oz * f.z; if (along > 0 && along < 14 && Math.abs(ox * f.z - oz * f.x) < 2.5) blocked = true; } const px = player.pos.x - v.pos.x, pz = player.pos.z - v.pos.z; const f = v.forward(); if (px * f.x + pz * f.z > 0 && px * f.x + pz * f.z < 14 && Math.abs(px * f.z - pz * f.x) < 2.5) blocked = true; if (blocked) this.lane = this.lane > 0 ? -0.55 : 0.55; else if (this.rnd() < 0.2) this.lane = (this.rnd() - 0.5) * 0.6; }
    const hw = (T[3] || 6) * (ev.type === 'cross' ? 0.4 : 1); const tx = T[0] + (-dz) * this.lane * hw, tz = T[2] + dx * this.lane * hw;
    // steering in car-local frame (+x = left)
    const inv = tmpQ.copy(v.quat).invert(); const loc = tmpV3.set(tx - v.pos.x, 0, tz - v.pos.z).applyQuaternion(inv);
    const ang = Math.atan2(loc.x, Math.max(0.5, loc.z)); inp.steer = clamp(-ang * 2.1, -1, 1); if (loc.z < 0) inp.steer = loc.x > 0 ? -1 : 1;
    // speed target from curvature, braking look-ahead
    let tgt = 1e9; const bl = Math.round(clamp(spd * spd / (2 * 7) / 5, 2, 50)); for (let k = 0; k <= bl; k += 2) tgt = Math.min(tgt, L.speed[step(i + k)] + k * 5 * 0.12);
    let grip = this.skill * (v.p.gripEst || 1); this.mistakeT -= h; if (this.mistakeT <= 0) { this.mistake = 1.2; this.mistakeT = 15 + this.rnd() * 30 / Math.max(0.3, this.skill); } if (this.mistake > 0) { this.mistake -= h; grip *= 1.12; }
    // rubber band (scaled by difficulty: harder = less help)
    const myProg = r.prog || 0, pp = ev.player?.prog || 0; const gap = pp - myProg; const rb = clamp(gap / 400, -1, 1) * (S.difficulty <= 2 ? 0.08 : 0.04);
    tgt *= grip * (1 + rb) * this.aggr;
    const err = tgt - spd; inp.throttle = clamp(err / 4 + 0.15, 0, 1); inp.brake = clamp(-err / 5, 0, 1); if (inp.brake > 0.1) inp.throttle = 0; inp.handbrake = 0;
    if (ev.type === 'drag') { inp.steer = clamp(-loc.x * 0.12, -0.2, 0.2); inp.throttle = 1; inp.brake = 0; }
    // stuck recovery
    if (spd < 2 && ev.t > 4) this.stuckT += h; else this.stuckT = Math.max(0, this.stuckT - h * 2);
    if (this.stuckT > 3 || v.upsideTime > 2) { const P0 = L.pts[step(i + 2)], P1 = L.pts[step(i + 4)]; v.place(P0[0], P0[1] + v.cgh + v.p.tireR + 0.6, P0[2], Math.atan2(P1[0] - P0[0], P1[2] - P0[2])); this.stuckT = 0; }
  }
}
function aiSkill() { return [0.78, 0.84, 0.89, 0.93, 0.97, 1.0, 1.03][clamp(S.difficulty | 0, 0, 6)]; }
const SUIT = { dirt: ['RALLY', 'RAID', 'OFFROAD', 'TRUCK', 'HATCH'], cross: ['RAID', 'OFFROAD', 'TRUCK', 'RALLY'], drift: ['DRIFT', 'SPORT', 'MUSCLE', 'RETRO'] };
function pickAICars(count, pi, type, rnd) {
  const suit = SUIT[type]; let pool = CARS.filter((c) => !c.barn && c.cat !== 'BIKE' && Math.abs(c.pi - pi) < 70 && (!suit || suit.includes(c.cat)));
  if (pool.length < count) pool = CARS.filter((c) => !c.barn && c.cat !== 'BIKE' && Math.abs(c.pi - pi) < 130);
  if (pool.length < count) pool = CARS.filter((c) => !c.barn);
  const out = []; for (let k = 0; k < count; k++) out.push(pool[Math.floor(rnd() * pool.length)]); return out;
}
function makeAIRacer(spec, k, rnd) {
  const up = {}; const targetPi = player.p.pi; // upgrade AI cars towards player's PI
  const p = applyBuild(spec, up, defaultTune(spec)); const hpScale = clamp(1 + (targetPi - p.pi) / 900, 0.85, 1.25); p.hp *= hpScale; p.nm *= hpScale; if (p.clutchCap) p.clutchCap *= hpScale; p.gripEst = 1;
  const veh = new Vehicle(p, { id: 100 + k, assists: { abs: 1, tcs: 0.7, stm: 0.8, steer: 0.7, shifting: 'auto', damage: 'cosmetic', wear: 0 } });
  const livery = { paint: ['gloss', 'metallic', 'pearl', 'matte'][k % 4], color: new THREE.Color().setHSL(rnd(), 0.75, 0.45).getHex(), decal: DECALS[1 + Math.floor(rnd() * (DECALS.length - 1))], decalColor: 0xffffff, color2: 0x111111, number: 2 + k * 7, wheel: k % 8, rim: 0x999999, tint: 0.5, caliper: 0xff3300 };
  const model = buildCarModel(spec, livery, { lod: 1 }); scene.add(model.group);
  const name = DRIVATARS[Math.floor(rnd() * DRIVATARS.length)];
  return { veh, model, ai: new AIDriver(aiSkill() * (0.96 + rnd() * 0.06), Math.floor(rnd() * 1e6)), name, spec, cpN: 0, prog: 0, finished: false, time: 0, idx: 0 };
}
function clearRacers() { for (const r of racers) { scene.remove(r.model.group); r.model.dispose(); if (r.voice) r.voice.stop(); } racers.length = 0; }

// ---------------------------------------------------------------------
// EVENT RUNTIME
// ---------------------------------------------------------------------
let activeEvent = null; const cpGroup = { meshes: [] };
function buildCheckpoints(ev) {
  const L = ev.line; const n = L.pts.length; const cps = []; const gap = ev.type === 'cross' ? 220 : 280;
  let next = gap; for (let i = 1; i < n; i++) { if (L.cum[i] >= next && L.len - L.cum[i] > gap * 0.4) { cps.push(i); next += gap; } }
  if (L.closed) cps.push(0); else cps.push(ev.finishIdx ?? n - 1);
  return cps;
}
function archMesh(color) {
  const g = new THREE.Group(); const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const post = new THREE.CylinderGeometry(0.25, 0.25, 7, 8); const a = new THREE.Mesh(post, m), b = new THREE.Mesh(post, m); a.position.y = b.position.y = 3.5; g.add(a, b); const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.3), m); top.position.y = 7; g.add(top); g.userData = { a, b, top }; return g;
}
function placeArch(g, L, idx, wide) { const n = L.pts.length; const p = L.pts[idx]; const q = L.pts[Math.min(n - 1, idx + 1)] || p; const pr = L.pts[Math.max(0, idx - 1)]; const dx = q[0] - pr[0], dz = q[2] - pr[2]; const yaw = Math.atan2(dx, dz); const hw = (wide || p[3] || 6) + 1.5; g.position.set(p[0], p[1], p[2]); g.rotation.y = yaw; g.userData.a.position.x = hw; g.userData.b.position.x = -hw; g.userData.top.scale.x = hw * 2 + 0.5; g.visible = true; }
function startEvent(def, opts = {}) {
  if (!def) return; if (activeEvent) endEvent();
  UI.closeAll(); clearWaypoint(); rewind.clear(); skill.reset(true);
  P.freePos = [player.pos.x, player.pos.y, player.pos.z, player.yaw()]; P.freeTod = world.tod;
  const seed = opts.seed ?? ((Date.now() / 1000) | 0); const rnd = mulberry32(seed);
  const ev = activeEvent = { def, id: def.id, type: def.type, name: def.name, line: def.line, t: 0, countdown: 4, laps: def.laps, online: !!opts.online, ghostRace: !!opts.ghostRace, seed, results: null, cleanRacing: true, done: false, score: 0, smashed: 0, near: 0, snapshot: null, restore: null, lineIdx: 0, prevWeather: world.weather.state };
  if (def.fixedTod != null) { world.tod = def.fixedTod; ev.fixedTod = def.fixedTod; }
  if (opts.weather) world.weather.set(opts.weather, true);
  const L = def.line; const n = L.pts.length;
  // start index & grid
  let s0 = 0; if (!L.closed) { s0 = 0; while (s0 < n - 1 && L.cum[s0] < (def.type === 'drag' ? 30 : 70)) s0++; }
  ev.s0 = s0; if (def.type === 'drag') { let f = s0; while (f < n - 1 && L.cum[f] - L.cum[s0] < def.dragLen) f++; ev.finishIdx = f; }
  ev.cps = buildCheckpoints(ev); if (def.type === 'drag') ev.cps = [ev.finishIdx];
  const isRace = ['road', 'dirt', 'cross', 'street', 'stadium', 'drag'].includes(def.type);
  let aiN = isRace ? (def.type === 'drag' ? 1 : clamp(S.aiCount | 0, 0, 11)) : 0; if (opts.online) aiN = opts.aiCount ?? 0; if (opts.ghostRace) aiN = 0; if (def.type === 'cross') aiN = Math.min(aiN, 7);
  const gridPos = (slot) => { const row = Math.floor(slot / 2), col = slot % 2; const back = 8 + row * 10; let k = s0; let d = 0; const step = (j) => (L.closed ? (j - 1 + n) % n : Math.max(0, j - 1)); while (d < back) { const j = step(k); d += Math.hypot(L.pts[k][0] - L.pts[j][0], L.pts[k][2] - L.pts[j][2]); k = j; if (!L.closed && k === 0) break; } const p = L.pts[k]; const q = L.pts[(k + 2) % n]; const yaw = Math.atan2(q[0] - p[0], q[2] - p[2]); const hw = def.type === 'drag' ? 6 : Math.min(p[3] || 6, 7) * 0.45; const lat = col ? -hw : hw; const lx = Math.cos(yaw), lz = -Math.sin(yaw); return { x: p[0] + lx * lat, z: p[2] + lz * lat, y: p[1], yaw }; };
  const pSlot = opts.slot ?? Math.min(aiN, def.type === 'drag' ? 0 : 3);
  const gp = gridPos(pSlot); for (let k = 0; k < 6; k++) world.stream(gp.x, gp.z, 60);
  player.place(gp.x, gp.y + player.cgh + player.p.tireR + 0.4, gp.z, gp.yaw); player.repair && player.repair(); playerModel.resetDeform && playerModel.resetDeform();
  for (const w of player.wheels) { w.temp = 60; }
  ev.player = { isPlayer: true, veh: player, name: P.character.name, cpN: 0, prog: 0, finished: false, time: 0, idx: s0, lapStart: 0, laps: [], sectors: [] };
  clearRacers(); const specs = pickAICars(aiN, player.p.pi, def.type, rnd);
  let slot = 0; specs.forEach((sp, k) => { if (slot === pSlot) slot++; const r = makeAIRacer(sp, k, rnd); const g = gridPos(slot++); r.veh.place(g.x, g.y + r.veh.cgh + r.veh.p.tireR + 0.4, g.z, g.yaw); r.idx = s0; r.ai.idx = s0; racers.push(r); });
  ev.entrants = [ev.player, ...racers];
  // checkpoint arches
  cpGroup.meshes.forEach((m) => scene.remove(m)); cpGroup.meshes = [archMesh(0xff2e88), archMesh(0xffb000)]; cpGroup.meshes.forEach((m) => scene.add(m));
  // showcase opponents
  if (def.showcase === 'train') { ev.oppSpeed = clamp(player.p.vTop * 0.5, 30, 52); world.trainSpeed = ev.oppSpeed; }
  if (def.showcase === 'plane') { ev.oppSpeed = clamp(player.p.vTop * 0.58, 35, 70); world.plane.visible = true; }
  if (def.type === 'arcade') setupArcade(ev);
  ev.snapshot = () => ({ t: ev.t, cp: ev.entrants.map((e) => [e.cpN, e.idx, e.finished, e.lapStart]), score: ev.score, smashed: ev.smashed, near: ev.near });
  ev.restore = (s) => { ev.t = s.t; s.cp.forEach((c, i) => { const e = ev.entrants[i]; if (e) { [e.cpN, e.idx, e.finished, e.lapStart] = c; } }); ev.score = s.score; ev.near = s.near; };
  ev.gpsTarget = () => { const e = ev.player; const cpi = ev.cps[e.cpN % ev.cps.length]; const p = L.pts[cpi]; return p ? { x: p[0], z: p[2] } : null; };
  // skill hooks
  ev.onSkill = (kind, pts) => { if (def.type === 'drift' || (def.arcade === 'drift' && kind === 'drift')) ev.score += pts; if (kind === 'near') ev.near++; };
  ev.onSmash = (c) => { if (c.pinata) { ev.smashed++; c.meshRef && (c.meshRef.visible = false); for (let k = 0; k < 25; k++) world.glow.emit(c.x, c.y + 1, c.z, (Math.random() - 0.5) * 10, Math.random() * 8, (Math.random() - 0.5) * 10, 0.3, Math.random(), Math.random(), Math.random(), 1, 1.4, 0, 6); toast(`Piñata ${ev.smashed}/${def.target}`, 'skill', 900); } };
  mode = 'event'; camRig.init = false; hudShow(true); fade(0.6); promptTarget = null; $('#prompt').classList.remove('on');
  banner(def.name, EVENT_TYPES[def.type]?.name + (ev.laps > 1 ? ` · ${ev.laps} laps` : '') + ` · ${def.line ? (def.line.len * ev.laps / 1000).toFixed(1) + ' km' : ''}`, 2800);
  P.stats.races++; net.onEventStart(ev);
  return ev;
}
function setupArcade(ev) {
  const d = ev.def; ev.timeLeft = d.time; ev.pinatas = [];
  if (d.arcade === 'smash') {
    const rnd = mulberry32(ev.seed); const mats = [0xff2e88, 0x22d3ee, 0xffd400, 0x7cfc00, 0xff7a00].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.25 }));
    const geo = new THREE.OctahedronGeometry(0.9, 0);
    for (let k = 0; k < d.target + 5; k++) { const a = rnd() * Math.PI * 2, r = 60 + rnd() * 320; const o = placeOnRoad(d.center[0] + Math.cos(a) * r, d.center[1] + Math.sin(a) * r); const q = world.roadQuery(o.x, o.z, {}); const lat = (rnd() - 0.5) * (q ? q.hw : 4); const x = o.x + Math.cos(o.yaw) * lat, z = o.z - Math.sin(o.yaw) * lat; const y = world.height(x, z); const fy = o.y; const m = new THREE.Mesh(geo, mats[k % mats.length]); m.position.set(x, fy + 1.2, z); m.castShadow = true; scene.add(m); const c = { k: 0, x, z, y: fy, r: 0.9, y0: fy - 1, y1: fy + 3, breakable: true, mass: 5, kind: 'Piñata', pinata: true, meshRef: m }; world.addCollider(c); ev.pinatas.push(c); }
  }
}
function endEvent() {
  const ev = activeEvent; if (!ev) return;
  if (ev.pinatas) for (const c of ev.pinatas) { world.removeCollider(c); scene.remove(c.meshRef); }
  cpGroup.meshes.forEach((m) => scene.remove(m)); cpGroup.meshes = []; clearRacers(); world.plane.visible = false; world.trainSpeed = 32;
  activeEvent = null; lineRibbon && lineRibbon.hide(); rewind.clear();
}
function exitEventToFreeRoam(atStart = true) {
  const ev = activeEvent; const def = ev?.def; endEvent(); mode = 'free'; UI.closeAll();
  if (def && atStart) { const o = placeOnRoad(def.start.x + 25, def.start.z + 25); player.place(o.x, o.y + player.cgh + player.p.tireR + 0.4, o.z, o.yaw); }
  else if (P.freePos) { const [x, y, z, yaw] = P.freePos; player.place(x, y + 0.4, z, yaw); }
  if (P.freeTod != null && def && def.fixedTod != null) world.tod = P.freeTod;
  player.vel.set(0, 0, 0); camRig.init = false; fade(0.5); net.onEventEnd();
}
function fade(sec) { const f = $('#fade'); f.style.transition = 'none'; f.style.opacity = 1; requestAnimationFrame(() => { f.style.transition = `opacity ${sec}s`; f.style.opacity = 0; }); }

function entrantProgress(ev, e) {
  const L = ev.line; const n = L.pts.length; const v = e.veh;
  const [i, d] = nearestIdx(L.pts, v.pos.x, v.pos.z, e.idx, ev.type === 'cross' ? 40 : 24); const prevIdx = e.idx; e.idx = i; e.offLine = d;
  // checkpoint passing
  const total = ev.cps.length * ev.laps; if (e.cpN < total) {
    const cpi = ev.cps[e.cpN % ev.cps.length]; const P0 = L.pts[cpi]; const dist = Math.hypot(P0[0] - v.pos.x, P0[2] - v.pos.z); const rad = ev.type === 'cross' ? 28 : Math.max(14, (P0[3] || 6) + 7);
    let passed = dist < rad; const lapWrap = L.closed && prevIdx > n * 0.85 && i < n * 0.15;
    if (!passed && cpi !== 0 && i > cpi && i - cpi < 40 && d < (P0[3] || 6) + 10 && !e.isPlayer) passed = true;
    if (!passed && cpi !== 0 && i > cpi && i - cpi < 12 && d < (P0[3] || 6) + 6) passed = true;
    if (!passed && cpi === 0 && lapWrap && d < (P0[3] || 6) + 10) passed = true;
    if (passed) {
      e.cpN++; if (e.isPlayer && e.cpN < total) { audio.tone && audio.tone(1100, 0.08, 'triangle', 0.06); }
      const cpsPerLap = ev.cps.length; if (e.cpN % cpsPerLap === 0 || e.cpN === total) { const lt = ev.t - (e.lapStart || 0); e.laps.push && e.laps.push(lt); e.lapStart = ev.t; if (e.isPlayer && ev.laps > 1 && e.cpN < total) { const best = Math.min(...e.laps); banner('LAP ' + (Math.floor(e.cpN / cpsPerLap) + 1) + ' / ' + ev.laps, 'Last lap ' + fmtTime(lt) + (lt <= best ? '  ·  BEST' : ''), 1800); } }
      else if (e.isPlayer && cpsPerLap >= 3 && e.cpN % Math.max(1, Math.round(cpsPerLap / 3)) === 0) { const st = ev.t - (e.secStart || 0); e.secStart = ev.t; e.sectors = e.sectors || []; e.sectors.push(st); }
      if (e.cpN >= total && !e.finished) { e.finished = true; e.time = ev.t; onEntrantFinish(ev, e); }
    }
  }
  // distance progress for ordering
  const cpN = Math.min(e.cpN, total); const nextCp = ev.cps[cpN % ev.cps.length]; const NP = L.pts[nextCp] || L.pts[n - 1];
  e.prog = e.finished ? 1e9 - e.time : cpN * 100000 - Math.hypot(NP[0] - v.pos.x, NP[2] - v.pos.z);
  const lapN = Math.floor(cpN / ev.cps.length); e.distDone = lapN * L.len + (L.closed && i < n * 0.1 && cpN % ev.cps.length > ev.cps.length / 2 ? L.len : 0) + L.cum[i] - (L.closed ? 0 : L.cum[ev.s0]);
}
function onEntrantFinish(ev, e) {
  const place = ev.entrants.filter((x) => x.finished).length; e.place = place;
  if (e.isPlayer) { replay.mark('Finish'); banner(place === 1 ? 'YOU WIN' : ordinal(place) + ' PLACE', fmtTime(e.time), 2600, place === 1 ? 'gold' : ''); audio.ui(place === 1 ? 'cash' : 'ok'); setTimeout(() => finishEvent(true), 2200); net.reportFinish(e.time); }
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function eventUpdate(dt) {
  updateGuides(dt); if (mode === 'free') { stuntUpdate(dt); promptUpdate(dt); return; }
  const ev = activeEvent; if (!ev || ev.done) return;
  if (ev.countdown > 0) { const prev = Math.ceil(ev.countdown - 0.5); ev.countdown -= dt; const c = Math.ceil(ev.countdown - 0.5); if (c !== prev && c >= 0 && c <= 3) { if (c > 0) { banner(String(c), '', 700, 'count'); audio.tone && audio.tone(440, 0.15, 'square', 0.07); } else { banner('GO!', '', 800, 'count go'); audio.tone && audio.tone(880, 0.35, 'square', 0.08); input.rumble(0.5, 0.5, 200); } } if (ev.countdown <= 0) { ev.countdown = 0; ev.t = 0; } return; }
  ev.t += dt;
  const L = ev.line; const n = L.pts.length;
  if (ev.type !== 'arcade') {
    for (const e of ev.entrants) if (!e.finished || e.isPlayer) entrantProgress(ev, e);
    // ordering
    const order = ev.entrants.slice().sort((a, b) => b.prog - a.prog); order.forEach((e, k) => { e.pos = k + 1; }); ev.order = order;
    // checkpoint arches: next + following
    const cpN = ev.player.cpN; const total = ev.cps.length * ev.laps;
    cpGroup.meshes.forEach((m, k) => { const idx = cpN + k; if (idx < total) { const cpi = ev.cps[idx % ev.cps.length]; placeArch(m, L, cpi, ev.type === 'cross' ? 12 : 0); m.children.forEach((c) => { c.material.color.set(idx === total - 1 ? 0x22ff88 : k === 0 ? 0xff2e88 : 0xffb000); }); } else m.visible = false; });
  }
  // showcase opponent
  if (ev.def.showcase) {
    const total = L.len - L.cum[ev.s0]; ev.oppDist = ev.t * ev.oppSpeed; ev.oppFrac = clamp(ev.oppDist / total, 0, 1);
    if (ev.def.showcase === 'plane') { let k = ev.s0; while (k < n - 1 && L.cum[k] - L.cum[ev.s0] < ev.oppDist) k++; const p = L.pts[k], q = L.pts[Math.min(n - 1, k + 3)]; world.plane.position.set(p[0], p[1] + 35 + Math.sin(ev.t * 0.5) * 4, p[2]); world.plane.lookAt(q[0], q[1] + 35, q[2]); }
    if (ev.oppFrac >= 1 && !ev.player.finished) { ev.player.finished = true; ev.player.time = ev.t; ev.player.place = 2; ev.lostShowcase = true; banner('DEFEATED', 'The ' + (ev.def.showcase === 'train' ? 'Horizon Express' : 'jet') + ' got there first', 2500); audio.ui('fail'); setTimeout(() => finishEvent(true), 2200); }
    if (ev.player.finished && !ev.lostShowcase) ev.player.place = 1;
  }
  // arcade
  if (ev.type === 'arcade') {
    ev.timeLeft -= dt; const d = ev.def; const val = d.arcade === 'smash' ? ev.smashed : d.arcade === 'drift' ? ev.score + skill.driftPts * skill.mult : ev.near; ev.progress = val;
    if (val >= d.target || ev.timeLeft <= 0) { ev.done = true; ev.player.finished = true; ev.player.place = val >= d.target ? 1 : 2; ev.player.time = ev.t; banner(val >= d.target ? 'ARCADE COMPLETE' : 'TIME UP', `${Math.round(val).toLocaleString()} / ${d.target.toLocaleString()}`, 2400, val >= d.target ? 'gold' : ''); setTimeout(() => finishEvent(true), 2000); }
  }
  if (ev.type === 'drift') { ev.progress = ev.score + skill.driftPts * skill.mult; }
  // time out safety (sprints that never finish)
  if (ev.t > Math.max(300, (L.len * ev.laps) / 12) && !ev.player.finished) { ev.player.finished = true; ev.player.time = ev.t; ev.player.place = ev.entrants.length; banner('TIME OUT', '', 2000); setTimeout(() => finishEvent(true), 1500); ev.done = true; }
}
function finishEvent(completed) {
  const ev = activeEvent; if (!ev || ev.results) return; ev.done = true;
  if (skill.total > 0) skill.bank();
  const def = ev.def; const pe = ev.player; const isRace = ev.entrants.length > 1 || ev.ghostRace;
  const rows = ev.entrants.map((e) => { let t = e.finished ? e.time : null; if (t == null) { const remain = Math.max(0, L_remaining(ev, e)); const sp = e.isPlayer ? CARS[playerRec.id].vTop : (e.spec ? e.spec.vTop : 50); const avg = ev.t > 15 ? (e.distDone || 0) / ev.t : sp * (e.isPlayer ? 0.5 : 0.46 + (e.skill || 0.8) * 0.06) * (0.97 + ((e.name || '').length % 7) * 0.01); t = ev.t + remain / Math.max(12, avg); } return { name: e.name, car: e.isPlayer ? CARS[playerRec.id].name : e.spec.name, time: t, isPlayer: !!e.isPlayer }; });
  if (ev.ghostRace) for (const g of ghostBoard.list(def.id).slice(0, 8)) if (g.name !== P.character.name) rows.push({ name: g.name, car: g.car, time: g.time, isPlayer: false, ghost: true });
  if (isRace) rows.sort((a, b) => a.time - b.time);
  let place = isRace ? rows.findIndex((r) => r.isPlayer) + 1 : (pe.place || 1);
  if (def.type === 'drift') place = ev.score >= def.target ? 1 : ev.score >= def.target * 0.6 ? 2 : 3;
  const won = place === 1 && completed;
  const mult = [0, 1, 0.75, 0.6, 0.5, 0.42, 0.36, 0.3, 0.26, 0.22, 0.2, 0.18, 0.16][Math.min(12, place)] || 0.15;
  const diffBonus = 1 + (S.difficulty | 0) * 0.1; const assistPenalty = (S.assists.abs ? 0 : 0.05) + (S.assists.tcs ? 0 : 0.05) + (S.assists.stm ? 0 : 0.05) + (S.assists.shifting === 'manual' ? 0.1 : S.assists.shifting === 'manualClutch' ? 0.2 : 0);
  let cr = Math.round(def.reward * mult * diffBonus * (1 + assistPenalty) / 50) * 50; const xp = Math.round(def.xp * (won ? 1.5 : 1));
  const rec = P.events[def.id] || {}; const first = !rec.won && won;
  rec.done = (rec.done || 0) + 1; rec.best = Math.min(rec.best || 99, place); if (won) rec.won = true; if (pe.finished && (!rec.time || pe.time < rec.time) && place <= rows.length) rec.time = pe.time;
  if (pe.laps && pe.laps.length) { const bl = Math.min(...pe.laps); if (!rec.lap || bl < rec.lap) rec.lap = bl; }
  if (def.type === 'drift' || def.type === 'arcade') rec.score = Math.max(rec.score || 0, Math.round(ev.progress || ev.score || 0));
  P.events[def.id] = rec; addCredits(cr, false); addXP(xp); if (won) P.stats.wins++; if (place <= 3) P.stats.podiums++;
  let spins = 0; if (first) { P.wheelspins++; spins = 1; }
  // seasonal championship points
  const champ = seasonChamp(); let sp = 0; if (champ.includes(def.id) && !P.season.champDone[def.id]) { sp = [0, 30, 20, 15, 10, 8][Math.min(5, place)] || 5; P.season.points += sp; P.season.champDone[def.id] = place; if (Object.keys(P.season.champDone).length === champ.length) { const tot = P.season.points; if (tot >= 60) { P.superWheelspins++; toast('Seasonal Championship complete! Super Wheelspin awarded', 'gold'); } } }
  // mastery: car-specific counters
  const car = playerRec; car.races = (car.races || 0) + 1; if (won) car.wins = (car.wins || 0) + 1;
  // ghosts for leaderboard fallback
  if (pe.finished && !ev.lostShowcase && isRace) { ghostBoard.submit(def.id, pe.time, CARS[playerRec.id].name); net.shareGhost({ ev: def.id, time: pe.time, car: CARS[playerRec.id].name, name: P.character.name }); }
  ev.results = { rows, place, cr, xp, spins, sp, won, first, score: ev.progress, def };
  saveGame(true); UI.open('results', { ev });
}
function L_remaining(ev, e) { const L = ev.line; const total = (L.closed ? L.len * ev.laps : L.len - L.cum[ev.s0]); return total - (e.distDone || 0); }
function seasonChamp() { const wk = Math.floor(Date.now() / (7 * 86400000)); const rnd = mulberry32(wk * 7 + 3); const pool = EVENTS.filter((e) => ['road', 'dirt', 'cross', 'street', 'stadium'].includes(e.type)); const out = []; while (out.length < 3 && pool.length) { const k = Math.floor(rnd() * pool.length); out.push(pool.splice(k, 1)[0].id); } return out; }

// ---------------------------------------------------------------------
// FREE-ROAM: PR stunts, event prompts, barn finds
// ---------------------------------------------------------------------
const stunt = { zone: null, drift: null, trail: null, ramp: null, rampT: 0, launch: null };
function stars(v, target, lowerBetter = false) { const r = lowerBetter ? target / Math.max(0.01, v) : v / target; return r >= 1 ? 3 : r >= 0.85 ? 2 : r >= 0.7 ? 1 : 0; }
function starStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
function recordStunt(store, id, val, target, unit, name, lowerBetter = false) {
  const prev = store[id]; const better = prev == null || (lowerBetter ? val < prev : val > prev); const sNew = stars(val, target, lowerBetter), sOld = prev == null ? 0 : stars(prev, target, lowerBetter);
  banner(name, `${unit(val)}  ${starStr(sNew)}${better && prev != null ? '  · NEW BEST' : ''}`, 2600, sNew === 3 ? 'gold' : '');
  if (better) { store[id] = val; const gained = Math.max(0, sNew - sOld); if (gained) { P.skillPts += gained; addXP(gained * 500); toast(`+${gained} Skill Point${gained > 1 ? 's' : ''} · +${gained * 500} XP`, 'skill'); } }
  audio.ui(sNew >= 2 ? 'cash' : 'ok'); replay.mark(name);
}
function stuntUpdate(dt) {
  const v = player; const px = v.pos.x, pz = v.pos.z; const kmh = v.speed * 3.6;
  // speed traps
  for (const t of STUNTS.traps) { t.cd -= dt; const dx = px - t.x, dz = pz - t.z; if (dx * dx + dz * dz > 1600) { t.side = 0; continue; } const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw); const al = dx * fx + dz * fz; const lat = Math.abs(dx * fz - dz * fx); const side = Math.sign(al); if (t.side && side !== t.side && lat < 16 && t.cd <= 0) { t.cd = 3; P.traps = P.traps || {}; recordStunt(P.traps, t.id, kmh, t.target, (x) => fmtSpeed(x), t.name); perf.flash = S.reduceFlash ? 0.1 : 0.4; } t.side = side; }
  const q = world.roadQuery(px, pz, groundTmp);
  // speed zones
  if (!stunt.zone) { for (const z of STUNTS.zones) if (q && q.edge === z.e && q.d < 2 && Math.abs(q.s - z.s0) < 8) { stunt.zone = { z, dir: 0, t: 0, startS: q.s }; toast(z.name + ' started', 'info', 1500); break; } }
  else { const Z = stunt.zone; Z.t += dt; const on = q && q.edge === Z.z.e && q.d < 6; const endS = Math.abs(Z.startS - Z.z.s0) < 10 ? Z.z.s1 : Z.z.s0; if (!on && Z.t > 0.5) { stunt.zone = null; toast('Speed zone abandoned', 'warn', 1500); } else if (on && Math.abs(q.s - endS) < 10 && Z.t > 1) { const avg = Math.abs(Z.z.s1 - Z.z.s0) / Z.t * 3.6; recordStunt(P.zones, Z.z.id, avg, Z.z.target, (x) => fmtSpeed(x) + ' avg', Z.z.name); stunt.zone = null; } else if (on) Z.avg = Math.abs(q.s - Z.startS) / Math.max(0.1, Z.t) * 3.6; }
  // drift zones
  if (!stunt.drift) { for (const z of STUNTS.drift) if (q && q.edge === z.e && q.d < 2 && Math.abs(q.s - z.s0) < 8) { stunt.drift = { z, score: 0, last: skill.driftPts, t: 0, startS: q.s }; toast(z.name + ' started', 'info', 1500); break; } }
  else { const D = stunt.drift; D.t += dt; const on = q && q.edge === D.z.e && q.d < 10; const dp = skill.driftPts - D.last; if (dp > 0) D.score += dp * skill.mult; D.last = skill.driftPts; const endS = Math.abs(D.startS - D.z.s0) < 10 ? D.z.s1 : D.z.s0; if (!on && D.t > 1) { stunt.drift = null; toast('Drift zone abandoned', 'warn', 1500); } else if (on && Math.abs(q.s - endS) < 12 && D.t > 2) { recordStunt(P.driftz, D.z.id, Math.round(D.score), D.z.target, (x) => Math.round(x).toLocaleString() + ' pts', D.z.name); stunt.drift = null; } }
  // danger signs
  const ra = world.rampAt && world.rampAt(px, pz); if (ra) { stunt.ramp = ra[0]; stunt.rampT = 1.2; }
  else if (stunt.rampT > 0) { stunt.rampT -= dt; if (!v.onGround && !stunt.launch && stunt.ramp) stunt.launch = { r: stunt.ramp, x: px, z: pz }; }
  if (stunt.launch && v.onGround && v.airTime === 0) { const L = stunt.launch; const d = Math.hypot(px - L.x, pz - L.z); stunt.launch = null; stunt.ramp = null; if (d > 8) recordStunt(P.danger, L.r.id, d, L.r.target, (x) => fmtDist(x), L.r.name); }
  // trailblazers
  if (stunt.trail) { const T = stunt.trail; T.t += dt; if (Math.hypot(px - T.tr.bx, pz - T.tr.bz) < 22) { recordStunt(P.trails, T.tr.id, T.t, T.target, (x) => fmtTime(x), T.tr.name, true); stunt.trail = null; clearWaypoint(); } else if (T.t > T.target * 4) { stunt.trail = null; toast('Trailblazer timed out', 'warn'); clearWaypoint(); } }
  // barn finds
  for (const b of BARNS) { if (P.barns.includes(b.i)) continue; if (Math.hypot(px - b.x, pz - b.z) < 22 && v.speed < 8) { P.barns.push(b.i); const c = addCar(b.id, { barn: true }); banner('BARN FIND', CARS[b.id].name + ' has been restored and added to your garage', 4000, 'gold'); addXP(2000); audio.ui('cash'); saveGame(true); } }
  // stats
  P.stats.distance += v.speed * dt; if (kmh > (P.stats.topSpeed || 0)) P.stats.topSpeed = kmh;
}
let promptTarget = null;
function promptUpdate(dt) {
  const px = player.pos.x, pz = player.pos.z; let best = null, bd = 18 * 18;
  for (const ev of EVENTS) { const d = (ev.start.x - px) ** 2 + (ev.start.z - pz) ** 2; if (d < bd) { bd = d; best = { kind: 'event', ev }; } }
  for (const t of STUNTS.trails) { const d = (t.x - px) ** 2 + (t.z - pz) ** 2; if (d < bd && !stunt.trail) { bd = d; best = { kind: 'trail', t }; } }
  promptTarget = best; const el = $('#prompt');
  if (best && !UI.isOpen()) { el.classList.add('on'); el.innerHTML = ''; el.appendChild(h('kbd', {}, input.device === 'gamepad' ? 'Y' : 'Enter')); el.appendChild(document.createTextNode(' ' + (best.kind === 'event' ? best.ev.name : best.t.name))); if (input.menuPressed('alt2') || (input.menuPressed('ok') && input.keys.has('Enter'))) { if (best.kind === 'event') UI.open('eventCard', { ev: best.ev }); else { stunt.trail = { tr: best.t, t: 0, target: Math.round(Math.hypot(best.t.bx - best.t.x, best.t.bz - best.t.z) / 30) }; setWaypoint(best.t.bx, best.t.bz, best.t.name + ' finish'); banner(best.t.name, 'Reach the beacon by any route · target ' + fmtTime(stunt.trail.target), 2500); } } }
  else el.classList.remove('on');
}
function nearestEvent() { let b = null, bd = 1e18; const done = (e) => P.events[e.id]?.won; for (const ev of EVENTS) { if (done(ev)) continue; const d = (ev.start.x - player.pos.x) ** 2 + (ev.start.z - player.pos.z) ** 2; if (d < bd) { bd = d; b = ev; } } return b; }
function fmtSpeed(kmh) { return S.units === 'imperial' ? Math.round(kmh * 0.6214) + ' mph' : Math.round(kmh) + ' km/h'; }
function fmtDist(m) { return S.units === 'imperial' ? Math.round(m * 3.281) + ' ft' : Math.round(m) + ' m'; }

// ---------------------------------------------------------------------
// REPLAY (60s @30Hz) + HIGHLIGHTS
// ---------------------------------------------------------------------
const replay = {
  frames: [], max: 1800, acc: 0, marks: [], n: 0, idx: 0, playing: true, speed: 1, cam: 0, cams: ['Chase', 'TV', 'Orbit', 'Helicopter', 'Bumper', 'Wheel'], filter: 0, prevMode: 'free', tvPos: new THREE.Vector3(), orbit: 0, hideHud: false,
  record(h) { this.acc += h; if (this.acc < 1 / 30) return; this.acc -= 1 / 30; const v = player; const f = { n: this.n++, p: [v.pos.x, v.pos.y, v.pos.z, v.quat.x, v.quat.y, v.quat.z, v.quat.w], s: v.speed, rpm: v.engine.rpm, st: v.input.steer, th: v.input.throttle, r: racers.map((r) => [r.veh.pos.x, r.veh.pos.y, r.veh.pos.z, r.veh.quat.x, r.veh.quat.y, r.veh.quat.z, r.veh.quat.w, r.veh.speed]) }; this.frames.push(f); if (this.frames.length > this.max) this.frames.shift(); },
  mark(label) { this.marks.push({ n: this.n, label }); if (this.marks.length > 30) this.marks.shift(); },
  clear() { this.frames.length = 0; this.marks.length = 0; },
  enter() { if (this.frames.length < 30) { toast('Not enough replay recorded yet', 'warn'); return; } this.prevMode = mode; mode = 'replay'; this.idx = Math.max(0, this.frames.length - 30 * 15); this.playing = true; this.speed = 1; hudShow(false); UI.open('replay'); },
  exit() { mode = this.prevMode; player.interpolate(1); for (const r of racers) r.veh.interpolate(1); hudShow(true); camRig.init = false; if (UI.top()?.name === 'replay') UI.back(); },
  highlights() { const base = this.frames[0]?.n ?? 0; return this.marks.filter((m) => m.n >= base).map((m) => ({ ...m, i: m.n - base })); },
  apply(i) {
    const F = this.frames; const k = Math.floor(i), t = i - k; const a = F[clamp(k, 0, F.length - 1)], b = F[clamp(k + 1, 0, F.length - 1)]; if (!a) return;
    player.renderPos.set(lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)); player.renderQuat.set(a.p[3], a.p[4], a.p[5], a.p[6]).slerp(tmpQ.set(b.p[3], b.p[4], b.p[5], b.p[6]), t);
    player.engine.rpm = lerp(a.rpm, b.rpm, t); player.input.steer = a.st; this.curSpeed = lerp(a.s, b.s, t);
    racers.forEach((r, j) => { const A = a.r[j], B = b.r[j] || A; if (!A) return; r.veh.renderPos.set(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); r.veh.renderQuat.set(A[3], A[4], A[5], A[6]); });
  },
  update(dt) {
    const F = this.frames; if (!F.length) return; if (this.playing) { this.idx += dt * 30 * this.speed; if (this.idx >= F.length - 1) { this.idx = F.length - 1; this.playing = false; } if (this.idx < 0) { this.idx = 0; this.playing = false; } }
    this.apply(this.idx); playerModel.update(player, dt); playerModel.spinWheels && playerModel.spinWheels(this.curSpeed * (this.playing ? Math.sign(this.speed) : 0), dt * Math.abs(this.speed));
    const c = player.renderPos; const R = player.renderQuat; const fwd = tmpV.set(0, 0, 1).applyQuaternion(R); const cm = this.cams[this.cam];
    if (cm === 'Chase') { camera.position.copy(c).addScaledVector(fwd, -7).add(tmpV2.set(0, 2.4, 0)); camera.lookAt(c.x, c.y + 0.8, c.z); }
    else if (cm === 'TV') { if (this.tvPos.distanceTo(c) > 90 || this.tvPos.lengthSq() === 0) { const side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(14 * (Math.random() < 0.5 ? -1 : 1)); this.tvPos.copy(c).addScaledVector(fwd, 55).add(side); this.tvPos.y = world.height(this.tvPos.x, this.tvPos.z) + 2 + Math.random() * 4; } camera.position.copy(this.tvPos); camera.lookAt(c); const d = this.tvPos.distanceTo(c); camera.fov = clamp(2400 / Math.max(10, d), 12, 60); camera.updateProjectionMatrix(); }
    else if (cm === 'Orbit') { this.orbit += dt * 0.5; camera.position.set(c.x + Math.sin(this.orbit) * 8, c.y + 2, c.z + Math.cos(this.orbit) * 8); camera.lookAt(c); }
    else if (cm === 'Helicopter') { camera.position.copy(c).addScaledVector(fwd, -25).add(tmpV2.set(0, 28, 0)); camera.lookAt(c); }
    else if (cm === 'Bumper') { camera.position.copy(tmpV2.set(0, 0.2, CARS[playerRec.id].len / 2 + 0.3).applyQuaternion(R).add(c)); camera.quaternion.copy(R).multiply(tmpQ.setFromAxisAngle(tmpV3.set(0, 1, 0), Math.PI)); }
    else { camera.position.copy(tmpV2.set(1.4, 0.1, -0.6).applyQuaternion(R).add(c)); camera.lookAt(tmpV3.copy(fwd).multiplyScalar(8).add(c)); }
    if (cm !== 'TV' && camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    const g = world.height(camera.position.x, camera.position.z) + 0.3; if (camera.position.y < g) camera.position.y = g;
    if (playerVoice && audio.ready) playerVoice.update(player.engine.rpm, 0.6, 0.5, 0, this.playing ? 0.7 : 0, null, dt);
  },
};

// ---------------------------------------------------------------------
// PHOTO MODE
// ---------------------------------------------------------------------
const photo = {
  pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 50, filter: 0, exposure: 1, tilt: 0, tiltPos: 0.5, vig: 0.35, prevMode: 'free', hideCar: false, savedTod: 12,
  enter() { this.prevMode = mode; mode = 'photo'; this.pos.copy(camera.position); const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); this.yaw = e.y; this.pitch = e.x; this.roll = 0; this.fov = camera.fov; this.savedTod = world.tod; hudShow(false); UI.open('photo'); },
  exit() { mode = this.prevMode; world.tod = this.savedTod; playerModel.group.visible = true; hudShow(true); camRig.init = false; if (UI.top()?.name === 'photo') UI.back(); },
  update(dt) {
    const k = input.keys; const pad = input.pad(); const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0), mz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), my = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    let lx = (input.state.mouseDX || 0) * 1.2, ly = (input.state.mouseDY || 0) * 1.2;
    if (pad) { mx += dz(pad.axes[0]); mz -= dz(pad.axes[1]); lx += dz(pad.axes[2]) * dt * 2; ly += dz(pad.axes[3]) * dt * 2; my += (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0); }
    if (input.touch && input.touch.active) { mx += input.touch.steer || 0; mz += (input.touch.throttle || 0) - (input.touch.brake || 0); }
    this.yaw -= lx; this.pitch = clamp(this.pitch - ly * (S.padInvertY ? -1 : 1), -1.4, 1.4);
    const sp = 9 * dt; const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.addScaledVector(f, mz * sp).addScaledVector(r, mx * sp); this.pos.y += my * sp;
    const c = player.renderPos; const off = this.pos.clone().sub(c); if (off.length() > 45) this.pos.copy(c).add(off.setLength(45));
    const g = world.height(this.pos.x, this.pos.z) + 0.25; if (this.pos.y < g) this.pos.y = g;
    camera.position.copy(this.pos); camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
    playerModel.group.visible = !this.hideCar;
  },
  post() { return { filter: this.filter, tilt: this.tilt, tiltPos: this.tiltPos, vig: this.vig, brightness: this.exposure, blur: 0, ca: 0, speedLines: 0 }; },
  take() {
    try {
      fx.render(scene, camera, world.sunDir, postParams(0)); const src = renderer.domElement; const url = src.toDataURL('image/jpeg', 0.92);
      const th = document.createElement('canvas'); th.width = 320; th.height = Math.round(320 * src.height / src.width); th.getContext('2d').drawImage(src, 0, 0, th.width, th.height);
      const list = JSON.parse(localStorage.getItem('fh6_photos') || '[]'); list.unshift({ t: Date.now(), car: CARS[playerRec.id].name, img: th.toDataURL('image/jpeg', 0.7) }); while (list.length > 12) list.pop();
      try { localStorage.setItem('fh6_photos', JSON.stringify(list)); } catch { toast('Photo album full', 'warn'); }
      P.photos++; perf.flash = S.reduceFlash ? 0.2 : 1; audio.burst && audio.burst(0.12, 'highpass', 4000, 0.3);
      saveDownload(`FH6_${CARS[playerRec.id].name.replace(/\W+/g, '_')}_${Date.now()}.jpg`, url, 'image/jpeg');
      if (P.photos === 1) { addXP(500); toast('First photo! +500 XP', 'xp'); } else toast('Photo saved to album & downloaded', 'info');
    } catch (e) { toast('Photo failed: ' + e.message, 'warn'); }
  },
};

// ---------------------------------------------------------------------
// QUICK-CHAT RADIAL
// ---------------------------------------------------------------------
const quickChat = {
  open: false, sel: -1,
  handle() {
    const el = $('#radial'); if (input.pressed('quickChat')) { this.open = !this.open; this.sel = -1; if (this.open) this.render(); el.classList.toggle('on', this.open); }
    if (!this.open) return;
    for (let i = 0; i < 8; i++) if (input.keys.has('Digit' + (i + 1))) { this.send(i); return; }
    const pad = input.pad();
    if (pad) { const x = pad.axes[2] || 0, y = pad.axes[3] || 0; if (Math.hypot(x, y) > 0.6) { const a = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2); this.sel = Math.round(a / (Math.PI / 4)) % 8; this.render(); } }
    if (input.menuPressed('ok') && this.sel >= 0) this.send(this.sel); if (input.menuPressed('back')) { this.open = false; el.classList.remove('on'); }
  },
  render() { const el = $('#radial'); el.innerHTML = ''; QUICKCHAT.forEach((q, i) => { const a = i * Math.PI / 4; const d = h('div', { class: 'ritem' + (i === this.sel ? ' sel' : ''), onclick: () => this.send(i) }, h('kbd', {}, String(i + 1)), ' ' + q); d.style.left = (50 + Math.sin(a) * 38) + '%'; d.style.top = (50 - Math.cos(a) * 38) + '%'; el.appendChild(d); }); el.appendChild(h('div', { class: 'rcenter' }, 'QUICK CHAT')); },
  send(i) { this.open = false; $('#radial').classList.remove('on'); net.sendChat(i); chatBubble(P.character.name, QUICKCHAT[i], true); },
};
function chatBubble(name, text, self) { const log = $('#chatlog'); const d = h('div', { class: 'chat' + (self ? ' self' : '') }, h('b', {}, name + ': '), text); log.appendChild(d); setTimeout(() => d.remove(), 7000); while (log.children.length > 6) log.firstChild.remove(); subtitle(name + ': ' + text, 3000); }

// ---------------------------------------------------------------------
// GHOST LEADERBOARD (offline / WebRTC-blocked fallback; shared across tabs)
// ---------------------------------------------------------------------
const ghostBoard = {
  key: 'fh6_ghostboard',
  all() { try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch { return {}; } },
  list(id) {
    const all = this.all(); let l = all[id] || []; const ev = EVENTS.find((e) => e.id === id);
    if (ev && ev.line) { const rnd = mulberry32(strHash(id)); const base = (ev.line.len * ev.laps) / 38; for (let i = 0; i < 6; i++) l = l.concat([{ name: DRIVATARS[Math.floor(rnd() * DRIVATARS.length)] + ' (ghost)', time: base * (0.92 + i * 0.05 + rnd() * 0.03), car: CARS[Math.floor(rnd() * 300)].name, ghost: true }]); }
    return l.sort((a, b) => a.time - b.time).slice(0, 15);
  },
  submit(id, time, car, name = P.character.name) { const all = this.all(); const l = all[id] || []; l.push({ name, time, car, date: Date.now() }); l.sort((a, b) => a.time - b.time); all[id] = l.slice(0, 20); try { localStorage.setItem(this.key, JSON.stringify(all)); } catch { } },
};
function strHash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

// ---------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------
const PALETTES = {
  off: { good: [0.15, 0.9, 0.45], warn: [1, 0.75, 0.1], bad: [1, 0.12, 0.08], accent: '#ff2e88', hiGood: '#2fe08a', hiBad: '#ff3b30' },
  deuteranopia: { good: [0.1, 0.5, 1], warn: [1, 0.85, 0.2], bad: [0.9, 0.1, 0.8], accent: '#ffb000', hiGood: '#3d8bff', hiBad: '#e040fb' },
  protanopia: { good: [0.1, 0.55, 1], warn: [1, 0.9, 0.25], bad: [0.85, 0.2, 0.9], accent: '#ffb000', hiGood: '#3d8bff', hiBad: '#d050ff' },
  tritanopia: { good: [0.1, 0.85, 0.8], warn: [1, 0.55, 0.65], bad: [1, 0.15, 0.2], accent: '#ff2e88', hiGood: '#20d0c0', hiBad: '#ff3040' },
};
const PAL = () => PALETTES[S.colorblind] || PALETTES.off;
let hudEls = {}; let mapCanvas = null; let miniCtx = null;
function initHUD() {
  ['hud', 'speedo', 'minimap', 'chain', 'raceinfo', 'eventbar', 'stuntinfo', 'markers', 'nameplates', 'dmg', 'hudinfo', 'perf', 'netbar'].forEach((k) => { hudEls[k] = $('#' + k); });
  miniCtx = hudEls.minimap.getContext('2d');
  hudEls.speedoCtx = hudEls.speedo.getContext('2d');
}
function hudShow(on) { hudEls.hud && hudEls.hud.classList.toggle('hide', !on); }
function buildMapCanvas() {
  const N = 2048; const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.drawImage(world.mapImage, 0, 0, N, N);
  const sc = N / (WORLD_HALF * 2); const tx = (x) => (x + WORLD_HALF) * sc;
  const draw = (filter, color, wmul, minW) => { g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; for (const e of world.edges) { if (!filter(e)) continue; g.lineWidth = Math.max(minW, e.width * sc * wmul); g.beginPath(); for (let i = 0; i < e.n; i += 2) { const x = tx(e.xs[i]), y = tx(e.zs[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.lineTo(tx(e.xs[e.n - 1]), tx(e.zs[e.n - 1])); g.stroke(); } };
  draw((e) => !e.hidden, 'rgba(0,0,0,0.55)', 2.2, 4); draw((e) => !e.hidden && (e.type === 'dirt' || e.type === 'gravel'), '#c9a26b', 1.3, 2.2); draw((e) => e.type !== 'dirt' && e.type !== 'gravel', '#f2f2f2', 1.3, 2.4); draw((e) => e.type === 'highway', '#ffd36b', 1.0, 2.6);
  // rail
  g.strokeStyle = '#6a4a3a'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); world.railPts.forEach((p, i) => (i ? g.lineTo(tx(p.x), tx(p.z)) : g.moveTo(tx(p.x), tx(p.z)))); g.closePath(); g.stroke(); g.setLineDash([]);
  mapCanvas = c; mapCanvas.sc = sc; mapCanvas.tx = tx;
}
const EV_ICON = { road: '🏁', dirt: '⛰', cross: '🌲', street: '🌃', drag: '⏱', showcase: '★', stadium: '🏟', arcade: '🎪', drift: '〰', speedtrap: '📷', speedzone: '⏩', danger: '⚠', trail: '🔷' };
function drawMinimap() {
  if (!miniCtx || !mapCanvas || !player) return; const g = miniCtx; const W = hudEls.minimap.width, H = hudEls.minimap.height; const sc = mapCanvas.sc;
  const zoom = clamp(0.6 + player.speed / 60, 0.6, 1.4); const radiusM = 330 * zoom; const pxPerM = (W / 2) / radiusM;
  g.save(); g.clearRect(0, 0, W, H); g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.clip(); g.fillStyle = '#123'; g.fillRect(0, 0, W, H);
  const yaw = player.yaw(); const px = player.renderPos.x, pz = player.renderPos.z;
  g.translate(W / 2, H / 2); g.rotate(Math.PI + yaw); g.scale(pxPerM / sc, pxPerM / sc); g.translate(-mapCanvas.tx(px), -mapCanvas.tx(pz));
  g.drawImage(mapCanvas, 0, 0);
  const tx = mapCanvas.tx; const k = sc / pxPerM;
  // GPS route
  if (gpsRoute && gpsRoute.pts && !activeEvent) { g.strokeStyle = '#22c7ff'; g.lineWidth = 5 * k; g.beginPath(); for (let i = gpsRoute.idx; i < Math.min(gpsRoute.pts.length, gpsRoute.idx + 400); i += 2) { const p = gpsRoute.pts[i]; i === gpsRoute.idx ? g.moveTo(tx(p[0]), tx(p[2])) : g.lineTo(tx(p[0]), tx(p[2])); } g.stroke(); }
  if (activeEvent && activeEvent.line) { const L = activeEvent.line; g.strokeStyle = PAL().accent; g.lineWidth = 4 * k; g.beginPath(); L.pts.forEach((p, i) => (i ? g.lineTo(tx(p[0]), tx(p[2])) : g.moveTo(tx(p[0]), tx(p[2])))); if (L.closed) g.closePath(); g.stroke(); }
  const dot = (x, z, col, r = 4) => { g.fillStyle = col; g.beginPath(); g.arc(tx(x), tx(z), r * k, 0, Math.PI * 2); g.fill(); };
  if (S.hud.markers) {
    if (!activeEvent) for (const ev of EVENTS) dot(ev.start.x, ev.start.z, EVENT_TYPES[ev.type]?.color || '#fff', 5);
    if (activeEvent) { for (const r of racers) dot(r.veh.renderPos.x, r.veh.renderPos.z, '#ff4040', 4); const t = activeEvent.gpsTarget && activeEvent.gpsTarget(); if (t) dot(t.x, t.z, '#ffd400', 6); }
    for (const t of world.traffic.list) dot(t.pos.x, t.pos.z, 'rgba(255,255,255,0.7)', 2.5);
    for (const rm of net.remoteList()) if (rm.veh) dot(rm.veh.renderPos.x, rm.veh.renderPos.z, '#36d1ff', 5);
    if (waypoint) dot(waypoint.x, waypoint.z, '#22c7ff', 6);
  }
  g.restore();
  // player arrow + ring
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W / 2, H / 2 - 9); g.lineTo(W / 2 + 6, H / 2 + 7); g.lineTo(W / 2, H / 2 + 3); g.lineTo(W / 2 - 6, H / 2 + 7); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
  // north marker (world -Z)
  const th = Math.PI + yaw; g.fillStyle = PAL().accent; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', W / 2 + Math.sin(th) * (W / 2 - 13), H / 2 - Math.cos(th) * (W / 2 - 13));
}
function drawSpeedo() {
  const g = hudEls.speedoCtx; const W = hudEls.speedo.width, H = hudEls.speedo.height; g.clearRect(0, 0, W, H); if (!player) return;
  const v = player; const e = v.engine; const p = v.p; const cx = W / 2, cy = H / 2 + 6, R = W * 0.42;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; const rpmF = clamp(e.rpm / p.limiter, 0, 1); const redF = p.redline / p.limiter;
  g.lineCap = 'butt'; g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  g.strokeStyle = 'rgba(255,40,40,0.55)'; g.beginPath(); g.arc(cx, cy, R, a0 + (a1 - a0) * redF, a1); g.stroke();
  const shift = e.rpm > p.redline * 0.94 && e.gear > 0; const blink = shift && Math.floor(gameTime * 14) % 2 === 0;
  g.strokeStyle = shift ? (blink ? '#ff2a2a' : '#ffffff') : PAL().accent; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * rpmF); g.stroke();
  // ticks
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; const maxK = Math.ceil(p.limiter / 1000); g.font = '11px sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k <= maxK; k++) { const a = a0 + (a1 - a0) * (k * 1000 / p.limiter); if (a > a1 + 0.01) break; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.lineTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); g.stroke(); g.fillText(String(k), cx + Math.cos(a) * (R - 28), cy + Math.sin(a) * (R - 28)); }
  // shift light bar
  if (S.hud.speedo) { for (let i = 0; i < 7; i++) { const on = rpmF > (redF * 0.72 + i * redF * 0.04); g.fillStyle = on ? (i < 3 ? '#2fe08a' : i < 5 ? '#ffd400' : '#ff2a2a') : 'rgba(255,255,255,0.12)'; if (shift) g.fillStyle = blink ? '#ff2a2a' : 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(cx - 48 + i * 16, cy - R * 0.55, 5, 0, Math.PI * 2); g.fill(); } }
  const spd = S.units === 'imperial' ? v.speed * 2.237 : v.speed * 3.6;
  g.fillStyle = '#fff'; g.font = 'bold 54px "Segoe UI", sans-serif'; g.fillText(String(Math.round(spd)), cx, cy + 4); g.font = '12px sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(S.units === 'imperial' ? 'MPH' : 'KM/H', cx, cy + 36);
  const gear = e.gear === -1 ? 'R' : e.gear === 0 ? 'N' : String(e.gear); g.font = 'bold 26px sans-serif'; g.fillStyle = shift ? '#ff2a2a' : PAL().accent; g.fillText(gear, cx, cy + R * 0.62);
  if (p.asp === 'T' || p.asp === 'TT' || p.asp === 'S') { const b = clamp(e.boost || 0, 0, 1); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(cx, cy, R - 42, Math.PI * 0.85, Math.PI * 0.15, true); g.stroke(); g.strokeStyle = '#36d1ff'; g.beginPath(); g.arc(cx, cy, R - 42, Math.PI * 0.85, Math.PI * 0.85 - (Math.PI * 0.7) * b, true); g.stroke(); g.font = '9px sans-serif'; g.fillStyle = '#9adfff'; g.fillText('BOOST', cx - R * 0.42, cy + R * 0.48); }
  if (S.assists.shifting !== 'auto') { g.font = '10px sans-serif'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText(S.assists.shifting === 'manualClutch' ? 'MANUAL+C' : 'MANUAL', cx, cy + R * 0.84); }
}
function setText(el, t) { if (el && el.__t !== t) { el.__t = t; el.textContent = t; } }
function setHTML(el, t) { if (el && el.__h !== t) { el.__h = t; el.innerHTML = t; } }
let hudT = 0; const markerPool = [];
function projectToScreen(x, y, z) { const v = tmpV.set(x, y, z).project(camera); const behind = v.z > 1; return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind, z: v.z }; }
function updateHUD(dt) {
  const show = player && (mode === 'free' || mode === 'event') && !(UI.isOpen() && !UI.top()?.overlay);
  if (hudEls.hud) hudEls.hud.classList.toggle('hide', !show); updatePerfOverlay();
  if (!show) { hudEls.markers.innerHTML = ''; markerPool.length = 0; return; }
  hudEls.speedo.style.display = S.hud.speedo ? '' : 'none'; hudEls.minimap.style.display = S.hud.minimap ? '' : 'none';
  if (S.hud.speedo) drawSpeedo(); hudT += dt; if (S.hud.minimap && hudT > 1 / 30) { hudT = 0; drawMinimap(); }
  // skill chain
  if (S.hud.chain && (skill.total > 0 || skill.flash || skill.drifting)) {
    let html = '';
    if (skill.flash) html += `<div class="cflash ${skill.flash.good ? 'good' : 'bad'}">${skill.flash.text}</div>`;
    if (skill.total > 0 || skill.drifting) { const live = skill.drifting ? Math.round(skill.driftPts) : 0; html += `<div class="cmult">x${skill.mult}</div><div class="ctotal">${Math.round(skill.total + live).toLocaleString()}</div>`; if (skill.drifting) html += `<div class="clive">${tierName('drift', skill.driftPts)} ${live.toLocaleString()}</div>`; html += skill.items.slice(0, 3).map((i) => `<div class="citem">${i.name} <b>+${i.pts.toLocaleString()}</b></div>`).join(''); const bt = skill.bankTime(); html += `<div class="cbank"><i style="width:${clamp(1 - skill.idle / bt, 0, 1) * 100}%"></i></div>`; }
    setHTML(hudEls.chain, html); hudEls.chain.style.display = '';
  } else hudEls.chain.style.display = 'none';
  // race info
  const ev = activeEvent;
  if (ev && S.hud.race) {
    let html = ''; const pe = ev.player;
    if (ev.order && ev.entrants.length > 1) { html += `<div class="rpos"><b>${pe.pos}</b><small>/${ev.entrants.length}</small></div>`; }
    if (ev.laps > 1) html += `<div class="rrow">LAP <b>${Math.min(ev.laps, Math.floor(pe.cpN / ev.cps.length) + 1)}/${ev.laps}</b></div>`;
    html += `<div class="rrow">TIME <b>${fmtTime(ev.countdown > 0 ? 0 : ev.t)}</b></div>`;
    if (pe.laps && pe.laps.length) html += `<div class="rrow small">LAST ${fmtTime(pe.laps[pe.laps.length - 1])} · BEST ${fmtTime(Math.min(...pe.laps))}</div>`;
    const rec = P.events[ev.id]; if (rec && rec.lap && ev.laps > 1) html += `<div class="rrow small">RECORD ${fmtTime(rec.lap)}</div>`;
    if (pe.sectors && pe.sectors.length) html += `<div class="rrow small">SECTOR ${fmtTime(pe.sectors[pe.sectors.length - 1])}</div>`;
    if (ev.order && ev.entrants.length > 1) {
      const i = ev.order.indexOf(pe); const ahead = ev.order[i - 1], behind = ev.order[i + 1]; const gap = (o) => { const d = Math.abs((o.distDone || 0) - (pe.distDone || 0)); return (d / Math.max(12, player.speed)).toFixed(1); };
      html += '<div class="gaps">' + (ahead ? `<div class="gap bad">▲ ${ahead.name} +${gap(ahead)}s</div>` : '<div class="gap good">LEADING</div>') + (behind ? `<div class="gap good">▼ ${behind.name} -${gap(behind)}s</div>` : '') + '</div>';
      html += '<div class="board">' + ev.order.slice(0, 8).map((o) => `<div class="${o.isPlayer ? 'me' : ''}">${o.pos}. ${o.name}${o.finished ? ' ✓' : ''}</div>`).join('') + '</div>';
    }
    setHTML(hudEls.raceinfo, html); hudEls.raceinfo.style.display = '';
    // event progress bar
    let bar = '';
    if (ev.def.showcase) { const pf = clamp((pe.distDone || 0) / (ev.line.len - ev.line.cum[ev.s0]), 0, 1); bar = `<div class="ebar"><div class="lab">YOU</div><div class="trk"><i style="width:${pf * 100}%"></i></div></div><div class="ebar opp"><div class="lab">${ev.def.showcase === 'train' ? 'TRAIN' : 'JET'}</div><div class="trk"><i style="width:${(ev.oppFrac || 0) * 100}%"></i></div></div>`; }
    if (ev.type === 'arcade' || ev.type === 'drift') { const t = ev.def.target; const v = ev.progress || 0; bar = `<div class="ebar"><div class="lab">${ev.def.arcade === 'smash' ? 'PIÑATAS' : ev.def.arcade === 'near' ? 'NEAR MISS' : 'SCORE'}</div><div class="trk"><i style="width:${clamp(v / t, 0, 1) * 100}%"></i></div><div class="val">${Math.round(v).toLocaleString()} / ${t.toLocaleString()}</div></div>` + (ev.timeLeft != null ? `<div class="etime">${fmtTime(Math.max(0, ev.timeLeft))}</div>` : ''); }
    setHTML(hudEls.eventbar, bar); hudEls.eventbar.style.display = bar ? '' : 'none';
  } else { hudEls.raceinfo.style.display = 'none'; hudEls.eventbar.style.display = 'none'; }
  // free-roam stunt info
  let st = '';
  if (mode === 'free') { if (stunt.zone) st = `<b>${stunt.zone.z.name}</b><br>AVG ${fmtSpeed(stunt.zone.avg || 0)} · TARGET ${fmtSpeed(stunt.zone.z.target)}`; else if (stunt.drift) st = `<b>${stunt.drift.z.name}</b><br>${Math.round(stunt.drift.score).toLocaleString()} / ${stunt.drift.z.target.toLocaleString()}`; else if (stunt.trail) st = `<b>${stunt.trail.tr.name}</b><br>${fmtTime(stunt.trail.t)} · TARGET ${fmtTime(stunt.trail.target)}`; }
  setHTML(hudEls.stuntinfo, st); hudEls.stuntinfo.style.display = st ? '' : 'none';
  // top-right info
  const tod = world.tod; const hh = Math.floor(tod), mm = Math.floor((tod - hh) * 60);
  setHTML(hudEls.hudinfo, `<div class="cr">${fmtCR(P.credits)}</div><div>LVL ${P.level} · ${P.skillPts} SP</div><div class="small">${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${world.weather.state} · ${world.season || ''}</div>`);
  hudEls.hudinfo.style.display = S.hud.notifications ? '' : 'none';
  // damage indicator
  if (S.hud.damage && S.assists.damage !== 'off') { const d = player.damage; const c = (x) => (x > 0.6 ? '#ff3b30' : x > 0.25 ? '#ffb000' : 'rgba(255,255,255,0.35)'); setHTML(hudEls.dmg, `<svg viewBox="0 0 40 60" width="30" height="45"><rect x="8" y="2" width="24" height="10" rx="3" fill="${c(d.front)}"/><rect x="8" y="48" width="24" height="10" rx="3" fill="${c(d.rear)}"/><rect x="2" y="14" width="6" height="32" rx="2" fill="${c(d.left)}"/><rect x="32" y="14" width="6" height="32" rx="2" fill="${c(d.right)}"/></svg>`); hudEls.dmg.style.display = Math.max(d.front, d.rear, d.left, d.right) > 0.05 ? '' : 'none'; } else hudEls.dmg.style.display = 'none';
  // objective markers
  updateMarkers();
}
function updateMarkers() {
  const want = [];
  if (S.hud.markers) {
    if (activeEvent && activeEvent.gpsTarget) { const t = activeEvent.gpsTarget(); if (t) want.push({ x: t.x, y: world.height(t.x, t.z) + 6, z: t.z, label: 'CHECKPOINT', cls: 'cp' }); }
    if (mode === 'free') { if (waypoint) want.push({ x: waypoint.x, y: world.height(waypoint.x, waypoint.z) + 8, z: waypoint.z, label: waypoint.name || 'WAYPOINT', cls: 'wp' }); for (const ev of EVENTS) { const d = Math.hypot(ev.start.x - player.pos.x, ev.start.z - player.pos.z); if (d < 600) want.push({ x: ev.start.x, y: world.height(ev.start.x, ev.start.z) + 10, z: ev.start.z, label: (EV_ICON[ev.type] || '') + ' ' + ev.name, cls: 'ev', d }); } if (stunt.trail) want.push({ x: stunt.trail.tr.bx, y: world.height(stunt.trail.tr.bx, stunt.trail.tr.bz) + 8, z: stunt.trail.tr.bz, label: 'FINISH', cls: 'cp' }); }
  }
  if (S.hud.nameplates) { for (const rm of net.remoteList()) if (rm.veh) { const d = rm.veh.renderPos.distanceTo(camera.position); if (d < 400) want.push({ x: rm.veh.renderPos.x, y: rm.veh.renderPos.y + 2.2, z: rm.veh.renderPos.z, label: (rm.talking > 0 ? '🔊 ' : '') + rm.name, cls: 'np' + (rm.ghost ? ' ghost' : ''), d }); } if (activeEvent) for (const r of racers) { const d = r.veh.renderPos.distanceTo(camera.position); if (d < 120) want.push({ x: r.veh.renderPos.x, y: r.veh.renderPos.y + 2, z: r.veh.renderPos.z, label: r.name, cls: 'np ai', d }); } }
  while (markerPool.length < want.length) { const el = h('div', { class: 'marker' }); hudEls.markers.appendChild(el); markerPool.push(el); }
  markerPool.forEach((el, i) => { const w = want[i]; if (!w) { el.style.display = 'none'; return; } const s = projectToScreen(w.x, w.y, w.z); if (s.behind || s.x < -50 || s.x > innerWidth + 50) { el.style.display = 'none'; return; } el.style.display = ''; el.className = 'marker ' + w.cls; el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; const dist = w.d ?? Math.hypot(w.x - player.pos.x, w.z - player.pos.z); setText(el, w.label + (w.cls === 'np' || w.cls === 'np ai' ? '' : '  ' + fmtDist(dist))); });
}
function perfUpdate(dt, now) {
  perf.frames++; perf.t += dt; perf.ft = lerp(perf.ft, dt * 1000, 0.05);
  if (perf.t >= 0.5) { perf.fps = perf.frames / perf.t; perf.frames = 0; perf.t = 0;
    if (S.adaptiveRes && (mode === 'free' || mode === 'event')) { const target = 50; const cur = perf.dynScale || 1; let ns = cur; if (perf.fps < target - 5) ns = Math.max(0.5, cur - 0.08); else if (perf.fps > target + 12) ns = Math.min(1, cur + 0.04); if (Math.abs(ns - cur) > 0.01) { perf.dynScale = ns; perf.needResize = true; } }
  }
}
function updatePerfOverlay() {
  const el = hudEls.perf; if (!el) return; if (!S.hud.perf) { el.style.display = 'none'; return; } el.style.display = '';
  const info = renderer.info; setText(el, `FPS ${perf.fps.toFixed(0)}  ${perf.ft.toFixed(1)}ms\nphys ${perf.phys.toFixed(2)}ms  render ${perf.rend.toFixed(2)}ms\ncalls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\nscale ${(S.resScale * (perf.dynScale || 1)).toFixed(2)}  chunks ${world.chunks.size}\npreset ${S.preset}${S.gpu ? '\n' + S.gpu.slice(0, 40) : ''}`);
}

// ---------------------------------------------------------------------
// SCREENS
// ---------------------------------------------------------------------
const SCREENS = {};
function carCard(spec, opts = {}) {
  const st = opts.stats || carStats(applyBuild(spec, opts.up || {}, defaultTune(spec))); const pi = opts.pi ?? spec.pi; const cls = piClass(pi);
  return h('div', { class: 'carcard' },
    h('div', { class: 'cc-top' }, h('span', { class: 'pi', style: { background: CLASS_COLORS[cls] } }, cls + ' ' + pi), h('span', { class: 'cat' }, CAT_INFO[spec.cat]?.name || spec.cat)),
    h('div', { class: 'cc-name' }, h('small', {}, spec.year + ' ' + spec.make), h('b', {}, spec.model || spec.name)),
    h('div', { class: 'cc-spec' }, `${Math.round(spec.hp)} hp · ${Math.round(spec.mass)} kg · ${spec.drive} · ${spec.eng}${spec.asp !== 'NA' && spec.asp !== 'EV' ? ' ' + spec.asp : ''}`),
    statBars(st), opts.extra || null);
}
function statBars(st) { return h('div', { class: 'stats' }, [['Speed', st.speed], ['Handling', st.handling], ['Acceleration', st.accel], ['Launch', st.launch], ['Braking', st.braking], ['Offroad', st.offroad]].map(([n, v]) => h('div', { class: 'stat' }, h('span', {}, n), h('div', { class: 'sbar' }, h('i', { style: { width: clamp(v * 10, 0, 100) + '%' } })), h('b', {}, (+v).toFixed(1))))); }
function confirmBox(title, text, yes, no) { UI.open('confirm', { title, text, yes, no }); }
SCREENS.confirm = {
  cls: 'panel modal', render(top) { const o = top.opts; return panel(o.title, '', h('p', {}, o.text), h('div', { class: 'brow' }, btn(o.yesLabel || 'Confirm', () => { UI.back(); o.yes && o.yes(); }, { autofocus: true }), btn('Cancel', () => { UI.back(); o.no && o.no(); })), footer([['ok', 'Select'], ['back', 'Cancel']])); },
};

// ---- title ----
SCREENS.title = {
  cls: 'title', noBack: true,
  render(top) {
    const slots = []; for (let i = 0; i < SLOT_COUNT; i++) slots.push(slotSummary(i));
    const wrap = h('div', { class: 'titlewrap' },
      h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'FORZA'), h('div', { class: 'l2' }, 'HORIZON 6'), h('div', { class: 'l3' }, 'UNOFFICIAL FAN TRIBUTE · ISLA HORIZONTE')),
      h('div', { class: 'slots' }, slots.map((s, i) => h('div', { class: 'slot' },
        s ? btn(`Slot ${i + 1}: ${s.name}`, () => { if (loadSlot(i)) { mode = 'free'; if (!P.introDone) UI.open('intro'); else enterWorld(); } else toast('Save is corrupted', 'warn'); }, { autofocus: i === 0, sub: `Level ${s.level} · ${fmtCR(s.credits)} · ${s.cars} cars · ${fmtTime(s.played || 0).split('.')[0]} played · ${new Date(s.saved || Date.now()).toLocaleDateString()}` })
          : btn(`Slot ${i + 1}: New Game`, () => UI.open('newGame', { slot: i }), { autofocus: i === 0 && !slots[0], sub: 'Start a new festival career' }),
        h('div', { class: 'slotops' }, s ? btn('Export', () => exportSlot(i), { cls: 'small' }) : null, btn('Import', () => importSlot(i, () => UI.refresh()), { cls: 'small' }), s ? btn('Delete', () => confirmBox('Delete save?', `Slot ${i + 1} (${s.name}) will be permanently deleted.`, () => { localStorage.removeItem(slotKey(i)); UI.refresh(); }), { cls: 'small danger' }) : null)))),
      h('div', { class: 'brow' }, btn('Settings', () => UI.open('settings')), btn('Help & Controls', () => UI.open('help')), btn('Credits', () => UI.open('credits'))),
      h('div', { class: 'tip' }, audio.ready ? '' : 'Tip: click or press any key to enable sound.'),
      h('div', { class: 'ver' }, 'v' + VERSION + ' · Not affiliated with Microsoft, Xbox Game Studios or Playground Games'));
    return wrap;
  },
};
SCREENS.newGame = {
  cls: 'panel modal',
  render(top) {
    const inp = h('input', { type: 'text', maxlength: 16, value: top.opts.name || 'Driver', class: 'f textin', placeholder: 'Driver name' });
    const go = () => { const name = (inp.value || 'Driver').trim().slice(0, 16) || 'Driver'; P = newProfile(name); slotIdx = top.opts.slot; S.playerName = name; saveSettings(); UI.closeAll(); UI.open('intro'); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') { inp.blur(); } });
    setTimeout(() => inp.focus(), 50);
    return panel('New Festival Career', 'Slot ' + (top.opts.slot + 1), h('label', { class: 'lbl' }, 'Your driver name'), inp,
      h('div', { class: 'brow' }, btn('Start', go, { autofocus: false }), btn('Cancel', () => UI.back())), footer([['ok', 'Confirm'], ['back', 'Back']]));
  },
};
// ---- festival intro ----
const INTRO_CARDS = [
  ['WELCOME TO ISLA HORIZONTE', 'The Horizon Festival has arrived on a sun-drenched island of red-rock canyons, alpine passes, jungle rally stages, salt flats and a neon city.'],
  ['DRIVE ANYWHERE', 'Over 90 km of road plus open terrain. Find hidden shortcuts, barn finds, speed traps, danger signs and drift zones.'],
  ['BUILD YOUR COLLECTION', 'Hundreds of cars and bikes. Win races, earn credits & skill points, then upgrade, tune and paint your rides.'],
  ['DRIVE TOGETHER', 'Open the Online menu to host or join a lobby with a room code, convoy with friends and race head-to-head.'],
];
SCREENS.intro = {
  cls: 'intro', noBack: true,
  render(top) {
    mode = 'intro'; const step = top.step || 0;
    if (step < INTRO_CARDS.length) { const [t, s] = INTRO_CARDS[step]; return h('div', { class: 'introcard' }, h('div', { class: 'ititle' }, t), h('div', { class: 'isub' }, s), h('div', { class: 'brow' }, btn(step < INTRO_CARDS.length - 1 ? 'Continue' : 'Choose your first car', () => { top.step = step + 1; UI.render(); }, { autofocus: true }), btn('Skip intro', () => { top.step = INTRO_CARDS.length; UI.render(); })), h('div', { class: 'dots' }, INTRO_CARDS.map((_, i) => h('i', { class: i === step ? 'on' : '' })))); }
    const ids = starterIds();
    return h('div', { class: 'introcars' }, h('div', { class: 'ititle' }, 'CHOOSE YOUR FIRST CAR'), h('div', { class: 'cards' }, ids.map((id, i) => h('div', { class: 'pick' }, carCard(CARS[id]), btn('Drive this ' + (CAT_INFO[CARS[id].cat]?.name || ''), () => {
      const c = addCar(id); P.current = c.uid; P.introDone = true; saveGame(true); enterWorld();
      const first = EVENTS.find((e) => e.id === 'canyonx') || EVENTS[0]; setTimeout(() => { startEvent(first); subtitle('Your first race: ' + first.name + '. Follow the racing line!', 5000); }, 600);
    }, { autofocus: i === 0 })))));
  },
};

// ---- pause menu (free roam) ----
SCREENS.pause = {
  cls: 'panel pause',
  render(top) {
    const tile = (label, sub, icon, fn, af) => btn(label, fn, { cls: 'tile', icon, sub, autofocus: af });
    const champ = seasonChamp(); const champDone = Object.keys(P.season.champDone).length;
    return panel('HORIZON FESTIVAL', `${P.character.name} · Level ${P.level} · ${fmtCR(P.credits)} · ${P.skillPts} skill points · ${world.season} season`,
      h('div', { class: 'tiles' },
        tile('Resume', 'Back to the road', '▶', () => UI.closeAll(), true),
        tile('Map', 'Events, waypoints, fast travel', '🗺', () => UI.replace('map')),
        tile('Career', 'Stats, roads, accolades, championship', '🏆', () => UI.open('career')),
        tile('Garage', `${P.cars.length} cars · swap, sell, favourite`, '🚗', () => UI.open('garage')),
        tile('Upgrades & Tuning', 'Performance parts, tuning setup', '🔧', () => UI.open('upgrade')),
        tile('Livery & Wheels', 'Paint, decals, rims, tint', '🎨', () => UI.open('livery')),
        tile('Car Mastery', 'Spend skill points', '⭐', () => UI.open('mastery')),
        tile('Autoshow', 'Buy new cars', '🏬', () => UI.open('dealer')),
        tile('Auction House', 'Bid on rare cars', '🔨', () => UI.open('auction')),
        tile('Wheelspin', `${P.wheelspins} spins · ${P.superWheelspins} super`, '🎰', () => UI.open('wheelspin')),
        tile('Online', net.inSession() ? `In room ${net.room} · ${net.peers.size + 1} players` : 'Host or join a lobby', '🌐', () => UI.open('online')),
        tile('Seasonal Championship', `${champDone}/${champ.length} complete · ${P.season.points} pts`, '❄', () => UI.open('season')),
        tile('Photo Mode', 'Free camera, filters', '📷', () => { UI.closeAll(); photo.enter(); }),
        tile('Photo Album', 'Your photos', '🖼', () => UI.open('album')),
        tile('Leaderboards', 'Rivals & ghost times', '🏁', () => UI.open('leaderboard')),
        tile('Character & Festival', 'Outfit, horn, festival style', '👤', () => UI.open('character')),
        tile('Settings', 'Video, audio, controls, assists', '⚙', () => UI.open('settings')),
        tile('Help', 'Controls and systems', '❓', () => UI.open('help')),
        tile('Save Game', 'Slot ' + (slotIdx + 1), '💾', () => { saveGame(); }),
        tile('Quit to Title', 'Saves first', '⏏', () => confirmBox('Quit to title?', 'Your progress will be saved.', () => quitToTitle())),
      ), footer([['ok', 'Select'], ['back', 'Resume']]));
  },
};
function quitToTitle() {
  saveGame(true); if (activeEvent) endEvent(); net.leave(); UI.closeAll(); clearWaypoint();
  if (playerModel) { scene.remove(playerModel.group); playerModel.dispose(); playerModel = null; } if (playerVoice) { playerVoice.stop(); playerVoice = null; }
  player = null; P = null; mode = 'title'; hudShow(false); world.traffic.clear && world.traffic.clear(); UI.open('title');
}
SCREENS.pauseEvent = {
  cls: 'panel modal',
  render() { const ev = activeEvent; return panel(ev ? ev.name : 'Event', ev ? EVENT_TYPES[ev.type]?.name : '', h('div', { class: 'col' },
    btn('Resume', () => UI.closeAll(), { autofocus: true }),
    ev && !ev.online ? btn('Restart Event', () => { const d = ev.def; UI.closeAll(); exitEventToFreeRoam(false); startEvent(d); }) : null,
    btn('Quit Event', () => confirmBox('Quit event?', 'You will forfeit this event.', () => exitEventToFreeRoam(true))),
    btn('Settings', () => UI.open('settings')), btn('Help', () => UI.open('help'))), footer([['ok', 'Select'], ['back', 'Resume']])); },
};
// ---- event card ----
SCREENS.eventCard = {
  cls: 'panel modal wide',
  render(top) {
    const ev = top.opts.ev; const rec = P.events[ev.id] || {}; const T = EVENT_TYPES[ev.type] || {}; const lb = ghostBoard.list(ev.id).slice(0, 6);
    const champ = seasonChamp().includes(ev.id);
    return panel((EV_ICON[ev.type] || '') + ' ' + ev.name, `${T.name} · ${ev.region}${ev.line ? ' · ' + (ev.line.len * ev.laps / 1000).toFixed(1) + ' km' : ''}${ev.laps > 1 ? ' · ' + ev.laps + ' laps' : ''}${champ ? ' · ❄ SEASONAL' : ''}`,
      h('div', { class: 'evcols' },
        h('div', {}, h('p', {}, ev.desc || ''), h('div', { class: 'kv' }, h('span', {}, 'Rewards'), h('b', {}, `${fmtCR(ev.reward)} · ${ev.xp} XP${rec.won ? '' : ' · Wheelspin on first win'}`)),
          h('div', { class: 'kv' }, h('span', {}, 'Your best'), h('b', {}, rec.best ? ordinal(rec.best) + (rec.time ? ' · ' + fmtTime(rec.time) : '') + (rec.score ? ' · ' + rec.score.toLocaleString() + ' pts' : '') : '—')),
          h('div', { class: 'kv' }, h('span', {}, 'Your car'), h('b', {}, CARS[playerRec.id].name + ' · ' + piClass(player.p.pi) + ' ' + player.p.pi)),
          ['road', 'dirt', 'cross', 'street', 'stadium'].includes(ev.type) ? slider('Drivatars', () => S.aiCount, (v) => { S.aiCount = v; saveSettings(); }, 0, 11, 1) : null,
          ['road', 'dirt', 'cross', 'street', 'stadium', 'drag', 'showcase'].includes(ev.type) ? choice('Difficulty', [[0, 'New Racer'], [1, 'Novice'], [2, 'Average'], [3, 'Above Average'], [4, 'Highly Skilled'], [5, 'Expert'], [6, 'Unbeatable']], () => S.difficulty, (v) => { S.difficulty = v; saveSettings(); }) : null,
          choice('Weather', [['current', 'Current'], ['clear', 'Clear'], ['overcast', 'Overcast'], ['rain', 'Rain'], ['storm', 'Storm'], ['fog', 'Fog'], ['snow', 'Snow']], () => top.weather || 'current', (v) => { top.weather = v; })),
        h('div', { class: 'lb' }, h('h3', {}, 'Leaderboard'), lb.length ? lb.map((r, i) => h('div', { class: 'lbrow' + (r.ghost ? ' ghost' : '') }, h('span', {}, `${i + 1}. ${r.name}`), h('b', {}, fmtTime(r.time)))) : h('p', { class: 'small' }, 'No times yet'))),
      h('div', { class: 'brow' }, btn('Start Event', () => { startEvent(ev, { weather: top.weather && top.weather !== 'current' ? top.weather : null }); }, { autofocus: true }),
        net.inSession() && net.isHost ? btn('Start for Lobby', () => { UI.closeAll(); net.startSyncEvent(ev, top.weather); }) : null,
        btn('Set GPS', () => { setWaypoint(ev.start.x, ev.start.z, ev.name); UI.closeAll(); }), btn('Cancel', () => UI.back())), footer([['ok', 'Select'], ['back', 'Back']]));
  },
};
// ---- results ----
SCREENS.results = {
  cls: 'panel modal wide', noBack: true,
  render(top) {
    const r = top.opts.ev.results; const ev = top.opts.ev;
    return panel(r.won ? 'VICTORY' : r.place ? ordinal(r.place) + ' PLACE' : 'COMPLETE', ev.name,
      h('div', { class: 'evcols' },
        h('div', { class: 'restable' }, r.rows.length > 1 ? r.rows.map((x, i) => h('div', { class: 'lbrow' + (x.isPlayer ? ' me' : '') }, h('span', {}, `${i + 1}. ${x.name}`), h('small', {}, x.car), h('b', {}, fmtTime(x.time)))) : h('div', { class: 'big' }, r.score != null && ev.type !== 'showcase' ? Math.round(r.score).toLocaleString() + ' pts' : fmtTime(ev.player.time || ev.t))),
        h('div', { class: 'rewards' }, h('div', { class: 'rw' }, h('span', {}, 'Credits'), h('b', {}, '+' + fmtCR(r.cr))), h('div', { class: 'rw' }, h('span', {}, 'XP'), h('b', {}, '+' + r.xp)), r.spins ? h('div', { class: 'rw gold' }, h('span', {}, 'First win'), h('b', {}, '+1 Wheelspin')) : null, r.sp ? h('div', { class: 'rw' }, h('span', {}, 'Season points'), h('b', {}, '+' + r.sp)) : null, ev.cleanRacing && r.rows.length > 1 ? h('div', { class: 'rw' }, h('span', {}, 'Clean racing'), h('b', {}, '✓')) : null, h('div', { class: 'rw' }, h('span', {}, 'Balance'), h('b', {}, fmtCR(P.credits))))),
      h('div', { class: 'brow' }, btn('Continue', () => { UI.closeAll(); exitEventToFreeRoam(true); }, { autofocus: true }), !ev.online ? btn('Restart', () => { const d = ev.def; UI.closeAll(); exitEventToFreeRoam(false); startEvent(d); }) : null, btn('Watch Replay', () => { UI.closeAll(); replay.enter(); replay.afterResults = ev; }), r.spins ? btn('Wheelspin now', () => { UI.open('wheelspin'); }) : null), footer([['ok', 'Select']]));
  },
};
SCREENS.help = {
  cls: 'panel', tabs: ['Controls', 'Driving', 'Progression', 'Online', 'Troubleshooting'],
  render(top) {
    const kb = (a) => input.bindingLabel(a, 'key'); const pd = (a) => input.bindingLabel(a, 'pad');
    const rows = (list) => h('div', { class: 'helpgrid' }, list.map(([a, b, c]) => h('div', { class: 'hrow' }, h('span', {}, a), h('kbd', {}, b), c ? h('kbd', {}, c) : h('span'))));
    const T = [
      () => rows(ACTIONS.map(([a, n]) => [n, kb(a) || '—', pd(a) || '—']).concat([['Start event (near beacon)', 'Enter', 'Y'], ['Quick chat options', '1 – 8', 'Right stick'], ['Performance overlay', 'F3', ''], ['Help', 'F1', '']])),
      () => h('div', { class: 'helptext' }, h('p', {}, 'The car uses a full four-wheel simulation: tyre slip curves with load sensitivity, weight transfer, suspension, gearbox and clutch, turbo lag, differentials, aero downforce, tyre temperature and wear, and brake fade.'), h('p', {}, 'Surfaces matter: tarmac grips best, dirt and gravel are loose, sand and snow are slow, and standing water in the rain can aquaplane you. Rally and off-road tyres work better off the tarmac.'), h('p', {}, 'Assists (Settings → Assists): ABS, traction control, stability, steering and braking assist, auto-brake, racing line (full / braking only / off), shifting (auto / manual / manual with clutch), damage (off / cosmetic / simulation) and rewind.'), h('p', {}, 'Keyboard steering is speed-sensitive and ramps in smoothly. Gamepad triggers are analog; tune deadzones, saturation and steering linearity in Settings → Controls.'), h('p', {}, 'Hold rewind to go back up to 10 seconds. Reset puts you back on the nearest road.')),
      () => h('div', { class: 'helptext' }, h('p', {}, 'Skill chains: drift, near misses, air, jumps, smashing scenery and speed all add to your chain and raise the multiplier. Keep it going — the chain banks after a few calm seconds and breaks if you crash.'), h('p', {}, 'Every 15,000 banked skill points earns a skill point to spend in Car Mastery. Levelling up awards Wheelspins.'), h('p', {}, 'Events are marked by coloured light beacons. PR stunts (speed traps, speed zones, drift zones, danger signs and trailblazers) award up to three stars. Barn finds are hidden around the island — the map shows rumour search areas.'), h('p', {}, 'Spend credits at the Autoshow or Auction House, then visit Upgrades & Tuning and Livery to make the car yours.')),
      () => h('div', { class: 'helptext' }, h('p', {}, 'Online uses WebRTC data channels through a free public signaling relay. Host a room to get a 5-letter code, share it, and friends can join by code or from the lobby browser.'), h('p', {}, 'In a session: convoy freely, start synchronous races from an event card, start a drift train, or a co-op showcase. Ghost mode disables collisions with other players.'), h('p', {}, 'Two tabs in the same browser can always connect locally. If WebRTC is blocked on your network, the game falls back to a shared ghost leaderboard so you can still compare times.')),
      () => h('div', { class: 'helptext' }, h('p', {}, 'Low frame rate? Settings → Video → Preset: Low, or enable adaptive resolution. Shadows, draw distance, post effects and traffic are the biggest costs.'), h('p', {}, 'No sound? Click or press any key — browsers require a gesture before audio can start.'), h('p', {}, 'If the world is still streaming you will see “Loading area…” and the car is held in place until terrain is ready.'), h('p', {}, 'Saves are kept in your browser (3 slots). Use Export on the title screen to back them up to a file.')),
    ];
    return panel('Help', 'Everything you need to know', tabsBar(this, top), T[top.tab](), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['back', 'Back']]));
  },
};
SCREENS.credits = {
  cls: 'panel modal',
  render() { return panel('Credits', 'FORZA HORIZON 6 — unofficial fan tribute', h('div', { class: 'credits' }, ...[['Design, code, physics, procedural art & audio', 'Built with Perplexity Computer'], ['Engine', 'Three.js (MIT) · WebGL · Web Audio · Gamepad API · WebRTC (PeerJS, MIT)'], ['Content', 'All cars, makes, places and music are fictional and procedurally generated.'], ['Disclaimer', 'Forza and Forza Horizon are trademarks of Microsoft Corporation. This is a non-commercial fan project and is not affiliated with or endorsed by Microsoft, Xbox Game Studios or Playground Games.'], ['Thanks', 'To everyone who loves driving games.']].map(([a, b]) => h('div', { class: 'cr-row' }, h('small', {}, a), h('div', {}, b)))), h('div', { class: 'brow' }, btn('Back', () => UI.back(), { autofocus: true })), footer([['back', 'Back']])); },
};

// ---- map ----
const MAP_FILTERS = { events: true, stunts: true, barns: true, players: true, roads: false };
SCREENS.map = {
  cls: 'panel mapscreen',
  render(top) {
    if (!top.cur) { top.cur = { x: player.pos.x, z: player.pos.z }; top.zoom = 1.6; top.panX = player.pos.x; top.panZ = player.pos.z; }
    const cv = h('canvas', { class: 'f mapcv', width: 1000, height: 700, onclick: (e) => { if (e.isTrusted && e.clientX) { const r = cv.getBoundingClientRect(); const [x, z] = this.toWorld(top, cv, (e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height); top.cur = { x, z }; } this.select(top); } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); top.zoom = clamp(top.zoom * (e.deltaY > 0 ? 0.85 : 1.18), 0.5, 12); }, { passive: false });
    let drag = null; cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: top.panX, pz: top.panZ, moved: false }; }); addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('pointermove', (e) => { if (!drag || !(e.buttons & 1)) return; const r = cv.getBoundingClientRect(); const mpp = (WORLD_HALF * 2) / (cv.width * top.zoom) * (cv.width / r.width); top.panX = drag.px - (e.clientX - drag.x) * mpp; top.panZ = drag.pz - (e.clientY - drag.y) * mpp; });
    top.cv = cv;
    const info = h('div', { class: 'mapinfo' }); top.info = info;
    const filt = h('div', { class: 'mapfilters' }, Object.keys(MAP_FILTERS).map((k) => toggle(k[0].toUpperCase() + k.slice(1), () => MAP_FILTERS[k], (v) => { MAP_FILTERS[k] = v; })));
    return panel('Map', `Roads discovered ${(roadPercent() * 100).toFixed(1)}% · ${world.totalRoadKm.toFixed(0)} km total`, h('div', { class: 'maplayout' }, cv, h('div', { class: 'mapside' }, info, filt, btn('Clear GPS', () => { clearWaypoint(); UI.closeAll(); }), btn('Fast travel to Festival', () => fastTravel(0, 30, 'Horizon Festival')))), footer([['ok', 'Set waypoint / start'], ['alt', 'Fast travel here'], ['tabL', 'Zoom out'], ['tabR', 'Zoom in'], ['back', 'Close']]));
  },
  toWorld(top, cv, px, py) { const W = cv.width, H = cv.height; const mpp = (WORLD_HALF * 2) / (W * top.zoom); return [top.panX + (px - W / 2) * mpp, top.panZ + (py - H / 2) * mpp]; },
  toPx(top, cv, x, z) { const W = cv.width, H = cv.height; const mpp = (WORLD_HALF * 2) / (W * top.zoom); return [W / 2 + (x - top.panX) / mpp, H / 2 + (z - top.panZ) / mpp]; },
  onDir(top, d) { if (UI.focus !== top.cv) return false; const mpp = (WORLD_HALF * 2) / (top.cv.width * top.zoom); const step = 40 * mpp; if (d === 'left') top.cur.x -= step; if (d === 'right') top.cur.x += step; if (d === 'up') top.cur.z -= step; if (d === 'down') top.cur.z += step; return true; },
  hover(top) { let best = null, bd = (14 * (WORLD_HALF * 2) / (top.cv.width * top.zoom)) ** 2; const c = top.cur; const test = (x, z, o) => { const d = (x - c.x) ** 2 + (z - c.z) ** 2; if (d < bd) { bd = d; best = o; } }; if (MAP_FILTERS.events) for (const ev of EVENTS) test(ev.start.x, ev.start.z, { kind: 'event', ev, x: ev.start.x, z: ev.start.z }); if (MAP_FILTERS.stunts) { for (const t of STUNTS.traps) test(t.x, t.z, { kind: 'trap', t, x: t.x, z: t.z }); for (const t of STUNTS.zones) test(t.a.x, t.a.z, { kind: 'zone', t, x: t.a.x, z: t.a.z }); for (const t of STUNTS.drift) test(t.a.x, t.a.z, { kind: 'drift', t, x: t.a.x, z: t.a.z }); for (const t of STUNTS.danger) test(t.x, t.z, { kind: 'danger', t, x: t.x, z: t.z }); for (const t of STUNTS.trails) test(t.x, t.z, { kind: 'trail', t, x: t.x, z: t.z }); } return best; },
  select(top) { const hv = this.hover(top); if (hv && hv.kind === 'event') { UI.open('eventCard', { ev: hv.ev }); return; } const x = hv ? hv.x : top.cur.x, z = hv ? hv.z : top.cur.z; setWaypoint(x, z, hv ? (hv.ev?.name || hv.t?.name) : 'Waypoint'); UI.closeAll(); },
  onAlt(top) { const hv = this.hover(top); if (!hv) { toast('Fast travel needs an event or stunt location — move the cursor onto an icon', 'warn'); return; } fastTravel(hv.x + 12, hv.z + 12, hv.ev?.name || hv.t?.name); },
  update(top) {
    if (!top.cv) return; if (input.menuPressed('tabL')) top.zoom = clamp(top.zoom * 0.8, 0.5, 12); if (input.menuPressed('tabR')) top.zoom = clamp(top.zoom * 1.25, 0.5, 12);
    const pad = input.pad(); if (pad && UI.focus === top.cv) { const mpp = (WORLD_HALF * 2) / (top.cv.width * top.zoom); const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0; if (Math.hypot(ax, ay) > 0.2) { top.cur.x += ax * mpp * 8; top.cur.z += ay * mpp * 8; } }
    // keep cursor in view
    const [cx, cy] = this.toPx(top, top.cv, top.cur.x, top.cur.z); const W = top.cv.width, H = top.cv.height; const mpp = (WORLD_HALF * 2) / (W * top.zoom); if (cx < 80) top.panX -= (80 - cx) * mpp; if (cx > W - 80) top.panX += (cx - W + 80) * mpp; if (cy < 80) top.panZ -= (80 - cy) * mpp; if (cy > H - 80) top.panZ += (cy - H + 80) * mpp;
    drawMap(top, this); const hv = this.hover(top);
    const html = hv ? (hv.kind === 'event' ? `<b>${EV_ICON[hv.ev.type] || ''} ${hv.ev.name}</b><br>${EVENT_TYPES[hv.ev.type]?.name}<br>${hv.ev.region}<br>${P.events[hv.ev.id]?.won ? '✓ Won' : P.events[hv.ev.id] ? 'Best: ' + ordinal(P.events[hv.ev.id].best) : 'Not attempted'}` : `<b>${hv.t.name}</b><br>${hv.kind === 'trap' ? 'Best ' + (P.traps[hv.t.id] ? fmtSpeed(P.traps[hv.t.id]) : '—') + ' · target ' + fmtSpeed(hv.t.target) : hv.kind === 'zone' ? 'Best ' + (P.zones[hv.t.id] ? fmtSpeed(P.zones[hv.t.id]) : '—') : hv.kind === 'drift' ? 'Best ' + (P.driftz[hv.t.id] || 0).toLocaleString() + ' pts' : hv.kind === 'danger' ? 'Best ' + (P.danger[hv.t.id] ? fmtDist(P.danger[hv.t.id]) : '—') + ' · target ' + fmtDist(hv.t.target) : 'Best ' + (P.trails[hv.t.id] ? fmtTime(P.trails[hv.t.id]) : '—')}`) : `<b>${world.regionName(top.cur.x, top.cur.z)}</b><br>${Math.round(top.cur.x)}, ${Math.round(top.cur.z)}`;
    if (top.info.__h !== html) { top.info.__h = html; top.info.innerHTML = html; }
  },
};
function drawMap(top, sc) {
  const cv = top.cv; const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.fillStyle = '#0d2a40'; g.fillRect(0, 0, W, H);
  const [x0, y0] = sc.toPx(top, cv, -WORLD_HALF, -WORLD_HALF); const [x1, y1] = sc.toPx(top, cv, WORLD_HALF, WORLD_HALF); g.imageSmoothingEnabled = true; g.drawImage(mapCanvas, x0, y0, x1 - x0, y1 - y0);
  const P2 = (x, z) => sc.toPx(top, cv, x, z);
  if (MAP_FILTERS.roads) { g.strokeStyle = '#22c7ff'; g.lineWidth = 3; for (const e of world.edges) { const s = P.roads[e.id]; if (!s) continue; const bins = s.length; for (let b = 0; b < bins; b++) { if (s[b] !== '1') continue; const i0 = Math.floor(b * 50 / e.len * (e.n - 1)), i1 = Math.min(e.n - 1, Math.floor((b + 1) * 50 / e.len * (e.n - 1))); g.beginPath(); for (let i = i0; i <= i1; i++) { const [px, py] = P2(e.xs[i], e.zs[i]); i === i0 ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke(); } } }
  if (gpsRoute && gpsRoute.pts) { g.strokeStyle = '#22c7ff'; g.lineWidth = 4; g.beginPath(); gpsRoute.pts.forEach((p, i) => { const [px, py] = P2(p[0], p[2]); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
  const icon = (x, z, txt, col, r = 11) => { const [px, py] = P2(x, z); if (px < -20 || py < -20 || px > W + 20 || py > H + 20) return; g.fillStyle = col; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.font = `${r * 1.1}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, px, py + 1); };
  if (MAP_FILTERS.barns) for (const b of BARNS) { if (P.barns.includes(b.i)) { icon(b.x, b.z, '🏚', '#6b3a22', 9); continue; } const ox = Math.sin(b.i * 12.9) * 160, oz = Math.cos(b.i * 7.3) * 160; const [px, py] = P2(b.x + ox, b.z + oz); const rr = 260 / ((WORLD_HALF * 2) / (W * top.zoom)); g.strokeStyle = 'rgba(255,200,80,0.8)'; g.setLineDash([6, 5]); g.lineWidth = 2; g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,200,80,0.9)'; g.font = '12px sans-serif'; g.fillText('Barn rumour', px, py); }
  if (MAP_FILTERS.stunts) { for (const t of STUNTS.traps) icon(t.x, t.z, '📷', '#e01870', 8); for (const t of STUNTS.zones) icon(t.a.x, t.a.z, '⏩', '#ff7a00', 8); for (const t of STUNTS.drift) icon(t.a.x, t.a.z, '〰', '#8a2be2', 8); for (const t of STUNTS.danger) icon(t.x, t.z, '⚠', '#d4a800', 8); for (const t of STUNTS.trails) icon(t.x, t.z, '🔷', '#1e90ff', 8); }
  if (MAP_FILTERS.events) for (const ev of EVENTS) { const won = P.events[ev.id]?.won; icon(ev.start.x, ev.start.z, EV_ICON[ev.type] || '●', won ? '#2a8a4a' : (EVENT_TYPES[ev.type]?.color || '#ff2e88'), 12); }
  icon(0, -90, '🎪', '#ff2e88', 15);
  if (MAP_FILTERS.players) for (const rm of net.remoteList()) if (rm.veh) icon(rm.veh.pos.x, rm.veh.pos.z, '●', '#36d1ff', 8);
  if (waypoint) icon(waypoint.x, waypoint.z, '⚑', '#22c7ff', 11);
  // player
  const [ppx, ppy] = P2(player.pos.x, player.pos.z); const yaw = player.yaw(); g.save(); g.translate(ppx, ppy); g.rotate(-yaw + Math.PI); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
  // cursor
  const [cx, cy] = P2(top.cur.x, top.cur.z); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.moveTo(cx - 22, cy); g.lineTo(cx - 8, cy); g.moveTo(cx + 8, cy); g.lineTo(cx + 22, cy); g.moveTo(cx, cy - 22); g.lineTo(cx, cy - 8); g.moveTo(cx, cy + 8); g.lineTo(cx, cy + 22); g.stroke();
}
function fastTravel(x, z, name) {
  const cost = P.perks.fasttravel ? 0 : 1000; if (activeEvent) { toast('Cannot fast travel during an event', 'warn'); return; } if (P.credits < cost) { toast('Not enough credits to fast travel (' + fmtCR(cost) + ')', 'warn'); return; }
  P.credits -= cost; const o = placeOnRoad(x, z); UI.closeAll(); fade(0.8); for (let i = 0; i < 12; i++) world.stream(o.x, o.z, 50);
  player.place(o.x, o.y + player.cgh + player.p.tireR + 0.5, o.z, o.yaw); player.vel.set(0, 0, 0); camRig.init = false; rewind.clear(); skill.reset(true); toast('Fast travelled to ' + (name || 'location') + (cost ? ' (−' + fmtCR(cost) + ')' : ''), 'gps'); net.onTeleport();
}
// ---- career ----
SCREENS.career = {
  cls: 'panel', tabs: ['Overview', 'Events', 'PR Stunts', 'Accolades'],
  render(top) {
    const st = P.stats; const kv = (a, b) => h('div', { class: 'kv' }, h('span', {}, a), h('b', {}, b));
    const T = [
      () => h('div', { class: 'grid2' }, h('div', {}, kv('Driver', P.character.name), kv('Festival level', P.level), h('div', { class: 'xpbar' }, h('i', { style: { width: (P.xp / xpForLevel(P.level) * 100) + '%' } }), h('span', {}, `${P.xp} / ${xpForLevel(P.level)} XP`)), kv('Credits', fmtCR(P.credits)), kv('Skill points', P.skillPts), kv('Cars owned', P.cars.length + ' / ' + CARS.length), kv('Barn finds', P.barns.length + ' / ' + BARNS.length), kv('Roads discovered', (roadPercent() * 100).toFixed(1) + '%'), kv('Time played', fmtTime(P.played).split('.')[0])),
        h('div', {}, kv('Distance driven', S.units === 'imperial' ? (st.distance / 1609).toFixed(1) + ' mi' : (st.distance / 1000).toFixed(1) + ' km'), kv('Races', st.races), kv('Wins', st.wins), kv('Podiums', st.podiums), kv('Top speed', fmtSpeed(st.topSpeed || 0)), kv('Best skill chain', (st.bestChain || 0).toLocaleString()), kv('Longest jump', fmtDist(st.longestJump || 0)), kv('Objects smashed', st.smashed), kv('Credits earned', fmtCR(st.creditsEarned || 0)), kv('Photos taken', P.photos))),
      () => h('div', { class: 'list' }, EVENTS.map((ev) => { const r = P.events[ev.id]; return h('div', { class: 'lbrow' }, h('span', {}, (EV_ICON[ev.type] || '') + ' ' + ev.name), h('small', {}, EVENT_TYPES[ev.type]?.name), h('b', {}, r ? (r.won ? '🏆 ' : '') + ordinal(r.best) + (r.time ? ' · ' + fmtTime(r.time) : '') : '—')); })),
      () => h('div', { class: 'list' }, [...STUNTS.traps.map((t) => [t.name, P.traps[t.id], t.target, fmtSpeed]), ...STUNTS.zones.map((t) => [t.name, P.zones[t.id], t.target, fmtSpeed]), ...STUNTS.drift.map((t) => [t.name, P.driftz[t.id], t.target, (x) => Math.round(x).toLocaleString() + ' pts']), ...STUNTS.danger.map((t) => [t.name, P.danger[t.id], t.target, fmtDist]), ...STUNTS.trails.map((t) => [t.name, P.trails[t.id], Math.round(Math.hypot(t.bx - t.x, t.bz - t.z) / 30), fmtTime, true])].map(([n, v, tg, f, low]) => h('div', { class: 'lbrow' }, h('span', {}, n), h('small', {}, 'target ' + f(tg)), h('b', {}, v != null ? f(v) + ' ' + starStr(stars(v, tg, low)) : '☆☆☆')))),
      () => h('div', { class: 'list' }, accolades().map((a) => h('div', { class: 'lbrow' + (a.done ? ' me' : '') }, h('span', {}, (a.done ? '✓ ' : '○ ') + a.name), h('small', {}, a.desc), h('b', {}, a.prog)))),
    ];
    return panel('Career', `${P.character.name} · ${P.festival.name}`, tabsBar(this, top), T[top.tab](), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['back', 'Back']]));
  },
};
function accolades() {
  const st = P.stats; const A = [['First Victory', 'Win any event', st.wins, 1], ['Serial Winner', 'Win 10 events', st.wins, 10], ['Collector', 'Own 10 cars', P.cars.length, 10], ['Car Hoarder', 'Own 50 cars', P.cars.length, 50], ['Barn Hunter', 'Find 5 barn finds', P.barns.length, 5], ['Explorer', 'Discover 25% of roads', Math.round(roadPercent() * 100), 25], ['Road Scholar', 'Discover all roads', Math.round(roadPercent() * 100), 100], ['Wrecking Ball', 'Smash 500 objects', st.smashed, 500], ['Ton Up', 'Reach 300 km/h', Math.round(st.topSpeed || 0), 300], ['Chain Gang', 'Bank a 100,000 skill chain', st.bestChain || 0, 100000], ['Frequent Flyer', 'Jump 150 m', Math.round(st.longestJump || 0), 150], ['Shutterbug', 'Take 10 photos', P.photos, 10], ['Big Spender', 'Earn 5,000,000 CR', st.creditsEarned || 0, 5000000], ['Social Driver', 'Finish an online race', st.onlineRaces || 0, 1]];
  return A.map(([name, desc, v, t]) => ({ name, desc, done: v >= t, prog: `${Math.min(v, t).toLocaleString()} / ${t.toLocaleString()}` }));
}

// ---- garage ----
function carValue(rec) { const spec = CARS[rec.id]; let v = spec.price * 0.65; for (const k of UPGRADE_KEYS) { const lv = rec.up[k] | 0; if (lv) v += upgradeCost(k, lv) * 0.4; } return Math.round(v / 100) * 100; }
function switchCar(rec) {
  if (activeEvent) { toast('Finish or quit the event before switching cars', 'warn'); return false; }
  P.current = rec.uid; const pos = player ? player.pos.clone() : new THREE.Vector3(0, 0, 0); const yaw = player ? player.yaw() : 0;
  spawnPlayer(rec, pos.x, pos.y, pos.z, yaw); player.vel.set(0, 0, 0); net.onCarChange && net.onCarChange(); saveGame(true); return true;
}
const GARAGE_SORTS = [['recent', 'Recently added'], ['pi', 'Performance Index'], ['name', 'Name'], ['value', 'Value'], ['make', 'Manufacturer'], ['year', 'Year']];
SCREENS.garage = {
  cls: 'panel showroom', showroom: true,
  render(top) {
    top.sort = top.sort || 'recent'; top.fav = top.fav || false; top.cat = top.cat || 'all';
    let list = P.cars.slice(); if (top.fav) list = list.filter((c) => c.fav); if (top.cat !== 'all') list = list.filter((c) => CARS[c.id].cat === top.cat);
    const pi = (c) => applyBuild(CARS[c.id], c.up, c.tune).pi;
    const cmp = { recent: (a, b) => b.added - a.added, pi: (a, b) => pi(b) - pi(a), name: (a, b) => CARS[a.id].name.localeCompare(CARS[b.id].name), value: (a, b) => carValue(b) - carValue(a), make: (a, b) => CARS[a.id].make.localeCompare(CARS[b.id].make) || CARS[a.id].year - CARS[b.id].year, year: (a, b) => CARS[a.id].year - CARS[b.id].year }[top.sort];
    list.sort(cmp);
    const cats = ['all', ...new Set(P.cars.map((c) => CARS[c.id].cat))];
    const side = h('div', { class: 'col side' }); top.side = side;
    const rows = list.map((c) => { const sp = CARS[c.id]; const b = applyBuild(sp, c.up, c.tune); const el = btn(`${c.fav ? '★ ' : ''}${sp.name}`, () => { if (c.uid === P.current) { UI.closeAll(); return; } if (switchCar(c)) { toast('Now driving: ' + sp.name, 'info'); UI.refresh(); } }, { cls: 'carrow' + (c.uid === P.current ? ' cur' : ''), sub: `${b.cls} ${b.pi} · ${sp.year} · ${CAT_INFO[sp.cat]?.name}${c.uid === P.current ? ' · DRIVING' : ''}` }); el.dataset.uid = c.uid; el.addEventListener('mouseenter', () => this.preview(top, c)); return el; });
    return panel('My Cars', `${P.cars.length} cars in your garage · ${fmtCR(P.credits)}`,
      h('div', { class: 'brow' }, choice('Sort', GARAGE_SORTS, () => top.sort, (v) => { top.sort = v; UI.refresh(); }), choice('Category', cats.map((c) => [c, c === 'all' ? 'All' : CAT_INFO[c]?.name || c]), () => top.cat, (v) => { top.cat = v; UI.refresh(); }), toggle('Favourites only', () => top.fav, (v) => { top.fav = v; UI.refresh(); })),
      h('div', { class: 'split' }, h('div', { class: 'list scroll' }, rows.length ? rows : h('p', { class: 'small' }, 'No cars match these filters.')), side),
      h('div', { class: 'brow' }, btn('Upgrades', () => UI.open('upgrade')), btn('Tuning', () => UI.open('tuning')), btn('Livery', () => UI.open('livery')), btn('Car Mastery', () => UI.open('mastery'))),
      footer([['ok', 'Drive car'], ['alt', 'Toggle favourite'], ['alt2', 'Sell car'], ['back', 'Back']]));
  },
  focused(top) { const uid = UI.focus?.dataset.uid; return uid ? P.cars.find((c) => c.uid === uid) : curCar(); },
  preview(top, c) { if (!top.side || top._pv === c.uid) return; top._pv = c.uid; top.side.innerHTML = ''; const sp = CARS[c.id]; const b = applyBuild(sp, c.up, c.tune); top.side.appendChild(carCard(sp, { stats: carStats(b), pi: b.pi, extra: h('div', { class: 'small' }, `Value ${fmtCR(carValue(c))} · Odometer ${(c.odo / 1000).toFixed(1)} km · Wins ${c.wins} · Mastery ${c.mastery.length}/9${sp.barn ? ' · Barn find' : ''}`) })); },
  update(top) { const c = this.focused(top); if (c) this.preview(top, c); },
  onAlt(top) { const c = this.focused(top); if (!c) return; c.fav = !c.fav; toast(c.fav ? 'Added to favourites' : 'Removed from favourites'); UI.refresh(); },
  onAlt2(top) { const c = this.focused(top); if (!c) return; if (c.uid === P.current) { toast('You cannot sell the car you are driving', 'warn'); return; } if (P.cars.length <= 1) return; const v = carValue(c); confirmBox('Sell car', `Sell ${CARS[c.id].name} for ${fmtCR(v)}?`, () => { P.cars = P.cars.filter((x) => x !== c); P.credits += v; audio.ui('cash'); toast('Sold for ' + fmtCR(v), 'cr'); saveGame(true); UI.refresh(); }); },
};
// ---- upgrades ----
SCREENS.upgrade = {
  cls: 'panel showroom', showroom: true,
  render(top) {
    const rec = curCar(); const sp = CARS[rec.id]; const b = applyBuild(sp, rec.up, rec.tune);
    const groups = [['Engine', ['engine', 'turbo', 'intake', 'exhaust', 'cams']], ['Drivetrain', ['gearbox', 'clutch', 'drivetrain']], ['Tires & Rims', ['tires', 'tireWidth']], ['Platform & Handling', ['brakes', 'suspension', 'arb', 'weight', 'chassis']], ['Aero', ['aero']]];
    const isBike = sp.cat === 'BIKE';
    return panel('Upgrades', `${sp.name} · ${b.cls} ${b.pi} · ${fmtCR(P.credits)}`,
      h('div', { class: 'split' }, h('div', { class: 'list scroll' }, groups.map(([g, ks]) => [h('div', { class: 'lbl grp' }, g), ks.filter((k) => !(isBike && (k === 'drivetrain' || k === 'aero' || k === 'arb'))).map((k) => btn(UPGRADES[k].name, () => UI.open('upgradePick', { key: k }), { sub: UPGRADES[k].levels[rec.up[k] | 0][0] }))])),
        h('div', { class: 'col side' }, carCard(sp, { stats: carStats(b), pi: b.pi, extra: h('div', { class: 'small' }, `${b.hp} hp · ${b.nm} Nm · ${b.mass} kg · ${b.drive} · tires: ${b.tire}`) }))),
      h('div', { class: 'brow' }, btn('Tuning', () => UI.replace('tuning')), btn('Reset all to stock', () => confirmBox('Reset upgrades', 'Return every part to stock? Purchased parts stay owned and can be re-fitted for free.', () => { rec.up = {}; refreshPlayerCar(); UI.refresh(); }))),
      footer([['ok', 'Choose part'], ['back', 'Back']]));
  },
};
SCREENS.upgradePick = {
  cls: 'panel modal', showroom: true,
  render(top) {
    const rec = curCar(); const sp = CARS[rec.id]; const k = top.opts.key; const U = UPGRADES[k]; rec.own = rec.own || {}; const own = rec.own[k] || [0];
    const cur = rec.up[k] | 0; const b0 = applyBuild(sp, rec.up, rec.tune);
    return panel(U.name, sp.name + ' · ' + fmtCR(P.credits), h('div', { class: 'list' }, U.levels.map(([nm, cost], lv) => {
      const b1 = applyBuild(sp, { ...rec.up, [k]: lv }, rec.tune); const owned = lv === 0 || own.includes(lv); const d = b1.pi - b0.pi;
      return btn(nm, () => {
        if (lv === cur) { UI.back(); return; } if (!owned) { if (P.credits < cost) { toast('Not enough credits', 'warn'); audio.ui('fail'); return; } P.credits -= cost; own.push(lv); rec.own[k] = own; audio.ui('cash'); }
        rec.up[k] = lv; if (k === 'gearbox' && lv >= 2) rec.tune.gears = rec.tune.gears.slice(); refreshPlayerCar(); toast(`${U.name}: ${nm} installed`, 'info'); saveGame(true); UI.back();
      }, { cls: lv === cur ? 'cur' : '', sub: `${lv === cur ? 'INSTALLED · ' : owned ? 'Owned · ' : fmtCR(cost) + ' · '}PI ${d >= 0 ? '+' : ''}${d} → ${b1.cls} ${b1.pi}`, autofocus: lv === cur });
    })), footer([['ok', 'Buy / install'], ['back', 'Back']]));
  },
};
// ---- tuning ----
SCREENS.tuning = {
  cls: 'panel showroom', showroom: true, tabs: ['Tires', 'Gearing', 'Alignment', 'Springs', 'Damping', 'Anti-roll', 'Aero', 'Brakes', 'Differential'],
  render(top) {
    const rec = curCar(); const sp = CARS[rec.id]; const b = applyBuild(sp, rec.up, rec.tune); const t = rec.tune; const fl = b.flags;
    const ch = () => { top.dirty = 0.35; };
    const S2 = (label, key, min, max, step, fmt, dis) => slider(label, () => t[key], (v) => { t[key] = v; ch(); }, min, max, step, fmt, { disabled: dis });
    const lock = (f, part) => (!fl[f] ? h('p', { class: 'hint warn' }, `Install ${part} to adjust these settings.`) : null);
    const isAWD = b.drive === 'AWD';
    const T = [
      () => [S2('Front pressure', 'tirePF', 1.0, 3.8, 0.05, (v) => v.toFixed(2) + ' bar'), S2('Rear pressure', 'tirePR', 1.0, 3.8, 0.05, (v) => v.toFixed(2) + ' bar'), h('p', { class: 'hint' }, 'Lower pressure = more grip & slower warm-up response; higher = sharper turn-in & less rolling resistance. Ideal hot pressure ≈ 2.1 bar.')],
      () => [lock('tuneGears', 'a Race transmission'), S2('Final drive', 'finalDrive', 2.2, 6.2, 0.01, (v) => v.toFixed(2), !fl.tuneGears), ...t.gears.map((g, i) => slider('Gear ' + (i + 1), () => t.gears[i], (v) => { t.gears[i] = v; ch(); }, 0.45, 5.5, 0.01, (v) => v.toFixed(2), { disabled: !fl.tuneGears })), h('p', { class: 'hint' }, `Estimated top speed: ${fmtSpeed(estTopSpeed(b))}`)],
      () => [S2('Front camber', 'camberF', -5, 2, 0.1, (v) => v.toFixed(1) + '°'), S2('Rear camber', 'camberR', -5, 2, 0.1, (v) => v.toFixed(1) + '°'), S2('Front toe', 'toeF', -2, 2, 0.1, (v) => v.toFixed(1) + '°'), S2('Rear toe', 'toeR', -2, 2, 0.1, (v) => v.toFixed(1) + '°'), S2('Caster', 'caster', 1, 7, 0.1, (v) => v.toFixed(1) + '°')],
      () => [lock('tuneSusp', 'Street or better springs'), S2('Front springs', 'springF', 0.5, 2, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp), S2('Rear springs', 'springR', 0.5, 2, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp), S2('Front ride height', 'rideF', -0.06, 0.08, 0.005, (v) => (v * 100).toFixed(1) + ' cm', !fl.tuneSusp), S2('Rear ride height', 'rideR', -0.06, 0.08, 0.005, (v) => (v * 100).toFixed(1) + ' cm', !fl.tuneSusp)],
      () => [lock('tuneSusp', 'Street or better springs'), S2('Front rebound', 'reboundF', 0.4, 2.2, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp), S2('Rear rebound', 'reboundR', 0.4, 2.2, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp), S2('Front bump', 'bumpF', 0.4, 2.2, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp), S2('Rear bump', 'bumpR', 0.4, 2.2, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneSusp)],
      () => [lock('tuneArb', 'Sport anti-roll bars'), S2('Front ARB', 'arbF', 0.2, 2.5, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneArb), S2('Rear ARB', 'arbR', 0.2, 2.5, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneArb), h('p', { class: 'hint' }, 'Stiffer front = more understeer; stiffer rear = more oversteer.')],
      () => [lock('tuneAero', 'Race aero'), S2('Front downforce', 'aeroF', 0.4, 1.8, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneAero), S2('Rear downforce', 'aeroR', 0.4, 1.8, 0.05, (v) => (v * 100).toFixed(0) + '%', !fl.tuneAero)],
      () => [lock('tuneBrake', 'Sport brakes'), S2('Brake balance (front)', 'brakeBias', 0.4, 0.75, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneBrake), S2('Brake pressure', 'brakePressure', 0.6, 1.5, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneBrake)],
      () => [lock('tuneDiff', 'a Limited Slip Differential'), S2('Acceleration lock', 'diffAccel', 0, 1, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneDiff), S2('Deceleration lock', 'diffDecel', 0, 1, 0.01, (v) => (v * 100).toFixed(0) + '%', !fl.tuneDiff), isAWD ? S2('Center balance (rear)', 'diffCenter', 10, 90, 1, (v) => v.toFixed(0) + '%', !fl.tuneDiff) : h('p', { class: 'hint' }, 'Center differential is only available on AWD cars.')],
    ];
    return panel('Tuning', `${sp.name} · ${b.cls} ${b.pi}`, tabsBar(this, top), h('div', { class: 'split' }, h('div', { class: 'list' }, T[top.tab]()), h('div', { class: 'col side' }, statBars(carStats(b)), h('p', { class: 'small' }, `${b.hp} hp · ${b.mass} kg · ${b.drive}`))),
      h('div', { class: 'brow' }, btn('Test drive', () => UI.closeAll()), btn('Reset tune to default', () => { rec.tune = defaultTune(sp); refreshPlayerCar(); UI.refresh(); }), btn('Upgrades', () => UI.replace('upgrade'))),
      footer([['tabL', 'Prev'], ['tabR', 'Next'], ['back', 'Save & back']]));
  },
  update(top) { if (top.dirty > 0) { top.dirty -= 1 / 60; if (top.dirty <= 0) { refreshPlayerCar(); } } },
  onClose(top) { if (top.dirty > 0) refreshPlayerCar(); saveGame(true); },
};
function estTopSpeed(b) { const g = b.gears[b.gears.length - 1] * b.finalDrive; const vGear = b.limiter / 60 * 2 * Math.PI * b.tireR / g; return Math.min(vGear, b.vTop || vGear) * KMH; }
// ---- livery ----
const SWATCH = [0xffffff, 0x111111, 0x8a8f96, 0xc8102e, 0xff6a00, 0xf2b705, 0x7dff6b, 0x0a5c36, 0x00b4d8, 0x1d3f8f, 0x6a0dad, 0xff2e88, 0x5c3a21, 0xd4c5a0, 0x2b2b35, 0xb8860b];
function colorRows(label, liv, key, onCh) {
  const c = new THREE.Color(liv[key] ?? 0xffffff); const hsl = {}; c.getHSL(hsl);
  const upd = () => { liv[key] = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l).getHex(); onCh(); };
  return h('div', { class: 'colgrp' }, h('div', { class: 'lbl' }, label), h('div', { class: 'swatches' }, SWATCH.map((s) => h('span', { class: 'f sw', style: { background: hex(s) }, onclick: () => { liv[key] = s; onCh(); UI.refresh(); } }))),
    slider('Hue', () => hsl.h, (v) => { hsl.h = v; upd(); }, 0, 1, 0.01, (v) => Math.round(v * 360) + '°'), slider('Saturation', () => hsl.s, (v) => { hsl.s = v; upd(); }, 0, 1, 0.01, (v) => Math.round(v * 100) + '%'), slider('Lightness', () => hsl.l, (v) => { hsl.l = v; upd(); }, 0, 1, 0.01, (v) => Math.round(v * 100) + '%'));
}
SCREENS.livery = {
  cls: 'panel leftpanel', showroom: true, tabs: ['Paint', 'Secondary', 'Decals', 'Wheels', 'Glass & Brakes'],
  render(top) {
    const rec = curCar(); const L = rec.livery; const live = () => { top.dirty = 0.12; };
    const T = [
      () => [choice('Finish', PAINT_TYPES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), () => L.paint, (v) => { L.paint = v; live(); }), colorRows('Primary colour', L, 'color', live)],
      () => [colorRows('Secondary / rider colour', L, 'color2', live)],
      () => [choice('Decal', DECALS.map((d) => [d, d[0].toUpperCase() + d.slice(1)]), () => L.decal, (v) => { L.decal = v; live(); }), slider('Race number', () => L.number, (v) => { L.number = v; live(); }, 0, 99, 1), colorRows('Decal colour', L, 'decalColor', live)],
      () => [choice('Wheel style', WHEEL_STYLES.map((w, i) => [i, w]), () => L.wheel | 0, (v) => { L.wheel = v; live(); }), colorRows('Rim colour', L, 'rim', live)],
      () => [slider('Window tint', () => L.tint ?? 0.3, (v) => { L.tint = v; live(); }, 0, 0.95, 0.05, (v) => Math.round(v * 100) + '%'), colorRows('Brake calipers', L, 'caliper', live)],
    ];
    return panel('Livery Editor', CARS[rec.id].name, tabsBar(this, top), h('div', { class: 'list' }, T[top.tab]()), h('div', { class: 'brow' }, btn('Random design', () => { const r = Math.random; L.color = SWATCH[(r() * 16) | 0]; L.color2 = SWATCH[(r() * 16) | 0]; L.decalColor = SWATCH[(r() * 16) | 0]; L.decal = DECALS[(r() * DECALS.length) | 0]; L.paint = PAINT_TYPES[(r() * 5) | 0]; L.wheel = (r() * 8) | 0; live(); UI.refresh(); }), btn('Done', () => UI.back())), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['back', 'Save & back']]));
  },
  update(top) { if (top.dirty > 0) { top.dirty -= 1 / 60; if (top.dirty <= 0) playerModel && playerModel.setLivery(curCar().livery); } },
  onClose(top) { playerModel && playerModel.setLivery(curCar().livery); net.onCarChange && net.onCarChange(); saveGame(true); },
};
// ---- car mastery ----
const MASTERY = [
  [{ n: 'Cash Injection', d: '+5,000 CR', cost: 1, f: () => addCredits(5000, 'Mastery') }, { n: 'Fast Learner', d: '+2,000 XP', cost: 1, f: () => addXP(2000) }, { n: 'Drift Club', d: 'Global: drift skill +20%', cost: 1, f: () => { P.perks.drift = 1; } }],
  [{ n: 'Wheelspin', d: '+1 Wheelspin', cost: 2, f: () => { P.wheelspins++; } }, { n: 'Skill Bank', d: 'Global: chain bank time 3s → 4.5s', cost: 2, f: () => { P.perks.bank = 1; } }, { n: 'Sponsor Deal', d: '+15,000 CR', cost: 2, f: () => addCredits(15000, 'Mastery') }],
  [{ n: 'Super Wheelspin', d: '+1 Super Wheelspin', cost: 4, f: () => { P.superWheelspins++; } }, { n: 'Chain Master', d: 'Global: max skill multiplier ×12', cost: 4, f: () => { P.perks.mult = 1; } }, { n: 'Free Travel', d: 'Global: fast travel is free', cost: 4, f: () => { P.perks.fasttravel = 1; } }],
];
SCREENS.mastery = {
  cls: 'panel showroom', showroom: true,
  render(top) {
    const rec = curCar(); const has = (r, c) => rec.mastery.includes(r * 3 + c);
    const avail = (r, c) => r === 0 || [c - 1, c, c + 1].some((cc) => cc >= 0 && cc < 3 && has(r - 1, cc));
    return panel('Car Mastery', `${CARS[rec.id].name} · ${P.skillPts} skill points available`, h('div', { class: 'mtree' }, MASTERY.map((row, r) => h('div', { class: 'mrow' }, row.map((pk, c) => {
      const owned = has(r, c), ok = avail(r, c);
      return btn(pk.n, () => { if (owned) return; if (!ok) { toast('Unlock an adjacent perk in the row above first', 'warn'); return; } if (P.skillPts < pk.cost) { toast('Not enough skill points — earn them by banking skill chains', 'warn'); audio.ui('fail'); return; } P.skillPts -= pk.cost; rec.mastery.push(r * 3 + c); pk.f(); audio.ui('skill'); toast('Perk unlocked: ' + pk.n, 'skill'); saveGame(true); UI.refresh(); }, { cls: 'perk' + (owned ? ' owned' : ok ? '' : ' locked'), sub: `${pk.d} · ${owned ? 'UNLOCKED' : pk.cost + ' SP'}` });
    })))), h('p', { class: 'hint' }, 'Every car has its own mastery tree. Skill points come from banking big skill chains and earning PR stunt stars.'), footer([['ok', 'Unlock'], ['back', 'Back']]));
  },
};

// ---- dealership ----
const DEALER_PAGE = 30;
SCREENS.dealer = {
  cls: 'panel',
  render(top) {
    top.cat = top.cat || 'all'; top.cls = top.cls || 'all'; top.sort = top.sort || 'price'; top.make = top.make || 'all'; top.page = top.page || 0;
    let list = CARS.filter((c) => !c.barn); if (top.cat !== 'all') list = list.filter((c) => c.cat === top.cat); if (top.cls !== 'all') list = list.filter((c) => c.cls === top.cls); if (top.make !== 'all') list = list.filter((c) => c.make === top.make);
    const so = { price: (a, b) => a.price - b.price, priceD: (a, b) => b.price - a.price, pi: (a, b) => b.pi - a.pi, year: (a, b) => a.year - b.year, name: (a, b) => a.name.localeCompare(b.name) }[top.sort]; list.sort(so);
    const pages = Math.max(1, Math.ceil(list.length / DEALER_PAGE)); top.page = clamp(top.page, 0, pages - 1); const shown = list.slice(top.page * DEALER_PAGE, (top.page + 1) * DEALER_PAGE);
    const side = h('div', { class: 'col side' }); top.side = side; top._pv = null;
    const owned = new Set(P.cars.map((c) => c.id));
    const rows = shown.map((sp) => { const el = btn(sp.name, () => this.buy(sp), { cls: 'carrow', sub: `${sp.cls} ${sp.pi} · ${fmtCR(sp.price)} · ${sp.rarity}${owned.has(sp.id) ? ' · OWNED' : ''}` }); el.dataset.cid = sp.id; el.addEventListener('mouseenter', () => this.preview(top, sp)); return el; });
    const makes = ['all', ...Object.keys(MAKES)];
    return panel('Autoshow', `${list.length} cars · ${fmtCR(P.credits)}`,
      h('div', { class: 'brow' }, choice('Category', [['all', 'All'], ...Object.keys(CAT_INFO).map((k) => [k, CAT_INFO[k].name])], () => top.cat, (v) => { top.cat = v; top.page = 0; UI.refresh(); }), choice('Class', ['all', 'D', 'C', 'B', 'A', 'S1', 'S2', 'X'].map((c) => [c, c === 'all' ? 'All' : c]), () => top.cls, (v) => { top.cls = v; top.page = 0; UI.refresh(); }), choice('Make', makes.map((m) => [m, m === 'all' ? 'All' : m]), () => top.make, (v) => { top.make = v; top.page = 0; UI.refresh(); }), choice('Sort', [['price', 'Price ↑'], ['priceD', 'Price ↓'], ['pi', 'PI'], ['year', 'Year'], ['name', 'Name']], () => top.sort, (v) => { top.sort = v; UI.refresh(); })),
      h('div', { class: 'split' }, h('div', { class: 'list scroll' }, rows.length ? rows : h('p', { class: 'small' }, 'No cars match.')), side),
      h('div', { class: 'brow' }, btn('‹ Prev page', () => { top.page--; UI.refresh(); }, { disabled: top.page === 0 }), h('span', { class: 'small' }, `Page ${top.page + 1} / ${pages}`), btn('Next page ›', () => { top.page++; UI.refresh(); }, { disabled: top.page >= pages - 1 })),
      footer([['ok', 'Buy'], ['back', 'Back']]));
  },
  preview(top, sp) { if (!top.side || top._pv === sp.id) return; top._pv = sp.id; top.side.innerHTML = ''; top.side.appendChild(carCard(sp, { extra: h('div', {}, h('div', { class: 'big' }, fmtCR(sp.price)), h('div', { class: 'small' }, `${sp.rarity} · ${MAKES[sp.make]?.c || ''} · ${sp.gears.length}-speed · ${(sp.vTop * KMH).toFixed(0)} km/h est.`)) })); },
  update(top) { const id = UI.focus?.dataset.cid; if (id != null) this.preview(top, CARS[+id]); },
  buy(sp) {
    if (P.credits < sp.price) { toast(`You need ${fmtCR(sp.price - P.credits)} more`, 'warn'); audio.ui('fail'); return; }
    UI.open('confirm', { title: 'Buy car', text: `Buy the ${sp.year} ${sp.name} for ${fmtCR(sp.price)}?`, yes: () => { P.credits -= sp.price; const rec = addCar(sp.id); audio.ui('cash'); toast('Purchased ' + sp.name, 'cr'); saveGame(true); UI.open('confirm', { title: sp.name, text: 'Drive your new car now?', yesLabel: 'Drive now', yes: () => { switchCar(rec); UI.closeAll(); } }); } });
  },
};
// ---- auction house ----
const AUC_NPC = ['GearHead77', 'Vroomba', 'MotorMaven', 'ClassicCollector', 'RevLimiter', 'TorqueTwist', 'BoostedBen', 'PistonPete'];
function aucNow() { return Date.now(); }
function auctionTick(dt) {
  if (!P) return; const now = aucNow();
  // fill market
  P.listings = P.listings || []; while (P.listings.length < 10) { const pool = CARS.filter((c) => !c.barn && c.price > 15000); const sp = pool[Math.floor(Math.random() * pool.length)]; const start = Math.round(sp.price * (0.45 + Math.random() * 0.3) / 500) * 500; P.listings.push({ lid: Math.random().toString(36).slice(2, 9), carId: sp.id, bid: start, buyout: Math.round(sp.price * (1.05 + Math.random() * 0.4) / 500) * 500, ends: now + (3 + Math.random() * 12) * 60000, bidder: null, seller: AUC_NPC[Math.floor(Math.random() * AUC_NPC.length)], up: Math.random() < 0.4 ? { engine: 2, tires: 2, suspension: 2 } : {} }); }
  // NPC bidding
  for (const L of P.listings) { if (L.ends <= now) continue; const val = CARS[L.carId].price; if (L.bid < val * 0.95 && Math.random() < dt * 0.02) { const prevMe = L.bidder === 'me'; const nb = Math.round(L.bid * 1.06 / 100) * 100; if (prevMe) { P.credits += L.bid; toast('Outbid on ' + CARS[L.carId].name + ' (' + fmtCR(L.bid) + ' refunded)', 'warn'); } L.bid = nb; L.bidder = AUC_NPC[Math.floor(Math.random() * AUC_NPC.length)]; if (L.ends - now < 30000) L.ends = now + 30000; } }
  // resolve market
  P.listings = P.listings.filter((L) => { if (L.ends > now) return true; if (L.bidder === 'me') { addCar(L.carId, { up: L.up }); toast('Auction won: ' + CARS[L.carId].name, 'gold'); } return false; });
  // player's own listings
  P.auctions = (P.auctions || []).filter((A) => { if (A.ends > now) return true; const sp = CARS[A.rec.id]; if (Math.random() < 0.85 || A.price <= sp.price * 0.7) { const fee = Math.round(A.price * 0.05); P.credits += A.price - fee; toast(`Your ${sp.name} sold for ${fmtCR(A.price)} (fee ${fmtCR(fee)})`, 'cr'); } else { P.cars.push(A.rec); toast(`Your ${sp.name} did not sell and was returned`, 'info'); } return false; });
}
SCREENS.auction = {
  cls: 'panel', tabs: ['Browse', 'Sell a car', 'My listings'],
  render(top) {
    auctionTick(0); const now = aucNow(); const tl = (t) => { const s = Math.max(0, Math.round((t - now) / 1000)); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
    const T = [
      () => P.listings.slice().sort((a, b) => a.ends - b.ends).map((L) => { const sp = CARS[L.carId]; return h('div', { class: 'aucrow' }, h('div', { class: 'col' }, h('b', {}, sp.name), h('small', {}, `${sp.cls} ${sp.pi} · seller ${L.seller}${Object.keys(L.up).length ? ' · upgraded' : ''} · ends in `, h('span', { class: 'aucT', 'data-end': L.ends }, tl(L.ends)))), h('div', { class: 'col' }, h('small', {}, 'Current bid'), h('b', {}, fmtCR(L.bid)), h('small', {}, L.bidder === 'me' ? 'You are winning' : L.bidder ? 'by ' + L.bidder : 'No bids')),
        btn('Bid ' + fmtCR(Math.round(L.bid * 1.05 / 100) * 100), () => { const nb = Math.round(L.bid * 1.05 / 100) * 100; if (L.bidder === 'me') { toast('You already hold the top bid', 'info'); return; } if (P.credits < nb) { toast('Not enough credits', 'warn'); return; } P.credits -= nb; L.bid = nb; L.bidder = 'me'; if (L.ends - now < 30000) L.ends = now + 30000; audio.ui('cash'); toast('Bid placed', 'cr'); UI.refresh(); }), btn('Buyout ' + fmtCR(L.buyout), () => { if (P.credits < L.buyout) { toast('Not enough credits', 'warn'); return; } confirmBox('Buyout', `Buy ${sp.name} now for ${fmtCR(L.buyout)}?`, () => { if (L.bidder === 'me') P.credits += L.bid; P.credits -= L.buyout; addCar(L.carId, { up: L.up }); P.listings = P.listings.filter((x) => x !== L); audio.ui('cash'); toast('Bought ' + sp.name, 'gold'); saveGame(true); UI.refresh(); }); })); }),
      () => { const cands = P.cars.filter((c) => c.uid !== P.current); return cands.length ? cands.map((c) => { const sp = CARS[c.id]; const price = Math.round(carValue(c) * 1.25 / 500) * 500; return btn(sp.name, () => confirmBox('List car', `List ${sp.name} for ${fmtCR(price)} (10 minute auction, 5% fee)?`, () => { P.cars = P.cars.filter((x) => x !== c); P.auctions.push({ rec: c, price, ends: Date.now() + 10 * 60000 }); toast('Car listed', 'info'); saveGame(true); UI.refresh(); }), { sub: `Suggested price ${fmtCR(price)}` }); }) : h('p', { class: 'small' }, 'You need a second car to sell one.'); },
      () => P.auctions.length ? P.auctions.map((A) => h('div', { class: 'aucrow' }, h('b', {}, CARS[A.rec.id].name), h('span', {}, fmtCR(A.price)), h('span', { class: 'aucT', 'data-end': A.ends }, tl(A.ends)), btn('Cancel', () => { P.auctions = P.auctions.filter((x) => x !== A); P.cars.push(A.rec); UI.refresh(); }))) : h('p', { class: 'small' }, 'You have no active listings.'),
    ];
    return panel('Auction House', fmtCR(P.credits), tabsBar(this, top), h('div', { class: 'list scroll' }, T[top.tab]()), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['ok', 'Select'], ['back', 'Back']]));
  },
  update(top) { top.t = (top.t || 0) + 1; if (top.t % 30) return; const now = aucNow(); $$('.aucT', UI.root).forEach((e) => { const s = Math.max(0, Math.round((+e.dataset.end - now) / 1000)); e.textContent = `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }); const n = P.listings.length; auctionTick(0.5); if (P.listings.length !== n || top.t % 300 === 0) UI.refresh(); },
};
// ---- wheelspin ----
function rollPrize(rnd = Math.random, superSpin = false) {
  const r = rnd(); const boost = superSpin ? 0.08 : 0;
  if (r < 0.45 - boost) { const amts = [5000, 10000, 20000, 35000, 50000, 75000, 100000, 250000, 1000000]; const w = [20, 22, 18, 12, 10, 7, 6, 3, 1]; let x = rnd() * w.reduce((a, b) => a + b), i = 0; while (x > w[i]) { x -= w[i]; i++; } return { kind: 'cr', v: amts[i], label: fmtCR(amts[i]), rarity: i >= 7 ? 'Legendary' : i >= 5 ? 'Epic' : i >= 3 ? 'Rare' : 'Common' }; }
  if (r < 0.8) { const rr = rnd(); const tier = rr < 0.02 + boost * 0.3 ? 'Legendary' : rr < 0.1 + boost ? 'Epic' : rr < 0.35 ? 'Rare' : rr < 0.65 ? 'Uncommon' : 'Common'; const pool = CARS.filter((c) => !c.barn && c.rarity === tier); const sp = pool[Math.floor(rnd() * pool.length)] || CARS[0]; return { kind: 'car', v: sp.id, label: sp.name, rarity: tier }; }
  if (r < 0.92) { const slot = rnd() < 0.5 ? 'hat' : 'top'; const i = Math.floor(rnd() * CLOTHING[slot].length); return { kind: 'cloth', slot, v: i, label: (slot === 'hat' ? 'Hat: ' : 'Top: ') + CLOTHING[slot][i], rarity: 'Uncommon' }; }
  const i = Math.floor(rnd() * HORNS.length); return { kind: 'horn', v: i, label: 'Horn: ' + HORNS[i], rarity: 'Rare' };
}
function grantPrize(p) {
  if (p.kind === 'cr') addCredits(p.v, 'Wheelspin');
  else if (p.kind === 'car') { addCar(p.v); toast('New car: ' + p.label, 'gold'); }
  else if (p.kind === 'cloth') { const L = P.unlockedClothes[p.slot]; if (L.includes(p.v)) { addCredits(5000); toast('Duplicate clothing → +' + fmtCR(5000), 'cr'); } else { L.push(p.v); toast('Unlocked ' + p.label, 'gold'); } }
  else if (p.kind === 'horn') { if (P.unlockedHorns.includes(p.v)) { addCredits(5000); } else { P.unlockedHorns.push(p.v); toast('Unlocked ' + p.label, 'gold'); } }
}
const RARITY_COL = { Common: '#9aa3ad', Uncommon: '#4caf50', Rare: '#2196f3', Epic: '#9c27b0', Legendary: '#ffb300' };
SCREENS.wheelspin = {
  cls: 'panel',
  render(top) {
    const reels = top.reels || []; top.reelEls = [];
    const reelBox = h('div', { class: 'reels' }, (reels.length ? reels : [null]).map((rl, i) => { const el = h('div', { class: 'reel' }, rl ? rl.cur.label : '— spin to win —'); if (rl) { el.style.borderColor = RARITY_COL[rl.cur.rarity]; } top.reelEls.push(el); return el; }));
    const spinning = reels.some((r) => !r.done);
    return panel('Wheelspin', `${P.wheelspins} Wheelspins · ${P.superWheelspins} Super Wheelspins`, reelBox,
      h('div', { class: 'brow' }, btn('Wheelspin', () => this.spin(top, false), { disabled: spinning || P.wheelspins < 1, autofocus: true }), btn('Super Wheelspin (3 prizes)', () => this.spin(top, true), { disabled: spinning || P.superWheelspins < 1 })),
      h('p', { class: 'hint' }, 'Earn Wheelspins by levelling up, finishing events for the first time and through Car Mastery.'), footer([['ok', 'Spin'], ['back', 'Back']]));
  },
  spin(top, sup) { if (sup) P.superWheelspins--; else P.wheelspins--; const n = sup ? 3 : 1; top.reels = []; for (let i = 0; i < n; i++) top.reels.push({ final: rollPrize(Math.random, sup), cur: rollPrize(), t: 0, dur: 2.2 + i * 0.7, tick: 0, done: false }); UI.refresh(); },
  update(top) {
    if (!top.reels) return; let changed = false;
    top.reels.forEach((r, i) => { if (r.done) return; r.t += 1 / 60; const prog = r.t / r.dur; r.tick += 1 / 60; const interval = 0.04 + prog * prog * 0.35; if (r.tick > interval) { r.tick = 0; r.cur = rollPrize(); audio.ui('move'); const el = top.reelEls[i]; if (el) { el.textContent = r.cur.label; el.style.borderColor = RARITY_COL[r.cur.rarity]; } } if (r.t >= r.dur) { r.done = true; r.cur = r.final; grantPrize(r.final); audio.ui(r.final.rarity === 'Legendary' || r.final.rarity === 'Epic' ? 'cash' : 'ok'); changed = true; } });
    if (changed && top.reels.every((r) => r.done)) { saveGame(true); UI.refresh(); top.reelEls.forEach((el, i) => el.classList.add('won')); }
  },
  onBack(top) { if (top.reels && top.reels.some((r) => !r.done)) { top.reels.forEach((r) => { if (!r.done) { r.done = true; r.cur = r.final; grantPrize(r.final); } }); saveGame(true); } },
};
// ---- seasonal championship ----
SCREENS.season = {
  cls: 'panel',
  render() {
    updateSeason(); const ids = seasonChamp(); const done = P.season.champDone || {};
    const wk = Math.floor(Date.now() / (7 * 86400000)); const msLeft = (wk + 1) * 7 * 86400000 - Date.now(); const dl = Math.floor(msLeft / 86400000), hl = Math.floor(msLeft % 86400000 / 3600000);
    return panel(`${world.season} Championship`, `Festival Playlist · ${P.season.points} season points · resets in ${dl}d ${hl}h`,
      h('p', {}, `This week the island is in ${world.season.toLowerCase()} — weather and grip change with the season. Win all three championship rounds to earn a Super Wheelspin and 50,000 CR. Each round gives 30 season points for a win, 15 for a podium.`),
      h('div', { class: 'list' }, ids.map((id, i) => { const ev = EVENTS.find((e) => e.id === id); return btn(`Round ${i + 1}: ${ev.name}`, () => { setWaypoint(ev.start.x, ev.start.z, ev.name); UI.closeAll(); }, { sub: `${EVENT_TYPES[ev.type]?.name} · ${ev.region} · ${done[id] ? '✓ Completed (' + ordinal(done[id]) + ')' : 'Not completed'} · Select to set GPS` }); })),
      h('div', { class: 'xpbar' }, h('i', { style: { width: Math.min(100, Object.keys(done).length / 3 * 100) + '%' } }), h('span', {}, `${Object.keys(done).length} / 3 rounds`)),
      footer([['ok', 'Set GPS'], ['back', 'Back']]));
  },
};
// ---- photo album ----
SCREENS.album = {
  cls: 'panel',
  render() {
    let list = []; try { list = JSON.parse(localStorage.getItem('fh6_photos') || '[]'); } catch { }
    return panel('Photo Album', `${list.length} photos (stored on this device; full-size copies download when taken)`,
      list.length ? h('div', { class: 'album' }, list.map((p, i) => h('div', { class: 'f photo', tabindex: 0, onclick: () => UI.open('photoView', { p, i }) }, h('img', { src: p.img, alt: p.car }), h('small', {}, p.car + ' · ' + new Date(p.t).toLocaleDateString())))) : h('p', {}, 'No photos yet. Press P (or D-pad right on a controller) while driving to enter Photo Mode.'),
      footer([['ok', 'View'], ['back', 'Back']]));
  },
};
SCREENS.photoView = {
  cls: 'panel modal wide', render(top) { const { p, i } = top.opts; return panel(p.car, new Date(p.t).toLocaleString(), h('img', { class: 'bigphoto', src: p.img }), h('div', { class: 'brow' }, btn('Download', () => { if (saveDownload('FH6_photo_' + p.t + '.jpg', p.img, 'image/jpeg')) toast('Photo saved', 'info'); }), btn('Delete', () => { let l = []; try { l = JSON.parse(localStorage.getItem('fh6_photos') || '[]'); } catch { } l.splice(i, 1); localStorage.setItem('fh6_photos', JSON.stringify(l)); UI.back(); UI.refresh(); }, { cls: 'danger' }), btn('Back', () => UI.back(), { autofocus: true }))); },
};
// ---- leaderboards ----
SCREENS.leaderboard = {
  cls: 'panel',
  render(top) {
    const evs = EVENTS.filter((e) => e.line && !['drift', 'arcade', 'showcase'].includes(e.type)); top.ev = top.ev || top.opts.ev || evs[0].id;
    const list = ghostBoard.list(top.ev);
    return panel('Leaderboards', 'Rivals ghost times (local + online session results)', choice('Event', evs.map((e) => [e.id, e.name]), () => top.ev, (v) => { top.ev = v; UI.refresh(); }),
      h('div', { class: 'lb' }, list.map((r, i) => h('div', { class: 'lbrow' + (r.ghost ? ' ghost' : '') + (r.name === P.character.name ? ' me' : '') }, h('span', {}, String(i + 1)), h('b', {}, r.name), h('small', {}, r.car || ''), h('span', {}, fmtTime(r.time))))),
      footer([['ok', 'Change event'], ['back', 'Back']]));
  },
};
// ---- character & festival ----
SCREENS.character = {
  cls: 'panel', tabs: ['Driver', 'Festival'],
  render(top) {
    const C = P.character, F = P.festival;
    const lockedOpts = (slot) => CLOTHING[slot].map((n, i) => [i, P.unlockedClothes[slot].includes(i) ? n : n + ' (locked)']);
    const T = [
      () => [h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Driver name'), h('input', { class: 'f textin', type: 'text', maxlength: 18, value: C.name, onchange: (e) => { C.name = e.target.value.trim().slice(0, 18) || 'Driver'; P.name = C.name; saveGame(true); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); } })),
        choice('Hat', lockedOpts('hat'), () => C.hat, (v) => { C.hat = v; }), choice('Top', lockedOpts('top'), () => C.top, (v) => { C.top = v; }), choice('Outfit colour', CLOTHING.color.map((c, i) => [i, ['Pink', 'Cyan', 'Yellow', 'Lime', 'White', 'Black', 'Orange', 'Purple'][i] || c]), () => C.color, (v) => { C.color = v; }),
        choice('Horn', HORNS.map((n, i) => [i, P.unlockedHorns.includes(i) ? n : n + ' (locked)']), () => C.horn, (v) => { C.horn = v; if (audio.ready) audio.horn(v); }),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Nameplate banner'), h('input', { class: 'f textin', type: 'text', maxlength: 16, value: C.banner, onchange: (e) => { C.banner = e.target.value.trim().toUpperCase().slice(0, 16) || 'HORIZON'; } })),
        h('div', { class: 'avatar', style: { '--c': CLOTHING.color[C.color] } }, h('div', { class: 'av-hat' }, CLOTHING.hat[C.hat]), h('div', { class: 'av-body' }, CLOTHING.top[C.top]), h('b', {}, C.name), h('small', {}, C.banner))],
      () => [h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Festival name'), h('input', { class: 'f textin', type: 'text', maxlength: 24, value: F.name, onchange: (e) => { F.name = e.target.value.trim().slice(0, 24) || 'Horizon Festival'; } })), choice('Festival colours', [[0, 'Horizon Pink'], [1, 'Electric Cyan'], [2, 'Sunset Orange'], [3, 'Jungle Green'], [4, 'Royal Purple']], () => F.color, (v) => { F.color = v; world.setFestivalColor && world.setFestivalColor(['#ff2e88', '#00e5ff', '#ff7a00', '#2fe08a', '#9b5de5'][v]); }), h('p', { class: 'hint' }, 'Festival colours re-theme the stage banners at the Horizon hub.')],
    ];
    return panel('Character & Festival', '', tabsBar(this, top), h('div', { class: 'list' }, T[top.tab]()), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['back', 'Save & back']]));
  },
  onClose() { const C = P.character; if (!P.unlockedClothes.hat.includes(C.hat)) C.hat = 0; if (!P.unlockedClothes.top.includes(C.top)) C.top = 0; if (!P.unlockedHorns.includes(C.horn)) { C.horn = 0; toast('Locked horn reset to Classic', 'warn'); } net.onCarChange && net.onCarChange(); saveGame(true); },
};

// =====================================================================
// NETCODE — host-authoritative star topology over WebRTC data channels
// (PeerJS public signalling relay) + BroadcastChannel for same-device
// tabs. Client-side prediction for the local car, host reconciliation,
// 100 ms entity interpolation, quantised binary snapshots @ 20 Hz.
// Falls back to a shared "ghost" leaderboard mode if WebRTC is blocked.
// =====================================================================
const NET_RATE = 1 / 20, INTERP_DELAY = 0.1, ROOM_ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const MSG_SNAP = 1, MSG_STATE = 2;
function encodeEntities(type, seq, list) {
  const buf = new ArrayBuffer(4 + list.length * 28); const dv = new DataView(buf); dv.setUint8(0, type); dv.setUint8(1, list.length); dv.setUint16(2, seq & 0xffff);
  let o = 4; for (const e of list) { dv.setUint8(o, e.id & 255); dv.setInt32(o + 1, Math.round(e.x * 100)); dv.setInt32(o + 5, Math.round(e.y * 100)); dv.setInt32(o + 9, Math.round(e.z * 100)); dv.setInt16(o + 13, Math.round(e.qx * 32767)); dv.setInt16(o + 15, Math.round(e.qy * 32767)); dv.setInt16(o + 17, Math.round(e.qz * 32767)); dv.setInt16(o + 19, Math.round(e.qw * 32767)); dv.setInt16(o + 21, clamp(Math.round(e.speed * 100), -32767, 32767)); dv.setUint16(o + 23, clamp(Math.round(e.rpm / 4), 0, 65535)); dv.setUint8(o + 25, e.flags & 255); dv.setUint8(o + 26, clamp(Math.round((e.steer + 1) * 127), 0, 254)); o += 28; }
  return buf;
}
function decodeEntities(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf); const type = dv.getUint8(0), n = dv.getUint8(1), seq = dv.getUint16(2); const out = []; let o = 4;
  for (let i = 0; i < n; i++) { out.push({ id: dv.getUint8(o), x: dv.getInt32(o + 1) / 100, y: dv.getInt32(o + 5) / 100, z: dv.getInt32(o + 9) / 100, qx: dv.getInt16(o + 13) / 32767, qy: dv.getInt16(o + 15) / 32767, qz: dv.getInt16(o + 17) / 32767, qw: dv.getInt16(o + 19) / 32767, speed: dv.getInt16(o + 21) / 100, rpm: dv.getUint16(o + 23) * 4, flags: dv.getUint8(o + 25), steer: dv.getUint8(o + 26) / 127 - 1 }); o += 28; }
  return { type, seq, list: out };
}
function selfEntity(id) { const v = player; return { id, x: v.pos.x, y: v.pos.y, z: v.pos.z, qx: v.quat.x, qy: v.quat.y, qz: v.quat.z, qw: v.quat.w, speed: v.speed, rpm: v.engine.rpm, steer: v.input.steer || 0, flags: (v.input.brake > 0.1 ? 1 : 0) | (playerLights && playerLights[0].intensity > 0 ? 2 : 0) | (skill.drifting ? 4 : 0) | (net.talkT > 0 ? 8 : 0) | (activeEvent ? 16 : 0) }; }
function randCode(n = 5) { let s = ''; for (let i = 0; i < n; i++) s += ROOM_ALPH[Math.floor(Math.random() * ROOM_ALPH.length)]; return s; }

const net = {
  pid: Math.random().toString(36).slice(2, 10), room: null, isHost: false, myId: 0, peers: new Map(), bc: null, peer: null, lobbyPeer: null, hostConn: null, transport: null,
  status: 'offline', seq: 0, sendT: 0, pingT: 0, clock: 0, lobbies: new Map(), meta: { type: 'Free Roam', region: 'EU', max: 8, name: '' }, ghostOnly: false, peerLib: null, ping: 0, talkT: 0, ghost: true, corrections: 0, rtcFailed: false, bytesOut: 0, bytesIn: 0, kbps: 0,
  init() {
    try { this.bc = new BroadcastChannel('fh6net'); this.bc.onmessage = (e) => this.onBC(e.data); } catch { this.bc = null; }
    this.ghost = S.ghostOnline !== false; this.region = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe').split('/')[0].replace('America', 'NA').replace('Europe', 'EU').replace('Asia', 'AS').replace('Australia', 'OC').replace('Africa', 'AF');
    this.meta.region = this.region;
  },
  inSession() { return !!this.room; },
  // ------------------------------------------------ transports
  async loadPeer() {
    if (this.peerLib) return this.peerLib; if (window.Peer) return (this.peerLib = window.Peer);
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = PEERJS_URL; s.onload = res; s.onerror = () => rej(new Error('PeerJS failed to load')); document.head.appendChild(s); setTimeout(() => rej(new Error('PeerJS load timeout')), 9000); });
    if (!window.Peer) throw new Error('PeerJS unavailable'); return (this.peerLib = window.Peer);
  },
  rtcSupported() { return typeof RTCPeerConnection !== 'undefined'; },
  makePeer(id) {
    return new Promise((res, rej) => { const Peer = this.peerLib; const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 }); const to = setTimeout(() => { rej(new Error('signalling timeout')); try { p.destroy(); } catch { } }, 9000); p.on('open', () => { clearTimeout(to); res(p); }); p.on('error', (e) => { clearTimeout(to); rej(e); }); });
  },
  degrade(reason) { this.rtcFailed = true; this.ghostOnly = true; console.warn('WebRTC unavailable:', reason); toast('Online relay unavailable — switched to Ghost Leaderboard mode', 'warn', 5000); },
  sendTo(pr, data) { try { if (pr.via === 'bc') this.bc && this.bc.postMessage({ room: this.room, from: this.pid, to: pr.pid, data }); else if (pr.conn && pr.conn.open) pr.conn.send(data); if (data instanceof ArrayBuffer) this.bytesOut += data.byteLength; else this.bytesOut += 60; } catch (e) { console.warn('send failed', e); } },
  sendHost(data) { if (this.isHost) return; if (this.hostVia === 'bc') this.bc && this.bc.postMessage({ room: this.room, from: this.pid, to: this.hostPid, data }); else if (this.hostConn && this.hostConn.open) this.hostConn.send(data); if (data instanceof ArrayBuffer) this.bytesOut += data.byteLength; else this.bytesOut += 60; },
  broadcast(data, except) { for (const pr of this.peers.values()) if (pr.pid !== except && pr.direct) this.sendTo(pr, data); },
  onBC(m) {
    if (!m || m.from === this.pid) return;
    if (m.kind === 'announce') { if (m.info.code !== this.room) this.lobbies.set(m.info.code, { ...m.info, via: 'bc', seen: performance.now(), ping: 1 }); return; }
    if (m.kind === 'ghost') { if (m.entry) ghostBoard.submit(m.entry.ev, m.entry.time, m.entry.car, m.entry.name); return; }
    if (m.to && m.to !== this.pid) return; if (m.room !== this.room && !(m.data && m.data.t === 'join')) return;
    this.onData(m.data, { via: 'bc', pid: m.from });
  },
  // ------------------------------------------------ hosting
  async host(meta = {}) {
    if (this.room) this.leave(); Object.assign(this.meta, meta); this.meta.name = P.character.name + "'s lobby";
    this.room = randCode(); this.isHost = true; this.myId = 1; this.nextId = 2; this.status = 'hosting'; this.hostPid = this.pid;
    toast('Hosting room ' + this.room, 'info');
    this.announceT = 0; this.startRTC();
    return this.room;
  },
  async startRTC() {
    if (!this.rtcSupported()) { this.degrade('no RTCPeerConnection'); return; }
    try { await this.loadPeer(); } catch (e) { this.degrade(e.message); return; }
    const code = this.room;
    try { this.peer = await this.makePeer('fh6t-room-' + code); } catch (e) { if (this.room === code) this.degrade(e.type || e.message); return; }
    if (this.room !== code) { this.peer.destroy(); return; }
    this.peer.on('connection', (c) => this.acceptConn(c)); this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { } });
    for (let i = 0; i < 16 && this.room === code; i++) { try { this.lobbyPeer = await this.makePeer('fh6t-lobby-' + i); this.lobbySlot = i; this.lobbyPeer.on('connection', (c) => { c.on('open', () => { c.send({ t: 'info', info: this.info() }); setTimeout(() => c.close(), 1500); }); }); break; } catch (e) { if (e.type !== 'unavailable-id') break; } }
    this.transport = 'webrtc'; toast('Room ' + code + ' is open to the internet (WebRTC)', 'info');
  },
  info() { return { code: this.room, name: this.meta.name, type: this.meta.type, region: this.meta.region, players: this.peers.size + 1, max: this.meta.max, host: P.character.name, ver: VERSION }; },
  acceptConn(c) {
    c.on('open', () => { this.bytesIn += 0; }); c.on('data', (d) => this.onData(d, { via: 'rtc', pid: c.peer, conn: c }));
    c.on('close', () => { const pr = [...this.peers.values()].find((p) => p.conn === c); if (pr) this.dropPeer(pr, 'left'); }); c.on('error', () => { });
  },
  // ------------------------------------------------ joining
  async join(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length < 4) { toast('Enter a valid room code', 'warn'); return false; }
    if (this.room) this.leave(); this.status = 'joining'; this.isHost = false; this.room = code; this.joinT = performance.now();
    const hello = { t: 'join', name: P.character.name, car: playerRec.id, livery: playerRec.livery, banner: P.character.banner, ver: VERSION };
    // try local tab first (instant), then WebRTC
    const lob = this.lobbies.get(code);
    if (lob && lob.via === 'bc') { this.hostVia = 'bc'; this.bc.postMessage({ room: code, from: this.pid, to: null, data: hello }); toast('Joining room ' + code + ' (local)…', 'info'); return true; }
    if (!this.rtcSupported()) { this.degrade('no RTCPeerConnection'); this.room = null; this.status = 'offline'; return false; }
    try { await this.loadPeer(); if (!this.peer) this.peer = await this.makePeer(null); } catch (e) { this.degrade(e.message || e.type); this.room = null; this.status = 'offline'; return false; }
    toast('Connecting to room ' + code + '…', 'info');
    return new Promise((res) => {
      const c = this.peer.connect('fh6t-room-' + code, { reliable: true, serialization: 'binary' }); const to = setTimeout(() => { if (this.status === 'joining') { toast('Room ' + code + ' not found or unreachable', 'warn'); this.leave(true); } res(false); }, 10000);
      c.on('open', () => { clearTimeout(to); this.hostConn = c; this.hostVia = 'rtc'; c.send(hello); res(true); });
      c.on('data', (d) => this.onData(d, { via: 'rtc', pid: c.peer, conn: c })); c.on('close', () => { if (this.room === code && !this.isHost) { toast('Disconnected from host', 'warn'); this.leave(true); } }); c.on('error', () => { });
    });
  },
  async browse() {
    // local lobbies come via BroadcastChannel announcements; internet lobbies via well-known lobby slots
    if (this.ghostOnly || !this.rtcSupported()) return;
    try { await this.loadPeer(); if (!this.peer) this.peer = await this.makePeer(null); } catch (e) { this.degrade(e.message || e.type); return; }
    for (let i = 0; i < 16; i++) { if (this.isHost && this.lobbySlot === i) continue; const t0 = performance.now(); let c; try { c = this.peer.connect('fh6t-lobby-' + i, { reliable: true }); } catch { continue; } const kill = setTimeout(() => { try { c.close(); } catch { } }, 5000); c.on('data', (d) => { if (d && d.t === 'info' && d.info && d.info.code) this.lobbies.set(d.info.code, { ...d.info, via: 'rtc', seen: performance.now(), ping: Math.round(performance.now() - t0) }); clearTimeout(kill); try { c.close(); } catch { } }); c.on('error', () => { }); }
  },
  // ------------------------------------------------ message handling
  onData(d, from) {
    if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) { this.bytesIn += d.byteLength; const pk = decodeEntities(d); if (pk.type === MSG_SNAP && !this.isHost) this.applySnap(pk); else if (pk.type === MSG_STATE && this.isHost) { const pr = this.peerByPid(from.pid); if (pr && pk.list[0]) { this.validate(pr, pk.list[0]); this.pushSnap(pr, pk.list[0]); pr.lastSeq = pk.seq; } } return; }
    if (!d || typeof d !== 'object') return; this.bytesIn += 60;
    switch (d.t) {
      case 'join': if (!this.isHost) return; {
        if (this.peers.size + 1 >= this.meta.max) { this.sendTo({ via: from.via, pid: from.pid, conn: from.conn }, { t: 'reject', why: 'Lobby full' }); return; }
        const id = this.nextId++; const pr = this.addPeer({ id, pid: from.pid, via: from.via, conn: from.conn, name: String(d.name || 'Driver').slice(0, 18), car: d.car | 0, livery: d.livery, banner: d.banner, direct: true });
        this.sendTo(pr, { t: 'welcome', id, room: this.room, meta: this.meta, roster: this.roster(), tod: world.tod, weather: world.weather.state, hostPid: this.pid });
        this.broadcast({ t: 'peer', p: this.peerInfo(pr) }, pr.pid); chatBubble('Lobby', pr.name + ' joined', false); audio.ui('ok'); break; }
      case 'welcome': this.myId = d.id; this.status = 'client'; this.hostPid = d.hostPid || from.pid; this.meta = d.meta; this.transport = from.via === 'bc' ? 'local' : 'webrtc'; for (const p of d.roster) if (p.id !== this.myId) this.addPeer({ ...p, via: from.via }); world.tod = d.tod; world.weather.set(d.weather); toast('Joined room ' + this.room + ' · ' + (d.roster.length) + ' players', 'info'); UI.top()?.name === 'online' && UI.refresh(); break;
      case 'reject': toast('Could not join: ' + d.why, 'warn'); this.leave(true); break;
      case 'peer': if (d.p.id !== this.myId && !this.peerById(d.p.id)) this.addPeer({ ...d.p, via: from.via }); chatBubble('Lobby', d.p.name + ' joined', false); break;
      case 'gone': { const pr = this.peerById(d.id); if (pr) this.dropPeer(pr, d.why || 'left', true); break; }
      case 'upd': { const pr = this.isHost ? this.peerByPid(from.pid) : this.peerById(d.id); if (!pr) return; Object.assign(pr, { car: d.car, livery: d.livery, name: d.name || pr.name, banner: d.banner }); this.rebuildModel(pr); if (this.isHost) this.broadcast({ ...d, id: pr.id }, from.pid); break; }
      case 'ping': this.sendReply(from, { t: 'pong', ts: d.ts }); break;
      case 'pong': this.ping = Math.round(performance.now() - d.ts); break;
      case 'chat': case 'horn': { const pr = this.isHost ? this.peerByPid(from.pid) : this.peerById(d.id); if (!pr) return; if (d.t === 'chat') { chatBubble(pr.name, QUICKCHAT[d.i] || '…', false); pr.talkT = 2.5; } else { pr.talkT = 1; if (audio.ready && pr.veh && pr.veh.pos.distanceTo(player.pos) < 120) audio.horn(d.style | 0); } if (this.isHost) this.broadcast({ ...d, id: pr.id }, from.pid); break; }
      case 'corr': if (!this.isHost && player && !activeEvent?.countdown) { player.pos.set(d.x, d.y, d.z); player.vel.multiplyScalar(0.5); player.savePrev(); this.corrections++; } break;
      case 'evstart': this.onRemoteEventStart(d); break;
      case 'fin': this.onFin(d, from); break;
      case 'evend': if (!this.isHost && activeEvent && activeEvent.online && !activeEvent.results) { toast('Host ended the event', 'info'); finishEvent(false); } break;
      case 'wp': if (!this.isHost && d.x != null && this.meta.type === 'Convoy') { setWaypoint(d.x, d.z, 'Convoy leader: ' + (d.name || 'waypoint')); } break;
      case 'bye': { const pr = this.peerByPid(from.pid); if (pr) this.dropPeer(pr, 'left'); if (!this.isHost && from.pid === this.hostPid) { toast('Host closed the lobby', 'warn'); this.leave(true); } break; }
      case 'tp': { const pr = this.peerByPid(from.pid); if (pr) pr.teleportOK = 40; break; }
      case 'ghostentry': if (d.entry) ghostBoard.submit(d.entry.ev, d.entry.time, d.entry.car, d.entry.name); break;
    }
  },
  sendReply(from, data) { if (from.via === 'bc') this.bc && this.bc.postMessage({ room: this.room, from: this.pid, to: from.pid, data }); else from.conn && from.conn.open && from.conn.send(data); },
  roster() { return [{ id: this.myId, name: P.character.name, car: playerRec.id, livery: playerRec.livery, banner: P.character.banner }, ...[...this.peers.values()].map((p) => this.peerInfo(p))]; },
  peerInfo(p) { return { id: p.id, name: p.name, car: p.car, livery: p.livery, banner: p.banner }; },
  peerById(id) { for (const p of this.peers.values()) if (p.id === id) return p; return null; },
  peerByPid(pid) { for (const p of this.peers.values()) if (p.pid === pid) return p; return null; },
  addPeer(o) {
    const key = o.pid || 'id' + o.id; const pr = { ...o, snaps: [], talkT: 0, lastSeen: performance.now(), veh: { pos: new THREE.Vector3(0, -999, 0), renderPos: new THREE.Vector3(0, -999, 0), quat: new THREE.Quaternion(), renderQuat: new THREE.Quaternion(), speed: 0, vel: new THREE.Vector3(), rpm: 900, flags: 0, steer: 0 }, model: null, voice: null };
    this.peers.set(key, pr); this.rebuildModel(pr); return pr;
  },
  rebuildModel(pr) { if (pr.model) { scene.remove(pr.model.group); pr.model.dispose(); } const sp = CARS[pr.car] || CARS[0]; pr.model = buildCarModel(sp, { ...(pr.livery || {}) }, { lod: true }); scene.add(pr.model.group); pr.model.group.visible = false; pr.specName = sp.name; if (pr.voice) { pr.voice.stop(); pr.voice = null; } },
  dropPeer(pr, why, silent) {
    if (pr.model) { scene.remove(pr.model.group); pr.model.dispose(); } if (pr.voice) pr.voice.stop(); for (const [k, v] of this.peers) if (v === pr) this.peers.delete(k);
    if (activeEvent && activeEvent.entrants) { const e = activeEvent.entrants.find((x) => x.remote === pr); if (e && !e.finished) { e.dnf = true; } }
    if (!silent) chatBubble('Lobby', pr.name + ' ' + why, false); if (this.isHost) this.broadcast({ t: 'gone', id: pr.id, why });
  },
  leave(silent) {
    if (this.room) { if (this.isHost) this.broadcast({ t: 'bye' }); else this.sendHost({ t: 'bye' }); }
    for (const pr of [...this.peers.values()]) this.dropPeer(pr, 'left', true); this.peers.clear();
    try { this.hostConn && this.hostConn.close(); } catch { } this.hostConn = null; try { this.lobbyPeer && this.lobbyPeer.destroy(); } catch { } this.lobbyPeer = null; this.lobbySlot = -1;
    if (this.isHost && this.peer) { try { this.peer.destroy(); } catch { } this.peer = null; }
    if (this.room && !silent) toast('Left the online session', 'info'); this.room = null; this.isHost = false; this.status = 'offline'; this.transport = null; this.myId = 0;
    if (UI.top()?.name === 'online') UI.refresh();
  },
  // ------------------------------------------------ state sync
  pushSnap(pr, e) {
    const now = performance.now() / 1000; pr.lastSeen = performance.now(); const s = pr.snaps; if (s.length && now - s[s.length - 1].t < 0.005) return;
    s.push({ t: now, ...e }); while (s.length > 30) s.shift();
  },
  validate(pr, e) {
    // host authority: reject impossible moves (teleports/speed hacks) unless flagged as a reset
    const s = pr.snaps[pr.snaps.length - 1]; if (!s) return; const dt = Math.max(0.03, performance.now() / 1000 - s.t); const d = Math.hypot(e.x - s.x, e.z - s.z);
    if (d > Math.max(30, 140 * dt) && !(pr.teleportOK > 0)) { this.sendTo(pr, { t: 'corr', x: s.x, y: s.y, z: s.z }); e.x = s.x; e.y = s.y; e.z = s.z; }
    pr.teleportOK = Math.max(0, (pr.teleportOK || 0) - 1);
  },
  applySnap(pk) { for (const e of pk.list) { if (e.id === this.myId) { this.ackSeq = pk.seq; continue; } const pr = this.peerById(e.id); if (pr) this.pushSnap(pr, e); } },
  onTeleport() { if (this.inSession()) { this.sendHost({ t: 'tp' }); this.teleportedAt = performance.now(); } },
  onCarChange() { if (!this.inSession()) return; const d = { t: 'upd', id: this.myId, car: playerRec.id, livery: playerRec.livery, name: P.character.name, banner: P.character.banner }; if (this.isHost) this.broadcast(d); else this.sendHost(d); },
  beforeTick() { },
  afterTick(h) {
    // remote-car collisions when ghosting is off (local player is pushed; kinematic remote bodies)
    if (!this.room || this.ghost || this.meta.type === 'Drift Train' && false) return;
    for (const pr of this.peers.values()) { const v = pr.veh; const dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z, dy = player.pos.y - v.pos.y; const d = Math.hypot(dx, dz); if (d < 3.4 && d > 0.01 && Math.abs(dy) < 2.5) { const nx = dx / d, nz = dz / d; const pen = 3.4 - d; player.pos.x += nx * pen * 0.5; player.pos.z += nz * pen * 0.5; const vn = player.vel.x * nx + player.vel.z * nz; if (vn < 0) { player.vel.x -= vn * nx * 1.3; player.vel.z -= vn * nz * 1.3; } if (-vn > 4) { skill.breakChain('Collision'); input.rumble(0.6, 0.4, 150); } } }
  },
  update(dt) {
    this.clock += dt; this.talkT = Math.max(0, this.talkT - dt);
    // lobby announcements over BroadcastChannel
    if (this.isHost && this.bc) { this.announceT = (this.announceT || 0) - dt; if (this.announceT <= 0) { this.announceT = 2; this.bc.postMessage({ kind: 'announce', from: this.pid, info: this.info() }); } }
    for (const [k, l] of this.lobbies) if (performance.now() - l.seen > 7000) this.lobbies.delete(k);
    this.kbpsT = (this.kbpsT || 0) + dt; if (this.kbpsT > 1) { this.kbps = ((this.bytesOut + this.bytesIn) / 1024 / this.kbpsT); this.bytesOut = this.bytesIn = 0; this.kbpsT = 0; }
    if (!this.room || !player) return;
    this.sendT += dt; if (this.sendT >= NET_RATE && this.status !== 'joining') {
      this.sendT = 0; this.seq++;
      if (this.isHost) { const ents = [selfEntity(this.myId)]; for (const pr of this.peers.values()) { const s = pr.snaps[pr.snaps.length - 1]; if (s) ents.push({ ...s, id: pr.id }); } const buf = encodeEntities(MSG_SNAP, this.seq, ents); for (const pr of this.peers.values()) this.sendTo(pr, buf); }
      else { this.sendHost(encodeEntities(MSG_STATE, this.seq, [selfEntity(this.myId)])); }
    }
    this.pingT -= dt; if (this.pingT <= 0 && !this.isHost) { this.pingT = 2; this.sendHost({ t: 'ping', ts: performance.now() }); }
    // timeouts
    const now = performance.now(); for (const pr of [...this.peers.values()]) { pr.talkT = Math.max(0, pr.talkT - dt); if (this.isHost && now - pr.lastSeen > 15000) this.dropPeer(pr, 'timed out'); }
    if (!this.isHost && this.status === 'joining' && now - this.joinT > 10000) { toast('Room ' + this.room + ' did not respond', 'warn'); this.leave(true); }
    // drift train / convoy bonuses
    if (skill.drifting) for (const pr of this.peers.values()) if (pr.veh.flags & 4 && pr.veh.pos.distanceTo(player.pos) < 22) { this.trainT = (this.trainT || 0) + dt; if (this.trainT > 1) { this.trainT = 0; skill.add('Drift Train', 'drift', 400); } }
    if (!activeEvent && this.meta.type === 'Convoy') { this.convoyT = (this.convoyT || 0) + dt; const near = [...this.peers.values()].filter((pr) => pr.veh.pos.distanceTo(player.pos) < 60).length; if (near && this.convoyT > 30) { this.convoyT = 0; addXP(150 * near); toast(`Convoy bonus · +${150 * near} XP`, 'xp'); } }
    if (this.isHost && this.meta.type === 'Convoy' && waypoint && (this._wpSent !== waypoint)) { this._wpSent = waypoint; this.broadcast({ t: 'wp', x: waypoint.x, z: waypoint.z, name: waypoint.name }); }
  },
  interpolate() {
    const rt = performance.now() / 1000 - INTERP_DELAY;
    for (const pr of this.peers.values()) {
      const s = pr.snaps; const v = pr.veh; if (!s.length) continue; let a = s[0], b = s[0];
      for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || s[i]; break; } }
      let t = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 0;
      // short extrapolation if the buffer starved
      let ex = 0; if (rt > s[s.length - 1].t) { a = b = s[s.length - 1]; ex = Math.min(0.25, rt - a.t); }
      v.pos.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)); v.quat.set(a.qx, a.qy, a.qz, a.qw).normalize(); tmpQ.set(b.qx, b.qy, b.qz, b.qw).normalize(); v.quat.slerp(tmpQ, t);
      if (ex > 0) { const fwd = tmpV.set(0, 0, 1).applyQuaternion(v.quat); v.pos.addScaledVector(fwd, a.speed * ex); }
      v.renderPos.copy(v.pos); v.renderQuat.copy(v.quat); v.speed = lerp(a.speed, b.speed, t); v.rpm = lerp(a.rpm, b.rpm, t); v.flags = b.flags; v.steer = b.steer; v.vel.set(0, 0, v.speed).applyQuaternion(v.quat);
      if (pr.model) { const vis = v.pos.y > -500; pr.model.group.visible = vis; pr.model.group.position.copy(v.renderPos); pr.model.group.quaternion.copy(v.renderQuat); pr.model.spinWheels(v.speed, 1 / 60); pr.model.setLights && pr.model.setLights(!!(v.flags & 2), !!(v.flags & 1)); pr.model.group.traverse && (pr.model._ghost !== this.ghost) && this.setGhostLook(pr); }
      pr.talking = pr.talkT > 0 || !!(v.flags & 8);
      if (audio.ready) { const d = v.pos.distanceTo(camera.position); if (d < 150 && !pr.voice) pr.voice = audio.createEngine({ ...CARS[pr.car] }, { remote: true, spatial: true }); if (pr.voice) { if (d > 170) { pr.voice.stop(); pr.voice = null; } else pr.voice.update(v.rpm, 0.5, 0.5, 0, clamp(1 - d / 150, 0, 1) * 0.6, v.pos, 1 / 60); } }
    }
  },
  setGhostLook(pr) { pr.model._ghost = this.ghost; pr.model.group.traverse((o) => { if (o.material && !Array.isArray(o.material)) { if (!o.material._g) { o.material = o.material.clone(); o.material._g = 1; } o.material.transparent = this.ghost; o.material.opacity = this.ghost ? 0.45 : 1; o.material.depthWrite = !this.ghost; } }); },
  remoteList() { const out = []; for (const pr of this.peers.values()) out.push({ id: pr.id, name: pr.name, banner: pr.banner, veh: pr.veh, model: pr.model, ghost: this.ghost, talking: pr.talking, car: pr.specName }); return out; },
  sendHorn() { if (!this.room) return; this.talkT = 1; const d = { t: 'horn', id: this.myId, style: P.character.horn }; if (this.isHost) this.broadcast(d); else this.sendHost(d); },
  sendChat(i) { if (!this.room) { return; } this.talkT = 2.5; const d = { t: 'chat', id: this.myId, i }; if (this.isHost) this.broadcast(d); else this.sendHost(d); },
  // ------------------------------------------------ synchronised events
  startSyncEvent(ev, weather) {
    if (!this.isHost) return; const seed = (Date.now() / 1000) | 0; const order = [this.myId, ...[...this.peers.values()].map((p) => p.id)];
    const msg = { t: 'evstart', id: ev.id, weather: weather || world.weather.state, seed, order, tod: world.tod };
    this.broadcast(msg); this.onRemoteEventStart(msg);
  },
  onRemoteEventStart(d) {
    const def = EVENTS.find((e) => e.id === d.id); if (!def) return; const slot = Math.max(0, d.order.indexOf(this.myId));
    if (UI.isOpen()) UI.closeAll(); if (d.tod != null) world.tod = d.tod; for (const pr of this.peers.values()) pr.teleportOK = 40;
    const coop = def.type === 'showcase'; startEvent(def, { online: true, weather: d.weather, seed: d.seed, slot, aiCount: coop ? 0 : Math.max(0, Math.min(S.aiCount | 0, 6) - this.peers.size) });
    banner(coop ? 'CO-OP SHOWCASE' : 'ONLINE RACE', `${def.name} · ${this.peers.size + 1} players`, 2600);
  },
  onEventStart(ev) {
    if (!ev.online || !this.room) return; this.finishers = [];
    for (const pr of this.peers.values()) { const e = { remote: pr, name: pr.name, spec: { name: pr.specName }, veh: pr.veh, cpN: 0, prog: 0, finished: false, time: 0, idx: ev.s0, lapStart: 0, laps: [], sectors: [], isRemote: true }; ev.entrants.push(e); }
  },
  reportFinish(t) { if (!this.room || !activeEvent || !activeEvent.online) return; const d = { t: 'fin', id: this.myId, time: t, ev: activeEvent.id, car: CARS[playerRec.id].name, name: P.character.name, won: !activeEvent.lostShowcase }; if (this.isHost) this.onFin(d, { pid: this.pid }); else this.sendHost(d); P.stats.onlineRaces = (P.stats.onlineRaces || 0) + 1; },
  onFin(d, from) {
    const ev = activeEvent; if (this.isHost && from.pid !== this.pid) this.broadcast(d, from.pid); if (this.isHost && from.pid === this.pid) this.broadcast(d);
    ghostBoard.submit(d.ev, d.time, d.car, d.name + ' (online)');
    if (!ev || !ev.online || d.id === this.myId) return; const e = ev.entrants.find((x) => x.remote && x.remote.id === d.id); if (e) { e.finished = true; e.time = d.time; if (!e.place) e.place = ev.entrants.filter((x) => x.finished).length; }
    if (ev.def.type === 'showcase' && d.won) toast(`${d.name} beat the ${ev.def.showcase} — team victory!`, 'gold');
  },
  onEventEnd() { if (this.isHost && this.room && this._evEnding) this.broadcast({ t: 'evend' }); },
  shareGhost(entry) { try { this.bc && this.bc.postMessage({ kind: 'ghost', from: this.pid, entry }); } catch { } },
};

// ---- photo mode panel ----
SCREENS.photo = {
  cls: 'panel sidepanel photo', live: true,
  render() {
    const ph = photo;
    return h('div', { class: 'pwrap' }, h('div', { class: 'phead' }, h('h1', {}, 'Photo Mode'), h('div', { class: 'psub' }, 'WASD / left stick: move · Q/E / triggers: height · mouse / right stick: look')),
      h('div', { class: 'pbody list' },
        slider('Field of view', () => ph.fov, (v) => { ph.fov = v; }, 12, 100, 1, (v) => Math.round(v) + '°'), slider('Roll', () => ph.roll, (v) => { ph.roll = v; }, -0.6, 0.6, 0.02, (v) => Math.round(v * 57.3) + '°'),
        choice('Filter', FILTERS.map((f, i) => [i, f]), () => ph.filter, (v) => { ph.filter = v; }), slider('Exposure', () => ph.exposure, (v) => { ph.exposure = v; }, 0.4, 1.8, 0.05),
        slider('Time of day', () => world.tod, (v) => { world.tod = v; }, 0, 23.9, 0.1, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor(v % 1 * 60)).padStart(2, '0')}`),
        slider('Depth of field (tilt-shift)', () => ph.tilt, (v) => { ph.tilt = v; }, 0, 1, 0.05, (v) => Math.round(v * 100) + '%'), slider('Focus position', () => ph.tiltPos, (v) => { ph.tiltPos = v; }, 0.1, 0.9, 0.02, (v) => Math.round(v * 100) + '%'),
        slider('Vignette', () => ph.vig, (v) => { ph.vig = v; }, 0, 1, 0.05, (v) => Math.round(v * 100) + '%'), toggle('Hide car', () => ph.hideCar, (v) => { ph.hideCar = v; }),
        btn('Take Photo', () => { UI.root.style.visibility = 'hidden'; requestAnimationFrame(() => { ph.take(); UI.root.style.visibility = ''; }); }, { autofocus: true, cls: 'gold' }), btn('Exit Photo Mode', () => ph.exit())),
      footer([['ok', 'Take / select'], ['back', 'Exit']]));
  },
  onClose() { if (mode === 'photo') photo.exit(); },
};
// ---- replay panel ----
SCREENS.replay = {
  cls: 'panel bottompanel', live: true,
  render(top) {
    const R = replay; const hl = R.highlights();
    const scrub = slider('Timeline', () => R.idx / Math.max(1, R.frames.length - 1), (v) => { R.idx = v * (R.frames.length - 1); }, 0, 1, 0.005, () => fmtTime(R.idx / 30).slice(0, -2) + ' / ' + fmtTime(R.frames.length / 30).slice(0, -2));
    top.scrub = scrub;
    return h('div', { class: 'pwrap' }, h('div', { class: 'brow' },
      btn(R.playing ? '❚❚ Pause' : '▶ Play', () => { R.playing = !R.playing; if (R.playing && R.idx >= R.frames.length - 2) R.idx = 0; UI.refresh(); }, { autofocus: true }),
      choice('Speed', [[-1, '◀◀ ×1'], [0.25, '×0.25'], [0.5, '×0.5'], [1, '×1'], [2, '×2'], [4, '×4']], () => R.speed, (v) => { R.speed = v; R.playing = true; }),
      choice('Camera', R.cams.map((c, i) => [i, c]), () => R.cam, (v) => { R.cam = v; R.tvPos.set(0, 0, 0); }), choice('Filter', FILTERS.map((f, i) => [i, f]), () => R.filter, (v) => { R.filter = v; }),
      btn('Photo', () => { replay.playing = false; const pm = mode; photo.enter(); photo.prevMode = pm; }), btn('Exit Replay', () => R.exit())),
      scrub, hl.length ? h('div', { class: 'brow hl' }, h('span', { class: 'lbl' }, 'Highlights:'), hl.slice(-8).map((m) => btn(m.label, () => { R.idx = Math.max(0, m.i - 90); R.playing = true; }))) : null,
      footer([['ok', 'Select'], ['back', 'Exit replay']]));
  },
  update(top) { top.t = (top.t || 0) + 1; if (top.t % 6 === 0 && top.scrub) { const R = replay; const fill = top.scrub.querySelector('i'); const val = top.scrub.querySelector('b'); const v = R.idx / Math.max(1, R.frames.length - 1); if (fill) fill.style.width = v * 100 + '%'; if (val) val.textContent = fmtTime(R.idx / 30).slice(0, -2) + ' / ' + fmtTime(R.frames.length / 30).slice(0, -2); } },
  onClose() { if (mode === 'replay') replay.exit(); if (replay.afterResults) { const ev = replay.afterResults; replay.afterResults = null; setTimeout(() => { if (activeEvent === ev && ev.results) UI.open('results', { ev }); else if (activeEvent) exitEventToFreeRoam(true); }, 0); } },
};
// ---- online ----
const LOBBY_TYPES = ['Free Roam', 'Convoy', 'Drift Train', 'Race', 'Co-op Showcase'];
SCREENS.online = {
  cls: 'panel', live: true, tabs: ['Session', 'Lobby Browser', 'Ghost Leaderboards'],
  render(top) {
    const N = net; const inS = N.inSession();
    const T = [
      () => inS ? [h('div', { class: 'kv' }, h('span', {}, 'Room code'), h('b', { class: 'big code' }, N.room)), h('div', { class: 'kv' }, h('span', {}, 'Role'), h('b', {}, N.isHost ? 'Host (authoritative)' : N.status === 'joining' ? 'Joining…' : 'Client')), h('div', { class: 'kv' }, h('span', {}, 'Transport'), h('b', {}, N.transport === 'local' ? 'Same-device tabs' : N.transport === 'webrtc' ? 'WebRTC data channel' : N.isHost ? (N.rtcFailed ? 'Local tabs only (relay blocked)' : 'Opening relay…') : '—')), h('div', { class: 'kv' }, h('span', {}, 'Activity'), h('b', {}, N.meta.type)),
        h('div', { class: 'lb' }, [{ name: P.character.name + ' (you)', id: N.myId, me: true }, ...N.remoteList()].map((p) => h('div', { class: 'lbrow' + (p.me ? ' me' : '') }, h('span', {}, p.talking ? '🔊' : '•'), h('b', {}, p.name), h('small', {}, p.car || CARS[playerRec.id].name), h('span', {}, p.me ? (N.isHost ? 'host' : N.ping + ' ms') : '')))),
        toggle('Ghost mode (no collisions)', () => N.ghost, (v) => { N.ghost = v; S.ghostOnline = v; saveSettings(); }),
        N.isHost ? choice('Activity', LOBBY_TYPES.map((t) => [t, t]), () => N.meta.type, (v) => { N.meta.type = v; }) : null,
        N.isHost ? h('div', { class: 'brow' }, btn('Start online race…', () => UI.open('onlineEvent', { kind: 'race' })), btn('Start co-op showcase…', () => UI.open('onlineEvent', { kind: 'showcase' })), btn('Drift zone with lobby…', () => UI.open('onlineEvent', { kind: 'drift' }))) : h('p', { class: 'hint' }, 'The host picks events — you will be teleported to the grid automatically.'),
        h('div', { class: 'brow' }, btn('Quick chat', () => { UI.closeAll(); quickChat.open = true; quickChat.sel = 0; $('#radial')?.classList.add('on'); }), btn('Leave session', () => { N.leave(); UI.refresh(); }, { cls: 'danger' }))]
        : [h('p', {}, 'Play with friends: host a lobby and share the room code, or join one. Same-device browser tabs connect instantly; other devices connect peer-to-peer over WebRTC using the public PeerJS signalling relay (no account needed).'),
          choice('Lobby activity', LOBBY_TYPES.map((t) => [t, t]), () => N.meta.type, (v) => { N.meta.type = v; }), choice('Max players', [2, 4, 6, 8, 12].map((n) => [n, String(n)]), () => N.meta.max, (v) => { N.meta.max = v; }),
          btn('Host a lobby', async () => { await N.host(); UI.refresh(); }, { autofocus: true }),
          h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Room code'), h('input', { class: 'f textin', id: 'joinCode', type: 'text', maxlength: 6, placeholder: 'ABCDE', value: top.code || '', oninput: (e) => { top.code = e.target.value.toUpperCase(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.target.blur(); this.doJoin(top); } } })),
          btn('Join by code', () => this.doJoin(top)), N.ghostOnly ? h('p', { class: 'hint warn' }, 'WebRTC appears blocked on this network. You can still play the Ghost Leaderboard mode and same-device tabs.') : null],
      () => { const list = [...N.lobbies.values()]; return [h('div', { class: 'brow' }, btn('Refresh internet lobbies', () => { N.browse(); toast('Searching for public lobbies…', 'info'); }), choice('Filter', [['all', 'All activities'], ...LOBBY_TYPES.map((t) => [t, t])], () => top.filt || 'all', (v) => { top.filt = v; UI.refresh(); })),
        h('div', { class: 'lb' }, h('div', { class: 'lbrow head' }, h('b', {}, 'Lobby'), h('span', {}, 'Activity'), h('span', {}, 'Region'), h('span', {}, 'Players'), h('span', {}, 'Latency')),
          list.filter((l) => !top.filt || top.filt === 'all' || l.type === top.filt).map((l) => h('div', { class: 'f lbrow', tabindex: 0, onclick: async () => { await N.join(l.code); UI.refresh(); } }, h('b', {}, l.name + ' · ' + l.code), h('span', {}, l.type), h('span', {}, l.region), h('span', {}, `${l.players}/${l.max}`), h('span', {}, (l.via === 'bc' ? 'local' : l.ping + ' ms'))))),
        list.length ? null : h('p', { class: 'small' }, 'No lobbies found yet. Lobbies on this device appear automatically; internet lobbies appear after Refresh.')]; },
      () => { const evs = EVENTS.filter((e) => e.line && ['road', 'dirt', 'street', 'cross', 'stadium'].includes(e.type)); top.gev = top.gev || evs[0].id; const ev = EVENTS.find((e) => e.id === top.gev); const l = ghostBoard.list(top.gev);
        return [h('p', {}, 'Ghost Leaderboard mode works even when peer-to-peer connections are blocked: race against rival ghost times from your own runs, other tabs on this device and online session results.'), choice('Event', evs.map((e) => [e.id, e.name]), () => top.gev, (v) => { top.gev = v; UI.refresh(); }),
          h('div', { class: 'lb' }, l.map((r, i) => h('div', { class: 'lbrow' + (r.ghost ? ' ghost' : '') + (r.name === P.character.name ? ' me' : '') }, h('span', {}, String(i + 1)), h('b', {}, r.name), h('small', {}, r.car || ''), h('span', {}, fmtTime(r.time))))),
          btn('Race this event vs. ghost times', () => { UI.closeAll(); const e2 = startEvent(ev, { ghostRace: true }); if (e2) { e2.ghostTarget = l[0]?.time; toast('Beat ' + (l[0] ? l[0].name + ' — ' + fmtTime(l[0].time) : 'the clock'), 'info', 5000); } })]; },
    ];
    return panel('Online', inS ? `Room ${N.room} · ${N.peers.size + 1} players` : (N.ghostOnly ? 'Offline — Ghost mode available' : 'Not connected'), tabsBar(this, top), h('div', { class: 'list' }, T[top.tab]()), footer([['tabL', 'Prev'], ['tabR', 'Next'], ['ok', 'Select'], ['back', 'Back']]));
  },
  async doJoin(top) { const code = (top.code || $('#joinCode')?.value || '').toUpperCase(); const ok = await net.join(code); UI.refresh(); if (ok) toast('Connecting…', 'info'); },
  update(top) { top.t = (top.t || 0) + 1; if (top.t % 90 === 0 && document.activeElement?.tagName !== 'INPUT') UI.refresh(); },
};
SCREENS.onlineEvent = {
  cls: 'panel modal', live: true,
  render(top) {
    const k = top.opts.kind; const list = EVENTS.filter((e) => (k === 'race' ? ['road', 'dirt', 'street', 'cross', 'stadium', 'drag'].includes(e.type) : k === 'showcase' ? e.type === 'showcase' : e.type === 'drift'));
    top.weather = top.weather || world.weather.state;
    return panel(k === 'race' ? 'Online Race' : k === 'showcase' ? 'Co-op Showcase' : 'Drift Zone', `${net.peers.size + 1} players`, choice('Weather', WEATHER_TYPES.map((w) => [w, w[0].toUpperCase() + w.slice(1)]), () => top.weather, (v) => { top.weather = v; }),
      h('div', { class: 'list scroll' }, list.map((ev) => btn(ev.name, () => { UI.closeAll(); net.startSyncEvent(ev, top.weather); }, { sub: `${EVENT_TYPES[ev.type]?.name} · ${ev.region} · ${(ev.line.len * ev.laps / 1000).toFixed(1)} km` }))), footer([['ok', 'Start for everyone'], ['back', 'Back']]));
  },
};

// ---- settings ----
function applyAssists() { if (player) Object.assign(player.assists, S.assists); for (const r of racers) r.veh.assists.damage = S.assists.damage; }
SCREENS.settings = {
  cls: 'panel', live: true, tabs: ['Video', 'Audio', 'Controls', 'Assists', 'HUD', 'Accessibility', 'Gameplay', 'Save'],
  render(top) {
    const sv = () => { saveSettings(); }; const vid = () => { applyVideoSettings(); sv(); };
    const pct = (v) => Math.round(v * 100) + '%';
    const T = [
      () => [choice('Quality preset', [['low', 'Low (integrated GPUs)'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']], () => (PRESETS[S.preset] ? S.preset : S.preset?.startsWith('auto:') ? S.preset.slice(5) : 'custom'), (v) => { if (v !== 'custom') { applyPreset(v); vid(); UI.refresh(); } }),
        slider('Resolution scale', () => S.resScale, (v) => { S.resScale = v; S.preset = 'custom'; vid(); }, 0.4, 1.5, 0.05, pct), toggle('Adaptive resolution (hold 45+ FPS)', () => S.adaptiveRes, (v) => { S.adaptiveRes = v; perf.dynScale = 1; vid(); }),
        choice('Shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], () => S.shadows, (v) => { S.shadows = v; S.preset = 'custom'; vid(); }),
        choice('Draw distance', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], () => S.drawDistance, (v) => { S.drawDistance = v; S.preset = 'custom'; vid(); }),
        choice('Particles', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => S.particles, (v) => { S.particles = v; S.preset = 'custom'; vid(); }),
        choice('Traffic density', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => S.traffic, (v) => { S.traffic = v; vid(); }),
        toggle('Post-processing', () => S.postfx, (v) => { S.postfx = v; S.preset = 'custom'; vid(); }), slider('Motion blur', () => S.motionBlur, (v) => { S.motionBlur = v; sv(); }, 0, 1, 0.05, pct), slider('Chromatic aberration', () => S.chromatic, (v) => { S.chromatic = v; sv(); }, 0, 1, 0.05, pct), slider('Speed lines', () => S.speedLines, (v) => { S.speedLines = v; sv(); }, 0, 1, 0.05, pct), toggle('God rays', () => S.godrays, (v) => { S.godrays = v; sv(); }),
        slider('Field of view', () => S.fov, (v) => { S.fov = v; sv(); }, 50, 100, 1, (v) => Math.round(v) + '°'), slider('Dynamic FOV', () => S.dynamicFov, (v) => { S.dynamicFov = v; sv(); }, 0, 1.5, 0.05, pct), slider('Camera shake', () => S.camShake, (v) => { S.camShake = v; sv(); }, 0, 1.5, 0.05, pct),
        choice('Default camera', camRig.modes.map((m) => [m, m[0].toUpperCase() + m.slice(1)]), () => S.camera, (v) => { S.camera = v; camRig.mode = camRig.modes.indexOf(v); sv(); }), h('p', { class: 'hint' }, 'GPU: ' + (S.gpu || 'unknown'))],
      () => [slider('Master volume', () => S.volMaster, (v) => { S.volMaster = v; audio.applyVolumes(); sv(); }, 0, 1, 0.05, pct), slider('Music', () => S.volMusic, (v) => { S.volMusic = v; audio.applyVolumes(); sv(); }, 0, 1, 0.05, pct), slider('Effects', () => S.volSfx, (v) => { S.volSfx = v; audio.applyVolumes(); sv(); }, 0, 1, 0.05, pct), slider('Engines', () => S.volEngine, (v) => { S.volEngine = v; audio.applyVolumes(); sv(); }, 0, 1, 0.05, pct),
        choice('Radio station', [['pulse', 'Horizon Pulse (electro)'], ['bass', 'Horizon Bass Arena (DnB)'], ['rock', 'Horizon Rocks'], ['off', 'Radio off']], () => S.radio, (v) => { S.radio = v; audio.startMusic(v); sv(); }), audio.ready ? null : h('p', { class: 'hint warn' }, 'Audio is waiting for a click, tap or key press (browser autoplay rules).')],
      () => [h('div', { class: 'lbl grp' }, 'Controller'), slider('Steering linearity', () => S.steerLinearity, (v) => { S.steerLinearity = v; sv(); }, 0.5, 2.5, 0.05), slider('Stick deadzone', () => S.stickDeadzone, (v) => { S.stickDeadzone = v; sv(); }, 0, 0.4, 0.01, pct), slider('Stick saturation', () => S.stickSaturation, (v) => { S.stickSaturation = v; sv(); }, 0.6, 1, 0.01, pct), slider('Trigger deadzone', () => S.trigDeadzone, (v) => { S.trigDeadzone = v; sv(); }, 0, 0.4, 0.01, pct), slider('Trigger saturation', () => S.trigSaturation, (v) => { S.trigSaturation = v; sv(); }, 0.6, 1, 0.01, pct), slider('Look sensitivity (pad)', () => S.padSens, (v) => { S.padSens = v; sv(); }, 0.2, 3, 0.05), toggle('Invert Y (pad)', () => S.padInvertY, (v) => { S.padInvertY = v; sv(); }), slider('Vibration', () => S.rumble, (v) => { S.rumble = v; sv(); if (v) input.rumble(0.5, 0.5, 200); }, 0, 1, 0.05, pct),
        h('div', { class: 'lbl grp' }, 'Keyboard & mouse'), slider('Keyboard steering speed', () => S.kbSteerSpeed, (v) => { S.kbSteerSpeed = v; sv(); }, 0.3, 2.5, 0.05), slider('Mouse sensitivity', () => S.mouseSens, (v) => { S.mouseSens = v; sv(); }, 0.2, 3, 0.05), toggle('Invert Y (mouse)', () => S.mouseInvertY, (v) => { S.mouseInvertY = v; sv(); }),
        h('div', { class: 'lbl grp' }, 'Touch'), choice('Touch controls', [['auto', 'Auto'], ['on', 'Always on'], ['off', 'Off']], () => S.touchControls, (v) => { S.touchControls = v; sv(); updateTouchVisibility(); }), choice('Touch steering', [['buttons', 'Buttons'], ['tilt', 'Tilt (gyro)']], () => S.touchSteer, (v) => { S.touchSteer = v; sv(); if (v === 'tilt') requestTilt(); }),
        h('div', { class: 'brow' }, btn('Remap keyboard', () => UI.open('remap', { kind: 'key' })), btn('Remap controller', () => UI.open('remap', { kind: 'pad' }))), h('p', { class: 'hint' }, `Active device: ${input.device}${input.pad() ? ' · ' + input.pad().id.slice(0, 40) : ''}. Plug in / switch controllers at any time.`)],
      () => [choice('Braking assist (ABS)', [[1, 'On'], [0, 'Off']], () => S.assists.abs, (v) => { S.assists.abs = v; applyAssists(); sv(); }), slider('Traction control', () => S.assists.tcs, (v) => { S.assists.tcs = v; applyAssists(); sv(); }, 0, 1, 0.05, (v) => (v ? pct(v) : 'Off')), slider('Stability control', () => S.assists.stm, (v) => { S.assists.stm = v; applyAssists(); sv(); }, 0, 1, 0.05, (v) => (v ? pct(v) : 'Off')),
        slider('Steering assist', () => S.assists.steer, (v) => { S.assists.steer = v; applyAssists(); sv(); }, 0, 1, 0.05, (v) => (v ? pct(v) : 'Simulation')), slider('Braking assist', () => S.assists.brake, (v) => { S.assists.brake = v; applyAssists(); sv(); }, 0, 1, 0.05, (v) => (v ? pct(v) : 'Off')), slider('Auto-brake (racing line)', () => S.assists.autoBrake, (v) => { S.assists.autoBrake = v; applyAssists(); sv(); }, 0, 1, 0.05, (v) => (v ? pct(v) : 'Off')),
        choice('Racing line', [[0, 'Off'], [1, 'Braking only'], [2, 'Full line']], () => S.assists.line, (v) => { S.assists.line = v; sv(); }), choice('Shifting', [['auto', 'Automatic'], ['manual', 'Manual'], ['manualClutch', 'Manual with clutch']], () => S.assists.shifting, (v) => { S.assists.shifting = v; applyAssists(); sv(); }),
        choice('Damage', [['off', 'Off'], ['cosmetic', 'Cosmetic'], ['sim', 'Simulation (mechanical)']], () => S.assists.damage, (v) => { S.assists.damage = v; applyAssists(); sv(); }), choice('Tire & fuel wear', [[1, 'On'], [0, 'Off']], () => S.assists.wear, (v) => { S.assists.wear = v; applyAssists(); sv(); }), choice('Rewind', [[1, 'On'], [0, 'Off']], () => S.assists.rewind, (v) => { S.assists.rewind = v; sv(); }),
        h('p', { class: 'hint' }, 'Turning assists off increases event credit payouts (shown on results).')],
      () => [slider('HUD scale', () => S.hudScale, (v) => { S.hudScale = v; document.documentElement.style.setProperty('--hud', v); sv(); }, 0.6, 1.5, 0.05, pct), choice('Units', [['kmh', 'Metric (km/h)'], ['imperial', 'Imperial (mph)']], () => S.units, (v) => { S.units = v; sv(); }),
        ...[['speedo', 'Speedometer & tachometer'], ['minimap', 'Minimap'], ['chain', 'Skill chain'], ['race', 'Race position & timing'], ['markers', 'Objective markers'], ['nameplates', 'Player nameplates'], ['notifications', 'Notifications'], ['line', 'GPS ribbon'], ['damage', 'Damage indicator'], ['perf', 'Performance overlay (F3)']].map(([k, n]) => toggle(n, () => S.hud[k], (v) => { S.hud[k] = v; sv(); }))],
      () => [choice('Colour-blind mode', [['off', 'Off'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']], () => S.colorblind, (v) => { S.colorblind = v; document.body.dataset.cb = v; sv(); }), slider('Subtitle size', () => S.subtitleSize, (v) => { S.subtitleSize = v; sv(); subtitle('Subtitle preview — Welcome to the Horizon Festival!', 2000); }, 0.7, 2, 0.05, pct), toggle('Reduce flashing effects', () => S.reduceFlash, (v) => { S.reduceFlash = v; sv(); }), slider('Camera shake', () => S.camShake, (v) => { S.camShake = v; sv(); }, 0, 1.5, 0.05, pct)],
      () => [choice('Drivatar difficulty', [[0, 'New Racer'], [1, 'Average'], [2, 'Above Average'], [3, 'Highly Skilled'], [4, 'Expert'], [5, 'Pro'], [6, 'Unbeatable']], () => S.difficulty, (v) => { S.difficulty = v; sv(); }), slider('Opponents in races', () => S.aiCount, (v) => { S.aiCount = v; sv(); }, 1, 11, 1), toggle('Online ghosting by default', () => S.ghostOnline, (v) => { S.ghostOnline = v; net.ghost = v; sv(); }),
        slider('Time of day speed', () => world.timeScale, (v) => { world.timeScale = v; }, 0, 240, 10, (v) => (v ? '×' + v : 'Frozen')), choice('Weather', [['auto', 'Dynamic'], ...WEATHER_TYPES.map((w) => [w, w[0].toUpperCase() + w.slice(1)])], () => (world.weather.auto ? 'auto' : world.weather.state), (v) => { if (v === 'auto') world.weather.auto = true; else { world.weather.auto = false; world.weather.set(v); } })],
      () => [h('p', {}, P ? `Profile "${P.character.name}" — slot ${slotIdx + 1}. The game autosaves every minute, after events and purchases, and when the tab is hidden.` : 'No profile loaded.'), P ? btn('Save now', () => saveGame()) : null,
        ...[0, 1, 2].map((i) => { const s = slotSummary(i); return h('div', { class: 'brow' }, h('span', { class: 'lbl' }, `Slot ${i + 1}: ${s ? (s.corrupt ? 'corrupt' : `${s.name} · Lvl ${s.level}`) : 'empty'}`), btn('Export', () => exportSlot(i), { disabled: !s }), btn('Import', () => importSlot(i, () => UI.refresh())), btn('Delete', () => confirmBox('Delete save', `Delete slot ${i + 1}? This cannot be undone.`, () => { if (P && i === slotIdx) { toast('Cannot delete the slot that is in use', 'warn'); return; } localStorage.removeItem(slotKey(i)); UI.refresh(); }), { disabled: !s, cls: 'danger' })); }),
        btn('Reset all settings to default', () => confirmBox('Reset settings', 'Restore every setting to its default value?', () => { const keep = S.gpu; Object.assign(S, structuredClone(DEFAULT_SETTINGS)); S.gpu = keep; applyVideoSettings(); audio.applyVolumes(); saveSettings(); UI.refresh(); }))],
    ];
    return panel('Settings', '', tabsBar(this, top), h('div', { class: 'list scroll' }, T[top.tab]()), footer([['tabL', 'Prev tab'], ['tabR', 'Next tab'], ['ok', 'Select'], ['back', 'Back']]));
  },
  onClose() { saveSettings(); },
};
// ---- input remapping ----
SCREENS.remap = {
  cls: 'panel', live: true,
  render(top) {
    const kind = top.opts.kind; const map = kind === 'key' ? input.keyMap : input.padMap;
    return panel(kind === 'key' ? 'Keyboard Bindings' : 'Controller Bindings', top.wait ? `Press a ${kind === 'key' ? 'key' : 'button / move a stick'} for "${top.wait}" …` : 'Select an action to rebind. Bindings are saved automatically.',
      h('div', { class: 'list scroll' }, ACTIONS.map(([a, label]) => btn(label, () => {
        top.wait = label; UI.refresh(); setTimeout(() => {
          input.capture = (ev) => {
            if (ev.kind !== kind) { top.wait = null; toast('Use the ' + (kind === 'key' ? 'keyboard' : 'controller') + ' for this list', 'warn'); UI.refresh(); return; }
            if (ev.code === 'Escape' && a !== 'pause') { top.wait = null; UI.refresh(); return; }
            for (const k in map) if (k !== a) map[k] = (map[k] || []).filter((c) => c !== ev.code);
            map[a] = [ev.code, ...(map[a] || []).filter((c) => c !== ev.code)].slice(0, 2); input.saveBindings(); top.wait = null; toast(`${label} → ${input.bindingLabel(a, kind)}`, 'info'); UI.refresh();
          };
        }, 150);
      }, { sub: input.bindingLabel(a, kind) || '—' }))),
      h('div', { class: 'brow' }, btn('Reset to defaults', () => { input.resetBindings(); UI.refresh(); }), btn('Done', () => UI.back())), footer([['ok', 'Rebind'], ['back', 'Back']]));
  },
  onClose() { input.capture = null; },
};

// ---------------------------------------------------------------------
// TOUCH CONTROLS (Android / tablets)
// ---------------------------------------------------------------------
let tiltOn = false, tiltVal = 0;
function isTouchDevice() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
function updateTouchVisibility() {
  const el = $('#touch'); if (!el) return; const want = S.touchControls === 'on' || (S.touchControls === 'auto' && isTouchDevice());
  const driving = (mode === 'free' || mode === 'event') && !UI.isOpen();
  el.classList.toggle('on', want && driving); input.touch.active = want; document.body.classList.toggle('touchmode', !!(want && driving));
  if (!want || !driving) { input.touch.throttle = input.touch.brake = input.touch.handbrake = 0; input.touch.steer = 0; }
}
function requestTilt() {
  const go = () => { tiltOn = true; addEventListener('deviceorientation', (e) => { if (S.touchSteer !== 'tilt') return; const land = Math.abs(window.orientation || screen.orientation?.angle || 0) === 90; const raw = land ? (e.beta || 0) * Math.sign(window.orientation || screen.orientation?.angle || 90) : (e.gamma || 0); tiltVal = clamp(raw / 28, -1, 1); }); };
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') go(); else toast('Tilt permission denied', 'warn'); }).catch(() => toast('Tilt unavailable', 'warn'));
  else go();
}
function initTouch() {
  const root = $('#touch'); if (!root) return; root.innerHTML = '';
  input.touchPress = new Set(); const T = input.touch; const held = { left: 0, right: 0 };
  const hold = (cls, label, on, off) => { const b = h('div', { class: 'tbtn ' + cls }, label); const start = (e) => { e.preventDefault(); b.classList.add('down'); audio.unlock(); on(); }; const end = (e) => { e.preventDefault(); b.classList.remove('down'); off(); }; b.addEventListener('touchstart', start, { passive: false }); b.addEventListener('touchend', end, { passive: false }); b.addEventListener('touchcancel', end, { passive: false }); b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') start(e); }); b.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(e); }); return b; };
  const tap = (cls, label, act) => { const b = h('div', { class: 'tbtn small ' + cls }, label); const f = (e) => { e.preventDefault(); audio.unlock(); if (typeof act === 'function') act(); else input.touchPress.add(act); }; b.addEventListener('touchstart', f, { passive: false }); b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') f(e); }); return b; };
  root.append(
    h('div', { class: 'tleft' }, hold('steerL', '◀', () => { held.left = 1; }, () => { held.left = 0; }), hold('steerR', '▶', () => { held.right = 1; }, () => { held.right = 0; })),
    h('div', { class: 'tright' }, hold('hand', 'HB', () => { T.handbrake = 1; }, () => { T.handbrake = 0; }), hold('brake', 'BRK', () => { T.brake = 1; }, () => { T.brake = 0; }), hold('gas', 'GAS', () => { T.throttle = 1; }, () => { T.throttle = 0; })),
    h('div', { class: 'ttop' }, tap('', '☰', 'pause'), tap('', '🗺', 'map'), tap('', '🎥', 'camera'), tap('', '⟲', 'reset'), tap('', '📯', 'horn'), tap('', '💬', 'quickChat'), tap('', '📷', 'photo')),
    hold('rew', '⏪', () => { T.rewind = 1; }, () => { T.rewind = 0; }),
  );
  // ramped steering for buttons, direct tilt when enabled
  setInterval(() => { const target = S.touchSteer === 'tilt' && tiltOn ? tiltVal : held.right - held.left; const rate = 0.12; T.steer += clamp(target - T.steer, -rate * 2, rate * 2); if (Math.abs(T.steer) < 0.01 && !target) T.steer = 0; }, 16);
  setInterval(updateTouchVisibility, 300); updateTouchVisibility();
}
