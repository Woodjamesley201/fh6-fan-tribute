// =====================================================================
// world.js : WORLD (terrain, biomes, roads, streaming chunks, scenery,
//            traffic, wildlife, landmarks) + RENDERING (sky, day/night,
//            weather, particles, skidmarks, car models, post FX)
// =====================================================================
import * as THREE from 'three';
import { Noise, clamp, lerp, smoothstep, mulberry32, hash2, SURF, CARS } from './data.js';

export const WORLD_HALF = 4000; // 8 km x 8 km = 64 km²
export const CHUNK = 256;
const ROAD_CELL = 64, COL_CELL = 32;

// ---------- canvas texture helpers ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function noiseFill(g, w, h, base, vari, n = 4000, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = mulberry32(w * 7 + h); for (let i = 0; i < n; i++) { const v = (r() - 0.5) * vari; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`; g.fillRect(r() * w, r() * h, size * r() + 0.5, size * r() + 0.5); }
}
export const TEX = {};
function makeTextures() {
  TEX.asphalt = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#3a3b3e', 0.25, 9000, 2);
    g.fillStyle = 'rgba(240,240,235,0.9)'; g.fillRect(8, 0, 6, h); g.fillRect(w - 14, 0, 6, h);
    g.fillStyle = 'rgba(245,200,40,0.95)'; for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 3, y, 6, 70);
  });
  TEX.highway = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#37383b', 0.22, 9000, 2);
    g.fillStyle = 'rgba(240,240,235,0.9)'; g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    g.fillStyle = 'rgba(245,200,40,0.95)'; g.fillRect(w / 2 - 6, 0, 4, h); g.fillRect(w / 2 + 2, 0, 4, h);
    g.fillStyle = 'rgba(240,240,235,0.85)'; for (let y = 0; y < h; y += 128) { g.fillRect(w * 0.25 - 2, y, 4, 60); g.fillRect(w * 0.75 - 2, y, 4, 60); }
  });
  TEX.city = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#45464a', 0.2, 8000, 2);
    g.fillStyle = 'rgba(230,230,230,0.8)'; g.fillRect(4, 0, 4, h); g.fillRect(w - 8, 0, 4, h);
    for (let y = 0; y < h; y += 96) g.fillRect(w / 2 - 2, y, 4, 48);
  });
  TEX.track = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#2e2f33', 0.2, 9000, 2);
    for (let y = 0; y < h; y += 32) { g.fillStyle = (y / 32) % 2 ? '#d22' : '#eee'; g.fillRect(0, y, 14, 32); g.fillRect(w - 14, y, 14, 32); }
  });
  TEX.dirt = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#8a6a45', 0.35, 9000, 3);
    g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(w * 0.22, 0, 30, h); g.fillRect(w * 0.66, 0, 30, h);
    const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, 'rgba(90,110,50,0.9)'); grd.addColorStop(0.1, 'rgba(0,0,0,0)'); grd.addColorStop(0.9, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(90,110,50,0.9)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  TEX.gravel = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, '#9a8f80', 0.45, 14000, 3);
    const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, 'rgba(70,90,50,0.9)'); grd.addColorStop(0.12, 'rgba(0,0,0,0)'); grd.addColorStop(0.88, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(70,90,50,0.9)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  TEX.ground = canvasTex(256, 256, (g, w, h) => { noiseFill(g, w, h, '#ffffff', 0.35, 12000, 3); });
  TEX.windows = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#5d6670'; g.fillRect(0, 0, w, h); const r = mulberry32(5);
    for (let y = 8; y < h; y += 24) for (let x = 6; x < w; x += 20) { const lit = r() < 0.45; g.fillStyle = lit ? `rgba(255,${200 + r() * 50 | 0},${120 + r() * 80 | 0},1)` : '#1d2a38'; g.fillRect(x, y, 13, 15); }
  });
  TEX.windowsEm = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const r = mulberry32(5);
    for (let y = 8; y < h; y += 24) for (let x = 6; x < w; x += 20) { const lit = r() < 0.45; g.fillStyle = lit ? `rgb(255,${200 + r() * 50 | 0},${120 + r() * 80 | 0})` : '#000'; g.fillRect(x, y, 13, 15); }
  });
  TEX.water = canvasTex(256, 256, (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#1d6f8f'); grd.addColorStop(1, '#124d6b'); g.fillStyle = grd; g.fillRect(0, 0, w, h); const r = mulberry32(9); for (let i = 0; i < 400; i++) { g.strokeStyle = `rgba(255,255,255,${r() * 0.15})`; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + 10 + r() * 20, y + r() * 2); g.stroke(); } });
  TEX.crowd = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = mulberry32(77); const cols = ['#ff2e88', '#00e5ff', '#ffd23f', '#7dff6b', '#ffffff', '#ff7a00', '#9b5de5', '#333'];
    for (let i = 0; i < 46; i++) { const x = i * 11 + r() * 6, hh = 70 + r() * 30; g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect(x, h - hh + 22, 9, hh - 40); g.fillStyle = '#2a2a2a'; g.fillRect(x + 1, h - 20, 3, 20); g.fillRect(x + 5, h - 20, 3, 20); g.fillStyle = ['#f1c27d', '#8d5524', '#e0ac69', '#c68642'][(r() * 4) | 0]; g.beginPath(); g.arc(x + 4.5, h - hh + 14, 6, 0, 7); g.fill(); if (r() < 0.4) { g.fillStyle = cols[(r() * cols.length) | 0]; g.fillRect(x + 7, h - hh - 10, 3, 28); } }
  }, false);
  TEX.crowd.wrapS = THREE.RepeatWrapping;
  TEX.banner = canvasTex(512, 128, (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#ff2e88'); grd.addColorStop(0.5, '#ff7a00'); grd.addColorStop(1, '#ffd23f'); g.fillStyle = grd; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 70px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('HORIZON', w / 2, 92); }, false);
  TEX.flare = canvasTex(64, 64, (g, w, h) => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, false);
  TEX.smoke = canvasTex(64, 64, (g, w, h) => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, false);
  TEX.chevron = canvasTex(64, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; for (let y = 20; y < h; y += 64) { g.beginPath(); g.moveTo(8, y + 30); g.lineTo(w / 2, y); g.lineTo(w - 8, y + 30); g.stroke(); } });
}

// ---------- biome regions ----------
export const REGIONS = [
  { id: 'hub', name: 'Horizon Festival', x: 0, z: 0, r: 420, box: false, h: 22 },
  { id: 'stadium', name: 'Horizon Stadium', x: 1000, z: 700, r: 360, h: 24 },
  { id: 'city', name: 'Puerto Sol City', x: 300, z: 2700, r: 950, box: true, h: 14 },
  { id: 'port', name: 'Ironbay Port', x: -2600, z: 2850, r: 700, box: true, h: 4.5 },
  { id: 'salt', name: 'Bonneville Salt Flats', x: 2750, z: 2650, r: 1050, h: 9 },
  { id: 'canyon', name: 'Red Rock Canyon', x: 2650, z: 100, r: 1400 },
  { id: 'alpine', name: 'Cumbre Alpine Pass', x: -300, z: -2600, r: 1500 },
  { id: 'obs', name: 'Observatory Peak', x: 2700, z: -2700, r: 950 },
  { id: 'jungle', name: 'Selva Rally Jungle', x: -2650, z: -2200, r: 1150 },
  { id: 'coast', name: 'Costa Highway', x: -3300, z: 300, r: 900, wide: 2600 },
  { id: 'farm', name: 'Valle Farmland', x: -1500, z: 650, r: 1300 },
];
const REG = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// =====================================================================
// World
// =====================================================================
export class World {
  constructor(scene, renderer, settings, seed = 6) {
    this.scene = scene; this.renderer = renderer; this.settings = settings; this.seed = seed;
    this.n1 = new Noise(seed); this.n2 = new Noise(seed * 31 + 7); this.n3 = new Noise(seed * 97 + 3);
    this.waterLevel = 0; this.time = 0; this.tod = 11; this.timeScale = 60; // 1 real sec = 1 game min
    this.env = { wet: 0, snow: 0 }; this.chunks = new Map(); this.colHash = new Map(); this.buildQueue = [];
    this.breakables = []; this.debris = []; this.onSmash = null;
    if (!TEX.asphalt) makeTextures();
    this.buildRoads();
    this.buildMaterials();
    this.root = new THREE.Group(); scene.add(this.root);
    this.buildSky(); this.buildWater(); this.buildHorizon(); this.buildLandmarks(); this.buildRail();
    this.particles = new Particles(scene, settings); this.glow = new Particles(scene, settings, true); this.skids = new Skids(scene);
    this.weather = new Weather(this, scene); this.traffic = new Traffic(this, scene); this.wild = new Wildlife(this, scene);
    this.crowds = new Crowds(this, scene);
    this.lightPool = []; for (let i = 0; i < 6; i++) { const L = new THREE.PointLight(0xffd59a, 0, 38, 1.6); scene.add(L); this.lightPool.push(L); }
    this.streetLights = []; // global positions for pool
  }

  // ------------------------------ terrain height ------------------------------
  regionWeights(x, z, out) {
    let sum = 0; out.length = 0;
    for (const r of REGIONS) {
      let d; if (r.id === 'coast') { d = Math.max(0, x - (-3000)) * 1.0; const w = 1 - smoothstep(0, 500, d); if (w > 0.001) { out.push([r, w]); sum += w; } continue; }
      d = r.box ? Math.max(Math.abs(x - r.x), Math.abs(z - r.z)) : Math.hypot(x - r.x, z - r.z);
      const w = 1 - smoothstep(r.r * (r.box ? 0.78 : 0.55), r.r, d);
      if (w > 0.001) { out.push([r, w]); sum += w; }
    }
    if (sum < 1) { out.push([null, 1 - sum]); sum = 1; }
    for (const o of out) o[1] /= sum; return out;
  }
  biomeH(id, x, z) {
    const n1 = this.n1, n2 = this.n2;
    switch (id) {
      case 'hub': return 22 + n1.n2(x / 300, z / 300) * 0.6;
      case 'stadium': return 24;
      case 'city': return 14 + n1.n2(x / 900, z / 900) * 0.4;
      case 'port': return 4.5;
      case 'salt': return 9 + n2.n2(x / 600, z / 600) * 0.3;
      case 'farm': return 20 + n1.fbm(x / 1100, z / 1100, 3) * 18 + n2.n2(x / 250, z / 250) * 3;
      case 'coast': return 16 + n1.fbm(x / 500, z / 500, 3) * 14 + n2.n2(x / 120, z / 120) * 2;
      case 'canyon': {
        const n = n1.fbm(x / 650 + 11, z / 650, 3); let t = clamp(n * 1.6 + 0.45, 0, 1);
        const q = t * 4, f = q - Math.floor(q); const ter = (Math.floor(q) + smoothstep(0.7, 1, f)) / 4;
        const val = n2.ridged(x / 900, z / 900, 3);
        return 35 + ter * 150 - smoothstep(0.75, 1, val) * 50 + n2.n2(x / 60, z / 60) * 1.5;
      }
      case 'alpine': { const rg = n1.ridged(x / 1300 + 3, z / 1300, 5); return 80 + rg * 470 + n2.fbm(x / 220, z / 220, 3) * 18; }
      case 'obs': { const d = Math.hypot(x - 2700, z + 2700); return 160 + 330 * Math.exp(-((d / 650) ** 2)) + n1.ridged(x / 700, z / 700, 4) * 90; }
      case 'jungle': return 40 + n1.fbm(x / 420, z / 420, 4) * 50 + n2.ridged(x / 260, z / 260, 3) * 22;
      default: return 26 + n1.fbm(x / 1500, z / 1500, 4) * 38 + n2.n2(x / 300, z / 300) * 6;
    }
  }
  heightRaw(x, z) {
    const W = this._rw || (this._rw = []); this.regionWeights(x, z, W);
    let h = 0; for (const [r, w] of W) h += w * this.biomeH(r ? r.id : 'plains', x, z);
    const e = Math.max(Math.abs(x), Math.abs(z)) + this.n3.n2(x / 700, z / 700) * 180;
    const edge = smoothstep(3450, 3950, e); h = lerp(h, -22, edge);
    return h;
  }
  dominant(x, z) { const W = this._rw2 || (this._rw2 = []); this.regionWeights(x, z, W); let best = null, bw = -1; for (const [r, w] of W) if (w > bw) { bw = w; best = r; } return best ? best.id : 'plains'; }
  regionName(x, z) { const id = this.dominant(x, z); return id === 'plains' ? 'Horizon Plains' : REG[id].name; }

  // ------------------------------ roads ------------------------------
  buildRoads() {
    const N = {
      HUB: [0, 0], ALP_S: [-100, -1400], PASS: [-300, -2700], JUNG: [-2600, -2300], J2: [-1500, -2700], OBS_B: [2200, -2600], OBS_T: [2700, -2700],
      COAST_N: [-3100, -1000], COAST_M: [-3050, -200], COAST_S: [-3050, 1400], PORT: [-2550, 2700], FARM_A: [-1100, 300], FARM_N: [-1200, -900],
      CAN_W: [1700, 100], CAN_E: [3200, 150], STAD_N: [1000, 560], STAD_S: [1000, 840], SALT_N: [2600, 2300], CITY_N: [300, 1900], CITY_W: [-500, 2700],
      CITY_E: [1100, 2700], CITY_NW: [-500, 1900], CAN_MID: [2400, 200], SALT_E: [3450, 1600], DRAG_W: [2150, 2950], DRAG_E: [3450, 2950], HUB_E: [220, 0], HUB_W: [-220, 0],
    };
    const E = [];
    const add = (a, b, pts, type = 'main', width = 12, opt = {}) => E.push({ a, b, pts, type, width, ...opt });
    // tarmac network
    add('HUB', 'ALP_S', [[0, -420], [-160, -900]], 'main', 12, { name: 'Festival Avenue' });
    add('ALP_S', 'PASS', [[200, -1600], [-200, -1760], [250, -1910], [-250, -2060], [200, -2210], [-280, -2360], [120, -2520]], 'main', 11, { name: 'Cumbre Switchbacks', noWiggle: true, curvy: true });
    add('PASS', 'J2', [[-800, -2920], [-1200, -2820]], 'main', 11, { name: 'Cumbre Descent' });
    add('J2', 'JUNG', [[-1900, -2550], [-2250, -2450]], 'main', 11, { name: 'Selva Road' });
    add('PASS', 'OBS_B', [[400, -3000], [1100, -3120], [1800, -2900]], 'main', 11, { name: 'Ridgeback Road' });
    add('OBS_B', 'OBS_T', [[2480, -2470], [2320, -2740], [2640, -2580], [2520, -2840]], 'main', 10, { name: 'Observatory Climb', noWiggle: true, curvy: true });
    add('JUNG', 'COAST_N', [[-2950, -1750]], 'highway', 16, { name: 'Costa Highway N' });
    add('COAST_N', 'COAST_M', [[-3150, -600]], 'highway', 16, { name: 'Costa Highway' });
    add('COAST_M', 'COAST_S', [[-3150, 600]], 'highway', 16, { name: 'Costa Highway' });
    add('COAST_S', 'PORT', [[-2900, 2100]], 'highway', 16, { name: 'Costa Highway S' });
    add('HUB_W', 'FARM_A', [[-600, 180]], 'main', 12, { name: 'Valle Road' });
    add('FARM_A', 'COAST_M', [[-1700, 100], [-2400, -20]], 'main', 12, { name: 'Valle Road W' });
    add('HUB_E', 'CAN_W', [[600, -100], [1150, -40]], 'highway', 16, { name: 'Canyon Expressway' });
    add('CAN_W', 'CAN_MID', [[2050, -150]], 'main', 12, { name: 'Red Rock Run' });
    add('CAN_MID', 'CAN_E', [[2800, -120]], 'main', 12, { name: 'Red Rock Run' });
    add('CAN_E', 'OBS_B', [[3450, -400], [3250, -1000], [2900, -1600], [2600, -2150]], 'main', 12, { name: 'Mesa Mountain Road' });
    add('HUB', 'STAD_N', [[450, 330]], 'main', 14, { name: 'Stadium Way' });
    add('STAD_S', 'SALT_N', [[1600, 1250], [2100, 1800]], 'highway', 16, { name: 'Salt Highway' });
    add('HUB', 'CITY_N', [[100, 600], [220, 1250]], 'highway', 16, { name: 'Sol Freeway' });
    add('CITY_W', 'PORT', [[-1200, 2900], [-1900, 3000]], 'highway', 16, { name: 'Port Link' });
    add('CITY_E', 'SALT_N', [[1700, 2650], [2250, 2500]], 'main', 14, { name: 'Flats Road' });
    add('CAN_E', 'SALT_E', [[3350, 800]], 'main', 12, { name: 'Canyon South' });
    add('SALT_E', 'SALT_N', [[3050, 2000]], 'main', 12, { name: 'Canyon South' });
    add('DRAG_W', 'DRAG_E', [], 'strip', 30, { name: 'Salt Flats Drag Strip', noWiggle: true });
    add('SALT_N', 'DRAG_W', [[2300, 2650]], 'main', 12, { name: 'Strip Access' });
    // hub ring (two halves)
    const ring = (cx, cz, rx, rz, a0, a1, n) => { const p = []; for (let i = 1; i < n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]); } return p; };
    add('HUB_E', 'HUB_W', ring(0, 0, 220, 220, 0, Math.PI, 14), 'track', 14, { name: 'Festival Ring', noWiggle: true, loop: 'hub' });
    add('HUB_W', 'HUB_E', ring(0, 0, 220, 220, Math.PI, Math.PI * 2, 14), 'track', 14, { name: 'Festival Ring', noWiggle: true, loop: 'hub' });
    add('STAD_N', 'STAD_S', ring(1000, 700, 260, 140, -Math.PI / 2, Math.PI / 2, 16), 'track', 16, { name: 'Stadium Oval', noWiggle: true, loop: 'stadium' });
    add('STAD_S', 'STAD_N', ring(1000, 700, 260, 140, Math.PI / 2, Math.PI * 1.5, 16), 'track', 16, { name: 'Stadium Oval', noWiggle: true, loop: 'stadium' });
    add('HUB', 'HUB_E', [], 'main', 14, { name: 'Festival Spur', noWiggle: true }); add('HUB', 'HUB_W', [], 'main', 14, { name: 'Festival Spur', noWiggle: true });
    // dirt & gravel
    add('FARM_A', 'FARM_N', [[-1320, -200], [-1180, -650]], 'dirt', 8, { name: 'Farm Trail' });
    add('FARM_N', 'ALP_S', [[-700, -1220]], 'dirt', 8, { name: 'Foothill Trail' });
    add('FARM_A', 'COAST_S', [[-1400, 820], [-1900, 1020], [-2400, 820], [-2750, 1200]], 'dirt', 8, { name: 'Valle Dirt Run' });
    add('JUNG', 'COAST_N', [[-2200, -1900], [-1800, -2100], [-1600, -1700], [-2000, -1420], [-2450, -1600], [-2800, -1300]], 'gravel', 8, { name: 'Selva Rally Stage', curvy: true });
    add('JUNG', 'J2', [[-2900, -2700], [-2550, -3100], [-2000, -3050], [-1700, -2850]], 'gravel', 8, { name: 'Selva Loop', curvy: true });
    add('CAN_W', 'CAN_E', [[1900, 600], [2300, 900], [2800, 720], [3100, 420]], 'dirt', 9, { name: 'Canyon Floor Trail', curvy: true });
    add('ALP_S', 'PASS', [[-600, -1700], [-900, -2100], [-700, -2480]], 'gravel', 8, { name: 'Fire Road', curvy: true });
    add('HUB', 'CITY_NW', [[-300, 650], [-800, 950], [-1050, 1400], [-750, 1800]], 'dirt', 8, { name: 'Ranch Road' });
    add('CAN_MID', 'OBS_B', [[2300, -600], [2000, -1200], [1900, -1900]], 'dirt', 8, { name: 'Mesa Shortcut', curvy: true, hidden: true });
    add('COAST_S', 'CITY_NW', [[-2500, 1650], [-1500, 1750]], 'dirt', 8, { name: 'Cliff Run' });
    // city grid
    const gx = [], gz = []; for (let i = 0; i <= 8; i++) { gx.push(-500 + i * 200); gz.push(1900 + i * 200); }
    const key = (i, j) => { const x = gx[i], z = gz[j]; for (const k in N) if (N[k][0] === x && N[k][1] === z) return k; const k = `C${i}_${j}`; N[k] = [x, z]; return k; };
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      if (i < 8) add(key(i, j), key(i + 1, j), [], 'city', j % 4 === 0 ? 16 : 13, { name: 'Calle ' + (j + 1), noWiggle: true });
      if (j < 8) add(key(i, j), key(i, j + 1), [], 'city', i % 4 === 0 ? 16 : 13, { name: 'Avenida ' + (i + 1), noWiggle: true });
    }
    // build sampled polylines
    this.nodes = {}; for (const k in N) this.nodes[k] = { id: k, x: N[k][0], z: N[k][1], edges: [], h: 0 };
    for (const k in this.nodes) { const n = this.nodes[k]; n.h = this.heightRaw(n.x, n.z); }
    const SP = 5; this.edges = [];
    E.forEach((e, ei) => {
      const A = this.nodes[e.a], Bn = this.nodes[e.b];
      let cps = [[A.x, A.z], ...e.pts, [Bn.x, Bn.z]];
      if (!e.noWiggle) { // insert wiggles for natural sweepers
        const out = [cps[0]]; const rnd = mulberry32(ei * 131 + 5);
        for (let i = 0; i < cps.length - 1; i++) { const [ax, az] = cps[i], [bx, bz] = cps[i + 1]; const L = Math.hypot(bx - ax, bz - az); const k = Math.max(1, Math.floor(L / 260)); for (let j = 1; j <= k; j++) { const t = j / (k + 1); const off = (rnd() - 0.5) * Math.min(160, L * 0.22) * (e.curvy ? 1.6 : 1); out.push([ax + (bx - ax) * t + (-(bz - az) / L) * off, az + (bz - az) * t + ((bx - ax) / L) * off]); } out.push(cps[i + 1]); }
        cps = out;
      }
      // catmull-rom sample
      const pts = [];
      for (let i = 0; i < cps.length - 1; i++) {
        const p0 = cps[Math.max(0, i - 1)], p1 = cps[i], p2 = cps[i + 1], p3 = cps[Math.min(cps.length - 1, i + 2)];
        const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const n = Math.max(1, Math.ceil(L / SP));
        for (let j = 0; j < n; j++) { const t = j / n, t2 = t * t, t3 = t2 * t; const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); }
      }
      pts.push(cps[cps.length - 1]);
      const n = pts.length; const xs = new Float32Array(n), zs = new Float32Array(n), raw = new Float32Array(n), hs = new Float32Array(n), dist = new Float32Array(n);
      for (let i = 0; i < n; i++) { xs[i] = pts[i][0]; zs[i] = pts[i][1]; raw[i] = this.heightRaw(xs[i], zs[i]); if (i) dist[i] = dist[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]); }
      // smoothing
      let cur = Float32Array.from(raw); const win = e.type === 'dirt' || e.type === 'gravel' ? 5 : 12;
      for (let pass = 0; pass < 3; pass++) { const nx = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = -win; j <= win; j++) { const k = clamp(i + j, 0, n - 1); s += cur[k]; c++; } nx[i] = s / c; } cur = nx; }
      // keep sea crossings above water
      for (let i = 0; i < n; i++) cur[i] = Math.max(cur[i], 3.5);
      // pin endpoints to node heights with blend
      const hA = A.h, hB = Bn.h; const bl = Math.min(40, n / 2 | 0);
      for (let i = 0; i < n; i++) { const ta = 1 - smoothstep(0, bl, i), tb = 1 - smoothstep(0, bl, n - 1 - i); cur[i] = cur[i] * (1 - ta - tb + ta * tb) + hA * ta * (1 - tb) + hB * tb * (1 - ta); }
      // grade limiting
      const maxG = e.type === 'dirt' || e.type === 'gravel' ? 0.16 : 0.105;
      for (let it = 0; it < 2; it++) { for (let i = 1; i < n; i++) { const dl = dist[i] - dist[i - 1]; cur[i] = clamp(cur[i], cur[i - 1] - maxG * dl, cur[i - 1] + maxG * dl); } for (let i = n - 2; i >= 0; i--) { const dl = dist[i + 1] - dist[i]; cur[i] = clamp(cur[i], cur[i + 1] - maxG * dl, cur[i + 1] + maxG * dl); } }
      cur[0] = hA; cur[n - 1] = hB; hs.set(cur);
      const flags = new Uint8Array(n);
      for (let i = 0; i < n; i++) { if (hs[i] - raw[i] > 6 || raw[i] < 1) flags[i] |= 1; if (raw[i] - hs[i] > 11 && e.type !== 'dirt') flags[i] |= 2; }
      // dilate flags
      const f2 = Uint8Array.from(flags); for (let i = 0; i < n; i++) for (let j = -2; j <= 2; j++) { const k = clamp(i + j, 0, n - 1); f2[i] |= flags[k]; }
      // lateral vectors
      const lx = new Float32Array(n), lz = new Float32Array(n);
      for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = xs[b] - xs[a], dz = zs[b] - zs[a]; const L = Math.hypot(dx, dz) || 1; lx[i] = -dz / L; lz[i] = dx / L; }
      const ed = { id: ei, a: e.a, b: e.b, type: e.type, width: e.width, hw: e.width / 2, name: e.name, xs, zs, hs, raw, dist, flags: f2, lx, lz, n, len: dist[n - 1], hidden: e.hidden, loop: e.loop };
      ed.surf = e.type === 'dirt' ? SURF.dirt : e.type === 'gravel' ? SURF.gravel : e.type === 'strip' ? SURF.salt : SURF.tarmac;
      ed.speed = e.type === 'highway' ? 27 : e.type === 'city' ? 14 : e.type === 'main' ? 21 : 15;
      this.edges.push(ed); A.edges.push(ed); Bn.edges.push(ed);
    });
    // segment spatial hash
    this.roadHash = new Map(); const INF = 50; let segCount = 0;
    for (const ed of this.edges) for (let i = 0; i < ed.n - 1; i++) {
      const ax = ed.xs[i], az = ed.zs[i], bx = ed.xs[i + 1], bz = ed.zs[i + 1];
      const x0 = Math.floor((Math.min(ax, bx) - INF) / ROAD_CELL), x1 = Math.floor((Math.max(ax, bx) + INF) / ROAD_CELL);
      const z0 = Math.floor((Math.min(az, bz) - INF) / ROAD_CELL), z1 = Math.floor((Math.max(az, bz) + INF) / ROAD_CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const k = cx * 100003 + cz; let a = this.roadHash.get(k); if (!a) this.roadHash.set(k, a = []); a.push(ed, i); }
      segCount++;
    }
    this.segCount = segCount;
    this.totalRoadKm = this.edges.reduce((s, e) => s + e.len, 0) / 1000;
  }
  // nearest road within influence
  roadQuery(x, z, out = this._rq || (this._rq = {})) {
    const k = Math.floor(x / ROAD_CELL) * 100003 + Math.floor(z / ROAD_CELL); const a = this.roadHash.get(k);
    out.d = 1e9; out.edge = null; if (!a) return null;
    for (let j = 0; j < a.length; j += 2) {
      const ed = a[j], i = a[j + 1]; const ax = ed.xs[i], az = ed.zs[i], dx = ed.xs[i + 1] - ax, dz = ed.zs[i + 1] - az;
      const L2 = dx * dx + dz * dz; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, pz = az + dz * t - z; const d = Math.sqrt(px * px + pz * pz) - ed.hw;
      if (d < out.d) { out.d = d; out.edge = ed; out.i = i; out.t = t; out.dist = Math.sqrt(px * px + pz * pz); }
    }
    if (!out.edge) return null;
    const ed = out.edge, i = out.i; out.hr = ed.hs[i] + (ed.hs[i + 1] - ed.hs[i]) * out.t; out.hw = ed.hw; out.flags = ed.flags[i] | ed.flags[i + 1];
    out.s = ed.dist[i] + (ed.dist[i + 1] - ed.dist[i]) * out.t;
    // signed lateral offset (positive = left side)
    out.lat = (x - (ed.xs[i] + (ed.xs[i + 1] - ed.xs[i]) * out.t)) * ed.lx[i] + (z - (ed.zs[i] + (ed.zs[i + 1] - ed.zs[i]) * out.t)) * ed.lz[i];
    return out;
  }
  height(x, z) {
    const raw = this.heightRaw(x, z); const q = this.roadQuery(x, z, this._rqh || (this._rqh = {}));
    if (!q || q.d > 48) return raw;
    if ((q.flags & 1) && q.hr > raw + 2) return raw;
    const dh = Math.abs(raw - q.hr); const inner = 1.2, sh = Math.min(40, 5 + dh * 1.3);
    if (q.d <= inner) return q.hr - 0.03;
    if (q.d >= inner + sh) return raw;
    return lerp(q.hr - 0.03, raw, smoothstep(inner, inner + sh, q.d));
  }
  // physics ground query (y = query origin height for bridges)
  ground(x, z, out, y = 1e9) {
    const q = this.roadQuery(x, z, this._rqg || (this._rqg = {}));
    out.water = 0; out.kerb = 0;
    if (q && q.d <= 0.2) {
      const ed = q.edge, i = q.i; const onBridge = q.flags & 1;
      if (!onBridge || y > q.hr - 2.5) {
        out.h = q.hr; const dx = ed.xs[i + 1] - ed.xs[i], dz = ed.zs[i + 1] - ed.zs[i], dh = ed.hs[i + 1] - ed.hs[i]; const L = Math.hypot(dx, dz) || 1;
        const sl = dh / L; const inv = 1 / Math.sqrt(1 + sl * sl); out.nx = -dx / L * sl * inv; out.nz = -dz / L * sl * inv; out.ny = inv;
        out.surf = ed.surf; if (ed.type === 'track' && q.d > -1.6) { out.kerb = 1; out.h += 0.04 * Math.sin(q.s * 4); }
        if (this.env.wet > 0.45 && ed.surf === SURF.tarmac) { const pn = this.n3.n2(x / 9, z / 9); if (pn > 0.5) out.water = (pn - 0.5) * 0.25 * (this.env.wet - 0.4); }
        return out;
      }
    }
    // terrain: use loaded chunk grid (exact mesh match) else analytic
    const h = this.gridHeight(x, z, out);
    if (h === null) { const e = 0.8; const hc = this.height(x, z); const hx = this.height(x + e, z), hz = this.height(x, z + e); out.h = hc; let nx = hc - hx, nz = hc - hz, ny = e; const l = Math.hypot(nx, ny, nz); out.nx = nx / l; out.ny = ny / l; out.nz = nz / l; }
    out.surf = this.surfaceAt(x, z, out.h, out.ny, q);
    if (out.surf.bump) { out.h += out.surf.bump * (this.n2.n2(x * 0.7, z * 0.7) + 0.5 * this.n3.n2(x * 2.1, z * 2.1)); }
    if (out.h < this.waterLevel + 0.15) { out.water = clamp(this.waterLevel - out.h + 0.15, 0, 2); }
    return out;
  }
  gridHeight(x, z, out) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK); const c = this.chunks.get(cx + ',' + cz);
    if (!c || !c.grid || c.res !== 64) return null;
    const res = c.res, step = CHUNK / res; const lx = (x - cx * CHUNK) / step, lz = (z - cz * CHUNK) / step;
    const i = Math.min(res - 1, Math.floor(lx)), j = Math.min(res - 1, Math.floor(lz)); const fx = lx - i, fz = lz - j; const W = res + 1, g = c.grid;
    const h00 = g[j * W + i], h10 = g[j * W + i + 1], h01 = g[(j + 1) * W + i], h11 = g[(j + 1) * W + i + 1];
    // match PlaneGeometry triangulation: (a=i,j  b=i,j+1  c=i+1,j+1  d=i+1,j) tris a-b-d and b-c-d
    let h, nx, nz;
    if (fx + fz <= 1) { h = h00 + (h10 - h00) * fx + (h01 - h00) * fz; nx = h00 - h10; nz = h00 - h01; }
    else { h = h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz); nx = h01 - h11; nz = h10 - h11; }
    const l = Math.hypot(nx, step, nz); out.h = h; out.nx = nx / l; out.ny = step / l; out.nz = nz / l; return h;
  }
  surfaceAt(x, z, h, ny, q) {
    if (h < this.waterLevel + 0.1) return SURF.water;
    if (q && q.d < 3 && q.edge && q.edge.type !== 'dirt' && q.edge.type !== 'gravel') return SURF.concrete;
    const id = this.dominant(x, z); const n = this.n2.n2(x / 40, z / 40);
    if (ny < 0.72) return id === 'alpine' || id === 'obs' ? SURF.rock : (id === 'canyon' ? SURF.rock : SURF.dirt);
    switch (id) {
      case 'hub': case 'stadium': return SURF.grass;
      case 'city': case 'port': return SURF.concrete;
      case 'salt': return SURF.salt;
      case 'canyon': return n > 0.2 ? SURF.sand : SURF.dirt;
      case 'alpine': case 'obs': return h > 300 ? SURF.snow : h > 210 ? SURF.gravel : SURF.grass;
      case 'jungle': return n > 0.35 ? SURF.mud : n > -0.2 ? SURF.dirt : SURF.grass;
      case 'farm': return Math.sin((x + z * 0.3) / 18) > 0.2 ? SURF.dirt : SURF.grass;
      case 'coast': return h < 4 ? SURF.sand : SURF.grass;
      default: return n > 0.5 ? SURF.dirt : SURF.grass;
    }
  }
  terrainColor(x, z, h, ny, out) {
    const id = this.dominant(x, z); const n = this.n2.n2(x / 35, z / 35) * 0.5 + 0.5; const n2 = this.n1.n2(x / 9, z / 9) * 0.5 + 0.5;
    const set = (r, g, b) => { out[0] = r; out[1] = g; out[2] = b; };
    const v = 0.88 + n2 * 0.18;
    if (h < 0.6) { set(0.76 * v, 0.68 * v, 0.5 * v); return; }
    if (ny < 0.7) { if (id === 'canyon') set(0.62 * v, 0.3 * v, 0.18 * v); else set(0.45 * v, 0.42 * v, 0.38 * v); return; }
    switch (id) {
      case 'canyon': { const band = Math.sin(h * 0.35) * 0.5 + 0.5; set((0.66 + band * 0.12) * v, (0.36 + band * 0.08) * v, 0.2 * v); if (n > 0.65) set(0.78 * v, 0.6 * v, 0.4 * v); return; }
      case 'salt': set(0.93 * v, 0.91 * v, 0.87 * v); return;
      case 'city': case 'port': set(0.52 * v, 0.52 * v, 0.5 * v); return;
      case 'alpine': case 'obs': if (h > 300) set(0.94, 0.96, 0.98); else if (h > 210) set(0.52 * v, 0.5 * v, 0.47 * v); else set(0.3 * v, 0.46 * v, 0.24 * v); return;
      case 'jungle': set(0.17 * v, 0.4 * v, 0.15 * v); if (n > 0.7) set(0.36 * v, 0.28 * v, 0.18 * v); return;
      case 'farm': { const s = Math.sin((x + z * 0.3) / 18); if (s > 0.2) set(0.55 * v, 0.42 * v, 0.25 * v); else if (s > -0.4) set(0.72 * v, 0.66 * v, 0.3 * v); else set(0.35 * v, 0.52 * v, 0.22 * v); return; }
      case 'coast': if (h < 4) set(0.86 * v, 0.78 * v, 0.56 * v); else set(0.42 * v, 0.55 * v, 0.28 * v); return;
      case 'hub': case 'stadium': set(0.33 * v, 0.55 * v, 0.25 * v); return;
      default: set((0.42 + n * 0.12) * v, (0.55 - n * 0.05) * v, 0.26 * v);
    }
  }

  // ------------------------------ materials ------------------------------
  buildMaterials() {
    const snowU = this.snowU = { value: 0 }, wetU = this.wetU = { value: 0 };
    const terr = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: TEX.ground });
    terr.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snowU; sh.uniforms.uWet = wetU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWN = normalize(mat3(modelMatrix) * normal); vWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (modelMatrix * vec4(position,1.0)).xz / 14.0;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnow; uniform float uWet; varying vec3 vWN; varying vec3 vWP;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat sn = smoothstep(0.55,0.9,vWN.y) * uSnow * smoothstep(-2.0, 6.0, vWP.y); diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93,0.95,0.98), clamp(sn,0.0,1.0)); diffuseColor.rgb *= 1.0 - uWet*0.25;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, uWet*0.6);');
    };
    this.mTerrain = terr;
    const roadMat = (tex, rough) => { const m = new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); m.onBeforeCompile = (sh) => { sh.uniforms.uWet = wetU; sh.uniforms.uSnow = snowU; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet; uniform float uSnow;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uWet*0.35; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.88,0.92), uSnow*0.35);').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, uWet);'); }; return m; };
    this.mRoad = { main: roadMat(TEX.asphalt, 0.85), highway: roadMat(TEX.highway, 0.85), city: roadMat(TEX.city, 0.85), track: roadMat(TEX.track, 0.8), strip: roadMat(TEX.highway, 0.7), dirt: roadMat(TEX.dirt, 1), gravel: roadMat(TEX.gravel, 1) };
    const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    this.M = {
      trunk: std(0x5a3d26), pine: std(0x1f4d2b), leaf: std(0x3f7a2a), palm: std(0x4f8a2a), cactus: std(0x4c7a3a), rock: std(0x8a7d70), redrock: std(0xa5502c, { roughness: 0.95 }),
      concrete: std(0x9a9a95), steel: std(0x7d8590, { metalness: 0.6, roughness: 0.5 }), rail: std(0xe0e0e0, { metalness: 0.5, roughness: 0.4 }), wood: std(0x8b6a43), hay: std(0xd9b44a, { roughness: 1 }),
      sign: std(0xffd23f), signPost: std(0x666666, { metalness: 0.5 }), barrel: std(0xd94a2b, { metalness: 0.3, roughness: 0.6 }), white: std(0xf2f2f2), red: std(0xd22222), dark: std(0x222428),
      lamp: new THREE.MeshStandardMaterial({ color: 0xffeecc, emissive: 0xffc070, emissiveIntensity: 0 }), building: new THREE.MeshStandardMaterial({ map: TEX.windows, emissiveMap: TEX.windowsEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6, metalness: 0.2 }),
      barn: std(0x9b2d20), roof: std(0x4a4a4f), container: new THREE.MeshStandardMaterial({ vertexColors: false, color: 0xffffff, roughness: 0.7, metalness: 0.3 }), fence: std(0xb89a6a), bush: std(0x4a6b2a), deadtree: std(0x6b5a48), snowcap: std(0xf5f7fa),
      crowd: new THREE.MeshBasicMaterial({ map: TEX.crowd, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }), banner: new THREE.MeshBasicMaterial({ map: TEX.banner, side: THREE.DoubleSide }),
      tunnelLight: new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), glass: new THREE.MeshStandardMaterial({ color: 0x9fd3ff, metalness: 0.9, roughness: 0.1 }),
    };
    this.M.container.vertexColors = false;
    // shared geometries
    const g = {};
    g.trunk = new THREE.CylinderGeometry(0.25, 0.4, 4, 6).translate(0, 2, 0);
    g.pine = new THREE.ConeGeometry(2.4, 8, 7).translate(0, 7.5, 0);
    g.leaf = new THREE.IcosahedronGeometry(3.2, 0).translate(0, 5.6, 0);
    g.palmTrunk = new THREE.CylinderGeometry(0.2, 0.35, 8, 5).translate(0, 4, 0);
    g.palm = new THREE.ConeGeometry(3.8, 1.6, 7).translate(0, 8.2, 0);
    g.cactus = mergeGeos([new THREE.CylinderGeometry(0.35, 0.4, 4, 7).translate(0, 2, 0), new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6).rotateZ(Math.PI / 2).translate(0.8, 2.2, 0), new THREE.CylinderGeometry(0.2, 0.2, 1.4, 6).translate(1.5, 2.9, 0)]);
    g.rock = new THREE.DodecahedronGeometry(1.6, 0);
    g.hoodoo = new THREE.CylinderGeometry(4, 9, 40, 7).translate(0, 18, 0);
    g.bush = new THREE.IcosahedronGeometry(1.1, 0).translate(0, 0.7, 0);
    g.hay = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 10).rotateZ(Math.PI / 2).translate(0, 0.75, 0);
    g.barrel = new THREE.CylinderGeometry(0.32, 0.32, 0.9, 10).translate(0, 0.45, 0);
    g.sign = mergeGeos([new THREE.BoxGeometry(0.08, 2.4, 0.08).translate(0, 1.2, 0), new THREE.BoxGeometry(1.2, 0.8, 0.05).translate(0, 2.4, 0)]);
    g.fence = mergeGeos([new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(-2, 0.6, 0), new THREE.BoxGeometry(4, 0.12, 0.06).translate(0, 0.9, 0), new THREE.BoxGeometry(4, 0.12, 0.06).translate(0, 0.45, 0)]);
    g.pole = new THREE.CylinderGeometry(0.1, 0.14, 8, 6).translate(0, 4, 0);
    g.lampHead = new THREE.BoxGeometry(0.5, 0.2, 1.4).translate(0, 8, 0.6);
    g.box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    g.cone = new THREE.ConeGeometry(0.25, 0.7, 8).translate(0, 0.35, 0);
    g.deadtree = mergeGeos([new THREE.CylinderGeometry(0.12, 0.2, 3, 5).translate(0, 1.5, 0), new THREE.CylinderGeometry(0.06, 0.08, 1.4, 4).rotateZ(0.8).translate(0.4, 2.6, 0)]);
    this.G = g;
  }

  // ------------------------------ sky / lights ------------------------------
  buildSky() {
    const sc = this.scene;
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6); this.sun.castShadow = true; sc.add(this.sun); sc.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6b5a40, 0.9); sc.add(this.hemi);
    this.applyShadowQuality();
    const skyU = this.skyU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uCloud: { value: 0.3 }, uNight: { value: 0 }, uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uFlash: { value: 0 } };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w*0.9999; }',
      fragmentShader: `uniform vec3 sunDir; uniform float uTime, uCloud, uNight, uFlash; uniform vec3 uTop, uHor, uSunCol; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5;} return s; }
      void main(){ vec3 d = normalize(vD); float y = max(d.y, -0.05);
        vec3 col = mix(uHor, uTop, pow(clamp(y,0.0,1.0), 0.55));
        float sd = max(dot(d, sunDir), 0.0);
        col += uSunCol * (pow(sd, 900.0)*30.0 + pow(sd, 12.0)*0.35 + pow(sd,3.0)*0.12) * (1.0-uCloud*0.7);
        // stars
        if (uNight > 0.01) { vec2 sp = d.xz/(d.y+0.3)*180.0; float st = step(0.997, h(floor(sp))) * uNight * smoothstep(0.0,0.3,d.y); col += vec3(st)*(1.0-uCloud); }
        // moon
        float md = max(dot(d, -sunDir), 0.0); col += vec3(0.8,0.85,1.0) * pow(md, 1500.0) * 6.0 * uNight;
        // clouds
        vec2 cp = d.xz / max(d.y, 0.06) * 1.4 + vec2(uTime*0.004, uTime*0.002);
        float c = fbm(cp); float cov = smoothstep(1.0 - uCloud*0.95 - 0.25, 1.0 - uCloud*0.7, c) * smoothstep(0.0, 0.15, d.y);
        vec3 cc = mix(vec3(0.95,0.95,0.98), uHor*0.6, uCloud*0.6) * (0.5 + 0.5*sd) + uSunCol*pow(sd,4.0)*0.4; cc *= mix(1.0, 0.18, uNight);
        col = mix(col, cc, cov*0.92);
        col += vec3(0.7,0.75,1.0)*uFlash;
        if (d.y < 0.0) col = mix(col, uHor*0.8, smoothstep(0.0,-0.05,d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = -1; sc.add(this.sky);
    sc.fog = new THREE.Fog(0xbfd6ea, 300, 3000);
    // envmap for car reflections
    this.pmrem = new THREE.PMREMGenerator(this.renderer); this.envT = 0; this.updateEnv(true);
  }
  updateEnv(force) {
    if (!force && this.envT > 0) return; this.envT = 20;
    try {
      const sc = new THREE.Scene(); sc.add(this.sky.clone());
      const gnd = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.hemi.groundColor.clone().multiplyScalar(0.5) })); gnd.position.y = -50; sc.add(gnd);
      const rt = this.pmrem.fromScene(sc, 0.04); if (this.envMap) this.envMap.dispose(); this.envMap = rt.texture; this.scene.environment = this.envMap; this._envRT && this._envRT.dispose(); this._envRT = rt;
    } catch (e) { console.warn('env map failed', e); }
  }
  applyShadowQuality() {
    const q = this.settings.shadows; const s = this.sun;
    s.castShadow = q !== 'off'; const size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024; const ext = q === 'low' ? 45 : 75;
    if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    s.shadow.mapSize.set(size, size); const c = s.shadow.camera; c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 1; c.far = 600; c.updateProjectionMatrix(); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.04;
    this.renderer.shadowMap.enabled = q !== 'off';
  }
  buildWater() {
    TEX.water.repeat.set(400, 400);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a7fa0, map: TEX.water, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88 }));
    this.water.position.y = 0; this.water.receiveShadow = false; this.scene.add(this.water);
  }
  // far low-res island for horizon
  buildHorizon() {
    const R = 128; const geo = new THREE.PlaneGeometry(WORLD_HALF * 2.2, WORLD_HALF * 2.2, R, R).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position; const col = new Float32Array(pos.count * 3); const c = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const h = this.heightRaw(x, z); pos.setY(i, h - 2.5); this.terrainColor(x, z, h, 1, c); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    this.horizon = new THREE.Mesh(geo, this.mTerrain); this.horizon.receiveShadow = false; this.scene.add(this.horizon);
    // map image (for minimap / map screen)
    const S = 384; const cv = document.createElement('canvas'); cv.width = S; cv.height = S; const g = cv.getContext('2d'); const img = g.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = (i / S - 0.5) * WORLD_HALF * 2, z = (j / S - 0.5) * WORLD_HALF * 2; const h = this.heightRaw(x, z); const k = (j * S + i) * 4;
      if (h < 0) { img.data[k] = 20; img.data[k + 1] = 70 + h; img.data[k + 2] = 110 + h; }
      else { this.terrainColor(x, z, h, 1, c); const shade = 0.75 + clamp((this.heightRaw(x + 30, z + 30) - h) * -0.02, -0.25, 0.25); img.data[k] = c[0] * 255 * shade; img.data[k + 1] = c[1] * 255 * shade; img.data[k + 2] = c[2] * 255 * shade; }
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0); this.mapImage = cv;
  }

  // ------------------------------ landmarks ------------------------------
  buildLandmarks() {
    const L = this.landmarks = new THREE.Group(); this.root.add(L); const M = this.M; this.globalCols = [];
    const addBox = (x, y, z, sx, sy, sz, mat, rot = 0, col = true, parent = L) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y + sy / 2, z); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; parent.add(m); if (col) this.globalCols.push({ k: 1, x, z, hx: sx / 2, hz: sz / 2, c: Math.cos(rot), s: Math.sin(rot), y0: y, y1: y + sy }); return m; };
    // --- Festival hub ---
    const hy = 22; this.hubLights = [];
    addBox(0, hy, -90, 60, 2, 26, M.dark); // main stage floor
    addBox(-30, hy, -100, 2, 22, 2, M.steel); addBox(30, hy, -100, 2, 22, 2, M.steel); addBox(0, hy + 22, -100, 62, 2, 2, M.steel, 0, false);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), M.banner); screen.position.set(0, hy + 13, -98.9); L.add(screen);
    for (let i = 0; i < 8; i++) { const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: [0xff2e88, 0x00e5ff, 0xffd23f, 0x7dff6b][i % 4], transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.set(-28 + i * 8, hy + 23, -100); beam.geometry.translate(0, 30, 0); L.add(beam); this.hubLights.push(beam); }
    // tents & booths
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const x = Math.cos(a) * 110, z = Math.sin(a) * 110 + 10; if (z < -60) continue; const t = new THREE.Mesh(new THREE.ConeGeometry(9, 8, 4), new THREE.MeshStandardMaterial({ color: [0xffffff, 0xff2e88, 0x00b4d8, 0xffd23f][i % 4] })); t.position.set(x, hy + 7, z); t.rotation.y = Math.PI / 4; t.castShadow = true; L.add(t); addBox(x, hy, z, 12, 3, 12, M.white); }
    // HORIZON letters
    const word = 'HORIZON'; word.split('').forEach((ch, i) => { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.font = 'bold 120px Arial Black, Arial'; g.textAlign = 'center'; g.fillText(ch, 64, 112); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: tx, transparent: true, emissive: 0xff2e88, emissiveMap: tx, emissiveIntensity: 0.6, side: THREE.DoubleSide })); m.position.set(-27 + i * 9, hy + 5, 70); m.rotation.y = Math.PI; L.add(m); });
    // flags around ring
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const x = Math.cos(a) * 236, z = Math.sin(a) * 236; addBox(x, this.heightRaw(x, z), z, 0.3, 9, 0.3, M.signPost, 0, true); const f = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4), new THREE.MeshStandardMaterial({ color: [0xff2e88, 0x00e5ff, 0xffd23f][i % 3], side: THREE.DoubleSide })); f.position.set(x + 1.1, this.heightRaw(x, z) + 7, z); L.add(f); }
    // crowd at hub
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(30, 4), M.crowd); c.position.set(-25 + i * 10, hy + 2, -72 + (i % 2) * 3); L.add(c); }
    // --- Stadium ---
    const sy = 24; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; const x = 1000 + Math.cos(a) * 300, z = 700 + Math.sin(a) * 180; addBox(x, sy, z, 30, 12, 12, M.concrete, -a + Math.PI / 2); const cr = new THREE.Mesh(new THREE.PlaneGeometry(28, 4), M.crowd); cr.position.set(x - Math.cos(a) * 6.5, sy + 12.5, z - Math.sin(a) * 6.5); cr.rotation.y = -a - Math.PI / 2; L.add(cr); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; const x = 1000 + Math.cos(a) * 330, z = 700 + Math.sin(a) * 210; addBox(x, sy, z, 2, 45, 2, M.steel); addBox(x, sy + 45, z, 10, 4, 2, M.lamp, -a, false); this.streetLightsExtra = (this.streetLightsExtra || []).concat([[x, sy + 45, z]]); }
    // --- Observatory ---
    const ox = 2700, oz = -2700, oy = this.nodeHeight('OBS_T');
    addBox(ox + 25, oy, oz, 26, 10, 26, M.white); const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.7, roughness: 0.25 })); dome.position.set(ox + 25, oy + 10, oz); dome.castShadow = true; L.add(dome);
    addBox(ox - 30, oy, oz + 10, 14, 6, 10, M.concrete); const dish = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 8, 0, Math.PI * 2, 0, 0.8), new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, metalness: 0.5 })); dish.position.set(ox - 30, oy + 18, oz - 25); dish.rotation.x = -0.9; L.add(dish); addBox(ox - 30, oy, oz - 25, 1.5, 12, 1.5, M.steel);
    // --- Port cranes ---
    for (let i = 0; i < 5; i++) { const x = -3150 + i * 240, z = 3220; const y = 4.5; addBox(x - 8, y, z, 2, 40, 2, M.red); addBox(x + 8, y, z, 2, 40, 2, M.red); addBox(x, y + 40, z, 20, 3, 3, M.red, 0, false); addBox(x, y + 42, z - 20, 3, 3, 70, M.red, 0, false); }
    // wind turbines (animated)
    this.turbines = [];
    const tpos = [[-700, -500], [-900, -650], [-1100, -480], [600, -900], [800, -1100], [-1700, 1500], [-1900, 1650], [1500, 1600]];
    for (const [x, z] of tpos) { const y = this.heightRaw(x, z); addBox(x, y, z, 2.6, 60, 2.6, M.white); const hub = new THREE.Group(); hub.position.set(x, y + 60, z + 1.6); for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 26, 0.3).translate(0, 13, 0), M.white); bl.rotation.z = b * Math.PI * 2 / 3; hub.add(bl); } L.add(hub); this.turbines.push(hub); }
    // barns at farm
    for (const [x, z] of [[-1300, 500], [-1650, 850], [-900, 900], [-2100, 650]]) { const y = this.heightRaw(x, z); addBox(x, y, z, 16, 9, 22, M.barn); const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 11.5, 6, 4, 1).rotateY(Math.PI / 4), M.roof); roof.scale.set(1, 1, 1.4); roof.position.set(x, y + 12, z); L.add(roof); const silo = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 18, 12), M.steel); silo.position.set(x + 14, y + 9, z); L.add(silo); this.globalCols.push({ k: 0, x: x + 14, z, r: 3.5, y0: y, y1: y + 18 }); }
    this.globalCols.forEach((c) => this.addCollider(c));
  }
  nodeHeight(k) { return this.nodes[k].h; }
  buildRail() {
    // freight rail for showcase train: loop through farmland & plains
    const cps = [[-600, 700], [-1200, 1200], [-2000, 1300], [-2500, 900], [-2400, 300], [-1900, -400], [-1200, -700], [-400, -700], [300, -500], [700, 100], [500, 500]];
    const pts = []; const n = cps.length;
    for (let i = 0; i < n; i++) { const p0 = cps[(i - 1 + n) % n], p1 = cps[i], p2 = cps[(i + 1) % n], p3 = cps[(i + 2) % n]; const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const k = Math.ceil(L / 10); for (let j = 0; j < k; j++) { const t = j / k, t2 = t * t, t3 = t2 * t; const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); pts.push(new THREE.Vector3(f(p0[0], p1[0], p2[0], p3[0]), 0, f(p0[1], p1[1], p2[1], p3[1]))); } }
    pts.forEach((p) => { p.y = Math.max(4, this.height(p.x, p.z)) + 0.3; });
    for (let it = 0; it < 4; it++) for (let i = 0; i < pts.length; i++) { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; pts[i].y = (a.y + pts[i].y * 2 + b.y) / 4; }
    this.railPts = pts; let L = 0; this.railDist = pts.map((p, i) => { if (i) L += p.distanceTo(pts[i - 1]); return L; }); this.railLen = L + pts[pts.length - 1].distanceTo(pts[0]);
    const geo = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = b.clone().sub(a); const len = d.length(); const yaw = Math.atan2(d.x, d.z); for (const off of [-0.75, 0.75]) { const g = new THREE.BoxGeometry(0.12, 0.15, len); g.rotateY(yaw); g.translate((a.x + b.x) / 2 + Math.cos(yaw) * off, (a.y + b.y) / 2, (a.z + b.z) / 2 - Math.sin(yaw) * off); geo.push(g); } if (i % 2 === 0) { const s = new THREE.BoxGeometry(2.6, 0.12, 0.3); s.rotateY(yaw); s.translate(a.x, a.y - 0.1, a.z); geo.push(s); } }
    const merged = mergeGeos(geo); const rail = new THREE.Mesh(merged, this.M.steel); rail.receiveShadow = true; this.root.add(rail);
    // train
    const train = this.train = new THREE.Group(); const car = (col, len) => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(3, 3.6, len), new THREE.MeshStandardMaterial({ color: col, metalness: 0.4, roughness: 0.5 })); b.position.y = 2.6; b.castShadow = true; g.add(b); return g; };
    this.trainCars = [car(0xd22222, 18), car(0x2a5fa8, 16), car(0x2a5fa8, 16), car(0x666666, 16), car(0x666666, 16), car(0x9a6b3a, 16)];
    this.trainCars.forEach((c) => train.add(c)); this.scene.add(train); this.trainS = 0; this.trainSpeed = 32;
    // plane
    const pl = this.plane = new THREE.Group(); const pm = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.4 });
    pl.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 14, 10).rotateX(Math.PI / 2), pm)); const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 2.5), pm); pl.add(wing); const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 1.4), pm); tail.position.z = -6; pl.add(tail); const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 1.6), new THREE.MeshStandardMaterial({ color: 0xff2e88 })); fin.position.set(0, 1.5, -6); pl.add(fin);
    pl.visible = false; this.scene.add(pl);
  }
  railPoint(s, out = new THREE.Vector3()) {
    s = ((s % this.railLen) + this.railLen) % this.railLen; const D = this.railDist, P = this.railPts; let lo = 0, hi = D.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (D[m] <= s) lo = m; else hi = m; }
    const a = P[lo], b = P[(lo + 1) % P.length]; const segL = (lo + 1 < D.length ? D[lo + 1] : this.railLen) - D[lo]; const t = clamp((s - D[lo]) / (segL || 1), 0, 1); return out.lerpVectors(a, b, t);
  }

  // ------------------------------ colliders ------------------------------
  addCollider(c) {
    const r = c.k === 0 ? c.r : Math.hypot(c.hx, c.hz); c.cells = [];
    const x0 = Math.floor((c.x - r) / COL_CELL), x1 = Math.floor((c.x + r) / COL_CELL), z0 = Math.floor((c.z - r) / COL_CELL), z1 = Math.floor((c.z + r) / COL_CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i * 100003 + j; let a = this.colHash.get(k); if (!a) this.colHash.set(k, a = []); a.push(c); c.cells.push(k); }
  }
  removeCollider(c) { for (const k of c.cells || []) { const a = this.colHash.get(k); if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); if (!a.length) this.colHash.delete(k); } } }
  queryColliders(x, z, r) {
    const out = this._qc || (this._qc = []); out.length = 0; const seen = this._seen || (this._seen = new Set()); seen.clear();
    const x0 = Math.floor((x - r) / COL_CELL), x1 = Math.floor((x + r) / COL_CELL), z0 = Math.floor((z - r) / COL_CELL), z1 = Math.floor((z + r) / COL_CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const a = this.colHash.get(i * 100003 + j); if (a) for (const c of a) if (!seen.has(c)) { seen.add(c); out.push(c); } }
    return out;
  }

  // ------------------------------ chunk streaming ------------------------------
  chunkRadius() { return { low: 2, medium: 3, high: 4, ultra: 5 }[this.settings.drawDistance] || 3; }
  isReady(x, z) { const c = this.chunks.get(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK)); return !!(c && c.res === 64 && c.built); }
  stream(px, pz, budgetMs = 6) {
    const R = this.chunkRadius(); const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    const want = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const cx = ccx + i, cz = ccz + j; if (Math.abs(cx * CHUNK) > WORLD_HALF + CHUNK || Math.abs(cz * CHUNK) > WORLD_HALF + CHUNK) continue; const d = Math.max(Math.abs(i), Math.abs(j)); want.push([cx, cz, d <= 1 ? 64 : 24, d]); }
    want.sort((a, b) => a[3] - b[3]);
    const keep = new Set();
    const t0 = performance.now(); let built = 0;
    for (const [cx, cz, res] of want) {
      const k = cx + ',' + cz; keep.add(k); const c = this.chunks.get(k);
      if (c && (c.res >= res || c.failed > 3) && !c.retry) continue;
      if (performance.now() - t0 > budgetMs && built > 0) continue;
      try { this.buildChunk(cx, cz, res); built++; }
      catch (e) { console.error('chunk build failed', k, e); const f = this.chunks.get(k) || { failed: 0 }; f.failed = (f.failed || 0) + 1; f.retry = f.failed < 4; this.chunks.set(k, f); }
    }
    for (const [k, c] of this.chunks) if (!keep.has(k)) { const [cx, cz] = k.split(',').map(Number); if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > R + 1) this.disposeChunk(k, c); }
    return built;
  }
  disposeChunk(k, c) {
    if (c.group) { this.root.remove(c.group); c.group.traverse((o) => { if (o.geometry && !o.geometry.shared) o.geometry.dispose(); }); }
    for (const col of c.cols || []) this.removeCollider(col);
    if (c.lights) this.streetLights = this.streetLights.filter((l) => l.chunk !== k);
    this.chunks.delete(k);
  }
  buildChunk(cx, cz, res) {
    const k = cx + ',' + cz; const old = this.chunks.get(k);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const grp = new THREE.Group(); grp.name = 'chunk' + k;
    // terrain grid
    const W = res + 1, step = CHUNK / res; const grid = new Float32Array(W * W);
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, res, res).rotateX(-Math.PI / 2); geo.translate(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
    const pos = geo.attributes.position; const col = new Float32Array(pos.count * 3); const cc = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const h = this.height(x, z); pos.setY(i, h); }
    // grid index: PlaneGeometry rows go along z (after rotation: row j → z increasing)
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) grid[j * W + i] = pos.getY(j * W + i);
    geo.computeVertexNormals(); const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) { this.terrainColor(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i), cc); col[i * 3] = cc[0]; col[i * 3 + 1] = cc[1]; col[i * 3 + 2] = cc[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // skirt to hide LOD cracks
    const terrain = new THREE.Mesh(geo, this.mTerrain); terrain.receiveShadow = true; grp.add(terrain);
    const sk = []; const edgeIdx = []; for (let i = 0; i < W; i++) edgeIdx.push(i); for (let j = 1; j < W; j++) edgeIdx.push(j * W + W - 1); for (let i = W - 2; i >= 0; i--) edgeIdx.push((W - 1) * W + i); for (let j = W - 2; j > 0; j--) edgeIdx.push(j * W);
    for (let e = 0; e < edgeIdx.length; e++) { const a = edgeIdx[e], b = edgeIdx[(e + 1) % edgeIdx.length]; const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a), bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b); sk.push(ax, ay, az, bx, by, bz, ax, ay - 6, az, bx, by, bz, bx, by - 6, bz, ax, ay - 6, az); }
    const skg = new THREE.BufferGeometry(); skg.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3)); skg.computeVertexNormals();
    const skc = new Float32Array(sk.length).fill(0.35); skg.setAttribute('color', new THREE.BufferAttribute(skc, 3));
    const skm = new THREE.Mesh(skg, this.mTerrain); grp.add(skm);
    const chunk = { key: k, cx, cz, res, grid, group: grp, cols: [], built: true, failed: 0 };
    // roads in this chunk
    this.buildChunkRoads(chunk, grp, x0, z0);
    // scenery only at hi-res (near) or medium
    this.buildChunkScenery(chunk, grp, x0, z0, res);
    if (old) this.disposeChunk(k, old);
    this.root.add(grp); this.chunks.set(k, chunk);
  }
  buildChunkRoads(chunk, grp, x0, z0) {
    const byType = {}; const extras = [];
    const inChunk = (x, z) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;
    for (const ed of this.edges) {
      // quick bbox reject
      if (!ed.bb) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < ed.n; i++) { a = Math.min(a, ed.xs[i]); b = Math.max(b, ed.xs[i]); c = Math.min(c, ed.zs[i]); d = Math.max(d, ed.zs[i]); } ed.bb = [a, b, c, d]; }
      const bb = ed.bb; if (bb[1] < x0 - 20 || bb[0] > x0 + CHUNK + 20 || bb[3] < z0 - 20 || bb[2] > z0 + CHUNK + 20) continue;
      const P = byType[ed.type] || (byType[ed.type] = { pos: [], uv: [], idx: [], vi: 0 });
      const yoff = 0.05 + (ed.id % 4) * 0.012;
      let run = false;
      for (let i = 0; i < ed.n - 1; i++) {
        const mx = (ed.xs[i] + ed.xs[i + 1]) / 2, mz = (ed.zs[i] + ed.zs[i + 1]) / 2;
        if (!inChunk(mx, mz)) { run = false; continue; }
        const hw = ed.hw;
        for (const j of [i, i + 1]) {
          if (j === i && run) continue;
          const x = ed.xs[j], z = ed.zs[j], y = ed.hs[j] + yoff;
          P.pos.push(x + ed.lx[j] * hw, y, z + ed.lz[j] * hw, x - ed.lx[j] * hw, y, z - ed.lz[j] * hw);
          const v = ed.dist[j] / (ed.width * 2); P.uv.push(0, v, 1, v); P.vi += 2;
        }
        const b = P.vi - 4; P.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        run = true;
        // bridge parts
        const fl = ed.flags[i];
        if (fl & 1) extras.push(['bridge', ed, i]);
        if (fl & 2) extras.push(['tunnel', ed, i]);
        // roadside furniture
        if (i % 30 === 7) extras.push(['sign', ed, i]);
        if ((ed.type === 'city' || ed.type === 'highway' || ed.type === 'track') && i % 8 === 3 && !(fl & 2)) extras.push(['lamp', ed, i]);
        if (ed.type === 'dirt' && i % 2 === 0 && this.dominant(mx, mz) === 'farm') extras.push(['fence', ed, i]);
      }
    }
    for (const t in byType) {
      const P = byType[t]; if (!P.idx.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2)); g.setIndex(P.idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.mRoad[t] || this.mRoad.main); m.receiveShadow = true; grp.add(m);
    }
    // extras
    const M = this.M, G = this.G; const inst = {};
    const put = (name, geo, mat, x, y, z, yaw, s = 1, sy = s, colInfo = null) => {
      const L = inst[name] || (inst[name] = { geo, mat, list: [] }); L.list.push([x, y, z, yaw, s, sy, colInfo]);
    };
    const bridgeGeo = []; const tunnelGeo = [];
    for (const [kind, ed, i] of extras) {
      const x = ed.xs[i], z = ed.zs[i], y = ed.hs[i]; const lx = ed.lx[i], lz = ed.lz[i]; const yaw = Math.atan2(-lz, lx) + Math.PI / 2; const hw = ed.hw;
      const x2 = ed.xs[i + 1], z2 = ed.zs[i + 1], y2 = ed.hs[i + 1]; const segL = Math.hypot(x2 - x, z2 - z);
      const fyaw = Math.atan2(x2 - x, z2 - z);
      if (kind === 'bridge') {
        // deck underside & rails
        for (const s of [-1, 1]) { const g = new THREE.BoxGeometry(0.4, 1.0, segL + 0.2); g.rotateY(fyaw); g.translate((x + x2) / 2 + lx * (hw + 0.2) * s, (y + y2) / 2 + 0.5, (z + z2) / 2 + lz * (hw + 0.2) * s); bridgeGeo.push(g); chunk.cols.push(this.addColliderR({ k: 1, x: (x + x2) / 2 + lx * (hw + 0.2) * s, z: (z + z2) / 2 + lz * (hw + 0.2) * s, hx: 0.3, hz: segL / 2 + 0.1, c: Math.cos(-fyaw), s: Math.sin(-fyaw), y0: (y + y2) / 2 - 1, y1: (y + y2) / 2 + 1.1 })); }
        const deck = new THREE.BoxGeometry(ed.width + 1, 1.2, segL + 0.1); deck.rotateY(fyaw); deck.translate((x + x2) / 2, (y + y2) / 2 - 0.62, (z + z2) / 2); bridgeGeo.push(deck);
        if (i % 6 === 0) { const ground = Math.max(this.heightRaw(x, z), -20); const hgt = y - ground; if (hgt > 1.5) { const p = new THREE.BoxGeometry(2.2, hgt, 2.2); p.translate(x, ground + hgt / 2 - 1.2, z); bridgeGeo.push(p); chunk.cols.push(this.addColliderR({ k: 0, x, z, r: 1.4, y0: ground - 2, y1: y - 1.3 })); } }
      } else if (kind === 'tunnel') {
        const cxm = (x + x2) / 2, czm = (z + z2) / 2, cym = (y + y2) / 2;
        const roof = new THREE.BoxGeometry(ed.width + 4, 1.2, segL + 0.15); roof.rotateY(fyaw); roof.translate(cxm, cym + 7.5, czm); tunnelGeo.push(roof);
        for (const s of [-1, 1]) { const w = new THREE.BoxGeometry(1.2, 8, segL + 0.15); w.rotateY(fyaw); w.translate(cxm + lx * (hw + 1.3) * s, cym + 3.5, czm + lz * (hw + 1.3) * s); tunnelGeo.push(w); chunk.cols.push(this.addColliderR({ k: 1, x: cxm + lx * (hw + 1.3) * s, z: czm + lz * (hw + 1.3) * s, hx: 0.6, hz: segL / 2 + 0.1, c: Math.cos(-fyaw), s: Math.sin(-fyaw), y0: cym - 1, y1: cym + 8 })); }
        if (i % 3 === 0) put('tlight', new THREE.BoxGeometry(0.4, 0.15, 2), M.tunnelLight, cxm, cym + 6.8, czm, fyaw, 1, 1);
      } else if (kind === 'sign') {
        const s = (i % 60 < 30) ? 1 : -1; const px = x + lx * (hw + 2) * s, pz = z + lz * (hw + 2) * s; const py = this.height(px, pz);
        put('sign', G.sign, M.sign, px, py, pz, fyaw + Math.PI / 2, 1, 1, { k: 0, r: 0.35, breakable: true, mass: 20, h: 3, kind: 'Sign' });
      } else if (kind === 'lamp') {
        const s = (i % 16 < 8) ? 1 : -1; const px = x + lx * (hw + 1.2) * s, pz = z + lz * (hw + 1.2) * s; const py = Math.max(y, this.height(px, pz));
        put('pole', G.pole, M.signPost, px, py, pz, 0, 1, 1, { k: 0, r: 0.18, h: 8, breakable: ed.type !== 'track', mass: 40, kind: 'Lamp Post' });
        put('lampHead', G.lampHead, M.lamp, px, py, pz, fyaw + (s > 0 ? -Math.PI / 2 : Math.PI / 2), 1, 1);
        this.streetLights.push({ x: px - lx * s * 1.2, y: py + 7.8, z: pz - lz * s * 1.2, chunk: chunk.key }); chunk.lights = true;
      } else if (kind === 'fence') {
        for (const s of [-1, 1]) { const px = (x + x2) / 2 + lx * (hw + 3) * s, pz = (z + z2) / 2 + lz * (hw + 3) * s; put('fence', G.fence, M.fence, px, this.height(px, pz), pz, fyaw + Math.PI / 2, 1, 1, { k: 1, hx: 2, hz: 0.2, rot: fyaw + Math.PI / 2, breakable: true, mass: 15, h: 1.2, kind: 'Fence' }); }
      }
    }
    if (bridgeGeo.length) { const m = new THREE.Mesh(mergeGeos(bridgeGeo), M.concrete); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    if (tunnelGeo.length) { const m = new THREE.Mesh(mergeGeos(tunnelGeo), M.concrete); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    chunk.inst = inst;
  }
  addColliderR(c) { this.addCollider(c); return c; }
  buildChunkScenery(chunk, grp, x0, z0, res) {
    const inst = chunk.inst; const M = this.M, G = this.G;
    const rnd = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ this.seed);
    const put = (name, geo, mat, x, y, z, yaw, s = 1, sy = s, colInfo = null) => { const L = inst[name] || (inst[name] = { geo, mat, list: [] }); L.list.push([x, y, z, yaw, s, sy, colInfo]); };
    const cxw = x0 + CHUNK / 2, czw = z0 + CHUNK / 2; const domC = this.dominant(cxw, czw);
    const near = res === 64;
    const density = (this.settings.drawDistance === 'low' ? 0.5 : 1) * (near ? 1 : 0.45);
    const q = {};
    // city buildings
    if (domC === 'city' || this.dominant(x0 + 10, z0 + 10) === 'city') this.cityBlocks(chunk, grp, x0, z0, rnd, put);
    if (domC === 'port') this.portStuff(chunk, grp, x0, z0, rnd, put);
    const tries = Math.floor(160 * density);
    for (let t = 0; t < tries; t++) {
      const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK; const id = this.dominant(x, z);
      const rq = this.roadQuery(x, z, q); if (rq && rq.d < 6) continue;
      const h = this.height(x, z); if (h < 1.2) continue;
      const hx = this.height(x + 2, z), hz = this.height(x, z + 2); const slope = Math.hypot(hx - h, hz - h) / 2; const r = rnd();
      if (Math.abs(x) < 300 && Math.abs(z) < 300 && Math.hypot(x, z) < 260) continue;
      switch (id) {
        case 'alpine': case 'obs':
          if (h < 330 && slope < 0.9) { if (r < 0.75) { const s = 0.7 + rnd() * 0.8; put('trunk', G.trunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.4 * s, h: 4 }); put('pine', G.pine, M.pine, x, h, z, rnd() * 6, s); } else put('rock', G.rock, M.rock, x, h - 0.4, z, rnd() * 6, 0.8 + rnd() * 1.8, 0.7 + rnd(), { k: 0, r: 1.6, h: 2 }); }
          else if (r < 0.15) put('rock', G.rock, M.rock, x, h - 0.4, z, rnd() * 6, 1 + rnd() * 2, 1, { k: 0, r: 2, h: 2 });
          break;
        case 'jungle': if (r < 0.5) { const s = 0.8 + rnd() * 0.6; put('ptrunk', G.palmTrunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.35, h: 8 }); put('palm', G.palm, M.palm, x, h, z, rnd() * 6, s); } else if (r < 0.85) { const s = 0.9 + rnd() * 0.7; put('trunk', G.trunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.45 * s, h: 4 }); put('leaf', G.leaf, M.leaf, x, h, z, rnd() * 6, s); } else put('bush', G.bush, M.bush, x, h, z, rnd() * 6, 1 + rnd(), 1, { k: 0, r: 0.9, h: 1.5, breakable: true, mass: 10, kind: 'Bush' }); break;
        case 'canyon':
          if (r < 0.35) put('cactus', G.cactus, M.cactus, x, h, z, rnd() * 6, 0.8 + rnd() * 0.5, 1, { k: 0, r: 0.45, h: 4, breakable: true, mass: 25, kind: 'Cactus' });
          else if (r < 0.45 && near) put('hoodoo', G.hoodoo, M.redrock, x, h - 4, z, rnd() * 6, 0.5 + rnd() * 0.6, 0.6 + rnd() * 0.8, { k: 0, r: 5, h: 40 });
          else if (r < 0.7) put('rock', G.rock, M.redrock, x, h - 0.4, z, rnd() * 6, 0.8 + rnd() * 2, 0.8, { k: 0, r: 1.8, h: 2 });
          else put('bush', G.bush, M.bush, x, h, z, rnd() * 6, 0.7, 0.6, { k: 0, r: 0.6, h: 1, breakable: true, mass: 8, kind: 'Tumbleweed' });
          break;
        case 'salt': if (r < 0.05) put('deadtree', G.deadtree, M.deadtree, x, h, z, rnd() * 6, 1.2, 1.2, { k: 0, r: 0.25, h: 4, breakable: true, mass: 20, kind: 'Dead Tree' }); break;
        case 'farm':
          if (r < 0.3) { put('hay', G.hay, M.hay, x, h, z, rnd() * 6, 1, 1, { k: 0, r: 0.8, h: 1.5, breakable: true, mass: 60, kind: 'Hay Bale' }); }
          else if (r < 0.5) { const s = 1 + rnd() * 0.6; put('trunk', G.trunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.45 * s, h: 4 }); put('leaf', G.leaf, M.leaf, x, h, z, rnd() * 6, s); }
          break;
        case 'coast': if (r < 0.4) { const s = 0.8 + rnd() * 0.5; put('ptrunk', G.palmTrunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.35, h: 8 }); put('palm', G.palm, M.palm, x, h, z, rnd() * 6, s); } else if (r < 0.6) put('bush', G.bush, M.bush, x, h, z, 0, 1, 1, { k: 0, r: 0.8, h: 1.5, breakable: true, mass: 10, kind: 'Bush' }); break;
        case 'city': case 'port': case 'hub': case 'stadium': break;
        default:
          if (r < 0.35) { const s = 0.9 + rnd() * 0.8; put('trunk', G.trunk, M.trunk, x, h, z, 0, s, s, { k: 0, r: 0.45 * s, h: 4 }); put('leaf', G.leaf, M.leaf, x, h, z, rnd() * 6, s); }
          else if (r < 0.5) put('bush', G.bush, M.bush, x, h, z, rnd() * 6, 1 + rnd() * 0.6, 1, { k: 0, r: 0.8, h: 1.5, breakable: true, mass: 10, kind: 'Bush' });
          else if (r < 0.55) put('rock', G.rock, M.rock, x, h - 0.4, z, rnd() * 6, 0.6 + rnd(), 0.6, { k: 0, r: 1.2, h: 1.5 });
      }
    }
    // hub props: barrels & cones
    if (domC === 'hub' && near) for (let i = 0; i < 30; i++) { const a = rnd() * Math.PI * 2, rr = 120 + rnd() * 80; const x = Math.cos(a) * rr, z = Math.sin(a) * rr; if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue; const h = this.height(x, z); put('cone', G.cone, M.barrel, x, h, z, 0, 1, 1, { k: 0, r: 0.3, h: 0.7, breakable: true, mass: 3, kind: 'Cone' }); }
    // build instanced meshes & colliders
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const name in inst) {
      const L = inst[name]; if (!L.list.length) continue;
      const im = new THREE.InstancedMesh(L.geo, L.mat, L.list.length); im.castShadow = !['tlight', 'lampHead'].includes(name) && near; im.receiveShadow = true;
      L.list.forEach(([x, y, z, yaw, s, sy, ci], idx) => {
        qq.setFromAxisAngle(up, yaw); sv.set(s, sy, s); pv.set(x, y, z); m4.compose(pv, qq, sv); im.setMatrixAt(idx, m4);
        if (ci) {
          const c = ci.k === 0 ? { k: 0, x, z, r: ci.r * (ci.breakable ? 1 : 1), y0: y - 1, y1: y + (ci.h || 3) * sy } : { k: 1, x, z, hx: ci.hx, hz: ci.hz, c: Math.cos(-(ci.rot ?? yaw)), s: Math.sin(-(ci.rot ?? yaw)), y0: y - 1, y1: y + (ci.h || 2) };
          if (ci.breakable) { c.breakable = true; c.mass = ci.mass; c.kind = ci.kind; c.mesh = im; c.idx = idx; c.matrix = m4.clone(); c.y = y; c.geoName = name; c.mat = L.mat; c.geo = L.geo; c.yaw = yaw; c.scale = s; }
          this.addCollider(c); chunk.cols.push(c);
          // linked mesh pairs (trunk + canopy) share nothing; ok
        }
      });
      im.instanceMatrix.needsUpdate = true; L.geo.shared = true; grp.add(im);
    }
  }
  cityBlocks(chunk, grp, x0, z0, rnd, put) {
    // buildings fill lots between city grid streets
    const boxes = []; const r2 = mulberry32(chunk.cx * 991 + chunk.cz * 7);
    for (let bi = 0; bi < 8; bi++) for (let bj = 0; bj < 8; bj++) {
      const bx0 = -500 + bi * 200, bz0 = 1900 + bj * 200; const cxm = bx0 + 100, czm = bz0 + 100;
      if (cxm < x0 || cxm >= x0 + CHUNK || czm < z0 || czm >= z0 + CHUNK) continue;
      const park = (bi * 7 + bj * 3) % 9 === 0; const downtown = Math.hypot(cxm - 300, czm - 2700) < 450;
      if (park) { for (let t = 0; t < 14; t++) { const x = bx0 + 20 + r2() * 160, z = bz0 + 20 + r2() * 160, h = this.height(x, z); put('trunk', this.G.trunk, this.M.trunk, x, h, z, 0, 1, 1, { k: 0, r: 0.4, h: 4 }); put('leaf', this.G.leaf, this.M.leaf, x, h, z, 0, 0.9); } for (let t = 0; t < 8; t++) { const x = bx0 + 30 + r2() * 140, z = bz0 + 30 + r2() * 140; put('barrel', this.G.barrel, this.M.barrel, x, this.height(x, z), z, 0, 1, 1, { k: 0, r: 0.35, h: 1, breakable: true, mass: 15, kind: 'Bin' }); } continue; }
      // 2x2 lots with alleys (shortcuts)
      const lots = [[0, 0], [1, 0], [0, 1], [1, 1]];
      for (const [li, lj] of lots) {
        const lx0 = bx0 + 12 + li * 92, lz0 = bz0 + 12 + lj * 92; const w = 76, d = 76;
        const hgt = downtown ? 40 + r2() * 110 : 12 + r2() * 35; const x = lx0 + w / 2, z = lz0 + d / 2; const y = this.height(x, z) - 0.5;
        boxes.push([x, y, z, w, hgt, d]);
        this.addCollider(chunk.cols[chunk.cols.push({ k: 1, x, z, hx: w / 2, hz: d / 2, c: 1, s: 0, y0: y - 2, y1: y + hgt }) - 1]);
        if (downtown && r2() < 0.5) { const h2 = hgt * (0.3 + r2() * 0.4); boxes.push([x, y + hgt, z, w * 0.6, h2, d * 0.6]); }
      }
    }
    if (!boxes.length) return;
    const geos = boxes.map(([x, y, z, w, h, d]) => { const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 20, uv.getY(i) * h / 14); g.translate(x, y + h / 2, z); return g; });
    const m = new THREE.Mesh(mergeGeos(geos), this.M.building); m.castShadow = true; m.receiveShadow = true; grp.add(m);
  }
  portStuff(chunk, grp, x0, z0, rnd, put) {
    const geos = []; const cols = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0x7f8c8d];
    const colorArr = [];
    for (let t = 0; t < 22; t++) {
      const x = x0 + 10 + rnd() * (CHUNK - 20), z = z0 + 10 + rnd() * (CHUNK - 20); const q = this.roadQuery(x, z, {}); if (q && q.d < 10) continue; if (this.dominant(x, z) !== 'port') continue;
      const h = this.height(x, z); if (h < 2) continue; const yaw = rnd() < 0.5 ? 0 : Math.PI / 2; const stack = 1 + (rnd() * 3 | 0);
      for (let s = 0; s < stack; s++) { const g = new THREE.BoxGeometry(2.5, 2.6, 12); g.rotateY(yaw); g.translate(x, h + 1.3 + s * 2.6, z); const c = new THREE.Color(cols[(rnd() * cols.length) | 0]); const n = g.attributes.position.count; const ca = new Float32Array(n * 3); for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); geos.push(g); }
      this.addCollider(chunk.cols[chunk.cols.push({ k: 1, x, z, hx: yaw ? 6 : 1.25, hz: yaw ? 1.25 : 6, c: 1, s: 0, y0: h - 1, y1: h + stack * 2.6 }) - 1]);
      for (let b = 0; b < 3; b++) { const bx = x + 4 + rnd() * 3, bz = z + rnd() * 4; put('barrel', this.G.barrel, this.M.barrel, bx, this.height(bx, bz), bz, 0, 1, 1, { k: 0, r: 0.35, h: 1, breakable: true, mass: 20, kind: 'Barrel' }); }
    }
    if (geos.length) { const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }); const m = new THREE.Mesh(mergeGeos(geos), mat); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  }

  // ------------------------------ breakables ------------------------------
  smashCollider(c, vel) {
    if (!c.mesh) return; const zero = new THREE.Matrix4().makeScale(0, 0, 0); c.mesh.setMatrixAt(c.idx, zero); c.mesh.instanceMatrix.needsUpdate = true;
    c.respawn = 90; this.breakables.push(c);
    // debris object
    const m = new THREE.Mesh(c.geo, c.mat); m.position.set(c.x, c.y, c.z); m.rotation.y = c.yaw; m.scale.setScalar(c.scale || 1); m.castShadow = true; this.scene.add(m);
    const v = vel.clone().multiplyScalar(0.9 + Math.random() * 0.4); v.y = 3 + Math.random() * 5 + vel.length() * 0.15;
    this.debris.push({ m, v, w: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8), t: 6 });
    if (this.debris.length > 40) { const d = this.debris.shift(); this.scene.remove(d.m); }
  }
  updateBreakables(dt, px, pz) {
    for (let i = this.debris.length - 1; i >= 0; i--) { const d = this.debris[i]; d.t -= dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.w.x * dt; d.m.rotation.z += d.w.z * dt; const g = this.height(d.m.position.x, d.m.position.z); if (d.m.position.y < g) { d.m.position.y = g; d.v.multiplyScalar(0.5); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.6); } if (d.t <= 0) { this.scene.remove(d.m); this.debris.splice(i, 1); } }
    for (let i = this.breakables.length - 1; i >= 0; i--) { const c = this.breakables[i]; c.respawn -= dt; if (c.respawn <= 0 && Math.hypot(c.x - px, c.z - pz) > 30) { c.dead = false; if (c.mesh && c.matrix) { c.mesh.setMatrixAt(c.idx, c.matrix); c.mesh.instanceMatrix.needsUpdate = true; } this.breakables.splice(i, 1); } }
  }

  // ------------------------------ time of day ------------------------------
  updateSky(dt, camPos, freezeTime) {
    if (!freezeTime) this.tod = (this.tod + dt * this.timeScale / 3600) % 24;
    this.time += dt; this.envT -= dt;
    const t = this.tod; const ang = (t - 6) / 24 * Math.PI * 2; const elev = Math.sin(ang);
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, elev, 0.35 + Math.cos(ang) * 0.2).normalize();
    this.sunDir = sunDir;
    const day = smoothstep(-0.12, 0.25, elev), dusk = (1 - Math.abs(elev - 0.05) / 0.3); const duskK = clamp(dusk, 0, 1) * smoothstep(-0.2, 0.0, elev);
    const night = 1 - smoothstep(-0.18, 0.05, elev); this.night = night;
    const W = this.weather.p; const cloud = W.cloud;
    const top = new THREE.Color().setRGB(0.18, 0.42, 0.85).lerp(new THREE.Color(0.02, 0.03, 0.08), night).lerp(new THREE.Color(0.45, 0.48, 0.52).multiplyScalar(1 - night * 0.9), cloud * 0.8);
    const hor = new THREE.Color().setRGB(0.72, 0.84, 0.95).lerp(new THREE.Color(1.0, 0.55, 0.3), duskK * 0.85).lerp(new THREE.Color(0.04, 0.05, 0.1), night).lerp(new THREE.Color(0.6, 0.62, 0.65).multiplyScalar(1 - night * 0.9), cloud * 0.7);
    const sunCol = new THREE.Color(1, 0.95, 0.85).lerp(new THREE.Color(1, 0.5, 0.2), duskK);
    const U = this.skyU; U.sunDir.value.copy(sunDir); U.uTime.value = this.time; U.uCloud.value = cloud; U.uNight.value = night; U.uTop.value.copy(top); U.uHor.value.copy(hor); U.uSunCol.value.copy(sunCol); U.uFlash.value = this.weather.flash;
    this.sky.position.copy(camPos);
    // lights
    const sunI = day * (1 - cloud * 0.75) * 2.8; this.sun.intensity = Math.max(sunI, night * 0.25); this.sun.color.copy(elev > 0 ? sunCol : new THREE.Color(0.55, 0.65, 1.0));
    const ld = elev > 0 ? sunDir : sunDir.clone().negate();
    this.sun.position.set(camPos.x + ld.x * 300, camPos.y + Math.max(0.15, ld.y) * 300, camPos.z + ld.z * 300); this.sun.target.position.copy(camPos);
    // snap shadow camera to texel grid to reduce shimmer
    this.hemi.intensity = 0.25 + day * 0.75 + this.weather.flash * 3; this.hemi.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.4); this.hemi.groundColor.setRGB(0.35, 0.3, 0.22).multiplyScalar(0.3 + day * 0.7);
    // fog
    const fogC = hor.clone(); const f = this.scene.fog; f.color.copy(fogC);
    const dd = { low: 900, medium: 1500, high: 2200, ultra: 3000 }[this.settings.drawDistance] || 1500;
    const vis = lerp(dd, 160, W.fog) * lerp(1, 0.55, W.rain) * lerp(1, 0.5, W.snowfall);
    f.near = vis * 0.08; f.far = vis;
    this.renderer.toneMappingExposure = lerp(0.62, 1.0, day) + duskK * 0.08;
    // emissives at night
    const em = smoothstep(0.3, 0.8, night + cloud * 0.25 * W.rain);
    this.M.lamp.emissiveIntensity = em * 3; this.M.building.emissiveIntensity = em * 1.4; this.M.tunnelLight.color.setScalar(0.6 + em * 0.6);
    this.hubLights.forEach((b, i) => { b.material.opacity = 0.05 + em * 0.25; b.rotation.z = Math.sin(this.time * 0.8 + i) * 0.5; b.rotation.x = Math.cos(this.time * 0.6 + i * 1.3) * 0.3; });
    this.turbines.forEach((t, i) => { t.rotation.z += dt * (0.8 + i * 0.05) * (1 + W.wind); });
    // nearest street lights get real point lights
    if (em > 0.05) {
      const sl = this.streetLights.concat((this.streetLightsExtra || []).map(([x, y, z]) => ({ x, y, z })));
      sl.sort((a, b) => ((a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2) - ((b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2));
      this.lightPool.forEach((L, i) => { const s = sl[i]; if (s) { L.position.set(s.x, s.y, s.z); L.intensity = em * 60; } else L.intensity = 0; });
    } else this.lightPool.forEach((L) => { L.intensity = 0; });
    if (this.envT <= 0) this.updateEnv(true);
    this.water.position.x = Math.round(camPos.x / 60) * 60; this.water.position.z = Math.round(camPos.z / 60) * 60; TEX.water.offset.x = this.time * 0.002; TEX.water.offset.y = this.time * 0.001;
  }
  updateTrain(dt, active, speedMul = 1) {
    this.trainS += dt * this.trainSpeed * speedMul; const p = new THREE.Vector3(), p2 = new THREE.Vector3(); let off = 0;
    this.trainCars.forEach((c, i) => { const len = i === 0 ? 18 : 16; this.railPoint(this.trainS - off, p); this.railPoint(this.trainS - off - len, p2); c.position.copy(p).add(p2).multiplyScalar(0.5); c.lookAt(p.x, c.position.y + (p.y - p2.y) * 0.5, p.z); off += len + 1.2; });
  }
  update(dt, camPos, player) {
    this.updateSky(dt, camPos, this.freezeTime);
    this.weather.update(dt, camPos);
    this.env.wet = this.weather.wetness; this.env.snow = this.weather.snowCover; this.snowU.value = this.weather.snowCover; this.wetU.value = this.weather.wetness;
    this.updateBreakables(dt, camPos.x, camPos.z);
    this.particles.update(dt); this.glow.update(dt);
    this.updateTrain(dt);
    if (player) { this.traffic.update(dt, player); this.wild.update(dt, player.pos); }
    this.crowds.update(dt);
  }
}

// ---------- geometry merge (positions/normals/uv/color) ----------
export function mergeGeos(geos) {
  let total = 0, hasUV = true, hasCol = false; const list = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; total += ng.attributes.position.count; if (!ng.attributes.uv) hasUV = false; if (ng.attributes.color) hasCol = true; return ng; });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = hasUV ? new Float32Array(total * 2) : null, col = hasCol ? new Float32Array(total * 3) : null; let o = 0;
  for (const g of list) { if (!g.attributes.normal) g.computeVertexNormals(); const n = g.attributes.position.count; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (uv) uv.set(g.attributes.uv.array, o * 2); if (col) { if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + n) * 3); } o += n; g.dispose && g !== geos && g.dispose(); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3)); return out;
}

// =====================================================================
// Weather
// =====================================================================
const WX = {
  clear: { cloud: 0.12, rain: 0, fog: 0, snowfall: 0, wind: 0.2 }, overcast: { cloud: 0.75, rain: 0, fog: 0.1, snowfall: 0, wind: 0.4 },
  rain: { cloud: 0.85, rain: 0.7, fog: 0.2, snowfall: 0, wind: 0.5 }, storm: { cloud: 1, rain: 1, fog: 0.3, snowfall: 0, wind: 1 },
  fog: { cloud: 0.5, rain: 0, fog: 0.85, snowfall: 0, wind: 0.05 }, snow: { cloud: 0.85, rain: 0, fog: 0.35, snowfall: 0.9, wind: 0.4 },
};
export const WEATHER_TYPES = Object.keys(WX);
class Weather {
  constructor(world, scene) {
    this.world = world; this.state = 'clear'; this.p = { ...WX.clear }; this.target = WX.clear; this.wetness = 0; this.snowCover = 0; this.flash = 0; this.nextFlash = 10; this.timer = 300; this.auto = true; this.seasonSnow = 0;
    const N = 5000; const geo = new THREE.BufferGeometry(); const pos = new Float32Array(N * 6); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaac4dd, transparent: true, opacity: 0.45 })); this.rain.frustumCulled = false; scene.add(this.rain); this.N = N; this.rp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.rp[i * 3] = (Math.random() - 0.5) * 80; this.rp[i * 3 + 1] = Math.random() * 40; this.rp[i * 3 + 2] = (Math.random() - 0.5) * 80; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9, map: TEX.smoke, depthWrite: false })); this.snow.frustumCulled = false; scene.add(this.snow);
    this.onThunder = null;
  }
  set(state, instant = false) { this.state = state; this.target = WX[state]; if (instant) { this.p = { ...this.target }; if (state === 'snow') this.snowCover = 0.8; if (state === 'rain' || state === 'storm') this.wetness = 0.8; } }
  update(dt, cam) {
    const T = this.target; for (const k in T) this.p[k] += (T[k] - this.p[k]) * clamp(dt / 20, 0, 1);
    if (this.auto) { this.timer -= dt; if (this.timer <= 0) { this.timer = 240 + Math.random() * 300; const probs = this.probs || { clear: 1 }; let r = Math.random(), acc = 0; for (const k in probs) { acc += probs[k]; if (r <= acc) { this.set(k); break; } } } }
    const p = this.p;
    this.wetness = clamp(this.wetness + (p.rain > 0.2 ? p.rain * 0.02 : -0.006) * dt, 0, 1);
    this.snowCover = clamp(this.snowCover + (p.snowfall > 0.2 ? 0.01 : (this.seasonSnow > this.snowCover ? 0.01 : -0.004)) * dt, Math.min(this.seasonSnow, 1), 1);
    // lightning
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.state === 'storm') { this.nextFlash -= dt; if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 6 + Math.random() * 14; setTimeout(() => this.onThunder && this.onThunder(), 600 + Math.random() * 1800); } }
    // rain particles
    const dens = this.world.settings.particles === 'low' ? 0.35 : this.world.settings.particles === 'medium' ? 0.65 : 1;
    const nR = Math.floor(this.N * p.rain * dens); const arr = this.rain.geometry.attributes.position.array; const rp = this.rp; const fall = 28 * dt; const wx = p.wind * 6;
    this.rain.visible = nR > 10; this.snow.visible = p.snowfall > 0.05;
    if (this.rain.visible) {
      for (let i = 0; i < nR; i++) { rp[i * 3 + 1] -= fall; rp[i * 3] += wx * dt; if (rp[i * 3 + 1] < -2) { rp[i * 3 + 1] = 38; rp[i * 3] = (Math.random() - 0.5) * 80; rp[i * 3 + 2] = (Math.random() - 0.5) * 80; } const x = cam.x + rp[i * 3], y = cam.y - 8 + rp[i * 3 + 1], z = cam.z + rp[i * 3 + 2]; arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z; arr[i * 6 + 3] = x - wx * 0.05; arr[i * 6 + 4] = y + 0.9; arr[i * 6 + 5] = z; }
      this.rain.geometry.setDrawRange(0, nR * 2); this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const sa = this.snow.geometry.attributes.position.array; const nS = Math.floor(this.N * p.snowfall * dens * 0.6);
      for (let i = 0; i < nS; i++) { rp[i * 3 + 1] -= 2.2 * dt; rp[i * 3] += (Math.sin(i + this.world.time) * 0.8 + wx * 0.4) * dt; if (rp[i * 3 + 1] < -2) { rp[i * 3 + 1] = 38; rp[i * 3] = (Math.random() - 0.5) * 80; rp[i * 3 + 2] = (Math.random() - 0.5) * 80; } sa[i * 3] = cam.x + ((rp[i * 3] % 80) + 120) % 80 - 40; sa[i * 3 + 1] = cam.y - 8 + rp[i * 3 + 1]; sa[i * 3 + 2] = cam.z + rp[i * 3 + 2]; }
      this.snow.geometry.setDrawRange(0, nS); this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}

// =====================================================================
// Particles (CPU-simulated points with per-particle size/color/alpha)
// =====================================================================
class Particles {
  constructor(scene, settings, additive = false) {
    this.settings = settings; const N = this.N = additive ? 1500 : 4000; this.i = 0;
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.c = new Float32Array(N * 4); this.s = new Float32Array(N); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grow = new Float32Array(N); this.grav = new Float32Array(N); this.a0 = new Float32Array(N);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.c, 4)); g.setAttribute('size', new THREE.BufferAttribute(this.s, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.smoke }, scale: { value: 600 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale; void main(){ vC=color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*scale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a*t.a); if (gl_FragColor.a < 0.01) discard; }',
    });
    this.mesh = new THREE.Points(g, mat); this.mesh.frustumCulled = false; scene.add(this.mesh); this.live = 0;
  }
  density() { return this.settings.particles === 'low' ? 0.3 : this.settings.particles === 'medium' ? 0.6 : this.settings.particles === 'off' ? 0 : 1; }
  emit(x, y, z, vx, vy, vz, size, r, g, b, a, life, grow = 1, grav = 0) {
    if (Math.random() > this.density()) return;
    const i = this.i; this.i = (this.i + 1) % this.N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a; this.a0[i] = a; this.s[i] = size; this.life[i] = life; this.max[i] = life; this.grow[i] = grow; this.grav[i] = grav;
  }
  update(dt) {
    const N = this.N; let live = 0; const p = this.p, v = this.v, c = this.c;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { if (c[i * 4 + 3] !== 0) c[i * 4 + 3] = 0; continue; }
      live++; this.life[i] -= dt; const drag = 1 - Math.min(0.9, dt * 1.6);
      v[i * 3] *= drag; v[i * 3 + 1] = v[i * 3 + 1] * drag - this.grav[i] * dt; v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      this.s[i] += this.grow[i] * dt; const k = Math.max(0, this.life[i] / this.max[i]); c[i * 4 + 3] = this.a0[i] * k * Math.min(1, (1 - k) * 8 + 0.2);
    }
    this.live = live; const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.c.fill(0); }
}

// =====================================================================
// Persistent skidmarks (ring buffer of quads)
// =====================================================================
class Skids {
  constructor(scene) {
    const N = this.N = 4000; this.i = 0; this.last = new Map();
    this.pos = new Float32Array(N * 4 * 3); this.al = new Float32Array(N * 4); this.col = new Float32Array(N * 4 * 3);
    const idx = new Uint32Array(N * 6); for (let q = 0; q < N; q++) { const b = q * 4; idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], q * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1)); g.setAttribute('scol', new THREE.BufferAttribute(this.col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
      vertexShader: 'attribute float alpha; attribute vec3 scol; varying float vA; varying vec3 vC; void main(){ vA = alpha; vC = scol; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float vA; varying vec3 vC; void main(){ gl_FragColor = vec4(vC, vA); }',
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  add(key, x, y, z, lx, lz, w, a, r = 0.05, gg = 0.05, b = 0.05) {
    const L = this.last.get(key);
    if (L && Math.hypot(x - L[0], z - L[2]) < 0.35) return;
    if (L && Math.hypot(x - L[0], z - L[2]) < 3) {
      const q = this.i; this.i = (this.i + 1) % this.N; const o = q * 12; const hw = w / 2;
      const P = this.pos; y += 0.04;
      P[o] = L[0] + L[3] * hw; P[o + 1] = L[1]; P[o + 2] = L[2] + L[4] * hw; P[o + 3] = L[0] - L[3] * hw; P[o + 4] = L[1]; P[o + 5] = L[2] - L[4] * hw;
      P[o + 6] = x + lx * hw; P[o + 7] = y; P[o + 8] = z + lz * hw; P[o + 9] = x - lx * hw; P[o + 10] = y; P[o + 11] = z - lz * hw;
      for (let k = 0; k < 4; k++) { this.al[q * 4 + k] = k < 2 ? L[5] : a; this.col[q * 12 + k * 3] = r; this.col[q * 12 + k * 3 + 1] = gg; this.col[q * 12 + k * 3 + 2] = b; }
      const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true; g.attributes.scol.needsUpdate = true;
    }
    this.last.set(key, [x, y + 0.04, z, lx, lz, a]);
  }
  lift(key) { this.last.delete(key); }
  clear() { this.al.fill(0); this.mesh.geometry.attributes.alpha.needsUpdate = true; this.last.clear(); }
}

// =====================================================================
// AI Traffic (kinematic lane-followers that become physical on impact)
// =====================================================================
const TRAFFIC_COLORS = [0xd8d8d8, 0x222222, 0x8a1c1c, 0x1c3f8a, 0x707070, 0xf0f0f0, 0x2f5a2f, 0xb08a3a, 0x4a2f5a, 0xc05a1a];
class TrafficCar {
  constructor(model, spec) {
    this.mesh = model; this.spec = spec; this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.mass = 1400; this.invMass = 1 / 1400; this.capR = 0.95; this.capHalf = 1.4; this.ghost = false; this.kinematic = false; this.isTraffic = true;
    this.edge = null; this.s = 0; this.dir = 1; this.speed = 10; this.want = 1; this.hit = false; this.hitT = 0; this.yawV = 0; this.nearMissDone = false; this.honk = 0;
  }
  capsule() { const f = _tv.set(0, 0, 1).applyQuaternion(this.quat); f.y = 0; f.normalize(); return [this.pos.x + f.x * this.capHalf, this.pos.z + f.z * this.capHalf, this.pos.x - f.x * this.capHalf, this.pos.z - f.z * this.capHalf]; }
  applyImpulse(J, P) { this.vel.addScaledVector(J, this.invMass); const r = _tv2.subVectors(P, this.pos); this.yawV += (r.z * J.x - r.x * J.z) * this.invMass * 0.6; if (!this.hit) { this.hit = true; this.hitT = 0; } }
}
const _tv = new THREE.Vector3(), _tv2 = new THREE.Vector3(), _tq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function edgeSample(ed, s, out) {
  s = clamp(s, 0, ed.len); const D = ed.dist; let lo = 0, hi = ed.n - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (D[m] <= s) lo = m; else hi = m; }
  const t = (s - D[lo]) / ((D[lo + 1] - D[lo]) || 1);
  out.x = ed.xs[lo] + (ed.xs[lo + 1] - ed.xs[lo]) * t; out.z = ed.zs[lo] + (ed.zs[lo + 1] - ed.zs[lo]) * t; out.y = ed.hs[lo] + (ed.hs[lo + 1] - ed.hs[lo]) * t;
  out.lx = ed.lx[lo]; out.lz = ed.lz[lo]; out.dx = ed.xs[lo + 1] - ed.xs[lo]; out.dz = ed.zs[lo + 1] - ed.zs[lo]; out.i = lo; return out;
}
export { edgeSample };
class Traffic {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.list = []; this.templates = null; this.spawnT = 0; this.enabled = true; this.group = new THREE.Group(); scene.add(this.group);
    this.onHit = null;
  }
  makeTemplates() {
    const picks = CARS.filter((c) => ['SPORT', 'HATCH', 'GT', 'CLASSIC', 'TRUCK', 'EV', 'OFFROAD'].includes(c.cat) && c.cat !== 'BIKE' && c.price < 90000).filter((c, i) => i % 5 === 0).slice(0, 10);
    this.templates = picks.map((spec, i) => ({ spec, model: buildCarModel(spec, { paint: 'gloss', color: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], decal: 'none', wheel: 0, tint: 0.4, rim: 0x999999 }, { lod: 1 }) }));
  }
  density() { return { off: 0, low: 8, medium: 16, high: 26 }[this.world.settings.traffic || 'medium'] ?? 16; }
  clear() { for (const t of this.list) this.group.remove(t.mesh.group); this.list.length = 0; }
  spawn(px, pz) {
    const W = this.world; const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 300; const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    const q = W.roadQuery(x, z, {}); if (!q || q.d > 4) return;
    const ed = q.edge; if (!['main', 'highway', 'city'].includes(ed.type)) return;
    if (!this.templates) this.makeTemplates();
    const T = this.templates[(Math.random() * this.templates.length) | 0];
    const m = T.model.clone(); const t = new TrafficCar(m, T.spec);
    t.edge = ed; t.s = clamp(q.s, 2, ed.len - 2); t.dir = Math.random() < 0.5 ? 1 : -1; t.want = 0.82 + Math.random() * 0.3; t.speed = ed.speed * t.want;
    t.lane = ed.type === 'highway' ? (Math.random() < 0.5 ? 0.2 : 0.62) : 0.45;
    this.place(t, 0); for (const o of this.list) if (o.pos.distanceToSquared(t.pos) < 400) return;
    if (W.player && W.player.pos.distanceToSquared(t.pos) < 3600) return;
    this.list.push(t); this.group.add(m.group);
  }
  place(t, dt) {
    const S = edgeSample(t.edge, t.s, this._s || (this._s = {}));
    const off = t.edge.hw * t.lane * t.dir; // l vector points to the right of +dir
    const x = S.x + S.lx * off, z = S.z + S.lz * off; const yaw = Math.atan2(S.dx * t.dir, S.dz * t.dir);
    if (dt > 0) t.vel.set((x - t.pos.x) / dt, 0, (z - t.pos.z) / dt);
    t.pos.set(x, S.y + 0.0, z); _tq.setFromAxisAngle(_up, yaw);
    if (dt > 0) t.quat.slerp(_tq, clamp(dt * 8, 0, 1)); else t.quat.copy(_tq);
  }
  nextEdge(t) {
    const W = this.world; const node = W.nodes[t.dir > 0 ? t.edge.b : t.edge.a];
    const opts = node.edges.filter((e) => e !== t.edge && ['main', 'highway', 'city'].includes(e.type));
    if (!opts.length) { t.dir *= -1; t.s = clamp(t.s, 0, t.edge.len); return; }
    const e = opts[(Math.random() * opts.length) | 0]; t.edge = e;
    if (e.a === node.id) { t.dir = 1; t.s = 0.5; } else { t.dir = -1; t.s = e.len - 0.5; }
  }
  update(dt, player) {
    const W = this.world; const px = player.pos.x, pz = player.pos.z; W.player = player;
    const want = this.enabled ? this.density() : 0;
    if (this.list.length < want) { this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = 0.25; this.spawn(px, pz); } }
    const night = W.night || 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const t = this.list[k]; const dpl = Math.hypot(t.pos.x - px, t.pos.z - pz);
      if (dpl > 620 || (t.hit && t.hitT > 8 && dpl > 60) || this.list.length > want + 2) { this.group.remove(t.mesh.group); this.list.splice(k, 1); continue; }
      if (t.hit) {
        t.hitT += dt; t.pos.addScaledVector(t.vel, dt); t.vel.multiplyScalar(1 - Math.min(1, dt * 1.2)); t.yawV *= 1 - Math.min(1, dt * 1.5);
        _tq.setFromAxisAngle(_up, t.yawV * dt); t.quat.premultiply(_tq); t.pos.y = W.height(t.pos.x, t.pos.z);
        const cols = W.queryColliders(t.pos.x, t.pos.z, 3); for (const c of cols) { if (c.dead || c.breakable) continue; if (c.k === 0) { const dx = t.pos.x - c.x, dz = t.pos.z - c.z, d = Math.hypot(dx, dz); if (d < c.r + 1) { t.pos.x = c.x + dx / d * (c.r + 1); t.pos.z = c.z + dz / d * (c.r + 1); t.vel.multiplyScalar(0.3); } } }
      } else {
        // look ahead for obstacles in lane
        const f = _tv.set(0, 0, 1).applyQuaternion(t.quat); let target = t.edge.speed * t.want;
        if (W.env.wet > 0.4) target *= 0.85; if (night > 0.5) target *= 0.92;
        const check = (o, isPlayer) => {
          const dx = o.pos.x - t.pos.x, dz = o.pos.z - t.pos.z; const fwd = dx * f.x + dz * f.z; if (fwd < 0 || fwd > 30) return;
          const lat = Math.abs(dx * f.z - dz * f.x); if (lat > 2.6) return;
          const ospd = isPlayer ? Math.max(0, o.vel.x * f.x + o.vel.z * f.z) : o.speed;
          target = Math.min(target, fwd < 9 ? 0 : ospd * 0.9 + (fwd - 9) * 0.25); if (isPlayer && fwd < 14 && player.speed < 2) t.honk = (t.honk || 0) + dt;
        };
        for (const o of this.list) if (o !== t) check(o, false);
        check(player, true);
        // corner speed from curvature ahead
        const S0 = edgeSample(t.edge, t.s, this._a || (this._a = {})); const S1 = edgeSample(t.edge, t.s + 25 * t.dir, this._b || (this._b = {}));
        const h0 = Math.atan2(S0.dx, S0.dz), h1 = Math.atan2(S1.dx, S1.dz); let dh = Math.abs(h1 - h0); if (dh > Math.PI) dh = Math.PI * 2 - dh;
        target = Math.min(target, lerp(t.edge.speed, 8, clamp(dh / 0.8, 0, 1)) * t.want + 2);
        t.speed += clamp(target - t.speed, -9 * dt, 2.8 * dt);
        t.s += t.speed * dt * t.dir;
        if (t.s > t.edge.len || t.s < 0) this.nextEdge(t);
        this.place(t, dt);
      }
      t.mesh.group.position.copy(t.pos); t.mesh.group.quaternion.copy(t.quat);
      t.mesh.setLights(night > 0.4 || (W.weather && W.weather.p.fog > 0.5), !t.hit && t.speed < t.edge.speed * 0.5);
      t.mesh.spinWheels(t.hit ? t.vel.length() : t.speed, dt);
    }
  }
}

// =====================================================================
// Wildlife: deer herds that graze and flee, bird flocks overhead
// =====================================================================
class Wildlife {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.herds = []; this.t = 0; this.group = new THREE.Group(); scene.add(this.group);
    const body = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.9 });
    const g = [new THREE.BoxGeometry(0.45, 0.5, 1.2).translate(0, 1.0, 0), new THREE.BoxGeometry(0.22, 0.6, 0.25).rotateX(-0.5).translate(0, 1.35, 0.6), new THREE.BoxGeometry(0.22, 0.25, 0.4).translate(0, 1.6, 0.8)];
    for (const [x, z] of [[-0.15, 0.45], [0.15, 0.45], [-0.15, -0.45], [0.15, -0.45]]) g.push(new THREE.BoxGeometry(0.1, 0.8, 0.1).translate(x, 0.4, z));
    g.push(new THREE.BoxGeometry(0.04, 0.35, 0.04).rotateZ(0.4).translate(0.12, 1.85, 0.75), new THREE.BoxGeometry(0.04, 0.35, 0.04).rotateZ(-0.4).translate(-0.12, 1.85, 0.75));
    this.deerGeo = mergeGeos(g); this.deerMat = body;
    // birds
    const N = 40; const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.birds = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x222222, size: 0.9, sizeAttenuation: true })); this.birds.frustumCulled = false; scene.add(this.birds); this.birdN = N; this.birdC = new THREE.Vector3();
  }
  spawnHerd(px, pz) {
    const W = this.world; const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 160; const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    const id = W.dominant(x, z); if (!['plains', 'farm', 'alpine', 'jungle', 'coast', 'obs'].includes(id)) return;
    const q = W.roadQuery(x, z, {}); if (q && q.d < 15) return; if (W.height(x, z) < 2 || W.height(x, z) > 340) return;
    const herd = { x, z, deer: [] }; const n = 3 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(this.deerGeo, this.deerMat); m.castShadow = true; const dx = x + (Math.random() - 0.5) * 14, dz = z + (Math.random() - 0.5) * 14; m.position.set(dx, W.height(dx, dz), dz); m.rotation.y = Math.random() * 6; this.group.add(m); herd.deer.push({ m, state: 'graze', t: Math.random() * 4, h: m.rotation.y, spd: 0 }); }
    this.herds.push(herd);
  }
  update(dt, ppos) {
    const W = this.world; this.t += dt; const max = W.settings.drawDistance === 'low' ? 1 : 3;
    if (this.herds.length < max && Math.random() < dt * 0.5) this.spawnHerd(ppos.x, ppos.z);
    for (let k = this.herds.length - 1; k >= 0; k--) {
      const H = this.herds[k]; if (Math.hypot(H.x - ppos.x, H.z - ppos.z) > 450) { H.deer.forEach((d) => this.group.remove(d.m)); this.herds.splice(k, 1); continue; }
      for (const d of H.deer) {
        const m = d.m; const dx = m.position.x - ppos.x, dz = m.position.z - ppos.z; const dist = Math.hypot(dx, dz);
        if (dist < 35 && d.state !== 'flee') { d.state = 'flee'; d.t = 4 + Math.random() * 2; d.h = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.8; }
        d.t -= dt;
        if (d.t <= 0) { if (d.state === 'flee' || d.state === 'walk') { d.state = 'graze'; d.t = 3 + Math.random() * 5; } else { d.state = 'walk'; d.t = 2 + Math.random() * 3; d.h += (Math.random() - 0.5) * 2; } }
        const target = d.state === 'flee' ? 11 : d.state === 'walk' ? 1.4 : 0; d.spd += (target - d.spd) * Math.min(1, dt * 3);
        let dr = d.h - m.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); m.rotation.y += dr * Math.min(1, dt * 4);
        m.position.x += Math.sin(m.rotation.y) * d.spd * dt; m.position.z += Math.cos(m.rotation.y) * d.spd * dt;
        const gy = W.height(m.position.x, m.position.z); m.position.y = gy + (d.state === 'flee' ? Math.abs(Math.sin(this.t * 9 + m.id)) * 0.35 : 0);
        m.rotation.x = d.state === 'graze' ? 0.25 : 0; if (gy < 1) d.h += Math.PI;
      }
    }
    // birds circle above
    if (!this.birdC.lengthSq() || this.birdC.distanceTo(ppos) > 600) this.birdC.set(ppos.x + 100, 0, ppos.z + 80);
    const arr = this.birds.geometry.attributes.position.array; const cy = W.height(this.birdC.x, this.birdC.z) + 70;
    for (let i = 0; i < this.birdN; i++) { const a = this.t * 0.3 + i * 0.37, r = 30 + (i % 7) * 6; arr[i * 3] = this.birdC.x + Math.cos(a) * r + Math.sin(this.t + i) * 3; arr[i * 3 + 1] = cy + Math.sin(a * 2 + i) * 6; arr[i * 3 + 2] = this.birdC.z + Math.sin(a) * r; }
    this.birds.geometry.attributes.position.needsUpdate = true; this.birds.visible = W.night < 0.6 && W.weather.p.rain < 0.5;
  }
}

// =====================================================================
// Crowds & photographers at events / showcases
// =====================================================================
class Crowds {
  constructor(world, scene) { this.world = world; this.scene = scene; this.items = []; this.group = new THREE.Group(); scene.add(this.group); this.t = 0;
    this.camGeo = mergeGeos([new THREE.BoxGeometry(0.4, 1.1, 0.3).translate(0, 1.05, 0), new THREE.SphereGeometry(0.15, 8, 6).translate(0, 1.75, 0), new THREE.BoxGeometry(0.18, 0.12, 0.2).translate(0, 1.5, 0.22)]);
    this.camMat = new THREE.MeshStandardMaterial({ color: 0x333a44 });
  }
  clear() { this.items.forEach((i) => this.group.remove(i.m)); this.items = []; }
  // points: [{x,z,yaw, kind:'crowd'|'photo'}]
  set(points) {
    this.clear(); const W = this.world;
    for (const p of points) {
      const y = W.height(p.x, p.z);
      if (p.kind === 'photo') { const m = new THREE.Mesh(this.camGeo, this.camMat); m.position.set(p.x, y, p.z); m.rotation.y = p.yaw; this.group.add(m); this.items.push({ m, photo: true, t: Math.random() * 3, y }); }
      else { const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.2), W.M.crowd); m.position.set(p.x, y + 1.6, p.z); m.rotation.y = p.yaw; this.group.add(m); this.items.push({ m, y: y + 1.6, ph: Math.random() * 6 }); }
    }
  }
  update(dt) {
    this.t += dt;
    for (const it of this.items) {
      if (it.photo) { it.t -= dt; if (it.t <= 0) { it.t = 0.6 + Math.random() * 3; const p = it.m.position; this.world.glow.emit(p.x + Math.sin(it.m.rotation.y) * 0.3, p.y + 1.5, p.z + Math.cos(it.m.rotation.y) * 0.3, 0, 0, 0, 2.2, 1, 1, 1, 1, 0.12, 0); } }
      else it.m.position.y = it.y + Math.abs(Math.sin(this.t * 6 + it.ph)) * 0.12;
    }
  }
}

// =====================================================================
// Procedural car models (extruded side profiles + livery atlas)
// =====================================================================
const PROFILES = {
  wedge: { p: [[0, 0.15], [0, 0.55], [0.06, 0.62], [0.3, 0.68], [0.42, 0.98], [0.58, 1.0], [0.72, 0.62], [0.97, 0.42], [1, 0.3], [1, 0.15]], belt: 0.62, g: [0.42, 0.72] },
  sport: { p: [[0, 0.18], [0, 0.62], [0.05, 0.66], [0.2, 0.72], [0.38, 1.0], [0.6, 0.98], [0.72, 0.66], [0.98, 0.52], [1, 0.35], [1, 0.18]], belt: 0.66, g: [0.2, 0.72] },
  muscle: { p: [[0, 0.18], [0, 0.6], [0.04, 0.66], [0.18, 0.68], [0.32, 1.0], [0.55, 1.0], [0.66, 0.68], [0.98, 0.62], [1, 0.45], [1, 0.18]], belt: 0.67, g: [0.18, 0.66] },
  sedan: { p: [[0, 0.18], [0, 0.62], [0.03, 0.68], [0.2, 0.7], [0.3, 1.0], [0.62, 1.0], [0.72, 0.68], [0.98, 0.62], [1, 0.4], [1, 0.18]], belt: 0.69, g: [0.2, 0.72] },
  hatch: { p: [[0, 0.18], [0, 0.7], [0.04, 0.95], [0.1, 1.0], [0.6, 1.0], [0.74, 0.68], [0.98, 0.6], [1, 0.4], [1, 0.18]], belt: 0.68, g: [0.02, 0.74] },
  boxy: { p: [[0, 0.18], [0, 0.66], [0.02, 0.68], [0.18, 0.7], [0.26, 1.0], [0.64, 1.0], [0.74, 0.7], [0.99, 0.66], [1, 0.5], [1, 0.18]], belt: 0.7, g: [0.18, 0.74] },
  classic: { p: [[0, 0.22], [0, 0.5], [0.08, 0.6], [0.25, 0.65], [0.35, 0.98], [0.55, 1.0], [0.65, 0.66], [0.9, 0.6], [1, 0.45], [1, 0.22]], belt: 0.64, g: [0.25, 0.65] },
  truck: { p: [[0, 0.15], [0, 0.62], [0.36, 0.62], [0.38, 1.0], [0.68, 1.0], [0.76, 0.7], [0.99, 0.66], [1, 0.4], [1, 0.15]], belt: 0.68, g: [0.37, 0.76] },
  suv: { p: [[0, 0.15], [0, 0.95], [0.04, 1.0], [0.66, 1.0], [0.78, 0.68], [0.99, 0.62], [1, 0.4], [1, 0.15]], belt: 0.66, g: [0.02, 0.78] },
  van: { p: [[0, 0.12], [0, 0.98], [0.03, 1.0], [0.85, 1.0], [0.97, 0.6], [1, 0.4], [1, 0.12]], belt: 0.62, g: [0.6, 0.97] },
  wagon: { p: [[0, 0.18], [0, 0.7], [0.02, 0.98], [0.06, 1.0], [0.62, 1.0], [0.74, 0.68], [0.98, 0.6], [1, 0.4], [1, 0.18]], belt: 0.68, g: [0.02, 0.74] },
  proto: { p: [[0, 0.15], [0, 0.62], [0.1, 0.55], [0.42, 0.56], [0.5, 0.95], [0.6, 0.95], [0.68, 0.52], [1, 0.3], [1, 0.15]], belt: 0.9, g: [0.5, 0.66], open: true },
  buggy: { p: [[0, 0.1], [0, 0.45], [0.3, 0.5], [0.45, 0.62], [0.7, 0.55], [1, 0.4], [1, 0.1]], belt: 0.95, g: null, cage: true },
};
function profileFor(body) {
  if (/^(hyper|super|wedge|super_front)/.test(body)) return body === 'super_front' ? 'sport' : 'wedge';
  if (/^(sport|gt|roadster)/.test(body)) return 'sport';
  if (/^muscle/.test(body)) return 'muscle';
  if (/^(classic|racer_classic)/.test(body)) return 'classic';
  if (/^(hatch|mini)/.test(body)) return 'hatch';
  if (/^boxy/.test(body)) return 'boxy';
  if (/^(sedan|ev_sedan)/.test(body)) return 'sedan';
  if (/^wagon/.test(body)) return 'wagon';
  if (/^(truck|ute|wedge_truck|wedge_classic)/.test(body)) return 'truck';
  if (/^(suv|raid)/.test(body)) return 'suv';
  if (/^van/.test(body)) return 'van';
  if (/^(proto|openwheel)/.test(body)) return 'proto';
  if (/^(buggy|trophy|kart)/.test(body)) return 'buggy';
  return 'sport';
}
const _liveryCache = new Map();
export function drawLivery(liv, size = 512) {
  const cv = document.createElement('canvas'); cv.width = size * 2; cv.height = size; const g = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const c1 = '#' + new THREE.Color(liv.color ?? 0xcc2222).getHexString(), c2 = '#' + new THREE.Color(liv.decalColor ?? 0xffffff).getHexString(), c3 = '#' + new THREE.Color(liv.color2 ?? 0x111111).getHexString();
  g.fillStyle = c1; g.fillRect(0, 0, W, H);
  // atlas: left half = top view (u across width, v along length), right half = side view (u along length rear->front, v up)
  const side = (fn) => { g.save(); g.translate(W / 2, 0); fn(W / 2, H); g.restore(); };
  const top = (fn) => { g.save(); fn(W / 2, H); g.restore(); };
  switch (liv.decal) {
    case 'stripes': top((w, h) => { g.fillStyle = c2; g.fillRect(w * 0.36, 0, w * 0.1, h); g.fillRect(w * 0.54, 0, w * 0.1, h); }); side((w, h) => { g.fillStyle = c2; g.fillRect(0, h * 0.86, w, h * 0.05); }); break;
    case 'racing number': side((w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.5, h * 0.45, h * 0.22, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = `bold ${h * 0.3 | 0}px Arial Black, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(liv.number ?? 7), w * 0.5, h * 0.46); g.fillStyle = c2; g.fillRect(0, h * 0.15, w, h * 0.04); }); top((w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h * 0.75, w * 0.2, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = `bold ${w * 0.26 | 0}px Arial Black, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(liv.number ?? 7), w / 2, h * 0.76); }); break;
    case 'flames': side((w, h) => { const grd = g.createLinearGradient(w, 0, w * 0.35, 0); grd.addColorStop(0, '#ffe14a'); grd.addColorStop(0.5, '#ff7a00'); grd.addColorStop(1, '#d42020'); g.fillStyle = grd; g.beginPath(); g.moveTo(w, h * 0.2); for (let i = 0; i <= 10; i++) { const x = w - i * w * 0.065; g.quadraticCurveTo(x - w * 0.04, h * (0.2 + (i % 2) * 0.12), x - w * 0.06, h * (0.35 + Math.sin(i) * 0.08)); } g.lineTo(w * 0.3, h * 0.55); for (let i = 10; i >= 0; i--) { const x = w - i * w * 0.065; g.quadraticCurveTo(x - w * 0.02, h * (0.7 - (i % 2) * 0.1), x, h * 0.85); } g.closePath(); g.fill(); }); top((w, h) => { g.fillStyle = '#ff7a00'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w * (0.2 + i * 0.15), h); g.quadraticCurveTo(w * (0.25 + i * 0.15), h * 0.72, w * (0.27 + i * 0.15), h * (0.6 + (i % 2) * 0.08)); g.quadraticCurveTo(w * (0.3 + i * 0.15), h * 0.8, w * (0.32 + i * 0.15), h); g.fill(); } }); break;
    case 'checker': side((w, h) => { const s = h * 0.08; for (let y = h * 0.62; y < h * 0.86; y += s) for (let x = 0; x < w; x += s) if (((x / s | 0) + (y / s | 0)) % 2) { g.fillStyle = c2; g.fillRect(x, y, s, s); } }); top((w, h) => { const s = w * 0.1; for (let y = h * 0.8; y < h; y += s) for (let x = 0; x < w; x += s) if (((x / s | 0) + (y / s | 0)) % 2) { g.fillStyle = c2; g.fillRect(x, y, s, s); } }); break;
    case 'side stripe': side((w, h) => { g.fillStyle = c2; g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.4); g.lineTo(w, h * 0.5); g.lineTo(0, h * 0.62); g.fill(); g.fillStyle = c3; g.fillRect(0, h * 0.64, w, h * 0.025); }); break;
    case 'horizon logo': side((w, h) => { const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#ff2e88'); grd.addColorStop(1, '#ffd23f'); g.fillStyle = grd; g.fillRect(0, h * 0.62, w, h * 0.2); g.fillStyle = '#fff'; g.font = `bold ${h * 0.15 | 0}px Arial Black, Arial`; g.textAlign = 'center'; g.fillText('HORIZON', w / 2, h * 0.78); }); top((w, h) => { g.fillStyle = '#ff2e88'; g.fillRect(0, h * 0.45, w, h * 0.08); }); break;
    case 'sunburst': top((w, h) => { g.fillStyle = c2; for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(w / 2, h); const a = Math.PI + i / 14 * Math.PI; g.lineTo(w / 2 + Math.cos(a) * h * 1.2, h + Math.sin(a) * h * 1.2); g.lineTo(w / 2 + Math.cos(a + 0.1) * h * 1.2, h + Math.sin(a + 0.1) * h * 1.2); g.fill(); } }); side((w, h) => { const grd = g.createLinearGradient(0, h, 0, 0); grd.addColorStop(0, c2); grd.addColorStop(0.5, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }); break;
    case 'camo': { const r = mulberry32(liv.number || 3); const cols = [c2, c3, '#' + new THREE.Color(liv.color ?? 0x556b2f).offsetHSL(0, 0, -0.15).getHexString()]; for (let i = 0; i < 160; i++) { g.fillStyle = cols[i % 3]; g.beginPath(); const x = r() * W, y = r() * H; g.ellipse(x, y, 20 + r() * 50, 12 + r() * 30, r() * 3, 0, 7); g.fill(); } break; }
  }
  // subtle panel line & grime
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(W / 2 + W * 0.25 * 0.5, H * 0.35, 2, H * 0.45);
  return cv;
}
function wheelGeo(style, r, w) {
  const parts = []; const rr = r * 0.66;
  const ring = new THREE.CylinderGeometry(rr, rr, w * 0.82, 20, 1, true).rotateZ(Math.PI / 2); parts.push(ring);
  const face = (n, thick, span = 0.92) => { for (let i = 0; i < n; i++) { const b = new THREE.BoxGeometry(w * 0.12, rr * span, thick).translate(0, rr * span / 2, 0).rotateX(i / n * Math.PI * 2).translate(w * 0.28, 0, 0); parts.push(b); } };
  const hub = new THREE.CylinderGeometry(rr * 0.22, rr * 0.22, w * 0.3, 10).rotateZ(Math.PI / 2).translate(w * 0.25, 0, 0); parts.push(hub);
  switch (style) {
    case 0: face(5, rr * 0.22); break;
    case 1: face(10, rr * 0.06); face(10, rr * 0.06, 0.9); for (const g of parts.slice(-10)) g.rotateX(Math.PI / 10); break;
    case 2: face(6, rr * 0.12, 0.6); parts.push(new THREE.CylinderGeometry(rr, rr * 0.6, w * 0.06, 20).rotateZ(Math.PI / 2).translate(w * 0.36, 0, 0)); break;
    case 3: face(16, rr * 0.08); break;
    case 4: parts.push(new THREE.CylinderGeometry(rr * 0.95, rr * 0.95, w * 0.06, 16).rotateZ(Math.PI / 2).translate(w * 0.27, 0, 0)); break;
    case 5: face(8, rr * 0.1); break;
    case 6: face(6, rr * 0.32); break;
    case 7: face(8, rr * 0.12); parts.push(new THREE.TorusGeometry(rr * 0.96, w * 0.05, 6, 20).rotateY(Math.PI / 2).translate(w * 0.36, 0, 0)); break;
  }
  return mergeGeos(parts);
}
const _tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 });
const _darkMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.7, metalness: 0.2 });
const _discMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4, emissive: 0xff3300, emissiveIntensity: 0 });
const _chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15 });
export function paintMaterial(liv, map) {
  const t = liv.paint || 'gloss'; const o = { map, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 };
  if (t === 'matte') Object.assign(o, { roughness: 0.82, metalness: 0.05, clearcoat: 0 });
  if (t === 'metallic') Object.assign(o, { roughness: 0.32, metalness: 0.75, clearcoat: 0.7 });
  if (t === 'chrome') Object.assign(o, { roughness: 0.05, metalness: 1, clearcoat: 0.3 });
  if (t === 'pearl') Object.assign(o, { roughness: 0.25, metalness: 0.35, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.7, sheen: 0.6, sheenColor: new THREE.Color(liv.decalColor ?? 0xffffff) });
  return new THREE.MeshPhysicalMaterial(o);
}
export class CarModel {
  constructor(spec, livery, opts = {}) {
    this.spec = spec; this.opts = opts; this.group = new THREE.Group(); this.livery = { paint: 'gloss', color: 0xcc2222, decal: 'none', decalColor: 0xffffff, color2: 0x111111, number: 7, wheel: 0, rim: 0xbbbbbb, tint: 0.3, caliper: 0xd02020, ...livery };
    this.isBike = spec.cat === 'BIKE' || /^bike/.test(spec.body);
    this.wheelGroups = []; this.lightOn = false; this.brakeOn = false; this.lean = 0;
    this.build();
  }
  build() {
    const s = this.spec, L = s.len, W = s.wid, H = s.hgt, r = s.tireR; const lowRide = s.cat === 'HYPER' || s.cat === 'SUPER';
    const gc = this.isBike ? r * 0.8 : (['OFFROAD', 'RAID', 'TRUCK'].includes(s.cat) ? r * 1.15 : lowRide ? r * 0.45 : r * 0.6);
    const y0 = -s.cgh + gc; this.y0 = y0; const BH = Math.max(0.5, H - gc);
    this.mats = {};
    this.liveryCanvas = drawLivery(this.livery, this.opts.lod ? 128 : 512); const tex = new THREE.CanvasTexture(this.liveryCanvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; this.liveryTex = tex;
    this.mats.paint = paintMaterial(this.livery, tex);
    this.mats.glass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x9fb8c8).lerp(new THREE.Color(0x050608), this.livery.tint ?? 0.3), metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.55 + (this.livery.tint ?? 0.3) * 0.4, clearcoat: 1 });
    this.mats.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.2 });
    this.mats.tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.3 });
    this.mats.rim = new THREE.MeshStandardMaterial({ color: this.livery.rim ?? 0xbbbbbb, metalness: 0.9, roughness: 0.25 });
    this.mats.caliper = new THREE.MeshStandardMaterial({ color: this.livery.caliper ?? 0xd02020, roughness: 0.5 });
    this.mats.disc = _discMat.clone();
    if (this.isBike) this.buildBike(y0); else this.buildBody(L, W, BH, y0);
    // wheels
    const wf = s.wf, wb = s.wb; const zf = wb * (1 - wf), zr = -wb * wf; const tr = s.track / 2; const tw = this.isBike ? 0.16 : clamp(r * 0.72, 0.18, 0.42);
    const mounts = this.isBike ? [[0, zf], [0, zf], [0, zr], [0, zr]] : [[tr, zf], [-tr, zf], [tr, zr], [-tr, zr]];
    const tireG = new THREE.CylinderGeometry(r, r, tw, 22).rotateZ(Math.PI / 2); const rimG = wheelGeo(this.livery.wheel | 0, r, tw);
    const discG = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.03, 16).rotateZ(Math.PI / 2); const calG = new THREE.BoxGeometry(0.06, r * 0.32, r * 0.22);
    this.tireG = tireG; this.rimG = rimG;
    mounts.forEach(([x, z], i) => {
      const steer = new THREE.Group(); const spin = new THREE.Group(); steer.position.set(x, -s.cgh + r, z);
      if (this.isBike && (i === 1 || i === 3)) { steer.visible = false; }
      const tire = new THREE.Mesh(tireG, _tireMat); tire.castShadow = !this.opts.lod; spin.add(tire);
      const rim = new THREE.Mesh(rimG, this.mats.rim); if (x < 0) rim.scale.x = -1; spin.add(rim);
      steer.add(spin);
      if (!this.opts.lod) { const disc = new THREE.Mesh(discG, this.mats.disc); disc.position.x = x < 0 ? tw * 0.05 : -tw * 0.05; steer.add(disc); const cal = new THREE.Mesh(calG, this.mats.caliper); cal.position.set(x < 0 ? tw * 0.1 : -tw * 0.1, r * 0.25, -r * 0.2); steer.add(cal); }
      this.group.add(steer); this.wheelGroups.push({ steer, spin, base: steer.position.clone() });
    });
    this.exhaust = this.isBike ? [new THREE.Vector3(0.18, y0 + 0.25, zr - 0.15)] : (s.cyl >= 8 ? [new THREE.Vector3(0.45, y0 + 0.18, -L / 2), new THREE.Vector3(-0.45, y0 + 0.18, -L / 2)] : [new THREE.Vector3(0.35, y0 + 0.18, -L / 2)]);
    if (s.asp !== 'EV') for (const e of this.exhaust) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8).rotateX(Math.PI / 2), _chromeMat); p.position.copy(e); this.group.add(p); }
    this.headPos = [new THREE.Vector3(W * 0.34, y0 + BH * 0.42, L / 2), new THREE.Vector3(-W * 0.34, y0 + BH * 0.42, L / 2)];
    this.group.traverse((o) => { if (o.isMesh && !this.opts.lod) o.castShadow = true; });
  }
  buildBody(L, W, BH, y0) {
    const prof = PROFILES[profileFor(this.spec.body)]; const P = prof.p; this.prof = prof;
    const shape = new THREE.Shape(); P.forEach(([u, v], i) => { const x = (u - 0.5) * L, y = y0 + v * BH; if (i) shape.lineTo(x, y); else shape.moveTo(x, y); }); shape.closePath();
    const depth = W * 0.9; const bev = Math.min(0.06, W * 0.03);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, steps: 1, curveSegments: 4 });
    // remap: shape x -> car z, shape y -> car y, extrude z -> car x (centered); taper top by belt
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const sx = pos.getX(i), sy = pos.getY(i), sz = pos.getZ(i); const v = (sy - y0) / BH; let x = sz - depth / 2;
      const tp = smoothstep(prof.belt - 0.04, 1.02, v); x *= 1 - tp * 0.24;
      const zN = sx / L + 0.5; x *= 1 - 0.07 * (Math.abs(zN - 0.5) * 2) ** 3; // round corners in plan
      pos.setXYZ(i, x, sy, sx);
    }
    geo.computeVertexNormals();
    // atlas uvs
    const nrm = geo.attributes.normal; const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const ny = nrm.getY(i), nx = nrm.getX(i);
      if (Math.abs(ny) > Math.abs(nx) * 1.2 && ny > 0) { uv[i * 2] = clamp(0.5 * (x / W + 0.5), 0, 0.5); uv[i * 2 + 1] = 1 - clamp(z / L + 0.5, 0, 1); }
      else { uv[i * 2] = 0.5 + 0.5 * clamp(z / L + 0.5, 0, 1); uv[i * 2 + 1] = clamp((y - y0) / BH, 0, 1); }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.bodyGeo = geo; this.bodyBase = Float32Array.from(pos.array);
    this.body = new THREE.Mesh(geo, this.mats.paint); this.group.add(this.body);
    // glasshouse: inset slab above belt
    if (prof.g) {
      const gs = new THREE.Shape(); const pts = P.filter(([u, v]) => v >= prof.belt - 0.01 && u >= prof.g[0] - 0.02 && u <= prof.g[1] + 0.02);
      if (pts.length >= 2) {
        const first = pts[0], last = pts[pts.length - 1];
        gs.moveTo((first[0] - 0.5) * L, y0 + prof.belt * BH);
        pts.forEach(([u, v]) => gs.lineTo((clamp(u, prof.g[0], prof.g[1]) - 0.5) * L * 0.995, y0 + Math.min(v, 0.985) * BH - 0.02));
        gs.lineTo((last[0] - 0.5) * L, y0 + prof.belt * BH); gs.closePath();
        const gd = W * 0.9 * (1 - 0.24 * 0.6) + 0.03; const gg = new THREE.ExtrudeGeometry(gs, { depth: gd, bevelEnabled: false });
        const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) { const sx = gp.getX(i), sy = gp.getY(i), sz = gp.getZ(i); const v = (sy - y0) / BH; let x = sz - gd / 2; x *= 1 - smoothstep(prof.belt, 1.02, v) * 0.14; pos && gp.setXYZ(i, x, sy, sx); }
        gg.computeVertexNormals(); this.glass = new THREE.Mesh(gg, this.mats.glass); this.group.add(this.glass);
      }
    }
    if (prof.open) { const helm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshStandardMaterial({ color: this.livery.decalColor ?? 0xffffff, metalness: 0.3, roughness: 0.3 })); helm.position.set(0, y0 + BH * 0.95, (0.55 - 0.5) * L); this.group.add(helm); }
    if (prof.cage) { const cm = _darkMat; const bars = []; const zc = 0.0, h = BH * 1.25; for (const sx of [-1, 1]) { bars.push(new THREE.CylinderGeometry(0.04, 0.04, h, 6).translate(sx * W * 0.38, y0 + BH * 0.4 + h / 2, zc - 0.5)); bars.push(new THREE.CylinderGeometry(0.04, 0.04, h * 1.05, 6).rotateX(0.35).translate(sx * W * 0.38, y0 + BH * 0.4 + h / 2, zc + 0.6)); } bars.push(new THREE.CylinderGeometry(0.04, 0.04, W * 0.76, 6).rotateZ(Math.PI / 2).translate(0, y0 + BH * 0.4 + h, zc)); bars.push(new THREE.BoxGeometry(W * 0.8, 0.04, 1.4).translate(0, y0 + BH * 0.4 + h, zc)); this.group.add(new THREE.Mesh(mergeGeos(bars), cm)); }
    // lights
    const hl = new THREE.BoxGeometry(W * 0.2, BH * 0.09, 0.05); const yl = y0 + BH * 0.42;
    const zFront = L / 2 + 0.01, zRear = -L / 2 - 0.01; this.lightMeshes = [];
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(hl, this.mats.head); const vf = this.sampleProfile(0.985); h.position.set(sx * W * 0.32, y0 + vf * BH * 0.85, zFront - 0.04); this.group.add(h);
      const t = new THREE.Mesh(hl, this.mats.tail); const vr = this.sampleProfile(0.01); t.position.set(sx * W * 0.32, y0 + vr * BH * 0.85, zRear + 0.04); this.group.add(t);
    }
    // grille / splitter / diffuser
    const spl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.05, 0.25), _darkMat); spl.position.set(0, y0 + 0.02, L / 2 - 0.1); this.group.add(spl);
    const dif = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.12, 0.2), _darkMat); dif.position.set(0, y0 + 0.07, -L / 2 + 0.08); this.group.add(dif);
    // mirrors
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), this.mats.paint); m.position.set(sx * W * 0.46, y0 + BH * prof.belt + 0.06, (prof.g ? prof.g[1] - 0.5 : 0.2) * L - 0.1); this.group.add(m); }
    // spoiler (added if aero upgraded or race body)
    this.spoiler = new THREE.Group(); const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.04, 0.32), _darkMat); wing.position.y = 0.32; this.spoiler.add(wing);
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.12), _darkMat); post.position.set(sx * W * 0.3, 0.16, 0); this.spoiler.add(post); const ep = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.36), _darkMat); ep.position.set(sx * W * 0.43, 0.32, 0); this.spoiler.add(ep); }
    this.spoiler.position.set(0, y0 + this.sampleProfile(0.03) * BH, -L / 2 + 0.25); this.spoiler.visible = !!(this.spec.clR > 0.4 || this.opts.wing); this.group.add(this.spoiler);
    this.BH = BH;
  }
  sampleProfile(u) { const P = this.prof.p; let best = 0; for (const [pu, pv] of P) if (Math.abs(pu - u) < 0.12) best = Math.max(best, pv); return best || 0.6; }
  buildBike(y0) {
    const s = this.spec; const L = s.len; const wb = s.wb; const r = s.tireR; const yb = -s.cgh + r;
    const lean = this.leanGroup = new THREE.Group(); this.group.add(lean);
    const P = this.mats.paint; const parts = (g, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.x = rx; lean.add(o); return o; };
    parts(new THREE.BoxGeometry(0.28, 0.3, wb * 0.55), P, 0, yb + r * 0.9, 0.05);
    parts(new THREE.BoxGeometry(0.34, 0.24, 0.5), P, 0, yb + r * 1.45, wb * 0.12, -0.1); // tank
    parts(new THREE.BoxGeometry(0.26, 0.1, 0.55), _darkMat, 0, yb + r * 1.35, -wb * 0.22); // seat
    parts(new THREE.BoxGeometry(0.22, 0.28, 0.5), P, 0, yb + r * 1.25, -wb * 0.45, 0.25); // tail
    parts(new THREE.BoxGeometry(0.06, r * 1.6, 0.06), _chromeMat, 0.09, yb + r * 0.85, wb * 0.43, 0.42); parts(new THREE.BoxGeometry(0.06, r * 1.6, 0.06), _chromeMat, -0.09, yb + r * 0.85, wb * 0.43, 0.42);
    if (!/dirt/.test(s.body)) parts(new THREE.BoxGeometry(0.4, 0.42, 0.45), P, 0, yb + r * 1.6, wb * 0.42, -0.5); // fairing
    // rider
    const suit = new THREE.MeshStandardMaterial({ color: this.livery.color2 ?? 0x222222, roughness: 0.7 });
    this.rider = new THREE.Group(); lean.add(this.rider);
    const tor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.55, 0.24), suit); tor.position.set(0, yb + r * 1.35 + 0.38, -wb * 0.05); tor.rotation.x = 0.75; this.rider.add(tor);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshStandardMaterial({ color: this.livery.decalColor ?? 0xffffff, metalness: 0.4, roughness: 0.25 })); helm.position.set(0, yb + r * 1.35 + 0.66, wb * 0.13); this.rider.add(helm);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.55), suit); leg.position.set(sx * 0.2, yb + r * 1.2, -wb * 0.12); leg.rotation.x = -0.4; this.rider.add(leg); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.45), suit); arm.position.set(sx * 0.2, yb + r * 1.55 + 0.25, wb * 0.18); arm.rotation.x = 0.5; this.rider.add(arm); }
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), this.mats.head); h.position.set(0, yb + r * 1.6, wb * 0.42 + 0.24); lean.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), this.mats.tail); t.position.set(0, yb + r * 1.35, -wb * 0.45 - 0.26); lean.add(t);
    this.lightMeshes = []; this.BH = 1;
  }
  setLivery(liv) {
    Object.assign(this.livery, liv);
    const cv = drawLivery(this.livery, this.opts.lod ? 128 : 512); this.liveryCanvas = cv; this.liveryTex.dispose(); const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; this.liveryTex = tex;
    const old = this.mats.paint; const nm = paintMaterial(this.livery, tex); this.mats.paint = nm;
    this.group.traverse((o) => { if (o.material === old) o.material = nm; }); old.dispose();
    this.mats.glass.color.set(new THREE.Color(0x9fb8c8).lerp(new THREE.Color(0x050608), this.livery.tint ?? 0.3)); this.mats.glass.opacity = 0.55 + (this.livery.tint ?? 0.3) * 0.4;
    this.mats.rim.color.set(this.livery.rim ?? 0xbbbbbb); this.mats.caliper.color.set(this.livery.caliper ?? 0xd02020);
    if ((liv.wheel ?? null) !== null && liv.wheel !== this._wheelStyle) { this._wheelStyle = liv.wheel; const s = this.spec; const tw = this.isBike ? 0.16 : clamp(s.tireR * 0.72, 0.18, 0.42); const g = wheelGeo(liv.wheel | 0, s.tireR, tw); this.wheelGroups.forEach((w) => { const rim = w.spin.children[1]; rim.geometry = g; }); this.rimG = g; }
  }
  setWing(on) { if (this.spoiler) this.spoiler.visible = !!on; }
  setLights(on, brake) {
    if (on !== this.lightOn) { this.lightOn = on; this.mats.head.emissiveIntensity = on ? 3 : 0.2; }
    const b = brake ? 4 : on ? 1.2 : 0.3; if (b !== this._tb) { this._tb = b; this.mats.tail.emissiveIntensity = b; }
  }
  spinWheels(speed, dt) { const r = this.spec.tireR; for (const w of this.wheelGroups) w.spin.rotation.x += speed / r * dt; }
  // sync visuals with physics vehicle state
  update(v, dt) {
    this.group.position.copy(v.renderPos); this.group.quaternion.copy(v.renderQuat);
    v.wheels.forEach((w, i) => {
      const G = this.wheelGroups[i]; if (!G) return;
      G.steer.position.set(G.base.x, w.mount.y + w.wheelY, G.base.z); G.steer.rotation.y = w.steer; G.spin.rotation.x = w.rot;
      if (w.camber && !this.isBike) G.steer.rotation.z = (w.left ? -1 : 1) * w.camber * Math.PI / 180 * 0.6;
    });
    const bt = Math.max(v.wheels[0].brakeTemp, v.wheels[2].brakeTemp); this.mats.disc.emissiveIntensity = clamp((bt - 380) / 350, 0, 1) * 2.5;
    if (this.isBike && this.leanGroup) { const target = clamp(-v.input.steer * Math.min(1, v.speed / 18) * 0.65, -0.75, 0.75); this.lean += (target - this.lean) * Math.min(1, dt * 5); this.group.rotateZ(this.lean); }
    // keep fully-damaged deform in sync
    if (v.dmgHits.length !== (this._dmgN || 0)) { if (v.dmgHits.length < (this._dmgN || 0)) this.resetDeform(); for (let i = this._dmgN || 0; i < v.dmgHits.length; i++) this.deform(v.dmgHits[i].p, v.dmgHits[i].a); this._dmgN = v.dmgHits.length; }
  }
  deform(lp, amt) {
    if (!this.bodyGeo) return; const pos = this.bodyGeo.attributes.position; const base = this.bodyBase; const R = 0.75 + amt * 2; const cy = this.y0 + this.BH * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const d = Math.hypot(x - lp.x, (y - (lp.y ?? cy)) * 0.6, z - lp.z); if (d > R) continue;
      const f = (1 - d / R) ** 2 * amt * 0.9; const dx = -x, dy = cy - y, dz = -z * 0.6; const l = Math.hypot(dx, dy, dz) || 1; const crinkle = 0.7 + 0.6 * Math.abs(Math.sin(x * 37 + y * 53 + z * 29));
      let nx = x + dx / l * f * crinkle, ny = y + dy / l * f * 0.5 * crinkle, nz = z + dz / l * f * crinkle;
      const ox = base[i * 3], oy = base[i * 3 + 1], oz = base[i * 3 + 2]; const tot = Math.hypot(nx - ox, ny - oy, nz - oz); if (tot > 0.28) { const k = 0.28 / tot; nx = ox + (nx - ox) * k; ny = oy + (ny - oy) * k; nz = oz + (nz - oz) * k; }
      pos.setXYZ(i, nx, ny, nz);
    }
    pos.needsUpdate = true; this.bodyGeo.computeVertexNormals();
  }
  resetDeform() { if (!this.bodyGeo) return; this.bodyGeo.attributes.position.array.set(this.bodyBase); this.bodyGeo.attributes.position.needsUpdate = true; this.bodyGeo.computeVertexNormals(); this._dmgN = 0; }
  clone() {
    // lightweight clone for traffic: shares geometry; own light materials
    const c = Object.create(CarModel.prototype); c.spec = this.spec; c.opts = this.opts; c.livery = this.livery; c.isBike = this.isBike; c.lightOn = false;
    c.group = this.group.clone(true); c.mats = { ...this.mats, head: this.mats.head.clone(), tail: this.mats.tail.clone() };
    c.group.traverse((o) => { if (o.material === this.mats.head) o.material = c.mats.head; else if (o.material === this.mats.tail) o.material = c.mats.tail; });
    c.wheelGroups = this.wheelGroups.map((w) => { const idx = this.group.children.indexOf(w.steer); const steer = c.group.children[idx]; return { steer, spin: steer.children[0], base: w.base.clone() }; });
    c.exhaust = this.exhaust; c.headPos = this.headPos; return c;
  }
  dispose() {
    this.group.traverse((o) => { if (o.isMesh) { if (o.geometry !== this.tireG && o.geometry && !o.geometry.shared) o.geometry.dispose(); } });
    for (const k in this.mats) if (this.mats[k] && this.mats[k].dispose && this.mats[k] !== _discMat) this.mats[k].dispose(); this.liveryTex && this.liveryTex.dispose();
  }
}
export function buildCarModel(spec, livery, opts) { return new CarModel(spec, livery, opts); }

// =====================================================================
// GPS routing (A* over the road graph) + helpers
// =====================================================================
World.prototype.nearestNode = function (x, z) { let best = null, bd = 1e18; for (const k in this.nodes) { const n = this.nodes[k]; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; };
World.prototype.route = function (fx, fz, tx, tz, allowDirt = true) {
  // returns polyline [[x,y,z],...] along roads from near (fx,fz) to near (tx,tz)
  const q = this.roadQuery(fx, fz, {}); let startIds = [];
  if (q && q.d < 25) startIds = [[q.edge.a, q.s], [q.edge.b, q.edge.len - q.s]]; else { const n = this.nearestNode(fx, fz); startIds = [[n.id, Math.hypot(n.x - fx, n.z - fz)]]; }
  const goal = this.nearestNode(tx, tz); const G = this.nodes;
  const gs = new Map(), came = new Map(), open = [];
  for (const [id, c] of startIds) { gs.set(id, c); open.push([c + Math.hypot(G[id].x - tx, G[id].z - tz), id]); came.set(id, null); }
  let found = null, it = 0;
  while (open.length && it++ < 5000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i; const [, id] = open.splice(bi, 1)[0];
    if (id === goal.id) { found = id; break; }
    for (const e of G[id].edges) {
      if (!allowDirt && (e.type === 'dirt' || e.type === 'gravel')) continue;
      const nb = e.a === id ? e.b : e.a; const cost = e.len * (e.type === 'dirt' || e.type === 'gravel' ? 1.5 : e.type === 'highway' ? 0.8 : 1);
      const ng = gs.get(id) + cost; if (ng < (gs.get(nb) ?? 1e18)) { gs.set(nb, ng); came.set(nb, [id, e]); open.push([ng + Math.hypot(G[nb].x - tx, G[nb].z - tz), nb]); }
    }
  }
  const pts = [[fx, this.height(fx, fz), fz]];
  if (found) {
    const chain = []; let cur = found; while (came.get(cur)) { const [prev, e] = came.get(cur); chain.unshift([prev, e, cur]); cur = prev; }
    if (q && q.d < 25 && chain.length) { // partial first edge from current position
      const e0 = q.edge; const toward = cur; const s0 = q.s; const n = e0.n; const fwd = toward === e0.b;
      for (let i = 0; i < n; i += 4) { const k = fwd ? i : n - 1 - i; if ((fwd && e0.dist[k] < s0) || (!fwd && e0.dist[k] > s0)) continue; pts.push([e0.xs[k], e0.hs[k], e0.zs[k]]); }
    }
    for (const [a, e] of chain) { const fwd = e.a === a; for (let i = 0; i < e.n; i += 4) { const k = fwd ? i : e.n - 1 - i; pts.push([e.xs[k], e.hs[k], e.zs[k]]); } }
  }
  pts.push([tx, this.height(tx, tz), tz]); return pts;
};
// sample an edge-chain into an evenly-spaced racing line [x,y,z]
World.prototype.edgeLine = function (edgeIds, reverse = []) {
  const out = []; edgeIds.forEach((id, j) => { const e = this.edges[id]; const rev = reverse[j]; for (let i = 0; i < e.n; i += 2) { const k = rev ? e.n - 1 - i : i; out.push([e.xs[k], e.hs[k], e.zs[k], e.hw]); } }); return out;
};
World.prototype.findEdge = function (name, nth = 0) { let c = 0; for (const e of this.edges) if (e.name === name) { if (c === nth) return e; c++; } return null; };
World.prototype.dispose = function () { for (const [k, c] of this.chunks) this.disposeChunk(k, c); };

// =====================================================================
// Post-processing: godrays, radial motion blur, chromatic aberration,
// vignette, speed lines, colour filters, flash, tonemapping
// =====================================================================
export const FILTERS = ['None', 'Vivid', 'Warm', 'Cool', 'Mono', 'Vintage', 'Noir', 'Cinematic', 'Dream'];
export class PostFX {
  constructor(renderer) {
    this.renderer = renderer; this.enabled = true;
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, depthBuffer: true });
    this.U = { tDiffuse: { value: this.rt.texture }, sunPos: { value: new THREE.Vector2(0.5, 0.8) }, sunVis: { value: 0 }, blur: { value: 0 }, ca: { value: 0 }, vig: { value: 0.35 }, flash: { value: 0 }, uFilter: { value: 0 }, speedLines: { value: 0 }, time: { value: 0 }, rays: { value: 1 }, aspect: { value: 1 }, tilt: { value: 0 }, tiltPos: { value: 0.5 }, damageFlash: { value: 0 }, brightness: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 sunPos; uniform float sunVis, blur, ca, vig, flash, speedLines, time, rays, aspect, tilt, tiltPos, damageFlash, brightness; uniform int uFilter; varying vec2 vUv;
      float hsh(float n){ return fract(sin(n)*43758.5453); }
      vec3 samp(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb; }
      void main(){
        vec2 uv = vUv; vec2 dc = uv - 0.5; float r = length(dc);
        vec3 col;
        if (ca > 0.0001) { vec2 o = dc * ca; col = vec3(samp(uv + o).r, samp(uv).g, samp(uv - o).b); } else col = samp(uv);
        if (blur > 0.001) { vec3 acc = col; float wsum = 1.0; float k = blur * smoothstep(0.12, 0.6, r); for (int i = 1; i <= 6; i++) { float t = float(i) / 6.0; acc += samp(uv - dc * k * t * 0.12); wsum += 1.0; } col = acc / wsum; }
        if (tilt > 0.001) { float d = abs(uv.y - tiltPos); float k = smoothstep(0.08, 0.4, d) * tilt * 0.006; vec3 acc = col; for (int i = -3; i <= 3; i++) for (int j = -1; j <= 1; j++) acc += samp(uv + vec2(float(i), float(j) * 1.5) * k); col = acc / 22.0; }
        if (sunVis > 0.001 && rays > 0.5) { vec2 d = (uv - sunPos) / 28.0; vec2 p = uv; float dec = 1.0; vec3 g = vec3(0.0); for (int i = 0; i < 28; i++) { p -= d; vec3 s = samp(p); float l = max(dot(s, vec3(0.3,0.59,0.11)) - 1.2, 0.0); g += s * l * dec * 0.04; dec *= 0.95; } col += g * sunVis; }
        if (speedLines > 0.001) { float a = atan(dc.y, dc.x); float id = floor(a * 70.0); float on = step(0.86, hsh(id + floor(time * 14.0) * 13.0)); col += vec3(on * smoothstep(0.28, 0.7, r) * speedLines * 0.35); }
        col *= brightness;
        // filters (in linear space, pre-tonemap)
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        if (uFilter == 1) col = mix(vec3(lum), col, 1.45);
        else if (uFilter == 2) col *= vec3(1.12, 1.0, 0.82);
        else if (uFilter == 3) col *= vec3(0.85, 0.98, 1.15);
        else if (uFilter == 4) col = vec3(lum);
        else if (uFilter == 5) col = vec3(lum) * vec3(1.15, 0.98, 0.72) + 0.02;
        else if (uFilter == 6) col = vec3(smoothstep(0.05, 0.9, lum)) * 1.2;
        else if (uFilter == 7) { col = mix(col * vec3(0.8, 1.0, 1.1), col * vec3(1.2, 0.95, 0.75), smoothstep(0.1, 0.6, lum)); }
        else if (uFilter == 8) col = mix(col, vec3(1.0, 0.85, 0.95) * lum * 1.4, 0.35) + 0.03;
        col *= 1.0 - vig * smoothstep(0.35, 0.85, r);
        col = mix(col, vec3(1.0), flash);
        col = mix(col, vec3(1.0, 0.1, 0.05), damageFlash * smoothstep(0.3, 0.8, r) * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false; this.qScene = new THREE.Scene(); this.qScene.add(this.quad); this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._v = new THREE.Vector3();
  }
  setSize() { const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.rt.setSize(sz.x, sz.y); this.U.aspect.value = sz.x / Math.max(1, sz.y); }
  render(scene, camera, sunDir, opts = {}) {
    const R = this.renderer;
    if (!this.enabled) { R.setRenderTarget(null); R.render(scene, camera); return; }
    const v = this._v.copy(sunDir).multiplyScalar(5000).add(camera.position).project(camera);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = fwd.dot(sunDir);
    this.U.sunPos.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    this.U.sunVis.value = (opts.rays ?? 1) * clamp(facing * 2, 0, 1) * clamp(sunDir.y * 6 + 0.3, 0, 1) * (1 - clamp(Math.max(Math.abs(v.x), Math.abs(v.y)) - 1, 0, 1)) * (opts.sunK ?? 1);
    this.U.blur.value = opts.blur || 0; this.U.ca.value = opts.ca || 0; this.U.vig.value = opts.vig ?? 0.35; this.U.flash.value = opts.flash || 0; this.U.uFilter.value = opts.filter || 0;
    this.U.speedLines.value = opts.speedLines || 0; this.U.time.value = performance.now() / 1000; this.U.rays.value = opts.raysOn === false ? 0 : 1; this.U.tilt.value = opts.tilt || 0; this.U.tiltPos.value = opts.tiltPos ?? 0.5;
    this.U.damageFlash.value = opts.damageFlash || 0; this.U.brightness.value = opts.brightness ?? 1;
    R.setRenderTarget(this.rt); R.render(scene, camera); R.setRenderTarget(null); R.render(this.qScene, this.qCam);
  }
}
