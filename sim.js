// =====================================================================
// sim.js : PHYSICS (vehicle model, tires, drivetrain, collisions)
//          INPUT (keyboard, gamepad, touch, remapping, rumble)
//          AUDIO (engine synthesis, sfx, music)
// =====================================================================
import * as THREE from 'three';
import { clamp, lerp, smoothstep, COMPOUNDS, ENGINES, SURF, surfaceFamily, TAU, mulberry32, strHash } from './data.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m3 = new THREE.Matrix3();
const G = 9.81, RHO = 1.225;

// ---------------------------------------------------------------------
// Tire model: normalized combined-slip Magic Formula (friction ellipse)
// ---------------------------------------------------------------------
function mf(x, C) { const B = Math.tan(Math.PI / (2 * C)); return Math.sin(C * Math.atan(B * x)); }
// returns [Fx, Fy] for slip ratio k, slip angle a (rad)
function tireForce(k, a, Fz, mu, kpk, apk, Clong, Clat, out) {
  const kn = k / kpk, an = a / apk; const rho = Math.sqrt(kn * kn + an * an);
  if (rho < 1e-6 || Fz <= 0) { out[0] = 0; out[1] = 0; return out; }
  const fl = mf(rho, Clong), ft = mf(rho, Clat);
  const w = Math.abs(kn) / rho; const f = fl * w + ft * (1 - w);
  const F = f * mu * Fz;
  out[0] = F * kn / rho; out[1] = -F * an / rho * 0.98; return out;
}
const _tf = [0, 0], _tf2 = [0, 0];

export const ASSIST_DEFAULTS = { abs: 1, tcs: 0.7, stm: 0.6, steer: 0.6, brake: 0.3, autoBrake: 0, line: 2, shifting: 'auto', damage: 'cosmetic', wear: 1, rewind: 1 };

// ---------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------
export class Vehicle {
  constructor(params, opts = {}) {
    this.id = opts.id ?? 0; this.isAI = !!opts.ai;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3(); this.renderQuat = new THREE.Quaternion();
    this.events = []; this.damage = { front: 0, rear: 0, left: 0, right: 0 }; this.dmgHits = [];
    this.assists = { ...ASSIST_DEFAULTS, ...(opts.assists || {}) };
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, shiftUp: 0, shiftDown: 0 };
    this.ghost = false; this.frozen = false; this.airTime = 0; this.onGround = true; this.upsideTime = 0;
    this.driftAngle = 0; this.speed = 0; this.odo = 0; this.ambientT = 22; this.wetness = 0; this.snowCover = 0;
    this.setParams(params);
  }
  setParams(p) {
    this.p = p; const m = p.mass; this.mass = m; this.invMass = 1 / m;
    const L = p.len, W = p.wid, H = p.hgt;
    const yawMul = p.yawMul || 1;
    this.I = new THREE.Vector3(m / 12 * (L * L + H * H) * 0.75, m / 12 * (L * L + W * W) * 0.82 / yawMul, m / 12 * (W * W + H * H) * 0.8);
    if (p.cat === 'BIKE') { this.I.z *= 0.6; }
    this.invI = new THREE.Vector3(1 / this.I.x, 1 / this.I.y, 1 / this.I.z);
    const wf = p.wf, wb = p.wb; const zf = wb * (1 - wf), zr = -wb * wf;
    const tr = p.track / 2; const cgh = Math.max(0.25, p.cgh + ((p.rideF || 0) + (p.rideR || 0)) * 0.5);
    this.cgh = cgh;
    const comp = COMPOUNDS[p.tire] || COMPOUNDS.street; this.comp = comp;
    const old = this.wheels;
    this.wheels = [];
    const mk = (x, z, front, left) => {
      const travel = p.travel; const k = front ? p.suspKF || p.suspK : p.suspKR || p.suspK;
      const axleLoad = m * G * (front ? wf : 1 - wf) / 2;
      const ride = front ? (p.rideF || 0) : (p.rideR || 0);
      const w = {
        front, left, driven: false, mount: new THREE.Vector3(x, -cgh + p.tireR + travel * 0.55 + ride, z),
        r: p.tireR, I: 1.1 * (p.tireR / 0.33) ** 3 * (p.cat === 'BIKE' ? 0.5 : 1), k, c: front ? (p.suspCF || p.suspC) : (p.suspCR || p.suspC),
        reb: front ? (p.reboundF || 1) : (p.reboundR || 1), travel, pre: axleLoad / k - travel * 0.45, Fz0: axleLoad,
        comp: travel * 0.45, compPrev: travel * 0.45, omega: 0, rot: 0, steer: 0, contact: false, Fz: 0, Fx: 0, Fy: 0, slipK: 0, slipA: 0,
        temp: 60, wear: 0, brakeTemp: 80, surf: SURF.tarmac, cp: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0), water: 0, slipVel: 0, kerb: 0,
        camber: front ? (p.camberF ?? -1) : (p.camberR ?? -0.8), toe: (front ? (p.toeF || 0) : (p.toeR || 0)) * Math.PI / 180 * (left ? 1 : -1),
        pressure: front ? (p.tirePF || 2.2) : (p.tirePR || 2.2), wheelY: 0,
      };
      return w;
    };
    this.wheels.push(mk(tr, zf, true, true), mk(-tr, zf, true, false), mk(tr, zr, false, true), mk(-tr, zr, false, false));
    if (old) old.forEach((o, i) => { this.wheels[i].omega = o.omega; this.wheels[i].temp = o.temp; this.wheels[i].wear = o.wear; });
    this.drive = p.drive; this.awd = p.drive === 'AWD' ? p.awd : p.drive === 'FWD' ? 1 : 0;
    this.wheels.forEach((w) => { w.driven = (this.drive === 'AWD') || (this.drive === 'FWD' ? w.front : !w.front); });
    this.Ie = p.asp === 'EV' ? 0.12 : 0.15 + p.cyl * 0.02;
    this.engine = this.engine || { rpm: p.idle || 0, omega: (p.idle || 0) * TAU / 60, boost: 0, gear: 1, shiftT: 0, nextGear: 1, clutch: 1, locked: false, cut: 0, revT: 0, throttle: 0, load: 0, revDir: 0, rpmVis: 0, tq: 0 };
    this.engine.gear = Math.min(this.engine.gear, p.gears.length);
    this.kpk = 0.1; this.apk = 0.13;
    if (p.tire === 'slick') { this.kpk = 0.085; this.apk = 0.115; } else if (p.tire === 'offroad' || p.tire === 'rally') { this.kpk = 0.13; this.apk = 0.16; } else if (p.tire === 'drift') { this.apk = 0.16; } else if (p.tire === 'vintage') { this.apk = 0.15; }
    this.bodyPts = [];
    const hb = -cgh + 0.15, ht = p.hgt - cgh; const hl = L / 2, hw = W / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { this.bodyPts.push(new THREE.Vector3(sx * hw, hb, sz * hl), new THREE.Vector3(sx * hw * 0.8, ht, sz * hl * 0.5)); }
    this.bodyPts.push(new THREE.Vector3(0, ht, 0));
    this.capR = Math.min(W / 2, L / 2) * 0.95; this.capHalf = Math.max(0, L / 2 - this.capR);
  }
  get gearCount() { return this.p.gears.length; }
  place(x, y, z, yaw) {
    this.pos.set(x, y, z); this.quat.setFromAxisAngle(_v1.set(0, 1, 0), yaw); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat);
    this.wheels.forEach((w) => { w.omega = 0; w.comp = w.travel * 0.45; w.compPrev = w.comp; });
    this.engine.gear = 1; this.engine.shiftT = 0; this.engine.omega = (this.p.idle || 0) * TAU / 60; this.engine.boost = 0; this.engine.locked = false;
    this.airTime = 0; this.upsideTime = 0;
  }
  yaw() { _v1.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(_v1.x, _v1.z); }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  getState() {
    const e = this.engine;
    return { p: this.pos.toArray(), q: this.quat.toArray(), v: this.vel.toArray(), w: this.angVel.toArray(), wo: this.wheels.map((w) => w.omega), wc: this.wheels.map((w) => w.comp), e: [e.omega, e.gear, e.boost, e.shiftT, e.nextGear, e.locked ? 1 : 0] };
  }
  setState(s) {
    this.pos.fromArray(s.p); this.quat.fromArray(s.q); this.vel.fromArray(s.v); this.angVel.fromArray(s.w);
    s.wo.forEach((o, i) => { this.wheels[i].omega = o; }); s.wc.forEach((c, i) => { this.wheels[i].comp = c; this.wheels[i].compPrev = c; });
    const e = this.engine; [e.omega, e.gear, e.boost, e.shiftT, e.nextGear] = s.e; e.locked = !!s.e[5];
  }
  savePrev() { this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); }
  interpolate(alpha) { this.renderPos.lerpVectors(this.prevPos, this.pos, alpha); this.renderQuat.slerpQuaternions(this.prevQuat, this.quat, alpha); }

  torqueAt(rpm) {
    const p = this.p, c = p.curve, N = c.length; const r0 = (p.idle || 0) * 0.5, r1 = p.limiter * 1.05;
    const f = clamp((rpm - r0) / (r1 - r0), 0, 1) * (N - 1); const i = Math.floor(f), t = f - i;
    return p.nm * (c[i] + (c[Math.min(N - 1, i + 1)] - c[i]) * t);
  }
  ratio(g) { const p = this.p; if (g === 0) return 0; if (g < 0) return -p.gears[0] * 1.1 * p.finalDrive; return p.gears[g - 1] * p.finalDrive; }

  // world: { ground(x,z,out) -> {h, nx,ny,nz, surf, water, kerb} } ; h = fixed dt
  step(h, world, env) {
    if (this.frozen) { this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); return; }
    const sub = 2, hs = h / sub;
    for (let s = 0; s < sub; s++) this.substep(hs, world, env);
    this.speed = this.vel.length(); this.odo += this.speed * h;
  }

  substep(h, world, env) {
    const p = this.p, A = this.assists, inp = this.input, e = this.engine;
    const R = this.quat; const up = _v1.set(0, 1, 0).applyQuaternion(R).clone(); const fwd = _v2.set(0, 0, 1).applyQuaternion(R).clone(); const left = _v3.set(1, 0, 0).applyQuaternion(R).clone();
    const vF = this.vel.dot(fwd), vL = this.vel.dot(left), spd = this.vel.length();
    const force = new THREE.Vector3(0, -G * this.mass, 0), torque = new THREE.Vector3();
    const dmgOn = A.damage === 'sim';
    const dm = this.damage;

    // ---------- steering ----------
    const steerAssist = A.steer;
    const sens = clamp(lerp(1 / (1 + spd * 0.014), 1 / (1 + spd * 0.04), steerAssist), 0.1, 1);
    let delta = -inp.steer * p.steerLock * sens;
    // slip-angle limiter / counter-steer assist
    if (steerAssist > 0 && Math.abs(vF) > 3) {
      const yawRate = this.angVel.dot(up);
      const betaF = Math.atan2(vL + yawRate * this.wheels[0].mount.z, Math.abs(vF));
      const lim = this.apk * 1.25;
      const lo = betaF - lim, hi = betaF + lim;
      const dl = clamp(delta, lo, hi); delta = lerp(delta, dl, steerAssist * 0.85);
      const betaR = Math.atan2(vL + yawRate * this.wheels[2].mount.z, Math.abs(vF));
      if (Math.abs(betaR) > 0.08 && Math.abs(inp.steer) < 0.3) delta += clamp(betaR, -0.5, 0.5) * steerAssist * 0.5;
    }
    if (dmgOn) delta += (dm.left - dm.right) * 0.03;
    delta = clamp(delta, -p.steerLock * 1.1, p.steerLock * 1.1);
    const curSteer = this.wheels[0].steer0 || 0; const rate = 5 * h;
    const st = curSteer + clamp(delta - curSteer, -rate, rate); this.wheels[0].steer0 = st;
    const ack = Math.abs(st) * 0.12;
    this.wheels[0].steer = st + (st > 0 ? ack : -ack * 0.5) * 0.5; this.wheels[1].steer = st + (st < 0 ? -ack : ack * 0.5) * 0.5;
    this.wheels[2].steer = 0; this.wheels[3].steer = 0;
    this.steerAngle = st;

    // ---------- gearbox logic ----------
    const isEV = p.asp === 'EV';
    let throttle = inp.throttle, brake = inp.brake;
    const n = this.gearCount;
    if (e.shiftT > 0) { e.shiftT -= h; if (e.shiftT <= p.shiftTime * 0.5 && e.gear !== e.nextGear) { e.gear = e.nextGear; e.locked = false; } if (e.shiftT <= 0) e.shiftT = 0; }
    const shiftTo = (g) => { if (g === e.gear || e.shiftT > 0) return; e.nextGear = g; e.shiftT = Math.max(0.02, p.shiftTime); if (p.shiftTime < 0.03) { e.gear = g; } this.events.push({ t: 'shift', up: g > e.gear }); };
    const autoGear = A.shifting === 'auto';
    if (autoGear) {
      // reverse handling
      if (e.gear > 0 && vF < 0.6 && inp.brake > 0.4 && inp.throttle < 0.1) { this.revTimer = (this.revTimer || 0) + h; if (this.revTimer > 0.35) { e.gear = -1; e.nextGear = -1; this.revTimer = 0; } }
      else if (e.gear === -1 && vF > -0.6 && inp.throttle > 0.3) { e.gear = 1; e.nextGear = 1; }
      else this.revTimer = 0;
      if (e.gear === -1) { throttle = inp.brake; brake = inp.throttle; }
      if (e.gear === 0) e.gear = 1;
      if (e.gear > 0 && e.shiftT <= 0 && n > 1) {
        const rpmNow = this.drivenOmega() * this.ratio(e.gear) * 60 / TAU;
        const wheelspin = this.maxDrivenSlip() > 0.25;
        const upAt = throttle > 0.6 ? p.redline * 0.965 : lerp(p.pRpm * 0.55, p.redline * 0.9, throttle);
        if (rpmNow > upAt && e.gear < n && !wheelspin && this.onGround) shiftTo(e.gear + 1);
        else if (e.gear > 1) {
          const rpmLower = rpmNow * this.ratio(e.gear - 1) / this.ratio(e.gear);
          const downAt = brake > 0.3 ? p.pRpm * 0.72 : throttle > 0.7 ? p.pRpm * 0.62 : p.pRpm * 0.38;
          if (rpmNow < downAt && rpmLower < p.redline * 0.88) shiftTo(e.gear - 1);
        }
      }
    } else {
      if (inp.shiftUp) { inp.shiftUp = 0; if (e.gear < n) shiftTo(e.gear === -1 ? 0 : e.gear + 1); }
      if (inp.shiftDown) { inp.shiftDown = 0; if (e.gear > -1) shiftTo(e.gear - 1); }
    }
    if (isEV && autoGear) { /* single speed */ }

    // ---------- assists on throttle (TCS, STM) ----------
    const yawRate = this.angVel.dot(up);
    if (A.tcs > 0 && throttle > 0) {
      const sl = this.maxDrivenSlip(); const thr = this.kpk * (1.3 + (1 - A.tcs) * 3);
      if (sl > thr) throttle *= clamp(1 - (sl - thr) / thr * A.tcs * 1.6, 0.05, 1);
    }
    let stmBrake = [0, 0, 0, 0];
    if (A.stm > 0 && Math.abs(vF) > 6) {
      const rDes = vF * Math.tan(st) / p.wb; const rMax = (1.1 * G) / Math.max(5, Math.abs(vF));
      const rd = clamp(rDes, -rMax, rMax); const err = yawRate - rd;
      if (Math.abs(err) > 0.12) {
        const over = Math.sign(err) === Math.sign(yawRate) && Math.abs(yawRate) > Math.abs(rd);
        throttle *= clamp(1 - Math.abs(err) * A.stm * 1.4, 0.15, 1);
        const amt = clamp((Math.abs(err) - 0.12) * A.stm * 0.6, 0, 0.5);
        // yaw left (positive) too much -> brake right front (outer)
        if (over) { if (err > 0) stmBrake[1] = amt; else stmBrake[0] = amt; }
        else { if (err > 0) stmBrake[2] = amt * 0.6; else stmBrake[3] = amt * 0.6; }
      }
    }
    if (e.shiftT > 0 && !isEV) throttle *= 0.0;
    if (inp.autoBrake) brake = Math.max(brake, inp.autoBrake * A.autoBrake);
    // braking assist: smooth pedal and soften lock-up
    if (A.brake > 0) brake = lerp(brake, Math.min(brake, 0.25 + brake * 0.75), A.brake * 0.3);

    // ---------- engine & clutch ----------
    const G_r = this.ratio(e.shiftT > 0 && !isEV ? 0 : e.gear);
    let wDs = 0, nD = 0; this.wheels.forEach((w) => { if (w.driven) { wDs += w.omega * (this.drive === 'AWD' ? (w.front ? this.awd : 1 - this.awd) * 2 : 1); nD++; } });
    wDs /= nD; // weighted driveshaft-side wheel speed
    const idleW = (p.idle || 0) * TAU / 60, limW = p.limiter * TAU / 60;
    let rpm = e.omega * 60 / TAU;
    // turbo
    if (p.boost > 0) {
      const spool = clamp((rpm - p.idle * 1.5) / Math.max(500, p.tqRpm - p.idle * 1.5), 0, 1);
      const target = p.asp === 'S' ? clamp(rpm / p.pRpm, 0, 1) * Math.max(throttle, 0.05) : throttle * spool;
      const prevB = e.boost;
      const tau = target > e.boost ? Math.max(0.05, p.turboLag) : 0.25;
      e.boost += (target - e.boost) * clamp(h / tau, 0, 1);
      if (prevB > 0.55 && throttle < 0.15 && (p.asp === 'T' || p.asp === 'TT') && !e.bovLatch) { this.events.push({ t: 'bov', amt: prevB }); e.bovLatch = 1; }
      if (throttle > 0.5) e.bovLatch = 0;
    } else e.boost = 0;
    const share = p.asp === 'T' || p.asp === 'TT' ? 0.42 : p.asp === 'S' ? 0.2 : 0;
    const boostMul = 1 - share * (1 - e.boost);
    let pwrLoss = dmgOn ? 1 - dm.front * 0.35 : 1;
    // fuel cut at limiter
    if (rpm > p.limiter) e.cut = 0.06; if (e.cut > 0) { e.cut -= h; }
    const thrEff = e.cut > 0 ? 0 : throttle;
    let Teng;
    if (isEV) {
      const motorRpm = Math.abs(wDs * G_r) * 60 / TAU;
      Teng = this.torqueAt(motorRpm) * thrEff * pwrLoss - (throttle < 0.05 ? p.nm * 0.12 * clamp(motorRpm / 3000, 0, 1) : 0);
    } else {
      const fric = (p.nm * 0.06 + p.nm * 0.16 * (rpm / p.limiter)) * (1 - thrEff);
      Teng = this.torqueAt(rpm) * thrEff * boostMul * pwrLoss - fric;
      if (e.omega < idleW) Teng += (idleW - e.omega) * this.Ie * 25 + p.nm * 0.1;
    }
    e.throttle = thrEff; e.tq = Teng;
    // clutch
    let cTarget = 1;
    if (!isEV) {
      if (e.shiftT > 0) cTarget = 0;
      else if (G_r === 0) cTarget = 0;
      else if (A.shifting === 'manualClutch') cTarget = 1 - inp.clutch;
      else {
        const wheelRpm = Math.abs(wDs * G_r) * 60 / TAU;
        if (wheelRpm < p.idle * 1.4) cTarget = clamp((rpm - p.idle * 1.05) / (600 + 2600 * throttle), 0, 1);
        if (inp.handbrake > 0.5 && this.drive !== 'FWD' && Math.abs(vF) < 25) cTarget = Math.min(cTarget, 0.25);
      }
    }
    e.clutch = cTarget;
    let Twheel = 0; // total torque to driveshaft-side
    let addInertia = 0;
    if (isEV) {
      e.locked = true; Twheel = Teng * G_r; addInertia = this.Ie * G_r * G_r; e.omega = Math.abs(wDs * G_r);
    } else {
      const cap = (p.clutchCap || p.nm * 1.6) * e.clutch;
      const dW = e.omega - wDs * G_r;
      if (e.locked && (e.clutch < 0.98 || G_r === 0)) e.locked = false;
      if (e.locked) {
        Twheel = Teng * G_r; addInertia = this.Ie * G_r * G_r;
        if (Math.abs(Teng) > cap * 1.05) e.locked = false;
      } else {
        const Ids = this.wheels.reduce((s, w) => s + (w.driven ? w.I : 0), 0);
        let Tc = 0;
        if (G_r !== 0 && cap > 0) { const need = dW / (h * (1 / this.Ie + G_r * G_r / Ids)); Tc = clamp(need, -cap, cap); }
        e.omega += (Teng - Tc) / this.Ie * h;
        Twheel = Tc * G_r;
        if (G_r !== 0 && e.clutch > 0.98 && Math.abs(e.omega - wDs * G_r) < 1.5 && Math.abs(Teng) < cap) e.locked = true;
      }
      if (e.omega < idleW * 0.7 && !e.locked) e.omega = idleW * 0.7;
      if (e.omega > limW * 1.08) e.omega = limW * 1.08;
    }

    // ---------- wheels ----------
    const eff = 0.9;
    const brakeFade = (w) => 1 - smoothstep(520, 880, w.brakeTemp) * 0.5 * (p.fade ?? 1);
    let fwSum = 0, rwSum = 0, slipPowTot = 0; this.onGround = false;
    const wet = env ? env.wet : 0; const snowCov = env ? env.snow : 0;
    const comp = this.comp;
    const out = this._g || (this._g = { h: 0, nx: 0, ny: 1, nz: 0, surf: SURF.tarmac, water: 0, kerb: 0 });
    // diff split per axle
    const axleT = { f: 0, r: 0 };
    if (this.drive === 'AWD') { axleT.f = Twheel * eff * this.awd; axleT.r = Twheel * eff * (1 - this.awd); }
    else if (this.drive === 'FWD') axleT.f = Twheel * eff; else axleT.r = Twheel * eff;
    const nDrivenAxle = this.drive === 'AWD' ? 4 : 2;
    const wheelT = [0, 0, 0, 0];
    const diffLock = (wl, wr, Ta, isFront) => {
      const lockK = Ta >= 0 ? (p.diffAccel ?? p.diffLock) : (p.diffDecel ?? p.diffLock * 0.4);
      const capL = 40 + lockK * Math.abs(Ta) * 1.2 + (lockK >= 0.99 ? 1e5 : 0);
      const need = (wl.omega - wr.omega) / (h * (1 / wl.I + 1 / wr.I)) * 0.5;
      const Tl = clamp(need, -capL, capL);
      return [Ta / 2 - Tl, Ta / 2 + Tl];
    };
    if (axleT.f !== 0 || this.wheels[0].driven) { const [a, b] = diffLock(this.wheels[0], this.wheels[1], axleT.f, true); if (this.wheels[0].driven) { wheelT[0] = a; wheelT[1] = b; } }
    if (axleT.r !== 0 || this.wheels[2].driven) { const [a, b] = diffLock(this.wheels[2], this.wheels[3], axleT.r, false); if (this.wheels[2].driven) { wheelT[2] = a; wheelT[3] = b; } }
    if (this.drive === 'AWD' && e.locked) { // center viscous coupling
      const wfA = (this.wheels[0].omega + this.wheels[1].omega) / 2, wrA = (this.wheels[2].omega + this.wheels[3].omega) / 2;
      const c = clamp((wfA - wrA) * 30, -Math.abs(Twheel) * 0.3 - 50, Math.abs(Twheel) * 0.3 + 50);
      wheelT[0] -= c / 2; wheelT[1] -= c / 2; wheelT[2] += c / 2; wheelT[3] += c / 2;
    }

    // ARB pre-pass
    const arbFd = (this.wheels[0].comp - this.wheels[1].comp) * (p.arbF || 0);
    const arbRd = (this.wheels[2].comp - this.wheels[3].comp) * (p.arbR || 0);
    let newDrivenW = 0, newDrivenN = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const M = _v4.copy(w.mount).applyQuaternion(R).add(this.pos);
      world.ground(M.x, M.z, out);
      const nx = out.nx, ny = out.ny, nz = out.nz; w.n.set(nx, ny, nz);
      const nU = nx * up.x + ny * up.y + nz * up.z;
      w.surf = out.surf; w.water = out.water; w.kerb = out.kerb;
      let susLen = w.travel, contact = false, t = 0;
      if (nU > 0.25) {
        t = (M.y - out.h) * ny / nU; susLen = t - w.r;
        if (susLen < w.travel) contact = true;
      }
      w.compPrev = w.comp;
      w.comp = contact ? w.travel - susLen : 0;
      const cVel = (w.comp - w.compPrev) / h;
      w.contact = contact;
      w.wheelY = -(contact ? Math.max(0, susLen) : w.travel);
      // rotational integration even airborne
      const steerA = w.steer + w.toe;
      const cs = Math.cos(steerA), sn = Math.sin(steerA);
      const wf = new THREE.Vector3().copy(fwd).multiplyScalar(cs).addScaledVector(left, sn);
      let brakeIn = brake * (w.front ? p.bias : 1 - p.bias) * 2;
      if (inp.handbrake > 0 && !w.front) brakeIn = Math.max(brakeIn, inp.handbrake * 1.6);
      brakeIn += stmBrake[i];
      let Tb = p.brakeT * brakeIn * brakeFade(w) * 0.5;
      if (!w.front && inp.handbrake > 0) Tb = Math.max(Tb, p.brakeT * inp.handbrake * 0.9);
      if (!contact) {
        const Iw = w.I + (w.driven ? addInertia / nDrivenAxle : 0);
        let om = w.omega + wheelT[i] / Iw * h; const dB = Tb / Iw * h; om = Math.abs(om) <= dB ? 0 : om - Math.sign(om) * dB; om *= 0.999; w.omega = om;
        w.Fz = 0; w.Fx = 0; w.Fy = 0; w.slipK = 0; w.slipA = 0; w.slipVel = 0;
        if (w.driven) { newDrivenW += om * (this.drive === 'AWD' ? (w.front ? this.awd : 1 - this.awd) * 2 : 1); newDrivenN++; }
        w.rot += w.omega * h; continue;
      }
      this.onGround = true;
      // suspension force
      const arb = w.front ? (w.left ? arbFd : -arbFd) : (w.left ? arbRd : -arbRd);
      const damp = cVel > 0 ? w.c * cVel : w.c * w.reb * 1.4 * cVel;
      let Fs = w.k * (w.comp + w.pre) + damp + arb;
      if (w.comp > w.travel * 0.95) Fs += (w.comp - w.travel * 0.95) * w.k * 12 + Math.max(0, cVel) * w.c * 2;
      Fs = Math.max(0, Fs);
      const Fz = Fs * nU;
      w.Fz = Fz;
      // contact point & velocity
      const C = w.cp.copy(M).addScaledVector(up, -t);
      const rC = new THREE.Vector3().subVectors(C, this.pos);
      const vC = new THREE.Vector3().crossVectors(this.angVel, rC).add(this.vel);
      const nVec = w.n;
      wf.addScaledVector(nVec, -wf.dot(nVec)).normalize();
      const wl = new THREE.Vector3().crossVectors(nVec, wf);
      const vx = vC.dot(wf), vy = vC.dot(wl);
      // grip
      const fam = surfaceFamily(w.surf);
      let mu = comp.mu * comp[fam] * w.surf.mu * (p.sigMu || 1) * Math.pow(p.tireWidth || 1, 0.3);
      if (fam === 'paved') mu *= lerp(1, w.surf === SURF.salt ? 0.85 : 0.78, wet);
      if (snowCov > 0 && fam !== 'snow') mu = lerp(mu, comp.mu * comp.snow * SURF.snow.mu, snowCov * 0.6);
      if (w.water > 0) mu *= 1 - clamp(w.water * Math.abs(vx) / 25, 0, 0.65);
      const loadS = clamp(1 - 0.13 * (Fz / w.Fz0 - 1), 0.7, 1.12);
      const tempF = 1 - clamp(((w.temp - comp.optT) / 55) ** 2, 0, 1) * 0.18;
      const wearF = 1 - w.wear * 0.3;
      const presF = 1 - 0.1 * (w.pressure - 2.1) ** 2;
      const cam = w.camber; const camLat = 1 + 0.022 * clamp(-cam, 0, 3) - 0.009 * cam * cam + (w.front ? 0.003 * ((p.caster || 5) - 5) : 0);
      const camLong = 1 - 0.012 * cam * cam;
      const muBase = mu * loadS * tempF * wearF * presF;
      const V0 = 3.0; const den = Math.max(Math.abs(vx), V0);
      let kpk = this.kpk * (fam === 'loose' ? 1.4 : 1) * (1 + (2.2 - w.pressure) * 0.15), apk = this.apk * (fam === 'loose' ? 1.3 : 1);
      const Clong = fam === 'paved' ? 1.65 : 1.35, Clat = fam === 'paved' ? 1.45 : 1.25;
      const slipA = Math.atan2(vy, den);
      // implicit wheel spin integration with ABS
      const Iw = w.I + (w.driven ? addInertia / nDrivenAxle : 0);
      const k0 = (w.omega * w.r - vx) / den;
      if (A.abs > 0 && brakeIn > 0.05 && k0 < -kpk * 1.05) Tb *= 1 - A.abs * 0.9;
      tireForce(k0, slipA, Fz, muBase, kpk, apk, Clong, Clat, _tf);
      tireForce(k0 + 0.002, slipA, Fz, muBase, kpk, apk, Clong, Clat, _tf2);
      const dFdk = Math.max(0, (_tf2[0] - _tf[0]) / 0.002) * camLong;
      const kw = dFdk * w.r / den; // dFx/domega
      const Fx0 = _tf[0] * camLong;
      const roll = (w.surf.roll + (w.water > 0 ? 0.05 : 0)) * Fz * Math.sign(w.omega) * w.r * (p.tirePF ? 2.2 / w.pressure : 1);
      const denomI = Iw + h * w.r * kw;
      let om = w.omega + h * (wheelT[i] - w.r * Fx0 - roll) / denomI;
      const dB = Tb * h / denomI;
      if (Math.abs(om) <= dB) om = 0; else om -= Math.sign(om) * dB;
      w.omega = om; w.rot += om * h;
      if (w.driven) { newDrivenW += om * (this.drive === 'AWD' ? (w.front ? this.awd : 1 - this.awd) * 2 : 1); newDrivenN++; }
      const k1 = (om * w.r - vx) / den;
      tireForce(k1, slipA, Fz, muBase, kpk, apk, Clong, Clat, _tf);
      let Fx = _tf[0] * camLong, Fy = _tf[1] * camLat;
      // low speed lateral damping to settle
      if (Math.abs(vx) < 1.5 && Math.abs(vy) < 1.5 && throttle < 0.05) { Fy -= vy * this.mass * 0.25; Fx -= (brake > 0.1 || inp.handbrake > 0.1 ? vx * this.mass * 0.3 : 0); }
      w.Fx = Fx; w.Fy = Fy; w.slipK = k1; w.slipA = slipA;
      const slipVx = om * w.r - vx; w.slipVel = Math.sqrt(slipVx * slipVx + vy * vy);
      const slipPow = Math.abs(Fx * slipVx) + Math.abs(Fy * vy);
      slipPowTot += slipPow;
      // tire temp & wear
      w.temp += (slipPow * 0.00018 + Fz * Math.abs(vx) * 0.0000015 - (w.temp - this.ambientT) * (0.004 + 0.0004 * Math.abs(vx)) * (1 + wet * 2)) * h;
      if (A.wear) w.wear = clamp(w.wear + slipPow * 1.2e-7 * comp.wearRate * h, 0, 1);
      w.brakeTemp += (Tb * Math.abs(om) * 0.00009 - (w.brakeTemp - this.ambientT) * 0.012 * (1 + Math.abs(vx) / 30)) * h;
      // apply forces at contact (lateral raised toward roll centre)
      const F = new THREE.Vector3().addScaledVector(wf, Fx).addScaledVector(wl, Fy);
      const Fsus = new THREE.Vector3().copy(up).multiplyScalar(Fs);
      force.add(F).add(Fsus);
      const rApp = rC.clone().addScaledVector(up, 0.18 + this.cgh * 0.35);
      torque.add(new THREE.Vector3().crossVectors(rApp, F));
      torque.add(new THREE.Vector3().crossVectors(rC, Fsus));
      if (w.front) fwSum += Fz; else rwSum += Fz;
    }
    // engine speed in locked mode follows wheels
    if (!isEV && e.locked && newDrivenN) { e.omega = Math.abs(newDrivenW / newDrivenN * G_r); if (e.omega > limW * 1.05) e.omega = limW * 1.05; }
    e.rpm = e.omega * 60 / TAU; if (!isEV && e.rpm < (p.idle || 0) * 0.7) e.rpm = (p.idle || 0) * 0.7;
    e.load = clamp(Teng / Math.max(1, p.nm), -0.3, 1);
    this.slipPower = slipPowTot;

    // ---------- aero ----------
    const v2 = vF * vF; const aeroLoss = dmgOn ? 1 - (dm.front + dm.rear) * 0.2 : 1;
    const dragF = new THREE.Vector3().copy(this.vel).multiplyScalar(-0.5 * RHO * p.cd * p.area * spd);
    force.add(dragF);
    const dfF = 0.5 * RHO * p.clF * p.area * v2 * aeroLoss, dfR = 0.5 * RHO * p.clR * p.area * v2 * aeroLoss;
    const pF = new THREE.Vector3().copy(fwd).multiplyScalar(this.wheels[0].mount.z), pR = new THREE.Vector3().copy(fwd).multiplyScalar(this.wheels[2].mount.z);
    const dF = new THREE.Vector3().copy(up).multiplyScalar(-dfF), dR = new THREE.Vector3().copy(up).multiplyScalar(-dfR);
    force.add(dF).add(dR); torque.add(new THREE.Vector3().crossVectors(pF, dF)).add(new THREE.Vector3().crossVectors(pR, dR));
    // surface drag (sand, water, mud)
    let sDrag = 0; this.wheels.forEach((w) => { if (w.contact) sDrag += w.surf.drag * 0.25 + w.water * 0.6; });
    if (sDrag > 0) force.addScaledVector(this.vel, -sDrag * this.mass * 0.06 * Math.min(1, spd / 4));
    // water submersion
    const waterY = world.waterLevel ?? 0;
    if (this.pos.y - this.cgh < waterY) { const depth = waterY - (this.pos.y - this.cgh); force.addScaledVector(this.vel, -this.mass * 0.6 * clamp(depth, 0, 2)); force.y += this.mass * G * clamp(depth / 1.6, 0, 0.9); this.inWater = depth; } else this.inWater = 0;

    // ---------- chassis contact with ground (rollovers, landings) ----------
    for (const bp of this.bodyPts) {
      const P = _v4.copy(bp).applyQuaternion(R).add(this.pos);
      world.ground(P.x, P.z, out);
      const pen = out.h - P.y;
      if (pen > 0) {
        const n = new THREE.Vector3(out.nx, out.ny, out.nz);
        const r = new THREE.Vector3().subVectors(P, this.pos);
        const v = new THREE.Vector3().crossVectors(this.angVel, r).add(this.vel);
        const vn = v.dot(n);
        const Fn = Math.max(0, this.mass * 700 * Math.min(pen, 0.5) + (vn < 0 ? -vn * this.mass * 35 : 0));
        const vt = v.addScaledVector(n, -vn); const Ft = vt.lengthSq() > 1e-4 ? vt.normalize().multiplyScalar(-Fn * 0.5) : new THREE.Vector3();
        const Fc = n.multiplyScalar(Fn).add(Ft);
        force.add(Fc); torque.add(new THREE.Vector3().crossVectors(r, Fc));
        if (vn < -4) this.events.push({ t: 'scrape', amt: -vn });
      }
    }

    // ---------- integrate ----------
    this.vel.addScaledVector(force, h * this.invMass);
    // angular in body frame
    const qInv = _q.copy(R).invert();
    const wb = this.angVel.clone().applyQuaternion(qInv); const tb = torque.applyQuaternion(qInv);
    const I = this.I, iI = this.invI;
    const Iw = new THREE.Vector3(I.x * wb.x, I.y * wb.y, I.z * wb.z); const gyro = new THREE.Vector3().crossVectors(wb, Iw);
    wb.x += (tb.x - gyro.x) * iI.x * h; wb.y += (tb.y - gyro.y) * iI.y * h; wb.z += (tb.z - gyro.z) * iI.z * h;
    // bikes: lean stabilizer (virtual rider) keeps them upright into turns
    if (p.cat === 'BIKE') { const lean = Math.atan2(left.y, up.y); wb.z += (-lean * 8 - wb.z * 2) * h; }
    wb.multiplyScalar(1 - 0.02 * h);
    this.angVel.copy(wb.applyQuaternion(R));
    if (!this.onGround) this.angVel.multiplyScalar(1 - 0.15 * h);
    this.pos.addScaledVector(this.vel, h);
    const w = this.angVel; const dq = new THREE.Quaternion(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0).multiply(R);
    R.x += dq.x; R.y += dq.y; R.z += dq.z; R.w += dq.w; R.normalize();
    // stats
    this.airTime = this.onGround ? 0 : this.airTime + h;
    this.driftAngle = spd > 5 ? Math.atan2(vL, Math.abs(vF)) : 0;
    this.upsideTime = up.y < 0.2 ? this.upsideTime + h : 0;
    this.frontLoad = fwSum; this.rearLoad = rwSum;
    if (!isFinite(this.pos.x) || !isFinite(this.vel.x)) { this.pos.copy(this.prevPos); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.quat.identity(); }
  }
  drivenOmega() { let s = 0, n = 0; this.wheels.forEach((w) => { if (w.driven) { s += w.omega; n++; } }); return n ? s / n : 0; }
  maxDrivenSlip() { let m = 0; this.wheels.forEach((w) => { if (w.driven && w.contact) m = Math.max(m, w.slipK); }); return m; }
  applyImpulse(J, point) {
    this.vel.addScaledVector(J, this.invMass);
    const r = _v4.subVectors(point, this.pos); const tq = new THREE.Vector3().crossVectors(r, J);
    const qInv = _q.copy(this.quat).invert(); tq.applyQuaternion(qInv); tq.x *= this.invI.x; tq.y *= this.invI.y; tq.z *= this.invI.z; tq.applyQuaternion(this.quat);
    this.angVel.add(tq);
  }
  effMass(point, n) {
    const r = new THREE.Vector3().subVectors(point, this.pos); const rn = new THREE.Vector3().crossVectors(r, n);
    const qInv = _q.copy(this.quat).invert(); const b = rn.clone().applyQuaternion(qInv); b.x *= this.invI.x; b.y *= this.invI.y; b.z *= this.invI.z; b.applyQuaternion(this.quat);
    return 1 / (this.invMass + rn.dot(b));
  }
  // capsule axis endpoints in XZ (world)
  capsule(pos = this.pos) {
    const f = _v1.set(0, 0, 1).applyQuaternion(this.quat); f.y = 0; f.normalize();
    return [pos.x + f.x * this.capHalf, pos.z + f.z * this.capHalf, pos.x - f.x * this.capHalf, pos.z - f.z * this.capHalf];
  }
  addDamage(localPoint, amount) {
    if (this.assists.damage === 'off') return;
    const z = localPoint.z, x = localPoint.x; const a = clamp(amount * (this.p.dmgMul || 1), 0, 0.5);
    if (Math.abs(z) > Math.abs(x) * 1.2) { if (z > 0) this.damage.front = clamp(this.damage.front + a, 0, 1); else this.damage.rear = clamp(this.damage.rear + a, 0, 1); }
    else if (x > 0) this.damage.left = clamp(this.damage.left + a, 0, 1); else this.damage.right = clamp(this.damage.right + a, 0, 1);
    this.dmgHits.push({ p: localPoint.clone(), a });
  }
  repair() { this.damage = { front: 0, rear: 0, left: 0, right: 0 }; this.dmgHits = []; this.repaired = true; this.wheels.forEach((w) => { w.wear = 0; }); }
}

// ---------------------------------------------------------------------
// Collision: swept capsule vs world colliders (circle/obb) + vehicles
// ---------------------------------------------------------------------
function closestSegPt(ax, az, bx, bz, px, pz, out) {
  const dx = bx - ax, dz = bz - az; const L = dx * dx + dz * dz; let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = clamp(t, 0, 1);
  out[0] = ax + dx * t; out[1] = az + dz * t; out[2] = t; return out;
}
const _cp = [0, 0, 0];
function segVsCircle(seg, c, r) {
  closestSegPt(seg[0], seg[1], seg[2], seg[3], c.x, c.z, _cp);
  const dx = _cp[0] - c.x, dz = _cp[1] - c.z; const d = Math.hypot(dx, dz); const rr = r + c.r;
  if (d >= rr) return null; const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
  return { nx, nz, pen: rr - d, px: _cp[0] - nx * r, pz: _cp[1] - nz * r };
}
function segVsBox(seg, b, r) {
  // to box local
  const toL = (x, z) => { const dx = x - b.x, dz = z - b.z; return [dx * b.c + dz * b.s, -dx * b.s + dz * b.c]; };
  const [ax, az] = toL(seg[0], seg[1]), [bx, bz] = toL(seg[2], seg[3]);
  const distAt = (t) => { const px = ax + (bx - ax) * t, pz = az + (bz - az) * t; const qx = clamp(px, -b.hx, b.hx), qz = clamp(pz, -b.hz, b.hz); return [Math.hypot(px - qx, pz - qz), px, pz, qx, qz]; };
  let lo = 0, hi = 1; for (let i = 0; i < 14; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (distAt(m1)[0] < distAt(m2)[0]) hi = m2; else lo = m1; }
  const [d, px, pz, qx, qz] = distAt((lo + hi) / 2);
  if (d >= r) return null;
  let lnx, lnz, pen;
  if (d < 1e-4) { const ex = b.hx - Math.abs(px), ez = b.hz - Math.abs(pz); if (ex < ez) { lnx = Math.sign(px) || 1; lnz = 0; pen = ex + r; } else { lnx = 0; lnz = Math.sign(pz) || 1; pen = ez + r; } }
  else { lnx = (px - qx) / d; lnz = (pz - qz) / d; pen = r - d; }
  const nx = lnx * b.c - lnz * b.s, nz = lnx * b.s + lnz * b.c;
  const wx = b.x + qx * b.c - qz * b.s, wz = b.z + qx * b.s + qz * b.c;
  return { nx, nz, pen, px: wx, pz: wz };
}
// returns list of contact events
export function collideWorld(car, world, h, onHit) {
  if (car.ghost) return;
  const dx = car.pos.x - car.prevPos.x, dz = car.pos.z - car.prevPos.z; const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (car.capR * 0.5)));
  const r = car.capR; const yb = car.pos.y - car.cgh, yt = yb + car.p.hgt;
  const qr = car.capHalf + r + dist + 2;
  const cols = world.queryColliders(car.pos.x - dx * 0.5, car.pos.z - dz * 0.5, qr);
  if (!cols.length) return;
  const tmp = new THREE.Vector3();
  for (let s = 1; s <= steps; s++) {
    const t = s / steps; tmp.set(car.prevPos.x + dx * t, car.pos.y, car.prevPos.z + dz * t);
    const seg = car.capsule(tmp);
    let hit = null, hitC = null;
    for (const c of cols) {
      if (c.dead || c.y1 < yb || c.y0 > yt) continue;
      const res = c.k === 0 ? segVsCircle(seg, c, r) : segVsBox(seg, c, r);
      if (res && (!hit || res.pen > hit.pen)) { hit = res; hitC = c; }
    }
    if (hit) {
      // breakable scenery: smash through
      if (hitC.breakable) {
        hitC.dead = true; const sp = car.vel.length();
        car.vel.multiplyScalar(clamp(1 - (hitC.mass || 50) / car.mass * 0.8, 0.6, 0.995));
        onHit && onHit({ type: 'smash', col: hitC, speed: sp, x: hit.px, z: hit.pz });
        continue;
      }
      car.pos.x = tmp.x + hit.nx * (hit.pen + 0.01); car.pos.z = tmp.z + hit.nz * (hit.pen + 0.01);
      const n = new THREE.Vector3(hit.nx, 0, hit.nz); const P = new THREE.Vector3(hit.px, car.pos.y, hit.pz);
      const v = new THREE.Vector3().crossVectors(car.angVel, new THREE.Vector3().subVectors(P, car.pos)).add(car.vel);
      const vn = v.dot(n);
      if (vn < 0) {
        const me = car.effMass(P, n); const e = 0.25; const j = -(1 + e) * vn * me;
        const J = n.clone().multiplyScalar(j);
        const vt = v.clone().addScaledVector(n, -vn); const vtl = vt.length();
        if (vtl > 1e-3) { const jt = Math.min(vtl * me * 0.5, j * 0.4); J.addScaledVector(vt, -jt / vtl); }
        car.applyImpulse(J, P);
        const local = P.clone().sub(car.pos).applyQuaternion(_q.copy(car.quat).invert());
        const sev = -vn; if (sev > 3) car.addDamage(local, sev * 0.008);
        onHit && onHit({ type: 'wall', speed: sev, x: hit.px, z: hit.pz, local, col: hitC });
      }
      break;
    }
  }
}
export function collideVehicles(a, b, onHit) {
  if (a.ghost || b.ghost) return;
  if (Math.abs(a.pos.y - b.pos.y) > 2.2) return;
  const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z; const reach = a.capHalf + b.capHalf + a.capR + b.capR;
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return;
  const sa = a.capsule(), sb = b.capsule();
  // segment-segment closest points (2D) via sampling + refine
  let best = 1e9, pa = null, pb = null;
  for (let i = 0; i <= 6; i++) { const t = i / 6; const ax = sa[0] + (sa[2] - sa[0]) * t, az = sa[1] + (sa[3] - sa[1]) * t; closestSegPt(sb[0], sb[1], sb[2], sb[3], ax, az, _cp); const d = Math.hypot(ax - _cp[0], az - _cp[1]); if (d < best) { best = d; pa = [ax, az]; pb = [_cp[0], _cp[1]]; } }
  const rr = a.capR + b.capR; if (best >= rr) return;
  const nx = best > 1e-4 ? (pa[0] - pb[0]) / best : 1, nz = best > 1e-4 ? (pa[1] - pb[1]) / best : 0;
  const pen = rr - best; const n = new THREE.Vector3(nx, 0, nz);
  const ma = a.kinematic ? 0 : 1 / a.mass, mb = b.kinematic ? 0 : 1 / b.mass; const ms = ma + mb || 1;
  a.pos.x += nx * pen * ma / ms; a.pos.z += nz * pen * ma / ms; b.pos.x -= nx * pen * mb / ms; b.pos.z -= nz * pen * mb / ms;
  const P = new THREE.Vector3((pa[0] + pb[0]) / 2, (a.pos.y + b.pos.y) / 2, (pa[1] + pb[1]) / 2);
  const va = new THREE.Vector3().crossVectors(a.angVel, new THREE.Vector3().subVectors(P, a.pos)).add(a.vel);
  const vb = new THREE.Vector3().crossVectors(b.angVel, new THREE.Vector3().subVectors(P, b.pos)).add(b.vel);
  const vn = va.sub(vb).dot(n);
  if (vn >= 0) return;
  const j = -(1 + 0.3) * vn / ms;
  const J = n.clone().multiplyScalar(j);
  if (!a.kinematic) a.applyImpulse(J.clone().multiplyScalar(0.7), P), a.vel.addScaledVector(J, ma * 0.3);
  if (!b.kinematic) b.applyImpulse(J.clone().multiplyScalar(-0.7), P), b.vel.addScaledVector(J, -mb * 0.3);
  const sev = -vn;
  if (sev > 3) { if (a.addDamage) a.addDamage(P.clone().sub(a.pos).applyQuaternion(_q.copy(a.quat).invert()), sev * 0.006); if (b.addDamage) b.addDamage(P.clone().sub(b.pos).applyQuaternion(_q.copy(b.quat).invert()), sev * 0.006); }
  onHit && onHit({ type: 'car', speed: sev, a, b, x: P.x, z: P.z });
}

// =====================================================================
// INPUT
// =====================================================================
export const ACTIONS = [
  ['throttle', 'Throttle'], ['brake', 'Brake / Reverse'], ['left', 'Steer Left'], ['right', 'Steer Right'], ['handbrake', 'Handbrake'],
  ['clutch', 'Clutch'], ['shiftUp', 'Shift Up'], ['shiftDown', 'Shift Down'], ['camera', 'Change Camera'], ['lookBack', 'Look Back'],
  ['rewind', 'Rewind'], ['reset', 'Reset Car'], ['map', 'Map'], ['pause', 'Pause Menu'], ['photo', 'Photo Mode'],
  ['quickChat', 'Quick Chat'], ['horn', 'Horn'], ['lights', 'Headlights'], ['anna', 'Set Waypoint to Event'], ['replay', 'Instant Replay'],
];
export const DEFAULT_KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], handbrake: ['Space'],
  clutch: ['ShiftLeft'], shiftUp: ['KeyE'], shiftDown: ['KeyQ'], camera: ['KeyC'], lookBack: ['KeyB'], rewind: ['KeyR'], reset: ['Backspace'],
  map: ['KeyM'], pause: ['Escape'], photo: ['KeyP'], quickChat: ['KeyT'], horn: ['KeyH'], lights: ['KeyL'], anna: ['KeyG'], replay: ['KeyY'],
};
// gamepad standard mapping: buttons index, axes as 'a<idx><+/->'
export const DEFAULT_PAD = {
  throttle: ['b7'], brake: ['b6'], left: ['a0-'], right: ['a0+'], handbrake: ['b0'], clutch: ['b4'], shiftUp: ['b1'], shiftDown: ['b2'],
  camera: ['b5'], lookBack: ['b11'], rewind: ['b3'], reset: ['b15'], map: ['b8'], pause: ['b9'], photo: ['b14'], quickChat: ['b12'],
  horn: ['b10'], lights: ['b13'], anna: [], replay: [],
};
const MENU_PAD = { up: [12], down: [13], left: [14], right: [15], ok: [0], back: [1], tabL: [4], tabR: [5], alt: [2], alt2: [3], start: [9], select: [8] };

export class Input {
  constructor(settings) {
    this.settings = settings; this.keys = new Set(); this.pressedSet = new Set(); this.prevPadBtn = {}; this.menuEdges = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, lookX: 0, lookY: 0 };
    this.steerK = 0; this.device = 'keyboard'; this.padIndex = -1; this.capture = null; this.mouse = { dx: 0, dy: 0, down: false };
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: 0, active: false };
    this.load(); this.repeatT = {};
    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c({ kind: 'key', code: e.code }); return; }
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
      if (!this.keys.has(e.code)) this.pressedSet.add(e.code);
      this.keys.add(e.code); this.device = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (this.mouse.down || document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('mousedown', (e) => { if (e.button === 2) this.mouse.down = true; });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.mouse.down = false; });
    addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
    this.onPadChange = null;
    addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; this.device = 'gamepad'; this.onPadChange && this.onPadChange('connected', e.gamepad); });
    addEventListener('gamepaddisconnected', (e) => { if (this.padIndex === e.gamepad.index) this.padIndex = -1; this.onPadChange && this.onPadChange('disconnected', e.gamepad); });
  }
  load() {
    try { const b = JSON.parse(localStorage.getItem('fh6_bindings') || 'null'); this.keyMap = { ...DEFAULT_KEYS, ...(b?.keys || {}) }; this.padMap = { ...DEFAULT_PAD, ...(b?.pad || {}) }; }
    catch { this.keyMap = { ...DEFAULT_KEYS }; this.padMap = { ...DEFAULT_PAD }; }
  }
  saveBindings() { localStorage.setItem('fh6_bindings', JSON.stringify({ keys: this.keyMap, pad: this.padMap })); }
  resetBindings() { this.keyMap = { ...DEFAULT_KEYS }; this.padMap = { ...DEFAULT_PAD }; this.saveBindings(); }
  pads() { const out = []; const gp = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of gp) if (g && g.connected) out.push(g); return out; }
  pad() { const gp = navigator.getGamepads ? navigator.getGamepads() : []; if (this.padIndex >= 0 && gp[this.padIndex]) return gp[this.padIndex]; for (const g of gp) if (g && g.connected) { this.padIndex = g.index; return g; } return null; }
  padVal(g, b) {
    if (!g || !b) return 0;
    if (b[0] === 'b') { const btn = g.buttons[+b.slice(1)]; return btn ? (typeof btn === 'object' ? btn.value : btn) : 0; }
    if (b[0] === 'a') { const i = +b.slice(1, -1), s = b.slice(-1) === '+' ? 1 : -1; const v = (g.axes[i] || 0) * s; return Math.max(0, v); }
    return 0;
  }
  curve(x, dz, sat, gamma = 1) { const a = Math.abs(x); if (a < dz) return 0; let t = clamp((a - dz) / Math.max(0.01, sat - dz), 0, 1); t = Math.pow(t, gamma); return t * Math.sign(x); }
  actionKey(a) { const ks = this.keyMap[a] || []; for (const k of ks) if (this.keys.has(k)) return 1; return 0; }
  actionPad(a, g) { let v = 0; for (const b of this.padMap[a] || []) v = Math.max(v, this.padVal(g, b)); return v; }
  // called once per frame
  update(dt, speed = 0) {
    const S = this.settings; const g = this.pad();
    const st = this.state; this.edges = new Set();
    // detect pad activity & edges
    if (g) {
      let any = false;
      g.buttons.forEach((b, i) => { const v = typeof b === 'object' ? b.value : b; const was = this.prevPadBtn[g.index + ':' + i] || 0; if (v > 0.5 && was <= 0.5) { this.edges.add('b' + i); any = true; } this.prevPadBtn[g.index + ':' + i] = v; });
      g.axes.forEach((a, i) => { if (Math.abs(a) > 0.5) any = true; const key = g.index + ':a' + i; const was = this.prevPadBtn[key] || 0; if (a > 0.6 && was <= 0.6) this.edges.add('a' + i + '+'); if (a < -0.6 && was >= -0.6) this.edges.add('a' + i + '-'); this.prevPadBtn[key] = a; });
      if (any) this.device = 'gamepad';
      // multi-pad: switch to any pad with input
      for (const o of this.pads()) if (o.index !== g.index && o.buttons.some((b) => (b.value ?? b) > 0.5)) { this.padIndex = o.index; this.device = 'gamepad'; }
      if (this.capture) { for (const e of this.edges) { const c = this.capture; this.capture = null; c({ kind: 'pad', code: e }); break; } }
    }
    // gameplay analog
    const kbT = this.actionKey('throttle'), kbB = this.actionKey('brake'), kbH = this.actionKey('handbrake'), kbC = this.actionKey('clutch');
    let padT = 0, padB = 0, padS = 0, padH = 0, padC = 0;
    if (g) {
      padT = this.curve(this.actionPad('throttle', g), S.trigDeadzone, S.trigSaturation, 1);
      padB = this.curve(this.actionPad('brake', g), S.trigDeadzone, S.trigSaturation, 1);
      const raw = this.actionPad('right', g) - this.actionPad('left', g);
      padS = this.curve(raw, S.stickDeadzone, S.stickSaturation, S.steerLinearity);
      padH = this.actionPad('handbrake', g); padC = this.actionPad('clutch', g);
    }
    // keyboard steering ramp
    const target = this.actionKey('right') - this.actionKey('left');
    const spdF = clamp(1 - speed / 90, 0.35, 1);
    if (target !== 0) { const rate = (Math.sign(target) !== Math.sign(this.steerK) && this.steerK !== 0 ? 9 : 3.2 * spdF) * S.kbSteerSpeed; this.steerK += clamp(target - this.steerK, -rate * dt, rate * dt); }
    else { const rate = 6 * S.kbSteerSpeed; this.steerK += clamp(-this.steerK, -rate * dt, rate * dt); }
    const T = this.touch;
    st.throttle = Math.max(kbT, padT, T.throttle); st.brake = Math.max(kbB, padB, T.brake);
    st.steer = Math.abs(padS) > 0.02 ? padS : (Math.abs(T.steer) > 0.02 ? T.steer : this.steerK);
    st.handbrake = Math.max(kbH, padH, T.handbrake); st.clutch = Math.max(kbC, padC);
    // look (right stick / mouse)
    let lx = 0, ly = 0;
    if (g) { lx = this.curve(g.axes[2] || 0, 0.15, 0.95) * S.padSens; ly = this.curve(g.axes[3] || 0, 0.15, 0.95) * S.padSens * (S.padInvertY ? -1 : 1); }
    st.lookX = lx; st.lookY = ly; st.mouseDX = this.mouse.dx * S.mouseSens * 0.003; st.mouseDY = this.mouse.dy * S.mouseSens * 0.003 * (S.mouseInvertY ? -1 : 1); this.mouse.dx = 0; this.mouse.dy = 0;
    // digital action edges
    this.actEdges = new Set();
    for (const [a] of ACTIONS) {
      for (const k of this.keyMap[a] || []) if (this.pressedSet.has(k)) this.actEdges.add(a);
      for (const b of this.padMap[a] || []) if (this.edges.has(b)) this.actEdges.add(a);
    }
    if (this.touchPress) { for (const a of this.touchPress) this.actEdges.add(a); this.touchPress.clear(); }
    // menu edges
    this.menu = new Set();
    const mk = { up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], ok: ['Enter', 'Space'], back: ['Escape', 'Backspace'], tabL: ['KeyQ', 'PageUp'], tabR: ['KeyE', 'PageDown'], alt: ['KeyX'], alt2: ['KeyY'] };
    for (const m in mk) for (const k of mk[m]) if (this.pressedSet.has(k)) this.menu.add(m);
    if (g) {
      for (const m in MENU_PAD) for (const i of MENU_PAD[m]) if (this.edges.has('b' + i)) this.menu.add(m);
      // stick navigation with repeat
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0; const now = performance.now();
      const dirs = [['left', ax < -0.6], ['right', ax > 0.6], ['up', ay < -0.6], ['down', ay > 0.6]];
      for (const [d, on] of dirs) { if (on) { if (!this.repeatT[d]) { this.menu.add(d); this.repeatT[d] = now + 380; } else if (now > this.repeatT[d]) { this.menu.add(d); this.repeatT[d] = now + 110; } } else this.repeatT[d] = 0; }
      for (const [d, idx] of [['up', 12], ['down', 13], ['left', 14], ['right', 15]]) { const b = g.buttons[idx]; const on = b && (b.value ?? b) > 0.5; const key = 'd' + d; if (on) { if (!this.repeatT[key]) this.repeatT[key] = now + 380; else if (now > this.repeatT[key]) { this.menu.add(d); this.repeatT[key] = now + 110; } } else this.repeatT[key] = 0; }
    }
    this.pressedSet.clear();
  }
  pressed(a) { return this.actEdges && this.actEdges.has(a); }
  held(a) { const g = this.pad(); return this.actionKey(a) || (g ? this.actionPad(a, g) > 0.5 : 0); }
  menuPressed(m) { return this.menu && this.menu.has(m); }
  rumble(strong, weak, ms) {
    if (!this.settings.rumble || this.device !== 'gamepad') return; const g = this.pad(); if (!g || !g.vibrationActuator) return;
    const s = this.settings.rumble; try { g.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: clamp(weak * s, 0, 1), strongMagnitude: clamp(strong * s, 0, 1) }); } catch { }
  }
  bindingLabel(a, kind) {
    if (kind === 'key') return (this.keyMap[a] || []).map((k) => k.replace('Key', '').replace('Arrow', 'Arrow ').replace('Digit', '')).join(' / ') || '—';
    const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Home'];
    return (this.padMap[a] || []).map((b) => b[0] === 'b' ? names[+b.slice(1)] || b : ('Axis ' + b.slice(1))).join(' / ') || '—';
  }
}

// =====================================================================
// AUDIO
// =====================================================================
export class AudioSys {
  constructor(settings) {
    this.settings = settings; this.ctx = null; this.ready = false; this.voices = new Set(); this.music = null;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
      this.bus = comp;
      this.engineBus = ctx.createGain(); this.engineBus.connect(comp);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(comp);
      this.musicBus = ctx.createGain(); this.musicBus.connect(comp);
      // noise buffer
      const len = ctx.sampleRate * 2; const nb = ctx.createBuffer(1, len, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = nb;
      // continuous layers: tires, wind, surface, rain
      this.layers = {};
      const mkLayer = (name, type, freq, q) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(); this.layers[name] = { f, g }; };
      mkLayer('squeal', 'bandpass', 1100, 6); mkLayer('wind', 'lowpass', 500, 0.7); mkLayer('gravel', 'lowpass', 900, 1); mkLayer('rain', 'highpass', 2500, 0.5); mkLayer('rumble', 'lowpass', 120, 2);
      this.ready = true; this.applyVolumes();
    } catch (e) { console.warn('audio unavailable', e); }
  }
  applyVolumes() {
    if (!this.ctx) return; const S = this.settings;
    this.master.gain.value = S.volMaster; this.engineBus.gain.value = S.volEngine; this.sfxBus.gain.value = S.volSfx; this.musicBus.gain.value = S.volMusic * 0.5;
  }
  layer(name, gain, freq) { if (!this.ready) return; const L = this.layers[name]; const t = this.ctx.currentTime; L.g.gain.setTargetAtTime(gain, t, 0.05); if (freq) L.f.frequency.setTargetAtTime(freq, t, 0.05); }
  burst(dur, type, freq, gain, q = 1, sweepTo = 0, bus) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur); f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || this.sfxBus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, type = 'sine', gain = 0.2, slideTo = 0, bus) {
    if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(bus || this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  ui(kind = 'move') { if (kind === 'move') this.tone(880, 0.05, 'triangle', 0.05); else if (kind === 'ok') { this.tone(660, 0.08, 'triangle', 0.08); this.tone(990, 0.12, 'triangle', 0.06); } else if (kind === 'back') this.tone(440, 0.1, 'triangle', 0.06, 300); else if (kind === 'cash') { [0, 0.07, 0.14].forEach((d, i) => setTimeout(() => this.tone(1200 + i * 300, 0.12, 'square', 0.04), d * 1000)); } else if (kind === 'skill') this.tone(1500, 0.08, 'sine', 0.06, 2200); else if (kind === 'fail') this.tone(300, 0.3, 'sawtooth', 0.06, 120); }
  impact(sev) { this.burst(0.25 + sev * 0.01, 'lowpass', 400 + sev * 60, clamp(sev / 25, 0.1, 0.9), 0.8); this.tone(70, 0.3, 'sine', clamp(sev / 30, 0.05, 0.6), 35); }
  smash() { this.burst(0.35, 'bandpass', 1400, 0.4, 0.8, 300); this.tone(110, 0.2, 'triangle', 0.25, 60); }
  shift(up) { this.tone(up ? 90 : 70, 0.07, 'square', 0.12, 40); this.burst(0.05, 'highpass', 3000, 0.1, 1); }
  bov(amt) { this.burst(0.45, 'bandpass', 3500, 0.25 * amt, 2.5, 900); }
  pop() { this.burst(0.05 + Math.random() * 0.05, 'bandpass', 600 + Math.random() * 900, 0.35 + Math.random() * 0.3, 1.5); this.tone(60 + Math.random() * 40, 0.06, 'square', 0.15, 40); }
  horn(style = 0) {
    if (!this.ready) return; const sets = [[392, 494], [233, 293], [523, 659, 784], [110, 138], [600, 900], [523, 659, 784, 1046], [500, 520]];
    const fr = sets[style % sets.length]; fr.forEach((f, i) => { const d = style === 2 || style === 5 ? i * 0.12 : 0; setTimeout(() => this.tone(f, 0.45, style === 6 ? 'sawtooth' : 'square', 0.06), d * 1000); });
  }
  thunder() { this.burst(2.5, 'lowpass', 220, 0.8, 0.5, 60); }
  whoosh() { this.burst(0.4, 'bandpass', 800, 0.25, 1, 2400); }
  createEngine(spec, opts = {}) { if (!this.ready) return null; const v = new EngineVoice(this, spec, opts); this.voices.add(v); return v; }
  startMusic(station) { if (!this.ready) return; if (this.music) this.music.stop(); this.music = station === 'off' ? null : new MusicGen(this, station); }
}

// Engine voice: PeriodicWave synthesized from firing order (Fourier series of exhaust pulse train)
const waveCache = new Map();
function engineWave(ctx, engKey, seed, loud) {
  const key = engKey + ':' + seed + ':' + (loud > 0.3 ? 1 : 0); if (waveCache.has(key)) return waveCache.get(key);
  const E = ENGINES[engKey]; const N = 96; const real = new Float32Array(N), imag = new Float32Array(N);
  const rnd = mulberry32(seed);
  const jit = E.fire.map(() => (rnd() - 0.5) * 6); const amp = E.fire.map(([, a]) => a * (0.92 + rnd() * 0.16));
  const width = E.cyl >= 10 ? 9 : E.cyl >= 6 ? 7 : 5.5;
  for (let n = 1; n < N; n++) {
    let a = 0, b = 0;
    E.fire.forEach(([ang], i) => { const th = (ang + jit[i]) / 720 * TAU; a += amp[i] * Math.cos(n * th); b += amp[i] * Math.sin(n * th); });
    const env = Math.exp(-((n / (E.cyl * width)) ** 2)) * (1 + (loud > 0.3 ? 0.4 : 0) * (n > E.cyl * 2 ? 1 : 0)) + 0.02 / n;
    real[n] = a * env; imag[n] = b * env;
  }
  // body resonance: add low cycle-rate harmonics for burble
  real[1] += 0.3; real[2] += 0.25;
  const w = ctx.createPeriodicWave(real, imag); waveCache.set(key, w); return w;
}
class EngineVoice {
  constructor(audio, spec, opts) {
    const ctx = audio.ctx; this.audio = audio; this.spec = spec; this.ev = spec.asp === 'EV';
    this.out = ctx.createGain(); this.out.gain.value = 0;
    if (opts.spatial) { this.pan = ctx.createPanner(); this.pan.panningModel = 'equalpower'; this.pan.distanceModel = 'inverse'; this.pan.refDistance = 8; this.pan.rolloffFactor = 1.4; this.out.connect(this.pan); this.pan.connect(audio.engineBus); }
    else this.out.connect(audio.engineBus);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 1.6;
    this.shaper = ctx.createWaveShaper(); this.setDrive(1.5);
    this.pre = ctx.createGain(); this.pre.gain.value = 0.8;
    this.pre.connect(this.shaper); this.shaper.connect(this.filter); this.filter.connect(this.out);
    if (!this.ev) {
      this.osc = ctx.createOscillator(); this.osc.setPeriodicWave(engineWave(ctx, spec.eng, strHash(spec.name || 'x') % 1000, spec.loud || 0)); this.osc.connect(this.pre); this.osc.start();
      this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.subG = ctx.createGain(); this.subG.gain.value = 0.2; this.sub.connect(this.subG); this.subG.connect(this.filter); this.sub.start();
    } else {
      this.osc = ctx.createOscillator(); this.osc.type = 'sine'; this.osc2 = ctx.createOscillator(); this.osc2.type = 'triangle';
      const g2 = ctx.createGain(); g2.gain.value = 0.25; this.osc.connect(this.pre); this.osc2.connect(g2); g2.connect(this.pre); this.osc.start(); this.osc2.start();
    }
    // intake noise
    this.nz = ctx.createBufferSource(); this.nz.buffer = audio.noise; this.nz.loop = true; this.nzF = ctx.createBiquadFilter(); this.nzF.type = 'bandpass'; this.nzF.Q.value = 1.2; this.nzG = ctx.createGain(); this.nzG.gain.value = 0;
    this.nz.connect(this.nzF); this.nzF.connect(this.nzG); this.nzG.connect(this.out); this.nz.start();
    // turbo whistle
    if (spec.boost > 0 && spec.asp !== 'S') { this.tw = ctx.createOscillator(); this.tw.type = 'sine'; this.twG = ctx.createGain(); this.twG.gain.value = 0; this.tw.connect(this.twG); this.twG.connect(this.out); this.tw.start(); }
    if (spec.asp === 'S') { this.sc = ctx.createOscillator(); this.sc.type = 'sawtooth'; this.scG = ctx.createGain(); this.scG.gain.value = 0; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 3; this.sc.connect(f); f.connect(this.scG); this.scG.connect(this.out); this.sc.start(); }
    this.lastThrottle = 0; this.crackleT = 0;
  }
  setDrive(k) { const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } this.shaper.curve = c; this.drive = k; }
  update(rpm, throttle, load, boost, vol = 1, pos = null, dt = 0.016) {
    const ctx = this.audio.ctx, t = ctx.currentTime, sp = this.spec; const rf = clamp(rpm / sp.limiter, 0, 1.1);
    if (!this.ev) {
      const f0 = Math.max(4, rpm / 120);
      this.osc.frequency.setTargetAtTime(f0, t, 0.012); this.sub.frequency.setTargetAtTime(f0 * Math.max(1, sp.cyl / 2) * 0.5, t, 0.015);
      const cutoff = 300 + rf * 2600 + throttle * (1800 + (sp.loud || 0) * 3000);
      this.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
      const g = (0.16 + throttle * 0.32 + rf * 0.2) * (1 + (sp.loud || 0) * 0.5) * vol;
      this.out.gain.setTargetAtTime(g, t, 0.04);
      const d = 1.2 + throttle * load * 2.8; if (Math.abs(d - this.drive) > 0.4) this.setDrive(d);
      this.nzF.frequency.setTargetAtTime(400 + rf * 2500, t, 0.05); this.nzG.gain.setTargetAtTime(throttle * 0.12 * rf, t, 0.05);
      if (this.tw) { this.tw.frequency.setTargetAtTime(2500 + boost * 5500 + rf * 1500, t, 0.05); this.twG.gain.setTargetAtTime(boost * boost * 0.05, t, 0.08); }
      if (this.sc) { this.sc.frequency.setTargetAtTime(rpm / 60 * 3, t, 0.02); this.scG.gain.setTargetAtTime(rf * 0.06 * (0.3 + throttle), t, 0.05); }
      // overrun crackle
      if (sp.crackle && this.lastThrottle > 0.6 && throttle < 0.1 && rf > 0.55) this.crackleT = 0.8;
      if (this.crackleT > 0) { this.crackleT -= dt; if (Math.random() < dt * 14 * this.crackleT) { this.audio.pop(); this.popped = true; } }
    } else {
      const f = 60 + rpm * 0.12; this.osc.frequency.setTargetAtTime(f, t, 0.02); this.osc2.frequency.setTargetAtTime(f * 2.5, t, 0.02);
      this.filter.frequency.setTargetAtTime(1500 + rf * 4000, t, 0.05);
      this.out.gain.setTargetAtTime((0.04 + throttle * 0.12 + rf * 0.08) * vol, t, 0.05);
      this.nzF.frequency.setTargetAtTime(1200 + rf * 3000, t, 0.05); this.nzG.gain.setTargetAtTime(rf * 0.05, t, 0.05);
    }
    this.lastThrottle = throttle;
    if (pos && this.pan) { this.pan.positionX.setTargetAtTime(pos.x, t, 0.05); this.pan.positionY.setTargetAtTime(pos.y, t, 0.05); this.pan.positionZ.setTargetAtTime(pos.z, t, 0.05); }
  }
  stop() { try { const t = this.audio.ctx.currentTime; this.out.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { [this.osc, this.osc2, this.sub, this.nz, this.tw, this.sc].forEach((o) => { try { o && o.stop(); } catch { } }); this.out.disconnect(); }, 300); } catch { } this.audio.voices.delete(this); }
}

// Simple procedural radio
class MusicGen {
  constructor(audio, station) {
    this.audio = audio; this.station = station; this.ctx = audio.ctx; this.next = this.ctx.currentTime + 0.1; this.step = 0; this.alive = true;
    this.bpm = station === 'bass' ? 172 : station === 'rock' ? 132 : 118;
    this.prog = station === 'bass' ? [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]] : station === 'rock' ? [[52, 56, 59], [57, 61, 64], [59, 63, 66], [57, 61, 64]] : [[57, 60, 64], [65, 69, 72], [60, 64, 67], [55, 59, 62]];
    this.timer = setInterval(() => this.schedule(), 50);
  }
  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  note(f, t, dur, type, gain, cut = 4000) { const c = this.ctx; const o = c.createOscillator(); o.type = type; o.frequency.value = f; const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(fl); fl.connect(g); g.connect(this.audio.musicBus); o.start(t); o.stop(t + dur + 0.05); }
  drum(t, kind) {
    const c = this.ctx;
    if (kind === 'k') { const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = c.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(this.audio.musicBus); o.start(t); o.stop(t + 0.25); }
    else { const s = c.createBufferSource(); s.buffer = this.audio.noise; const f = c.createBiquadFilter(); f.type = kind === 'h' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'h' ? 7000 : 1800; const g = c.createGain(); const d = kind === 'h' ? 0.04 : 0.15; g.gain.setValueAtTime(kind === 'h' ? 0.08 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); s.connect(f); f.connect(g); g.connect(this.audio.musicBus); s.start(t, Math.random()); s.stop(t + d + 0.02); }
  }
  schedule() {
    if (!this.alive) return; const spb = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.25) {
      const t = this.next, s = this.step % 16, bar = Math.floor(this.step / 16) % 4; const ch = this.prog[bar];
      if (this.station === 'bass') { if (s === 0 || s === 10) this.drum(t, 'k'); if (s === 4 || s === 12) this.drum(t, 's'); if (s % 2 === 0) this.drum(t, 'h'); if (s % 4 === 0 || s === 7) this.note(this.mtof(ch[0] - 24), t, spb * 3, 'sawtooth', 0.12, 400); }
      else { if (s % 4 === 0) this.drum(t, 'k'); if (s === 4 || s === 12) this.drum(t, 's'); if (s % 2 === 1) this.drum(t, 'h'); if (s % 2 === 0) this.note(this.mtof(ch[0] - 24), t, spb * 1.8, this.station === 'rock' ? 'square' : 'sawtooth', 0.09, 600); }
      if (s % 2 === 0) this.note(this.mtof(ch[(s / 2) % 3] + 12), t, spb * 1.5, 'triangle', 0.035, 3000);
      if (s === 0) ch.forEach((m) => this.note(this.mtof(m), t, spb * 15, 'sawtooth', 0.018, 1200));
      this.next += spb; this.step++;
    }
  }
  stop() { this.alive = false; clearInterval(this.timer); }
}
