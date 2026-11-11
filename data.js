// =====================================================================
// FORZA HORIZON 6 — unofficial fan tribute
// data.js : math utils, noise, car roster, upgrades, tuning, PI, content
// =====================================================================

// ---------- math utils ----------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const sign = (v) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;
export const KMH = 3.6;
export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash2(x, z) { let h = (x * 374761393 + z * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function fmtTime(t) { if (!isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`; }
export function fmtCR(n) { return 'CR ' + Math.round(n).toLocaleString('en-US'); }

// ---------- simplex noise 2D (seeded) ----------
export class Noise {
  constructor(seed = 1337) {
    const r = mulberry32(seed); const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512); for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  n2(xin, yin) {
    const F2 = 0.366025403784, G2 = 0.211324865405, perm = this.perm;
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255; let n = 0;
    const g = (h, x, y) => { h &= 7; const u = h < 4 ? x : y, v = h < 4 ? y : x; return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v); };
    let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { t0 *= t0; n += t0 * t0 * g(perm[ii + perm[jj]], x0, y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { t1 *= t1; n += t1 * t1 * g(perm[ii + i1 + perm[jj + j1]], x1, y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { t2 *= t2; n += t2 * t2 * g(perm[ii + 1 + perm[jj + 1]], x2, y2); }
    return 40 * n; // ~[-1,1]
  }
  fbm(x, y, oct = 4, lac = 2, gain = 0.5) { let a = 1, f = 1, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * this.n2(x * f, y * f); n += a; a *= gain; f *= lac; } return s / n; }
  ridged(x, y, oct = 4) { let a = 1, f = 1, s = 0, n = 0; for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(this.n2(x * f, y * f)); s += a * v * v; n += a; a *= 0.5; f *= 2.03; } return s / n; }
}

// ---------- surfaces ----------
// mu: base friction, roll: rolling resistance coeff, bump: roughness (m), drag: extra drag, deform: soft surface sink
export const SURF = {
  tarmac: { id: 0, mu: 1.0, roll: 0.012, bump: 0.0, drag: 0, name: 'Tarmac' },
  concrete: { id: 1, mu: 0.97, roll: 0.012, bump: 0.003, drag: 0, name: 'Concrete' },
  dirt: { id: 2, mu: 0.72, roll: 0.03, bump: 0.03, drag: 0.15, name: 'Dirt' },
  gravel: { id: 3, mu: 0.66, roll: 0.035, bump: 0.045, drag: 0.2, name: 'Gravel' },
  grass: { id: 4, mu: 0.62, roll: 0.04, bump: 0.025, drag: 0.25, name: 'Grass' },
  sand: { id: 5, mu: 0.55, roll: 0.09, bump: 0.02, drag: 0.6, name: 'Sand' },
  snow: { id: 6, mu: 0.45, roll: 0.05, bump: 0.02, drag: 0.35, name: 'Snow' },
  salt: { id: 7, mu: 0.9, roll: 0.015, bump: 0.002, drag: 0, name: 'Salt' },
  mud: { id: 8, mu: 0.5, roll: 0.08, bump: 0.04, drag: 0.7, name: 'Mud' },
  rock: { id: 9, mu: 0.8, roll: 0.02, bump: 0.06, drag: 0.1, name: 'Rock' },
  water: { id: 10, mu: 0.35, roll: 0.1, bump: 0.01, drag: 2.0, name: 'Water' },
};
export const SURF_BY_ID = Object.values(SURF);
// compound effectiveness vs surface families [paved, loose, snow]
export const COMPOUNDS = {
  stock: { name: 'Stock', mu: 0.95, paved: 1.0, loose: 0.85, snow: 0.75, wearRate: 0.6, optT: 70 },
  street: { name: 'Street', mu: 1.0, paved: 1.0, loose: 0.85, snow: 0.75, wearRate: 0.7, optT: 75 },
  sport: { name: 'Sport', mu: 1.08, paved: 1.0, loose: 0.8, snow: 0.7, wearRate: 0.9, optT: 85 },
  semislick: { name: 'Semi-Slick', mu: 1.17, paved: 1.0, loose: 0.72, snow: 0.6, wearRate: 1.15, optT: 90 },
  slick: { name: 'Race Slick', mu: 1.27, paved: 1.0, loose: 0.62, snow: 0.5, wearRate: 1.4, optT: 95 },
  rally: { name: 'Rally', mu: 1.0, paved: 0.92, loose: 1.12, snow: 0.95, wearRate: 0.8, optT: 70 },
  offroad: { name: 'Off-Road', mu: 0.95, paved: 0.86, loose: 1.22, snow: 1.0, wearRate: 0.6, optT: 65 },
  snowtire: { name: 'Snow', mu: 0.95, paved: 0.88, loose: 1.05, snow: 1.4, wearRate: 0.7, optT: 55 },
  drift: { name: 'Drift', mu: 0.98, paved: 1.0, loose: 0.8, snow: 0.7, wearRate: 1.8, optT: 80 },
  vintage: { name: 'Vintage', mu: 0.86, paved: 1.0, loose: 0.85, snow: 0.7, wearRate: 0.5, optT: 60 },
  bike: { name: 'Moto', mu: 1.1, paved: 1.0, loose: 0.7, snow: 0.55, wearRate: 1.0, optT: 85 },
};
export function surfaceFamily(s) { return (s === SURF.tarmac || s === SURF.concrete || s === SURF.salt) ? 'paved' : (s === SURF.snow ? 'snow' : 'loose'); }

// ---------- engine layouts & firing angles (crank degrees over 720° cycle, plus pulse amplitude) ----------
export const ENGINES = {
  I3: { cyl: 3, fire: [[0, 1], [240, 1], [480, 1]], label: 'Inline-3' },
  I4: { cyl: 4, fire: [[0, 1], [180, 0.97], [360, 1], [540, 0.97]], label: 'Inline-4' },
  I5: { cyl: 5, fire: [[0, 1], [144, 0.95], [288, 1], [432, 0.93], [576, 1]], label: 'Inline-5' },
  I6: { cyl: 6, fire: [[0, 1], [120, 1], [240, 1], [360, 1], [480, 1], [600, 1]], label: 'Inline-6' },
  B4: { cyl: 4, fire: [[0, 1], [192, 0.8], [360, 1.1], [528, 0.85]], label: 'Flat-4 (unequal)' },
  B6: { cyl: 6, fire: [[0, 1], [122, 0.92], [240, 1], [362, 0.9], [480, 1], [601, 0.94]], label: 'Flat-6' },
  V6: { cyl: 6, fire: [[0, 1], [120, 0.9], [240, 1], [360, 0.9], [480, 1], [600, 0.9]], label: 'V6' },
  V8: { cyl: 8, fire: [[0, 1.15], [90, 0.75], [180, 1.15], [270, 1.15], [360, 0.75], [450, 1.15], [540, 0.75], [630, 0.75]], label: 'V8 Cross-plane' },
  V8F: { cyl: 8, fire: [[0, 1], [90, 0.9], [180, 1], [270, 0.9], [360, 1], [450, 0.9], [540, 1], [630, 0.9]], label: 'V8 Flat-plane' },
  V10: { cyl: 10, fire: [[0, 1], [72, 0.92], [144, 1], [216, 0.92], [288, 1], [360, 0.92], [432, 1], [504, 0.92], [576, 1], [648, 0.92]], label: 'V10' },
  V12: { cyl: 12, fire: Array.from({ length: 12 }, (_, i) => [i * 60, i % 2 ? 0.95 : 1]), label: 'V12' },
  W16: { cyl: 16, fire: Array.from({ length: 16 }, (_, i) => [i * 45, i % 4 === 0 ? 1.05 : 0.95]), label: 'W16' },
  R2: { cyl: 2, fire: [[0, 1], [180, 1], [360, 1], [540, 1]], label: 'Twin Rotor' },
  V2: { cyl: 2, fire: [[0, 1.2], [315, 1.0]], label: 'V-Twin' },
  I1: { cyl: 1, fire: [[0, 1]], label: 'Single' },
  I4B: { cyl: 4, fire: [[0, 1], [180, 1], [360, 1], [540, 1]], label: 'Inline-4 (moto)' },
  EV: { cyl: 0, fire: [], label: 'Electric' },
  D6: { cyl: 6, fire: [[0, 1.2], [120, 1.1], [240, 1.2], [360, 1.1], [480, 1.2], [600, 1.1]], label: 'Diesel I6' },
};

// ---------- fictional manufacturers ----------
export const MAKES = {
  Aurex: { c: 'IT', col: '#c8102e' }, Brannock: { c: 'UK', col: '#0a5c36' }, Calvera: { c: 'IT', col: '#f2b705' },
  Dunmore: { c: 'US', col: '#1d3f8f' }, Eisenwerk: { c: 'DE', col: '#9aa3ad' }, Fujikawa: { c: 'JP', col: '#e5e5e5' },
  Garrison: { c: 'US', col: '#3b3b3b' }, Hartwell: { c: 'UK', col: '#7a1f2b' }, Ishikari: { c: 'JP', col: '#2a6fdb' },
  Kestrel: { c: 'SE', col: '#5bc0eb' }, Montclair: { c: 'FR', col: '#264653' }, Novara: { c: 'IT', col: '#e76f51' },
  Orsini: { c: 'IT', col: '#111111' }, Quillon: { c: 'FR', col: '#8338ec' }, Ravenna: { c: 'IT', col: '#ff006e' },
  Sakura: { c: 'JP', col: '#ffafcc' }, Taurine: { c: 'MX', col: '#e63946' }, Ulster: { c: 'UK', col: '#2b9348' },
  Valkyr: { c: 'NO', col: '#495057' }, Westbrook: { c: 'US', col: '#b5838d' }, Xenon: { c: 'US', col: '#00f5d4' },
  Yamaro: { c: 'JP', col: '#ffbe0b' }, Zephyr: { c: 'DE', col: '#4361ee' }, Halvorsen: { c: 'DK', col: '#adb5bd' },
  Pemberton: { c: 'AU', col: '#fb8500' }, Rosado: { c: 'ES', col: '#d00000' }, Takumi: { c: 'JP', col: '#ffffff' },
};

// ---------- base roster ----------
// [model, make, year, cat, body, hp, nm, kg, wf%, drive, eng, asp, gears, len, wid, hgt, wb, price, sig]
// cat: HYPER SUPER SPORT GT MUSCLE CLASSIC HATCH RALLY RAID OFFROAD TRUCK DRIFT EV BIKE RETRO
// asp: NA T TT S (supercharged) EV  ; sig: handling signature keyword(s)
const B = [
  ['Tempesta V12', 'Aurex', 2025, 'HYPER', 'hyper', 1015, 800, 1550, 42, 'AWD', 'V12', 'NA', 8, 4.75, 2.07, 1.13, 2.70, 2800000, 'planted'],
  ['Fulmine', 'Aurex', 2023, 'SUPER', 'super', 830, 720, 1480, 41, 'RWD', 'V12', 'NA', 7, 4.70, 2.05, 1.15, 2.65, 520000, 'tail'],
  ['Strada 8', 'Aurex', 2021, 'SUPER', 'super', 710, 770, 1430, 41, 'RWD', 'V8F', 'TT', 8, 4.61, 1.98, 1.19, 2.65, 280000, 'nimble'],
  ['Classico 250', 'Aurex', 1962, 'CLASSIC', 'classic', 300, 294, 1050, 49, 'RWD', 'V12', 'NA', 5, 4.33, 1.60, 1.21, 2.40, 1800000, 'vintage'],
  ['Pista 488', 'Aurex', 2019, 'SUPER', 'super', 710, 770, 1385, 41, 'RWD', 'V8F', 'TT', 7, 4.61, 1.98, 1.20, 2.65, 350000, 'grip'],
  ['Vento GT', 'Brannock', 2024, 'GT', 'gt', 650, 800, 1720, 51, 'RWD', 'V12', 'TT', 8, 4.75, 1.96, 1.29, 2.80, 260000, 'heavy'],
  ['Corsa DB', 'Brannock', 1965, 'CLASSIC', 'classic', 282, 390, 1470, 52, 'RWD', 'I6', 'NA', 5, 4.60, 1.68, 1.34, 2.49, 900000, 'vintage'],
  ['Valor', 'Brannock', 2022, 'HYPER', 'hyper', 1160, 900, 1100, 43, 'RWD', 'V12', 'NA', 7, 4.36, 1.96, 1.07, 2.70, 3200000, 'tail'],
  ['Vendetta Cup', 'Brannock', 2020, 'SPORT', 'sport', 503, 685, 1500, 50, 'RWD', 'V8', 'TT', 8, 4.47, 1.94, 1.27, 2.70, 160000, 'balanced'],
  ['Spettro', 'Calvera', 2024, 'HYPER', 'hyper', 1001, 950, 1520, 43, 'AWD', 'V12', 'NA', 7, 4.98, 2.10, 1.10, 2.75, 3500000, 'planted'],
  ['Toro 640', 'Calvera', 2018, 'SUPER', 'super', 640, 600, 1520, 43, 'AWD', 'V10', 'NA', 7, 4.52, 1.93, 1.17, 2.62, 330000, 'planted'],
  ['Miura Tribute', 'Calvera', 1971, 'CLASSIC', 'classic', 370, 400, 1180, 44, 'RWD', 'V12', 'NA', 5, 4.36, 1.76, 1.08, 2.50, 2100000, 'tail'],
  ['Sterrato', 'Calvera', 2023, 'SUPER', 'super', 602, 560, 1550, 43, 'AWD', 'V10', 'NA', 7, 4.53, 2.00, 1.25, 2.62, 290000, 'rallyx'],
  ['Mustang-Type GT', 'Dunmore', 2024, 'MUSCLE', 'muscle', 480, 567, 1750, 54, 'RWD', 'V8', 'NA', 6, 4.81, 1.92, 1.40, 2.72, 55000, 'tail'],
  ['Boss 69', 'Dunmore', 1969, 'MUSCLE', 'muscle_classic', 375, 610, 1610, 57, 'RWD', 'V8', 'NA', 4, 4.76, 1.82, 1.29, 2.74, 120000, 'muscle'],
  ['Shelbourne 500', 'Dunmore', 2020, 'MUSCLE', 'muscle', 760, 847, 1880, 56, 'RWD', 'V8F', 'S', 7, 4.82, 1.94, 1.38, 2.72, 85000, 'tail'],
  ['Ranger Raptor', 'Dunmore', 2023, 'TRUCK', 'truck', 450, 691, 2600, 56, 'AWD', 'V6', 'TT', 10, 5.89, 2.18, 1.99, 3.68, 75000, 'float'],
  ['GT-40 Tribute', 'Dunmore', 1966, 'CLASSIC', 'racer_classic', 485, 640, 1000, 42, 'RWD', 'V8', 'NA', 4, 4.18, 1.78, 1.03, 2.42, 4000000, 'grip'],
  ['Bronco Trail', 'Dunmore', 2022, 'OFFROAD', 'suv', 330, 563, 2300, 55, 'AWD', 'V6', 'TT', 10, 4.81, 1.93, 1.85, 2.95, 52000, 'float'],
  ['Kraft 911 Turbo', 'Eisenwerk', 2021, 'SPORT', 'sport_rear', 640, 800, 1640, 38, 'AWD', 'B6', 'TT', 8, 4.54, 1.90, 1.30, 2.45, 210000, 'rear'],
  ['Kraft 911 RS', 'Eisenwerk', 2023, 'SPORT', 'sport_rear', 518, 465, 1450, 39, 'RWD', 'B6', 'NA', 7, 4.57, 1.90, 1.32, 2.45, 230000, 'rear'],
  ['Kraft 73 Carrera', 'Eisenwerk', 1973, 'CLASSIC', 'classic_rear', 210, 255, 975, 38, 'RWD', 'B6', 'NA', 5, 4.15, 1.65, 1.32, 2.27, 600000, 'rear'],
  ['Spyder 918', 'Eisenwerk', 2015, 'HYPER', 'hyper', 887, 1280, 1675, 43, 'AWD', 'V8F', 'NA', 7, 4.64, 1.94, 1.17, 2.73, 1500000, 'planted'],
  ['Taycan-ish Volt', 'Eisenwerk', 2024, 'EV', 'ev_sedan', 750, 1050, 2300, 49, 'AWD', 'EV', 'EV', 2, 4.96, 1.97, 1.38, 2.90, 190000, 'heavy'],
  ['Rallye 2.0', 'Eisenwerk', 1988, 'RETRO', 'boxy', 200, 240, 1200, 51, 'AWD', 'I4', 'T', 5, 4.33, 1.68, 1.37, 2.56, 90000, 'rallyx'],
  ['Supra-Type RZ', 'Fujikawa', 1998, 'RETRO', 'sport', 320, 441, 1510, 53, 'RWD', 'I6', 'TT', 6, 4.52, 1.81, 1.27, 2.55, 110000, 'tuner'],
  ['GR Ronin', 'Fujikawa', 2024, 'SPORT', 'sport', 382, 500, 1540, 52, 'RWD', 'I6', 'T', 8, 4.38, 1.85, 1.29, 2.47, 60000, 'balanced'],
  ['Hachi AE', 'Fujikawa', 1986, 'DRIFT', 'boxy', 130, 149, 950, 53, 'RWD', 'I4', 'NA', 5, 4.20, 1.63, 1.34, 2.40, 30000, 'drift'],
  ['Land Titan 70', 'Fujikawa', 1990, 'OFFROAD', 'suv_classic', 160, 360, 2100, 55, 'AWD', 'D6', 'T', 5, 4.60, 1.79, 1.90, 2.73, 45000, 'float'],
  ['GR Corolla Rally', 'Fujikawa', 2023, 'HATCH', 'hatch', 300, 370, 1475, 61, 'AWD', 'I3', 'T', 6, 4.41, 1.85, 1.48, 2.64, 42000, 'rallyx'],
  ['Desert Hilux', 'Fujikawa', 2022, 'RAID', 'raid', 400, 620, 2000, 52, 'AWD', 'V6', 'TT', 6, 4.70, 2.30, 1.95, 2.90, 400000, 'raid'],
  ['Stampede', 'Garrison', 2023, 'MUSCLE', 'muscle', 807, 959, 1970, 55, 'RWD', 'V8', 'S', 8, 5.01, 1.95, 1.46, 2.95, 95000, 'tail'],
  ['Charger 70', 'Garrison', 1970, 'MUSCLE', 'muscle_classic', 425, 664, 1700, 57, 'RWD', 'V8', 'NA', 4, 5.28, 1.95, 1.35, 2.97, 150000, 'muscle'],
  ['Viper ACR-ish', 'Garrison', 2017, 'SUPER', 'super_front', 645, 813, 1550, 49, 'RWD', 'V10', 'NA', 6, 4.47, 1.96, 1.24, 2.51, 180000, 'grip'],
  ['Ram Rebel TRX', 'Garrison', 2022, 'TRUCK', 'truck', 702, 881, 2900, 57, 'AWD', 'V8', 'S', 8, 5.92, 2.23, 2.06, 3.67, 90000, 'float'],
  ['Demon Drag', 'Garrison', 2018, 'MUSCLE', 'muscle', 840, 1044, 1930, 56, 'RWD', 'V8', 'S', 8, 5.02, 1.95, 1.45, 2.95, 140000, 'drag'],
  ['Cobra Roadster', 'Hartwell', 1965, 'CLASSIC', 'roadster_classic', 425, 650, 1150, 48, 'RWD', 'V8', 'NA', 4, 3.96, 1.73, 1.23, 2.29, 1100000, 'muscle'],
  ['E-Type Speedster', 'Hartwell', 1961, 'CLASSIC', 'classic', 265, 350, 1230, 50, 'RWD', 'I6', 'NA', 4, 4.45, 1.66, 1.22, 2.44, 300000, 'vintage'],
  ['F-Pace SVR-ish', 'Hartwell', 2021, 'SPORT', 'suv', 550, 700, 2100, 52, 'AWD', 'V8', 'S', 8, 4.75, 2.07, 1.67, 2.87, 90000, 'heavy'],
  ['Project Eight', 'Hartwell', 2019, 'SPORT', 'sedan', 592, 700, 1745, 54, 'AWD', 'V8', 'S', 8, 4.80, 1.93, 1.40, 2.84, 190000, 'grip'],
  ['GT-R Nismo-ish', 'Ishikari', 2024, 'SUPER', 'sport', 600, 652, 1720, 54, 'AWD', 'V6', 'TT', 6, 4.69, 1.90, 1.37, 2.78, 210000, 'planted'],
  ['Skyline R34-ish', 'Ishikari', 2002, 'RETRO', 'sport', 330, 392, 1560, 55, 'AWD', 'I6', 'TT', 6, 4.60, 1.79, 1.36, 2.67, 250000, 'tuner'],
  ['Silvi S15', 'Ishikari', 2001, 'DRIFT', 'sport', 250, 275, 1240, 55, 'RWD', 'I4', 'T', 6, 4.45, 1.70, 1.29, 2.53, 45000, 'drift'],
  ['Fairlady 240', 'Ishikari', 1971, 'CLASSIC', 'classic', 151, 198, 1070, 52, 'RWD', 'I6', 'NA', 4, 4.14, 1.63, 1.29, 2.31, 50000, 'vintage'],
  ['Patrol Desert', 'Ishikari', 2020, 'OFFROAD', 'suv', 400, 560, 2700, 54, 'AWD', 'V8', 'NA', 7, 5.17, 1.99, 1.94, 3.07, 70000, 'float'],
  ['Leaf-ish Sprint', 'Ishikari', 2023, 'EV', 'hatch', 214, 340, 1700, 58, 'FWD', 'EV', 'EV', 1, 4.48, 1.79, 1.54, 2.70, 30000, 'push'],
  ['Regera Hyper', 'Kestrel', 2020, 'HYPER', 'hyper', 1500, 2000, 1590, 44, 'RWD', 'V8F', 'TT', 1, 4.56, 2.05, 1.11, 2.66, 3000000, 'rocket'],
  ['Jesko Absolut', 'Kestrel', 2022, 'HYPER', 'hyper', 1600, 1500, 1390, 44, 'RWD', 'V8F', 'TT', 9, 4.61, 2.03, 1.21, 2.70, 3500000, 'rocket'],
  ['CCX Classic', 'Kestrel', 2006, 'SUPER', 'super', 806, 920, 1280, 44, 'RWD', 'V8F', 'S', 6, 4.29, 2.00, 1.12, 2.66, 900000, 'tail'],
  ['Alpine A110-ish', 'Montclair', 2023, 'SPORT', 'sport', 300, 340, 1110, 44, 'RWD', 'I4', 'T', 7, 4.18, 1.80, 1.25, 2.42, 70000, 'nimble'],
  ['Clio Cup', 'Montclair', 2021, 'HATCH', 'hatch', 220, 280, 1150, 62, 'FWD', 'I4', 'T', 6, 4.05, 1.73, 1.43, 2.58, 35000, 'push'],
  ['5 Turbo Retro', 'Montclair', 1982, 'RETRO', 'hatch_boxy', 160, 221, 970, 40, 'RWD', 'I4', 'T', 5, 3.66, 1.75, 1.32, 2.43, 120000, 'rear'],
  ['Megane RS Trophy', 'Montclair', 2020, 'HATCH', 'hatch', 300, 420, 1420, 61, 'FWD', 'I4', 'T', 6, 4.37, 1.87, 1.43, 2.67, 45000, 'push'],
  ['Stratos Revival', 'Novara', 1974, 'RALLY', 'wedge_classic', 280, 280, 980, 42, 'RWD', 'V6', 'NA', 5, 3.71, 1.75, 1.11, 2.18, 700000, 'rallyx'],
  ['Integrale Evo', 'Novara', 1992, 'RALLY', 'boxy', 215, 314, 1340, 59, 'AWD', 'I4', 'T', 5, 3.90, 1.77, 1.37, 2.48, 150000, 'rallyx'],
  ['Stelvio Q', 'Novara', 2022, 'SPORT', 'suv', 505, 600, 1830, 50, 'AWD', 'V6', 'TT', 8, 4.70, 1.95, 1.68, 2.82, 85000, 'balanced'],
  ['Giulia Cup', 'Novara', 2023, 'SPORT', 'sedan', 533, 600, 1580, 50, 'RWD', 'V6', 'TT', 8, 4.64, 1.87, 1.43, 2.82, 90000, 'balanced'],
  ['Countach Echo', 'Orsini', 1988, 'SUPER', 'wedge_classic', 455, 500, 1490, 42, 'RWD', 'V12', 'NA', 5, 4.14, 2.00, 1.07, 2.50, 650000, 'tail'],
  ['Nero Huracan', 'Orsini', 2023, 'SUPER', 'super', 631, 565, 1340, 41, 'RWD', 'V10', 'NA', 7, 4.55, 1.93, 1.17, 2.62, 330000, 'tail'],
  ['Sesto Elemento', 'Orsini', 2011, 'HYPER', 'hyper', 562, 540, 999, 43, 'AWD', 'V10', 'NA', 6, 4.40, 2.04, 1.11, 2.62, 2200000, 'nimble'],
  ['Ultimo EV', 'Quillon', 2025, 'EV', 'hyper', 1900, 2340, 2000, 46, 'AWD', 'EV', 'EV', 1, 4.83, 2.04, 1.12, 2.80, 2400000, 'rocket'],
  ['Hatch 205 T16', 'Quillon', 1985, 'RALLY', 'hatch_boxy', 450, 490, 910, 45, 'AWD', 'I4', 'T', 5, 3.82, 1.67, 1.35, 2.54, 800000, 'rallyx'],
  ['DS Racer', 'Quillon', 2019, 'HATCH', 'hatch', 270, 330, 1200, 60, 'FWD', 'I4', 'T', 6, 4.16, 1.74, 1.46, 2.54, 32000, 'push'],
  ['Ravenna 33 Stradale', 'Ravenna', 1968, 'CLASSIC', 'racer_classic', 230, 206, 700, 45, 'RWD', 'V8F', 'NA', 6, 3.97, 1.71, 0.99, 2.35, 2600000, 'nimble'],
  ['Zonda Cinque', 'Ravenna', 2010, 'HYPER', 'hyper', 678, 780, 1210, 44, 'RWD', 'V12', 'NA', 6, 4.40, 2.06, 1.14, 2.73, 2800000, 'tail'],
  ['Huayra R', 'Ravenna', 2021, 'HYPER', 'hyper', 838, 750, 1050, 44, 'RWD', 'V12', 'NA', 6, 4.84, 2.06, 1.20, 2.80, 3100000, 'grip'],
  ['RX Spirit', 'Sakura', 2002, 'DRIFT', 'sport', 276, 314, 1280, 50, 'RWD', 'R2', 'TT', 5, 4.29, 1.76, 1.23, 2.43, 70000, 'drift'],
  ['Roadster MX', 'Sakura', 2023, 'SPORT', 'roadster', 181, 205, 1060, 50, 'RWD', 'I4', 'NA', 6, 3.92, 1.74, 1.23, 2.31, 32000, 'nimble'],
  ['787 Legend', 'Sakura', 1991, 'GT', 'proto', 700, 608, 845, 45, 'RWD', 'R2', 'NA', 5, 4.78, 1.99, 1.00, 2.66, 3500000, 'aero'],
  ['Cosmo Classic', 'Sakura', 1967, 'CLASSIC', 'classic', 128, 140, 940, 49, 'RWD', 'R2', 'NA', 4, 4.14, 1.59, 1.17, 2.20, 140000, 'vintage'],
  ['Escarabajo Baja', 'Taurine', 1970, 'OFFROAD', 'buggy', 180, 220, 750, 38, 'RWD', 'B4', 'NA', 4, 3.70, 1.80, 1.45, 2.40, 30000, 'buggy'],
  ['Trophy Truck X', 'Taurine', 2021, 'RAID', 'trophy', 900, 900, 2700, 50, 'RWD', 'V8', 'NA', 4, 5.80, 2.40, 2.10, 3.40, 450000, 'raid'],
  ['Baja Bandito', 'Taurine', 2024, 'RAID', 'buggy', 520, 620, 1500, 45, 'AWD', 'V8', 'NA', 4, 4.40, 2.20, 1.60, 2.95, 180000, 'buggy'],
  ['Mini Works', 'Ulster', 2023, 'HATCH', 'hatch', 228, 320, 1250, 62, 'FWD', 'I4', 'T', 6, 3.87, 1.73, 1.41, 2.50, 34000, 'nimble'],
  ['Mini 65 Cooper', 'Ulster', 1965, 'CLASSIC', 'mini_classic', 76, 108, 640, 63, 'FWD', 'I4', 'NA', 4, 3.05, 1.41, 1.35, 2.04, 40000, 'nimble'],
  ['Defender Works', 'Ulster', 2023, 'OFFROAD', 'suv_boxy', 518, 625, 2480, 51, 'AWD', 'V8', 'S', 8, 5.02, 2.00, 1.97, 3.02, 120000, 'float'],
  ['Lotus-ish Exige', 'Ulster', 2020, 'SPORT', 'roadster', 430, 440, 1110, 38, 'RWD', 'V6', 'S', 6, 4.08, 1.80, 1.13, 2.37, 100000, 'nimble'],
  ['Ragnarok', 'Valkyr', 2025, 'HYPER', 'hyper', 1360, 1200, 1300, 44, 'AWD', 'V8F', 'TT', 7, 4.60, 2.00, 1.10, 2.70, 2600000, 'aero'],
  ['Fenrir Drift', 'Valkyr', 2022, 'DRIFT', 'sport', 900, 1000, 1350, 51, 'RWD', 'V8', 'TT', 6, 4.50, 1.95, 1.25, 2.60, 120000, 'drift'],
  ['Corvette C8-ish', 'Westbrook', 2024, 'SUPER', 'super', 670, 637, 1660, 40, 'RWD', 'V8F', 'NA', 8, 4.63, 2.03, 1.23, 2.72, 120000, 'grip'],
  ['Stingray 63', 'Westbrook', 1963, 'CLASSIC', 'classic', 360, 475, 1380, 49, 'RWD', 'V8', 'NA', 4, 4.45, 1.77, 1.26, 2.49, 200000, 'muscle'],
  ['Nova SS 72', 'Westbrook', 1972, 'MUSCLE', 'muscle_classic', 300, 480, 1550, 56, 'RWD', 'V8', 'NA', 4, 4.80, 1.85, 1.35, 2.82, 45000, 'muscle'],
  ['Camaro ZL-ish', 'Westbrook', 2022, 'MUSCLE', 'muscle', 650, 881, 1800, 54, 'RWD', 'V8', 'S', 10, 4.83, 1.90, 1.34, 2.81, 75000, 'grip'],
  ['Silverado Prerunner', 'Westbrook', 2024, 'TRUCK', 'truck', 420, 624, 2550, 57, 'AWD', 'V8', 'NA', 10, 5.88, 2.06, 1.99, 3.65, 70000, 'float'],
  ['Hummer Volt', 'Westbrook', 2024, 'EV', 'truck', 1000, 1590, 4100, 52, 'AWD', 'EV', 'EV', 1, 5.51, 2.20, 2.03, 3.44, 110000, 'heavy'],
  ['Plaid Sedan', 'Xenon', 2024, 'EV', 'ev_sedan', 1020, 1420, 2160, 48, 'AWD', 'EV', 'EV', 1, 4.97, 1.96, 1.44, 2.96, 110000, 'rocket'],
  ['Roadster Volt', 'Xenon', 2025, 'EV', 'roadster', 1200, 1800, 1800, 46, 'AWD', 'EV', 'EV', 1, 4.25, 1.95, 1.20, 2.55, 250000, 'rocket'],
  ['Cyber Wedge', 'Xenon', 2024, 'EV', 'wedge_truck', 845, 1300, 3100, 50, 'AWD', 'EV', 'EV', 1, 5.68, 2.20, 1.79, 3.60, 100000, 'heavy'],
  ['RideOne Volt', 'Xenon', 2023, 'EV', 'hatch', 450, 650, 1800, 48, 'AWD', 'EV', 'EV', 1, 4.40, 1.85, 1.50, 2.75, 50000, 'balanced'],
  ['R1 Superbike', 'Yamaro', 2023, 'BIKE', 'bike', 200, 113, 200, 52, 'RWD', 'I4B', 'NA', 6, 2.06, 0.69, 1.15, 1.40, 30000, 'bike'],
  ['V-Max Cruiser', 'Yamaro', 2020, 'BIKE', 'bike', 200, 167, 310, 50, 'RWD', 'V2', 'NA', 5, 2.40, 0.82, 1.19, 1.70, 25000, 'bike'],
  ['Dirt 450', 'Yamaro', 2024, 'BIKE', 'bike_dirt', 60, 50, 110, 48, 'RWD', 'I1', 'NA', 5, 2.18, 0.83, 1.27, 1.48, 12000, 'bikedirt'],
  ['Ninja H2-ish', 'Yamaro', 2022, 'BIKE', 'bike', 228, 141, 238, 52, 'RWD', 'I4B', 'S', 6, 2.08, 0.77, 1.13, 1.45, 55000, 'bike'],
  ['Banshee Quad', 'Yamaro', 2006, 'OFFROAD', 'buggy', 70, 60, 180, 45, 'RWD', 'V2', 'NA', 6, 1.80, 1.15, 1.10, 1.25, 15000, 'buggy'],
  ['M5 Competition', 'Zephyr', 2024, 'SPORT', 'sedan', 617, 750, 1940, 52, 'AWD', 'V8', 'TT', 8, 4.98, 1.90, 1.47, 2.98, 120000, 'heavy'],
  ['M3 E30 Evo', 'Zephyr', 1990, 'RETRO', 'boxy', 235, 240, 1200, 51, 'RWD', 'I4', 'NA', 5, 4.35, 1.68, 1.37, 2.56, 110000, 'balanced'],
  ['M4 GT-Track', 'Zephyr', 2023, 'SPORT', 'sport', 543, 650, 1625, 51, 'RWD', 'I6', 'TT', 8, 4.80, 1.88, 1.39, 2.86, 110000, 'tail'],
  ['2002 Turbo', 'Zephyr', 1973, 'CLASSIC', 'boxy', 170, 240, 1080, 52, 'RWD', 'I4', 'T', 4, 4.22, 1.62, 1.41, 2.50, 80000, 'vintage'],
  ['i-Volt Coupe', 'Zephyr', 2024, 'EV', 'sport', 536, 795, 2200, 48, 'AWD', 'EV', 'EV', 1, 4.78, 1.85, 1.45, 2.86, 80000, 'balanced'],
  ['Quattro S1', 'Halvorsen', 1985, 'RALLY', 'boxy', 470, 590, 1090, 58, 'AWD', 'I5', 'T', 6, 4.16, 1.86, 1.34, 2.22, 900000, 'rallyx'],
  ['RS6 Avant-ish', 'Halvorsen', 2024, 'SPORT', 'wagon', 621, 850, 2075, 57, 'AWD', 'V8', 'TT', 8, 5.00, 1.95, 1.46, 2.93, 130000, 'planted'],
  ['R8 Plus', 'Halvorsen', 2021, 'SUPER', 'super', 611, 560, 1595, 42, 'AWD', 'V10', 'NA', 7, 4.43, 1.94, 1.24, 2.65, 210000, 'planted'],
  ['TT Rally', 'Halvorsen', 2022, 'RALLY', 'hatch', 400, 480, 1300, 58, 'AWD', 'I5', 'T', 6, 4.20, 1.83, 1.37, 2.50, 90000, 'rallyx'],
  ['Falcon XB', 'Pemberton', 1973, 'MUSCLE', 'muscle_classic', 300, 515, 1500, 56, 'RWD', 'V8', 'S', 4, 4.70, 1.88, 1.35, 2.82, 160000, 'muscle'],
  ['Ute Maloo', 'Pemberton', 2017, 'MUSCLE', 'ute', 585, 740, 1890, 55, 'RWD', 'V8', 'S', 6, 5.04, 1.90, 1.48, 2.92, 70000, 'tail'],
  ['Outback Raider', 'Pemberton', 2021, 'RAID', 'raid', 420, 600, 1900, 52, 'AWD', 'V8', 'NA', 6, 4.60, 2.20, 1.90, 2.85, 220000, 'raid'],
  ['Ibiza Cupra', 'Rosado', 2022, 'HATCH', 'hatch', 300, 400, 1350, 61, 'FWD', 'I4', 'T', 7, 4.32, 1.80, 1.45, 2.63, 38000, 'push'],
  ['Barcelona GT', 'Rosado', 2024, 'GT', 'gt', 720, 700, 1290, 46, 'RWD', 'V8F', 'TT', 7, 4.65, 2.04, 1.15, 2.70, 380000, 'aero'],
  ['Civic Type-ish R', 'Takumi', 2024, 'HATCH', 'hatch', 315, 420, 1430, 62, 'FWD', 'I4', 'T', 6, 4.59, 1.89, 1.40, 2.73, 45000, 'grip'],
  ['NSX Classic', 'Takumi', 1992, 'RETRO', 'super', 270, 285, 1365, 42, 'RWD', 'V6', 'NA', 5, 4.40, 1.81, 1.17, 2.53, 140000, 'nimble'],
  ['S2000 Club', 'Takumi', 2008, 'SPORT', 'roadster', 240, 220, 1250, 50, 'RWD', 'I4', 'NA', 6, 4.13, 1.75, 1.27, 2.40, 40000, 'nimble'],
  ['Integra Type-ish', 'Takumi', 2001, 'HATCH', 'hatch', 195, 178, 1100, 63, 'FWD', 'I4', 'NA', 5, 4.38, 1.70, 1.33, 2.57, 35000, 'push'],
  ['Evo IX Tribute', 'Takumi', 2006, 'RALLY', 'sedan', 286, 392, 1400, 59, 'AWD', 'I4', 'T', 5, 4.49, 1.77, 1.45, 2.63, 55000, 'rallyx'],
  ['WRX Blue', 'Kestrel', 2004, 'RALLY', 'sedan', 300, 405, 1470, 58, 'AWD', 'B4', 'T', 6, 4.47, 1.74, 1.43, 2.54, 40000, 'rallyx'],
  ['Unimog Expedition', 'Eisenwerk', 2021, 'TRUCK', 'truck_box', 300, 1200, 7500, 52, 'AWD', 'D6', 'T', 8, 5.40, 2.30, 2.80, 3.25, 250000, 'heavy'],
  ['Gelande 6x6', 'Eisenwerk', 2014, 'TRUCK', 'suv_boxy', 544, 760, 3850, 50, 'AWD', 'V8', 'TT', 7, 5.87, 2.11, 2.21, 3.30, 600000, 'float'],
  ['Sentinel Van', 'Halvorsen', 1972, 'RETRO', 'van', 70, 140, 1150, 45, 'RWD', 'B4', 'NA', 4, 4.50, 1.72, 1.94, 2.40, 40000, 'float'],
  ['Le Mans Prototype', 'Valkyr', 2023, 'GT', 'proto', 680, 650, 1030, 45, 'AWD', 'V6', 'TT', 7, 5.10, 2.00, 1.06, 3.15, 4500000, 'aero'],
  ['Formula Tribute', 'Brannock', 2021, 'GT', 'openwheel', 950, 650, 798, 45, 'RWD', 'V6', 'T', 8, 5.50, 2.00, 0.95, 3.60, 5000000, 'aero'],
  ['Kart Tribute', 'Rosado', 2024, 'SPORT', 'kart', 30, 25, 160, 42, 'RWD', 'I1', 'NA', 1, 1.80, 1.30, 0.70, 1.05, 8000, 'nimble'],
  ['Golf Cart Supreme', 'Halvorsen', 2020, 'RETRO', 'kart', 8, 40, 400, 50, 'RWD', 'EV', 'EV', 1, 2.40, 1.20, 1.80, 1.65, 6000, 'float'],
];

const CAT_INFO = {
  HYPER: { name: 'Hypercars', tire: 'semislick', pRpm: 8200, susp: 1.5, aero: 1.6, cd: 0.33 },
  SUPER: { name: 'Supercars', tire: 'sport', pRpm: 7800, susp: 1.35, aero: 1.1, cd: 0.34 },
  SPORT: { name: 'Sports Cars', tire: 'sport', pRpm: 6800, susp: 1.15, aero: 0.5, cd: 0.33 },
  GT: { name: 'Track Toys', tire: 'slick', pRpm: 8500, susp: 1.8, aero: 3.2, cd: 0.42 },
  MUSCLE: { name: 'Modern Muscle', tire: 'street', pRpm: 6200, susp: 0.95, aero: 0.25, cd: 0.36 },
  CLASSIC: { name: 'Classics', tire: 'vintage', pRpm: 6000, susp: 0.8, aero: 0, cd: 0.42 },
  HATCH: { name: 'Hot Hatch', tire: 'sport', pRpm: 6400, susp: 1.1, aero: 0.25, cd: 0.33 },
  RALLY: { name: 'Rally Monsters', tire: 'rally', pRpm: 6800, susp: 0.9, aero: 0.4, cd: 0.38 },
  RAID: { name: 'Rally Raid', tire: 'offroad', pRpm: 5800, susp: 0.6, aero: 0, cd: 0.48 },
  OFFROAD: { name: 'Off-Road', tire: 'offroad', pRpm: 5200, susp: 0.55, aero: 0, cd: 0.5 },
  TRUCK: { name: 'Pickups & 4x4', tire: 'offroad', pRpm: 5000, susp: 0.6, aero: 0, cd: 0.52 },
  DRIFT: { name: 'Drift Cars', tire: 'drift', pRpm: 7200, susp: 1.2, aero: 0.2, cd: 0.36 },
  EV: { name: 'Electric', tire: 'sport', pRpm: 6000, susp: 1.1, aero: 0.3, cd: 0.25 },
  BIKE: { name: 'Motorcycles', tire: 'bike', pRpm: 12000, susp: 1.0, aero: 0, cd: 0.6 },
  RETRO: { name: 'Retro Icons', tire: 'street', pRpm: 6500, susp: 0.95, aero: 0.2, cd: 0.38 },
};
export { CAT_INFO };

// handling signature modifiers
const SIG = {
  planted: { mu: 1.04, steer: 0.95, yaw: 0.9, diff: 0.35 }, tail: { mu: 0.98, steer: 1.05, yaw: 1.15, diff: 0.55 },
  nimble: { mu: 1.02, steer: 1.12, yaw: 1.15, diff: 0.3 }, grip: { mu: 1.06, steer: 1.0, yaw: 1.0, diff: 0.35 },
  vintage: { mu: 0.94, steer: 0.85, yaw: 0.95, diff: 0.0, soft: 0.75 }, heavy: { mu: 1.0, steer: 0.9, yaw: 0.85, diff: 0.3 },
  balanced: { mu: 1.0, steer: 1.0, yaw: 1.0, diff: 0.35 }, rallyx: { mu: 1.0, steer: 1.1, yaw: 1.1, diff: 0.5, soft: 0.85 },
  muscle: { mu: 0.93, steer: 0.82, yaw: 1.1, diff: 0.0, soft: 0.75 }, float: { mu: 0.97, steer: 0.85, yaw: 0.9, diff: 0.25, soft: 0.6 },
  rear: { mu: 1.0, steer: 1.05, yaw: 1.1, diff: 0.4 }, tuner: { mu: 1.0, steer: 1.0, yaw: 1.05, diff: 0.4 },
  drift: { mu: 0.97, steer: 1.25, yaw: 1.25, diff: 0.85 }, raid: { mu: 1.0, steer: 0.9, yaw: 1.0, diff: 0.4, soft: 0.45 },
  rocket: { mu: 1.02, steer: 0.95, yaw: 0.95, diff: 0.35 }, aero: { mu: 1.05, steer: 1.0, yaw: 1.0, diff: 0.4 },
  push: { mu: 1.0, steer: 0.95, yaw: 0.85, diff: 0.25 }, drag: { mu: 0.98, steer: 0.8, yaw: 0.9, diff: 0.7 },
  buggy: { mu: 1.0, steer: 1.1, yaw: 1.1, diff: 0.5, soft: 0.5 }, bike: { mu: 1.0, steer: 1.0, yaw: 1.0, diff: 0.0 },
  bikedirt: { mu: 1.0, steer: 1.1, yaw: 1.05, diff: 0.0, soft: 0.6 },
};

// Trim generators per category
const TRIMS = {
  default: [['', 1, 1, 1, 0], ['S', 1.12, 0.97, 1.35, 1], ['Track Edition', 1.25, 0.93, 2.1, 2]],
  CLASSIC: [['', 1, 1, 1, 0], ['Lightweight', 1.08, 0.9, 1.5, 1], ['Restomod', 1.6, 1.0, 1.8, 3]],
  MUSCLE: [['', 1, 1, 1, 0], ['Drag Pack', 1.2, 0.97, 1.4, 4], ['Widebody', 1.32, 0.96, 1.9, 2]],
  HATCH: [['', 1, 1, 1, 0], ['Rally Spec', 1.15, 0.97, 1.5, 5], ['Cup', 1.22, 0.92, 1.8, 2]],
  RALLY: [['', 1, 1, 1, 0], ['Group B Evo', 1.3, 0.95, 1.8, 5], ['Tarmac Spec', 1.2, 0.97, 1.6, 2]],
  DRIFT: [['', 1, 1, 1, 0], ['Drift Spec', 1.45, 0.95, 1.6, 6], ['Street Spec', 1.15, 1.0, 1.25, 1]],
  OFFROAD: [['', 1, 1, 1, 0], ['Trail Pro', 1.2, 1.02, 1.4, 5], ['Desert Runner', 1.45, 0.98, 1.9, 7]],
  TRUCK: [['', 1, 1, 1, 0], ['Prerunner', 1.25, 0.97, 1.5, 7]],
  RAID: [['', 1, 1, 1, 0], ['Dakar Spec', 1.15, 0.96, 1.4, 7]],
  EV: [['', 1, 1, 1, 0], ['Performance', 1.18, 1.0, 1.35, 1], ['Track Mode', 1.3, 0.95, 1.9, 2]],
  BIKE: [['', 1, 1, 1, 0], ['Race Replica', 1.12, 0.94, 1.5, 2]],
  HYPER: [['', 1, 1, 1, 0], ['Evo', 1.1, 0.95, 1.3, 2]],
  SUPER: [['', 1, 1, 1, 0], ['Performante', 1.08, 0.95, 1.3, 2], ['Spyder', 1.0, 1.05, 1.15, 0]],
  GT: [['', 1, 1, 1, 0]],
  RETRO: [['', 1, 1, 1, 0], ['Tuner Build', 1.5, 0.95, 1.6, 1], ['Rally Spec', 1.2, 0.97, 1.4, 5]],
  SPORT: [['', 1, 1, 1, 0], ['GTS', 1.12, 0.97, 1.3, 1], ['Track Edition', 1.22, 0.93, 1.8, 2]],
};

function torqueCurveFor(spec) {
  // Build 48-point normalized torque curve (multiplier of peakTorque) from idle to limiter
  const N = 48, out = new Float32Array(N);
  const { idle, limiter, tqRpm, pRpm, asp, eng } = spec;
  for (let i = 0; i < N; i++) {
    const rpm = idle * 0.5 + (limiter * 1.05 - idle * 0.5) * i / (N - 1);
    let t;
    if (asp === 'EV') {
      // constant torque to base speed, then constant power
      t = rpm < tqRpm ? 1 : tqRpm / rpm;
    } else {
      const rise = asp === 'T' || asp === 'TT' ? 0.6 : (asp === 'S' ? 0.75 : 0.55);
      if (rpm < tqRpm) t = rise + (1 - rise) * Math.sin(Math.min(1, (rpm - idle * 0.5) / (tqRpm - idle * 0.5)) * Math.PI / 2);
      else if (rpm < pRpm) { const k = (rpm - tqRpm) / Math.max(1, pRpm - tqRpm); t = lerp(1, spec.tqAtP, k * k * (asp === 'NA' ? 1 : 1.4)); t = Math.min(1, t); }
      else { const k = (rpm - pRpm) / Math.max(1, limiter - pRpm); t = spec.tqAtP * (1 - 0.28 * k * k - 0.04 * k); }
      if (eng === 'D6') t *= rpm > pRpm ? 0.85 : 1;
    }
    out[i] = Math.max(0.05, t);
  }
  return out;
}

function estimateTopSpeed(hp, cdA, mass) {
  const P = hp * 745.7 * 0.88; let v = 30;
  for (let i = 0; i < 40; i++) { const F = 0.5 * 1.225 * cdA * v * v + mass * 9.81 * 0.013; v = Math.cbrt(Math.max(1, (P - mass * 9.81 * 0.013 * v)) / (0.5 * 1.225 * cdA)) * 0.5 + v * 0.5; if (!isFinite(v)) v = 60; void F; }
  return clamp(v, 25, 140);
}

function buildSpec(row, trim, idx) {
  let [model, make, year, cat, body, hp, nm, kg, wf, drive, eng, asp, gears, len, wid, hgt, wb, price, sig] = row;
  const [tname, pMul, mMul, $Mul, tKind] = trim;
  const ci = CAT_INFO[cat]; const sg = SIG[sig] || SIG.balanced;
  hp = Math.round(hp * pMul); nm = Math.round(nm * (1 + (pMul - 1) * 0.85)); kg = Math.round(kg * mMul);
  let tire = ci.tire; let aeroMul = ci.aero; let suspMul = ci.susp * (sg.soft || 1); let yr = year;
  let cats = cat; let bodyK = body;
  if (tKind === 2) { tire = cat === 'CLASSIC' ? 'sport' : (tire === 'slick' ? 'slick' : 'semislick'); aeroMul = aeroMul + 1.2; suspMul *= 1.25; }
  if (tKind === 3) { tire = 'sport'; suspMul *= 1.3; yr = year; }
  if (tKind === 4) { tire = 'street'; }
  if (tKind === 5) { tire = 'rally'; suspMul *= 0.75; }
  if (tKind === 6) { tire = 'drift'; }
  if (tKind === 7) { tire = 'offroad'; suspMul *= 0.8; }
  const isBike = cat === 'BIKE';
  const cyl = ENGINES[eng].cyl;
  let pRpm = ci.pRpm;
  if (eng === 'V12' || eng === 'V10') pRpm += 500; if (eng === 'V8' && asp === 'NA') pRpm -= 400; if (eng === 'R2') pRpm += 1500;
  if (eng === 'D6') pRpm = 3600; if (eng === 'I1' || eng === 'V2') pRpm = isBike ? 9500 : 7500; if (eng === 'I4B') pRpm = 12500;
  if (year < 1980 && !isBike) pRpm = Math.min(pRpm, 5800);
  if (asp === 'EV') pRpm = 15000;
  const limiter = asp === 'EV' ? 16000 : Math.round(pRpm * (eng === 'D6' ? 1.2 : 1.1) / 100) * 100;
  const redline = Math.round(limiter * 0.97);
  const idle = asp === 'EV' ? 0 : (isBike ? 1300 : (cyl >= 8 ? 800 : 850));
  const Pw = hp * 745.7; const wP = pRpm * TAU / 60;
  let tqPeak = nm; const tqAtPabs = Pw / wP; if (tqAtPabs > tqPeak) tqPeak = tqAtPabs * 1.04;
  const tqAtP = tqAtPabs / tqPeak;
  const tqRpm = asp === 'EV' ? (Pw / tqPeak) / TAU * 60 : (asp === 'T' || asp === 'TT' ? Math.max(2200, pRpm * 0.45) : asp === 'S' ? pRpm * 0.55 : pRpm * 0.7);
  const tireR = isBike ? 0.31 : (['truck', 'trophy', 'suv_boxy', 'truck_box', 'raid', 'suv', 'suv_classic', 'wedge_truck'].includes(body) ? (body === 'truck_box' ? 0.55 : 0.41) : (body === 'kart' ? 0.14 : (body === 'buggy' ? 0.36 : 0.33)));
  const track = isBike ? 0.32 : wid * 0.84;
  const area = wid * hgt * 0.82;
  const cd = ci.cd * (tKind === 2 ? 1.06 : 1);
  const cdA = cd * area;
  const vTop = estimateTopSpeed(hp, cdA, kg);
  // gears
  const ng = gears; const first = asp === 'EV' ? 1 : (ng >= 8 ? 4.7 : ng >= 6 ? 3.5 : ng === 5 ? 3.3 : 2.9);
  const top = asp === 'EV' ? 1 : (ng >= 8 ? 0.65 : ng >= 6 ? 0.8 : 0.85);
  const ratios = [];
  for (let g = 0; g < ng; g++) ratios.push(ng === 1 ? 1 : +(first * Math.pow(top / first, g / (ng - 1))).toFixed(3));
  const wRed = redline * TAU / 60;
  const finalDrive = +(wRed * tireR / (vTop * 1.03 * ratios[ng - 1])).toFixed(3);
  const cgh = isBike ? 0.62 : hgt * (body.includes('truck') || body.includes('suv') || body === 'van' ? 0.42 : 0.36);
  const awdSplit = drive === 'AWD' ? (cat === 'RALLY' ? 0.45 : cat === 'HYPER' || cat === 'SUPER' ? 0.33 : 0.4) : drive === 'FWD' ? 1 : 0;
  const spec = {
    id: idx, model: tname ? model + ' ' + tname : model, baseModel: model, trim: tname, make, year: yr, cat: cats, body: bodyK,
    hp, nm: Math.round(tqPeak), mass: kg, wf: wf / 100, drive, eng, cyl, asp, gears: ratios, finalDrive,
    len, wid, hgt, wb, track, cgh, tireR, tire, sig, price: Math.round(price * $Mul / 500) * 500,
    idle, limiter, redline, pRpm, tqRpm, tqAtP, boost: asp === 'TT' ? 1.3 : asp === 'T' ? 1.0 : asp === 'S' ? 0.8 : 0,
    turboLag: asp === 'TT' ? 0.55 : asp === 'T' ? 0.8 : asp === 'S' ? 0.08 : 0,
    suspK: (isBike ? 30000 : 28000) * suspMul * (kg / 1400), suspC: 3200 * Math.sqrt(suspMul) * (kg / 1400), travel: body.includes('truck') || cat === 'OFFROAD' || cat === 'RAID' || body === 'buggy' ? 0.32 : (cat === 'RALLY' ? 0.22 : 0.14),
    arbF: 9000 * suspMul * (kg / 1400), arbR: 6000 * suspMul * (kg / 1400),
    cd, area, clF: 0.12 * aeroMul, clR: 0.18 * aeroMul,
    brakeT: kg * 1.7 * (cat === 'CLASSIC' ? 0.85 : 1) * (tKind === 2 ? 1.15 : 1), bias: 0.6,
    steerLock: (isBike ? 0.4 : (cat === 'DRIFT' ? 0.72 : 0.58)) * (sg.steer || 1), sigMu: sg.mu, yawMul: sg.yaw, diffLock: sg.diff, vTop,
    shiftTime: cat === 'CLASSIC' || year < 1990 ? 0.35 : asp === 'EV' ? 0.0 : (cat === 'HYPER' || cat === 'SUPER' || cat === 'GT' ? 0.08 : 0.18),
    lightBody: false,
  };
  spec.curve = torqueCurveFor(spec);
  spec.name = `${make} ${spec.model}`;
  spec.pi = computePI(spec);
  spec.cls = piClass(spec.pi);
  spec.rarity = spec.price > 2000000 ? 'Legendary' : spec.price > 400000 ? 'Epic' : spec.price > 120000 ? 'Rare' : spec.price > 50000 ? 'Uncommon' : 'Common';
  return spec;
}

export function computePI(s) {
  const pw = s.hp / (s.mass / 1000);
  const comp = COMPOUNDS[s.tire] || COMPOUNDS.street;
  const grip = comp.mu * (s.sigMu || 1);
  let pi = -573 + 218 * Math.log(Math.max(20, pw)) + (grip - 1.0) * 420 + (s.clF + s.clR) * 30 + (s.drive === 'AWD' ? 15 : 0);
  if (s.cat === 'BIKE') pi -= 120;
  return Math.round(clamp(pi, 100, 999));
}
export function piClass(pi) { return pi >= 999 ? 'X' : pi > 900 ? 'S2' : pi > 800 ? 'S1' : pi > 700 ? 'A' : pi > 600 ? 'B' : pi > 500 ? 'C' : 'D'; }
export const CLASS_COLORS = { D: '#5bc0eb', C: '#f4d35e', B: '#f78c3a', A: '#ee4266', S1: '#9b5de5', S2: '#3a86ff', X: '#2ec4b6' };

// ---------- build roster ----------
export const CARS = [];
B.forEach((row) => {
  const trims = TRIMS[row[3]] || TRIMS.default;
  trims.forEach((t) => { CARS.push(buildSpec(row, t, CARS.length)); });
});
// Year-variant "heritage" editions to deepen roster
B.forEach((row, i) => {
  if (i % 2 === 0 && row[2] > 1995 && row[3] !== 'BIKE') {
    const r = row.slice(); r[2] = row[2] - 8 - (i % 5); r[0] = row[0] + ' (' + r[2] + ')'; r[5] = Math.round(row[5] * 0.82); r[6] = Math.round(row[6] * 0.85); r[17] = Math.round(row[17] * 0.6);
    CARS.push(buildSpec(r, ['', 1, 1.02, 1, 0], CARS.length));
  }
});
// Barn finds (hidden unique cars)
export const BARN_FINDS = [
  ['Speedwagon 1936', 'Westbrook', 1936, 'CLASSIC', 'classic', 120, 260, 1500, 54, 'RWD', 'V8', 'NA', 3, 4.80, 1.80, 1.60, 3.00, 900000, 'vintage'],
  ['Silver Dart W25', 'Zephyr', 1934, 'CLASSIC', 'openwheel', 354, 500, 750, 50, 'RWD', 'I6', 'S', 4, 4.00, 1.60, 1.10, 2.70, 6000000, 'vintage'],
  ['Mulsanne Racer', 'Hartwell', 1955, 'CLASSIC', 'racer_classic', 250, 330, 880, 50, 'RWD', 'I6', 'NA', 4, 3.90, 1.65, 1.00, 2.30, 5000000, 'vintage'],
  ['Bandit Firestar', 'Westbrook', 1977, 'MUSCLE', 'muscle_classic', 200, 434, 1640, 56, 'RWD', 'V8', 'NA', 4, 5.00, 1.86, 1.27, 2.75, 80000, 'muscle'],
  ['Gullwing DM-12', 'Ulster', 1982, 'RETRO', 'wedge_classic', 130, 207, 1230, 35, 'RWD', 'V6', 'NA', 5, 4.27, 1.99, 1.14, 2.41, 70000, 'rear'],
  ['Contaro Prototipo', 'Orsini', 1974, 'SUPER', 'wedge_classic', 370, 368, 1100, 42, 'RWD', 'V12', 'NA', 5, 4.14, 1.89, 1.07, 2.45, 3000000, 'tail'],
  ['Baja Beetle 1965', 'Taurine', 1965, 'OFFROAD', 'buggy', 90, 140, 700, 38, 'RWD', 'B4', 'NA', 4, 3.70, 1.80, 1.45, 2.40, 50000, 'buggy'],
  ['Group 5 Turbo', 'Eisenwerk', 1978, 'GT', 'proto', 750, 760, 1025, 40, 'RWD', 'B6', 'TT', 4, 4.89, 1.99, 1.07, 2.27, 4500000, 'aero'],
  ['Rotary Cosmo Sport', 'Sakura', 1968, 'CLASSIC', 'classic', 128, 140, 940, 49, 'RWD', 'R2', 'NA', 5, 4.14, 1.59, 1.17, 2.20, 400000, 'nimble'],
  ['Unitrak 1957', 'Eisenwerk', 1957, 'TRUCK', 'truck_box', 32, 140, 2900, 52, 'AWD', 'D6', 'NA', 6, 3.50, 1.80, 2.20, 1.72, 120000, 'heavy'],
  ['Phantom Moto 1949', 'Yamaro', 1949, 'BIKE', 'bike', 45, 60, 220, 50, 'RWD', 'V2', 'NA', 4, 2.20, 0.80, 1.10, 1.50, 300000, 'bike'],
  ['Endurance 1966 Legend', 'Dunmore', 1966, 'GT', 'racer_classic', 485, 640, 1000, 42, 'RWD', 'V8', 'NA', 4, 4.18, 1.78, 1.03, 2.42, 7000000, 'grip'],
];
export const BARN_CAR_IDS = BARN_FINDS.map((r) => { const s = buildSpec(r, ['', 1, 1, 1, 0], CARS.length); s.barn = true; CARS.push(s); return s.id; });

// ---------- upgrades ----------
// each level: [label, cost, mods]. mods applied multiplicatively/additively in applyBuild
export const UPGRADES = {
  engine: { name: 'Engine Block', levels: [['Stock', 0, {}], ['Street', 4000, { pow: 1.05 }], ['Sport', 9000, { pow: 1.1, mass: 5 }], ['Race', 22000, { pow: 1.18, mass: 10, rev: 300 }]] },
  turbo: { name: 'Forced Induction', levels: [['Stock', 0, {}], ['Street Turbo', 6000, { boost: 0.25, pow: 1.06 }], ['Sport Turbo', 14000, { boost: 0.5, pow: 1.14, lag: -0.1 }], ['Race Twin-Turbo', 30000, { boost: 0.9, pow: 1.26, lag: -0.2, mass: 20 }]] },
  intake: { name: 'Intake', levels: [['Stock', 0, {}], ['Street', 1500, { pow: 1.02 }], ['Sport', 3000, { pow: 1.04 }], ['Race', 6000, { pow: 1.06 }]] },
  exhaust: { name: 'Exhaust', levels: [['Stock', 0, {}], ['Street', 1500, { pow: 1.02, loud: 0.15 }], ['Sport', 3500, { pow: 1.04, mass: -5, loud: 0.3 }], ['Race', 7000, { pow: 1.06, mass: -10, loud: 0.5, crackle: 1 }]] },
  cams: { name: 'Camshaft', levels: [['Stock', 0, {}], ['Street', 2000, { pow: 1.02, rev: 200 }], ['Sport', 4500, { pow: 1.04, rev: 400 }], ['Race', 9000, { pow: 1.07, rev: 700, idleRough: 1 }]] },
  gearbox: { name: 'Transmission', levels: [['Stock', 0, {}], ['Sport', 3000, { shift: 0.75 }], ['Race 6-Speed', 8000, { shift: 0.5, tuneGears: 1 }], ['Race 8-Speed', 14000, { shift: 0.35, tuneGears: 1, addGear: 1 }]] },
  clutch: { name: 'Clutch', levels: [['Stock', 0, {}], ['Sport', 1500, { clutch: 1.3 }], ['Race', 4000, { clutch: 1.7, shift: 0.85 }]] },
  drivetrain: { name: 'Drivetrain & Differential', levels: [['Stock', 0, {}], ['Street LSD', 2500, { diff: 0.35, tuneDiff: 1 }], ['Race LSD', 6000, { diff: 0.6, tuneDiff: 1 }], ['AWD Swap', 18000, { awd: 1, mass: 60, tuneDiff: 1 }], ['RWD Swap', 12000, { rwd: 1, tuneDiff: 1 }]] },
  tires: { name: 'Tire Compound', levels: [['Stock', 0, {}], ['Street', 1500, { tire: 'street' }], ['Sport', 4000, { tire: 'sport' }], ['Semi-Slick', 8000, { tire: 'semislick' }], ['Race Slick', 14000, { tire: 'slick' }], ['Rally', 5000, { tire: 'rally' }], ['Off-Road', 5000, { tire: 'offroad' }], ['Snow', 4000, { tire: 'snowtire' }], ['Drift', 3500, { tire: 'drift' }]] },
  tireWidth: { name: 'Tire Width', levels: [['Stock', 0, {}], ['+10mm', 1200, { width: 1.03 }], ['+20mm', 2400, { width: 1.06 }], ['+40mm', 4000, { width: 1.1, mass: 8 }]] },
  brakes: { name: 'Brakes', levels: [['Stock', 0, {}], ['Street', 1500, { brake: 1.1, fade: 0.9 }], ['Sport', 4000, { brake: 1.22, fade: 0.7, tuneBrake: 1 }], ['Race Carbon', 10000, { brake: 1.38, fade: 0.4, mass: -12, tuneBrake: 1 }]] },
  suspension: { name: 'Springs & Dampers', levels: [['Stock', 0, {}], ['Street', 2000, { susp: 1.15, tuneSusp: 1 }], ['Sport', 5000, { susp: 1.35, tuneSusp: 1 }], ['Race', 10000, { susp: 1.6, tuneSusp: 1, lower: 0.03 }], ['Rally', 9000, { susp: 0.9, travel: 1.6, tuneSusp: 1, raise: 0.04 }], ['Drift', 8000, { susp: 1.4, lock: 1.3, tuneSusp: 1 }], ['Off-Road', 9000, { susp: 0.75, travel: 2.0, tuneSusp: 1, raise: 0.08 }]] },
  arb: { name: 'Anti-Roll Bars', levels: [['Stock', 0, {}], ['Sport', 1500, { arb: 1.3, tuneArb: 1 }], ['Race', 3500, { arb: 1.6, tuneArb: 1 }]] },
  weight: { name: 'Weight Reduction', levels: [['Stock', 0, {}], ['Street', 3000, { massPct: -0.04 }], ['Sport', 8000, { massPct: -0.08 }], ['Race', 18000, { massPct: -0.13 }]] },
  aero: { name: 'Aero (Front & Rear)', levels: [['Stock', 0, {}], ['Street Lip & Spoiler', 2500, { aero: 0.4, drag: 1.02 }], ['Race Splitter & Wing', 8000, { aero: 1.5, drag: 1.07, tuneAero: 1 }], ['Forza Aero Kit', 15000, { aero: 2.6, drag: 1.1, tuneAero: 1 }]] },
  chassis: { name: 'Chassis Reinforcement', levels: [['Stock', 0, {}], ['Sport', 3000, { stiff: 1.08, mass: 10, dmg: 0.85 }], ['Race Roll Cage', 9000, { stiff: 1.16, mass: 25, dmg: 0.6 }]] },
};
export const UPGRADE_KEYS = Object.keys(UPGRADES);

export function defaultTune(spec) {
  return {
    gears: spec.gears.slice(), finalDrive: spec.finalDrive,
    camberF: -1.2, camberR: -0.8, toeF: 0.0, toeR: 0.1, caster: 5.5,
    springF: 1, springR: 1, rideF: 0, rideR: 0, reboundF: 1, reboundR: 1, bumpF: 1, bumpR: 1,
    arbF: 1, arbR: 1, diffAccel: 0.5, diffDecel: 0.2, diffCenter: spec.drive === 'AWD' ? Math.round((1 - spec.awdSplit()) * 100) : 0,
    brakeBias: 0.58, brakePressure: 1, tirePF: 2.2, tirePR: 2.2, aeroF: 1, aeroR: 1,
  };
}
CARS.forEach((s) => { const sp = s.drive === 'AWD' ? (s.cat === 'RALLY' ? 0.45 : (s.cat === 'HYPER' || s.cat === 'SUPER') ? 0.33 : 0.4) : s.drive === 'FWD' ? 1 : 0; s.awdSplit = () => sp; });

// Apply upgrades + tune to a spec → physics parameter set
export function applyBuild(spec, up = {}, tune = null) {
  const t = tune || defaultTune(spec);
  const p = { ...spec };
  let pow = 1, massAdd = 0, massPct = 0, boostAdd = 0, lagAdd = 0, rev = 0, shift = 1, clutch = 1, diff = spec.diffLock, brake = 1, fade = 1, susp = 1, travel = 1, arb = 1, aero = 0, drag = 1, stiff = 1, dmg = 1, width = 1, lower = 0, raise = 0, lock = 1, loud = 0, crackle = 0;
  let tire = spec.tire, drive = spec.drive, addGear = 0;
  const flags = {};
  for (const k of UPGRADE_KEYS) {
    const lv = up[k] | 0; if (!lv) continue; const m = UPGRADES[k].levels[lv]?.[2]; if (!m) continue;
    if (m.pow) pow *= m.pow; if (m.mass) massAdd += m.mass; if (m.massPct) massPct += m.massPct; if (m.boost) boostAdd += m.boost; if (m.lag) lagAdd += m.lag;
    if (m.rev) rev += m.rev; if (m.shift) shift *= m.shift; if (m.clutch) clutch *= m.clutch; if (m.diff) diff = Math.max(diff, m.diff);
    if (m.brake) brake *= m.brake; if (m.fade) fade *= m.fade; if (m.susp) susp *= m.susp; if (m.travel) travel *= m.travel; if (m.arb) arb *= m.arb;
    if (m.aero) aero += m.aero; if (m.drag) drag *= m.drag; if (m.stiff) stiff *= m.stiff; if (m.dmg) dmg *= m.dmg; if (m.width) width *= m.width;
    if (m.lower) lower += m.lower; if (m.raise) raise += m.raise; if (m.lock) lock *= m.lock; if (m.loud) loud += m.loud; if (m.crackle) crackle = 1;
    if (m.tire) tire = m.tire; if (m.awd) drive = 'AWD'; if (m.rwd) drive = 'RWD'; if (m.addGear) addGear = 1;
    for (const f of ['tuneGears', 'tuneDiff', 'tuneBrake', 'tuneSusp', 'tuneArb', 'tuneAero']) if (m[f]) flags[f] = 1;
  }
  if (spec.asp === 'NA' && boostAdd > 0) { p.asp = 'T'; p.boost = boostAdd + 0.4; p.turboLag = 0.7 + lagAdd; }
  else if (spec.asp !== 'EV') { p.boost = spec.boost + boostAdd; p.turboLag = Math.max(0.05, spec.turboLag + lagAdd); }
  if (spec.asp === 'EV') { pow = 1 + (pow - 1) * 0.6; }
  p.hp = Math.round(spec.hp * pow); p.nm = Math.round(spec.nm * (1 + (pow - 1) * 0.9));
  p.mass = Math.round(spec.mass * (1 + massPct) + massAdd);
  p.limiter = spec.limiter + rev; p.redline = spec.redline + rev; p.pRpm = spec.pRpm + rev * 0.7;
  p.shiftTime = spec.shiftTime * shift; p.clutchCap = p.nm * 1.6 * clutch; p.diffLock = diff;
  p.brakeT = spec.brakeT * brake * t.brakePressure; p.fade = fade; p.bias = t.brakeBias;
  p.suspKF = spec.suspK * susp * stiff * t.springF; p.suspKR = spec.suspK * susp * stiff * t.springR;
  p.suspCF = spec.suspC * Math.sqrt(susp) * t.bumpF; p.suspCR = spec.suspC * Math.sqrt(susp) * t.bumpR;
  p.reboundF = t.reboundF; p.reboundR = t.reboundR;
  p.travel = spec.travel * travel; p.rideF = t.rideF - lower + raise; p.rideR = t.rideR - lower + raise;
  p.arbF = spec.arbF * arb * t.arbF; p.arbR = spec.arbR * arb * t.arbR;
  p.clF = (spec.clF + aero * 0.5) * t.aeroF; p.clR = (spec.clR + aero * 0.65) * t.aeroR; p.cd = spec.cd * drag;
  p.tire = tire; p.tireWidth = width; p.drive = drive; p.dmgMul = dmg; p.loud = loud; p.crackle = crackle || spec.asp !== 'EV' && spec.cyl >= 8 ? 1 : crackle;
  p.steerLock = spec.steerLock * lock;
  p.awd = drive === 'AWD' ? clamp(1 - (t.diffCenter || 60) / 100, 0.1, 0.9) : drive === 'FWD' ? 1 : 0;
  if (drive === 'AWD' && spec.drive !== 'AWD' && !t.diffCenter) p.awd = 0.4;
  p.diffAccel = flags.tuneDiff ? t.diffAccel : diff; p.diffDecel = flags.tuneDiff ? t.diffDecel : diff * 0.4;
  let g = t.gears.slice(); if (addGear && g.length >= 5 && g.length < 9) { const last = g[g.length - 1]; g.push(+(last * 0.86).toFixed(3)); }
  p.gears = g; p.finalDrive = t.finalDrive;
  p.camberF = t.camberF; p.camberR = t.camberR; p.toeF = t.toeF; p.toeR = t.toeR; p.caster = t.caster; p.tirePF = t.tirePF; p.tirePR = t.tirePR;
  p.flags = flags; p.curve = spec.curve;
  p.pi = computePI({ ...p, hp: p.hp, mass: p.mass, tire: p.tire, sigMu: spec.sigMu * width ** 0.3 * (1 + (susp - 1) * 0.04), clF: p.clF, clR: p.clR, drive: p.drive, cat: spec.cat });
  p.cls = piClass(p.pi);
  return p;
}
export function upgradeCost(key, lv) { return UPGRADES[key].levels[lv]?.[1] || 0; }

// stats bars for UI (0..10)
export function carStats(p) {
  const pw = p.hp / (p.mass / 1000);
  const comp = COMPOUNDS[p.tire] || COMPOUNDS.street;
  return {
    speed: clamp((p.vTop * 3.6 - 120) / 30, 1, 10),
    handling: clamp((comp.mu * (p.sigMu || 1) - 0.8) * 14 + (p.clF + p.clR) * 0.8 + (p.suspKF ? p.suspKF / (p.mass * 22) : 1), 1, 10),
    accel: clamp(Math.log(pw / 50) * 3.2 + (p.drive === 'AWD' ? 0.8 : 0), 1, 10),
    launch: clamp(Math.log(pw / 50) * 2.4 + (p.drive === 'AWD' ? 2.5 : p.drive === 'FWD' ? 0.5 : 0) + (comp.mu - 1) * 8, 1, 10),
    braking: clamp((p.brakeT / p.mass) * 3 + (comp.mu - 1) * 10 + (p.clF + p.clR) * 0.6, 1, 10),
    offroad: clamp((comp.loose - 0.6) * 12 + (p.travel || 0.14) * 14 + (p.drive === 'AWD' ? 1.5 : 0), 1, 10),
  };
}

// ---------- events & content ----------
export const EVENT_TYPES = {
  road: { name: 'Road Racing', icon: '🏁', color: '#ff2e88', surface: 'tarmac' },
  dirt: { name: 'Dirt Racing', icon: '⛰', color: '#c98b2b', surface: 'dirt' },
  cross: { name: 'Cross Country', icon: '🌲', color: '#3dbb57', surface: 'any' },
  street: { name: 'Street Scene', icon: '🌃', color: '#7c4dff', surface: 'tarmac' },
  drag: { name: 'Drag Meet', icon: '⚡', color: '#ffd23f', surface: 'tarmac' },
  showcase: { name: 'Showcase', icon: '★', color: '#ffb000', surface: 'any' },
  stadium: { name: 'Stadium', icon: '◎', color: '#00d1ff', surface: 'tarmac' },
  arcade: { name: 'Horizon Arcade', icon: '◆', color: '#ff4fd8', surface: 'any' },
  drift: { name: 'Drift Zone', icon: '〰', color: '#ff7a00', surface: 'tarmac' },
  speedtrap: { name: 'Speed Trap', icon: '📷', color: '#ffea00', surface: 'tarmac' },
  speedzone: { name: 'Speed Zone', icon: '⏱', color: '#00e5ff', surface: 'tarmac' },
  danger: { name: 'Danger Sign', icon: '⚠', color: '#ff3d3d', surface: 'any' },
  trail: { name: 'Trailblazer', icon: '➶', color: '#7dff6b', surface: 'any' },
};
export const DRIVATARS = ['Nitro_Nadia', 'ApexPredator', 'SidewaysSam', 'KerbKiller', 'TurboTomas', 'LateBraker', 'Gr8Scott', 'DriftKing_JP', 'Valentina_V', 'MudSlinger', 'ChromeHeart', 'RedlineRita', 'Ghost_Rider88', 'PitLane_Pete', 'SlipstreamSue', 'BoostBaron', 'HeelToeHank', 'Oversteer_Olga', 'Torquemada', 'GearGrinder', 'Lambo_Luis', 'NightOwlNoor', 'Clutch_Kid', 'Rally_Raj', 'Horizon_Hero', 'TwinTurboTina', 'Banzai_Ben', 'CanyonCarver', 'SaltFlat_Sal', 'Rooster_Ray'];
export const QUICKCHAT = ['Follow me!', 'Nice driving!', 'Race?', 'Wait up!', 'Drift train!', 'Sorry!', 'GG', 'Let\'s go!'];
export const HORNS = ['Classic', 'Air Horn', 'La Cucaracha', 'Truck', 'Clown', 'Festival Fanfare', 'Duck'];
export const CLOTHING = {
  hat: ['None', 'Cap', 'Beanie', 'Cowboy', 'Bucket', 'Helmet'], top: ['Tee', 'Hoodie', 'Racing Jacket', 'Denim', 'Bomber', 'Hawaiian'],
  color: ['#ff2e88', '#00e5ff', '#ffd23f', '#7dff6b', '#ffffff', '#222222', '#ff7a00', '#9b5de5'],
};
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_WEATHER = {
  Spring: { clear: 0.35, overcast: 0.25, rain: 0.25, storm: 0.05, fog: 0.1, snow: 0 },
  Summer: { clear: 0.65, overcast: 0.15, rain: 0.08, storm: 0.07, fog: 0.05, snow: 0 },
  Autumn: { clear: 0.25, overcast: 0.3, rain: 0.25, storm: 0.1, fog: 0.1, snow: 0 },
  Winter: { clear: 0.3, overcast: 0.25, rain: 0, storm: 0, fog: 0.15, snow: 0.3 },
};
export const WHEEL_STYLES = ['Five Spoke', 'Mesh', 'Deep Dish', 'Turbofan', 'Steelie', 'Multi-Spoke', 'Monoblock', 'Beadlock'];
export const PAINT_TYPES = ['gloss', 'matte', 'metallic', 'chrome', 'pearl'];
export const DECALS = ['none', 'stripes', 'racing number', 'flames', 'checker', 'side stripe', 'horizon logo', 'sunburst', 'camo'];

export function weekSeason(date = new Date()) {
  const wk = Math.floor(date.getTime() / (7 * 86400000));
  return SEASONS[wk % 4];
}
export const CAR_COUNT = CARS.length;
