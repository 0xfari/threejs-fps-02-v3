// The armoury: four guns and one grenade. Each entry owns its numbers — damage,
// headshot multiplier, magazine, fire rate, spread, reload, price — and the view
// model is built from boxes so every gun reads differently at a glance. Each
// gun also owns its tracer colour, so a firefight reads by weapon at distance.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  P9: {
    id: 'P9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 4, mag: 12, reserve: 48, gap: 0.16, auto: false,
    reload: 1.2, spreadStill: 0.004, spreadMove: 0.03, range: 60, kick: 0.006,
    tracer: 0xffb066,
    desc: 'Reliable sidearm. Free, always in your holster.',
  },
  VK9: {
    id: 'VK9', name: 'VK-9 SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 4, mag: 32, reserve: 96, gap: 0.075, auto: true,
    reload: 1.8, spreadStill: 0.006, spreadMove: 0.034, range: 45, kick: 0.005,
    tracer: 0xffd27a,
    desc: 'Fast close-quarters spray. Shreds at short range, wanders far.',
  },
  AR77: {
    id: 'AR77', name: 'AR-77 Rifle', kind: 'rifle', price: 2700,
    damage: 34, headMult: 4, mag: 30, reserve: 90, gap: 0.096, auto: true,
    reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, range: 80, kick: 0.009,
    tracer: 0x58e6c8,
    desc: 'The workhorse. Stopping to aim pays; spraying on the move does not.',
  },
  LW50: {
    id: 'LW50', name: 'LW-50 Longshot', kind: 'sniper', price: 4750,
    damage: 88, headMult: 4, mag: 5, reserve: 15, gap: 1.15, auto: false,
    reload: 2.6, spreadStill: 0.0006, spreadMove: 0.06, range: 120, kick: 0.03,
    tracer: 0xffe9c4,
    desc: 'One shot, one kill on an unarmoured chest. Right-click to scope.',
  },
};

export const GRENADE_PRICE = 300;
export const SMOKE_PRICE = 300;
export const FLASH_PRICE = 250;
export const ARMOR_PRICE = 650;

function buildViewModel(kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#221f1c'), roughness: 0.6, metalness: 0.35 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5c564c'), roughness: 0.45, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a25e'), roughness: 0.4, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8, metalness: 0.05 });
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (kind === 'pistol') {
    part(0.06, 0.09, 0.26, 0, 0, -0.1, metal);
    part(0.05, 0.12, 0.07, 0, -0.07, 0.02, grip);
    part(0.02, 0.03, 0.02, 0, 0.055, -0.2, accent);
  } else if (kind === 'smg') {
    part(0.08, 0.09, 0.4, 0, 0, -0.08, metal);
    part(0.04, 0.04, 0.34, 0, 0.02, -0.36, dark);
    part(0.06, 0.14, 0.06, 0, -0.09, 0.02, grip);
    part(0.05, 0.1, 0.05, 0, -0.06, -0.16, dark);
  } else if (kind === 'sniper') {
    part(0.07, 0.08, 0.55, 0, 0, -0.14, metal);
    part(0.05, 0.05, 0.5, 0, 0.02, -0.4, dark);
    part(0.05, 0.06, 0.12, 0, 0.07, -0.1, dark);
    part(0.06, 0.12, 0.06, 0, -0.08, 0.06, grip);
    part(0.09, 0.09, 0.2, 0, -0.01, 0.22, grip);
  } else {
    part(0.09, 0.1, 0.42, 0, 0, -0.1, metal);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.42, dark);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.26, grip);
    part(0.06, 0.12, 0.06, 0, -0.09, 0.0, grip);
    part(0.05, 0.04, 0.14, 0, 0.07, -0.12, dark);
  }
  return model;
}

export function createWeapon(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.2, -1.12);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.2, -0.75);
  camera.add(flashLight);

  const models = {};
  const ammo = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def.kind);
    models[def.id].scale.setScalar(0.8);
    models[def.id].position.set(0.26, -0.23, -0.55);
    models[def.id].visible = false;
    camera.add(models[def.id]);
    ammo[def.id] = { mag: def.mag, reserve: def.reserve };
  }
  models.P9.visible = true;

  const state = {
    current: 'P9', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    scoped: false, bobPhase: 0, grenades: 0, armor: false,
  };

  function def() { return WEAPONS[state.current]; }
  function model() { return models[state.current]; }

  return {
    state,
    WEAPONS,
    ammo,
    def,
    equip(id) {
      if (!WEAPONS[id] || state.current === id || state.reloadLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      state.scoped = false;
      models[id].visible = true;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    own(id) {
      return id === 'P9' || ammo[id].owned === true;
    },
    buy(id) {
      if (!WEAPONS[id] || ammo[id].owned) return false;
      ammo[id].owned = true;
      return true;
    },
    refillAll() {
      for (const d of Object.values(WEAPONS)) {
        ammo[d.id].mag = d.mag;
        ammo[d.id].reserve = d.reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
    },
    step(dt, moving, scoped) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      state.scoped = scoped;
      const m = model();
      state.bobPhase += dt * (moving ? 11 : 4);
      const bob = moving ? Math.sin(state.bobPhase) * 0.008 : 0;
      const targetZ = state.scoped ? -0.42 : -0.55 + state.kick;
      const targetX = state.scoped ? 0 : 0.26;
      const targetY = state.scoped ? -0.145 : -0.23 + bob;
      m.position.x += (targetX - m.position.x) * Math.min(1, dt * 18);
      m.position.y += (targetY - m.position.y) * Math.min(1, dt * 18);
      m.position.z += (targetZ - m.position.z) * Math.min(1, dt * 18);
      m.rotation.x = state.kick * 2.2 + (state.reloadLeft > 0 ? -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2) : 0);
      flash.visible = state.flash > 0;
      if (state.flash > 0) flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        if (state.reloadLeft === 0) {
          const d = def();
          const a = ammo[d.id];
          const need = d.mag - a.mag;
          const take = Math.min(need, a.reserve);
          a.mag += take;
          a.reserve -= take;
        }
      }
    },
    ready() {
      const d = def();
      return ammo[d.id].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = def().kind === 'sniper' ? 0.09 : 0.055;
    },
    takeRound() {
      const a = ammo[state.current];
      if (a.mag <= 0) return false;
      a.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      const a = ammo[d.id];
      if (state.reloadLeft > 0 || a.mag === d.mag || a.reserve === 0) return false;
      state.reloadLeft = d.reload;
      return true;
    },
    spread(speed) {
      const d = def();
      const moveFactor = Math.min(1, speed / 5.2);
      const scopedFactor = state.scoped ? 0.35 : 1;
      return (d.spreadStill + moveFactor * d.spreadMove) * scopedFactor;
    },
    mag() { return ammo[state.current].mag; },
    reserve() { return ammo[state.current].reserve; },
  };
}
