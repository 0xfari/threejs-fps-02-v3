// The HE grenade, the smoke grenade and the flashbang: arcing, bouncing
// projectiles with a fuse. The HE one ends in a radius blast; the smoke one
// blooms into a grey cloud that hangs for twelve seconds and blocks sight —
// bots cannot spot through it and shots fired through it hit nothing. The
// flashbang pops white: anything looking at the pop is blinded, bots lose
// their sight entirely for a couple of seconds and the player's screen whites
// out. Physics are simple on purpose — gravity, a damped bounce off the
// world's boxes, and damage that falls off with distance. No new objects in
// the hot loop: one reusable probe box, and the smoke test is plain arithmetic
// on the segment.
import * as THREE from 'three';

const GRAVITY = 16;
const FUSE = 1.6;
const BLAST_RADIUS = 7;
const BLAST_DAMAGE = 95;
const SMOKE_SECONDS = 12;
const SMOKE_RADIUS = 3.2;
const FLASH_RADIUS = 26;
const FLASH_FULL_SECONDS = 2.4;
const FLASH_GLANCE_SECONDS = 0.8;

export function createGrenades(scene, world) {
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.5, metalness: 0.5 });
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);
  const blastMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.7, depthWrite: false });
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
  const probe = new THREE.Box3();
  const list = [];
  const clouds = [];

  function throwGrenade(origin, direction) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(origin);
    scene.add(mesh);
    list.push({
      kind: 'he',
      mesh,
      pos: mesh.position,
      vel: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: FUSE,
      bounced: 0,
    });
  }

  // A smoke canister: same arc as the HE grenade, but it blooms instead of
  // exploding. Three overlapping spheres read as one cloud at a glance.
  function throwSmoke(origin, direction) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(origin);
    scene.add(mesh);
    list.push({
      kind: 'smoke',
      mesh,
      pos: mesh.position,
      vel: direction.clone().multiplyScalar(14).add(new THREE.Vector3(0, 5.5, 0)),
      fuse: FUSE,
      bounced: 0,
    });
  }

  // A flashbang: same arc, but it pops white instead of blooming or
  // exploding. The pop itself is reported to the loop, which works out who
  // was looking at it and for how long they stay blind.
  function throwFlash(origin, direction) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(origin);
    scene.add(mesh);
    list.push({
      kind: 'flash',
      mesh,
      pos: mesh.position,
      vel: direction.clone().multiplyScalar(15).add(new THREE.Vector3(0, 5.0, 0)),
      fuse: FUSE,
      bounced: 0,
    });
  }

  function deploySmoke(pos) {
    const group = new THREE.Group();
    const puffs = [];
    const offsets = [[0, 1.3, 0, 2.4], [1.6, 1.0, 0.7, 1.9], [-1.5, 1.1, -0.8, 2.0]];
    for (const [ox, oy, oz, r] of offsets) {
      const puff = new THREE.Mesh(blastGeo, smokeMat.clone());
      puff.position.set(pos.x + ox, Math.max(0.6, pos.y + oy - 1), pos.z + oz);
      puff.scale.setScalar(r);
      puff.castShadow = false;
      group.add(puff);
      puffs.push(puff);
    }
    scene.add(group);
    clouds.push({ group, puffs, x: pos.x, y: 1.3, z: pos.z, radius: SMOKE_RADIUS, left: SMOKE_SECONDS });
  }

  // Whether the segment between two points passes through any smoke cloud:
  // closest point on the segment to the cloud centre, inside its radius.
  // Plain arithmetic, no allocations, so the sight checks can call it freely.
  function blocksShot(ax, ay, az, bx, by, bz) {
    if (clouds.length === 0) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const lenSq = dx * dx + dy * dy + dz * dz;
    for (const c of clouds) {
      let t = 0;
      if (lenSq > 0) {
        t = ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / lenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const px = ax + dx * t - c.x;
      const py = ay + dy * t - c.y;
      const pz = az + dz * t - c.z;
      if (px * px + py * py + pz * pz < c.radius * c.radius) return true;
    }
    return false;
  }

  function step(dt, damageAt, onFlash) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const g = list[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const next = g.pos.clone().addScaledVector(g.vel, dt);
      // Bounce: test the next position against the world's boxes, one axis at
      // a time, and damp the component that hit.
      probe.min.set(next.x - 0.09, next.y - 0.09, next.z - 0.09);
      probe.max.set(next.x + 0.09, next.y + 0.09, next.z + 0.09);
      let hit = false;
      for (const c of world.colliders) {
        if (probe.intersectsBox(c)) { hit = true; break; }
      }
      if (hit) {
        const probeX = probe.clone();
        probeX.min.x = g.pos.x - 0.09 + g.vel.x * dt;
        probeX.max.x = g.pos.x + 0.09 + g.vel.x * dt;
        probeX.min.y = g.pos.y - 0.09;
        probeX.max.y = g.pos.y + 0.09;
        probeX.min.z = g.pos.z - 0.09;
        probeX.max.z = g.pos.z + 0.09;
        let hitX = false;
        let hitZ = false;
        for (const c of world.colliders) {
          if (probeX.intersectsBox(c)) hitX = true;
          if (probe.intersectsBox(c)) hitZ = true;
        }
        if (hitX) g.vel.x *= -0.45;
        if (hitZ) g.vel.z *= -0.45;
        if (!hitX && !hitZ) g.vel.y *= -0.45;
        g.vel.multiplyScalar(0.7);
        g.bounced += 1;
      } else {
        g.pos.copy(next);
      }
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        if (g.kind === 'smoke') deploySmoke(g.pos);
        else if (g.kind === 'flash') popFlash(g, onFlash);
        else explode(g, damageAt);
        scene.remove(g.mesh);
        list.splice(i, 1);
      }
    }
    // Smoke clouds hang, then thin out over their last two seconds.
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const c = clouds[i];
      c.left -= dt;
      if (c.left <= 0) {
        scene.remove(c.group);
        clouds.splice(i, 1);
        continue;
      }
      const opacity = 0.6 * Math.min(1, c.left / 2);
      for (const puff of c.puffs) puff.material.opacity = opacity;
    }
  }

  // The flash pop: a hard white blink and a report to the loop, which blinds
  // whoever was looking at it. No damage — the flash is pure utility.
  function popFlash(g, onFlash) {
    const flash = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
    flash.position.copy(g.pos);
    flash.scale.setScalar(0.5);
    scene.add(flash);
    const light = new THREE.PointLight(0xffffff, 120, 30);
    light.position.copy(g.pos);
    scene.add(light);
    let life = 0.22;
    const start = performance.now();
    function fade() {
      const t = (performance.now() - start) / 1000;
      const k = 1 - t / life;
      if (k <= 0) {
        scene.remove(flash);
        scene.remove(light);
        return;
      }
      flash.scale.setScalar(0.5 + (1 - k) * 3);
      flash.material.opacity = 0.95 * k;
      light.intensity = 120 * k;
      requestAnimationFrame(fade);
    }
    requestAnimationFrame(fade);
    if (onFlash) onFlash(g.pos.clone());
  }

  function explode(g, damageAt) {
    const flash = new THREE.Mesh(blastGeo, blastMat.clone());
    flash.position.copy(g.pos);
    flash.scale.setScalar(0.5);
    scene.add(flash);
    const light = new THREE.PointLight(0xff7a1a, 60, 18);
    light.position.copy(g.pos);
    scene.add(light);
    let life = 0.35;
    const start = performance.now();
    function fade() {
      const t = (performance.now() - start) / 1000;
      const k = 1 - t / life;
      if (k <= 0) {
        scene.remove(flash);
        scene.remove(light);
        return;
      }
      flash.scale.setScalar(0.5 + (1 - k) * BLAST_RADIUS);
      flash.material.opacity = 0.7 * k;
      light.intensity = 60 * k;
      requestAnimationFrame(fade);
    }
    requestAnimationFrame(fade);
    if (damageAt) damageAt(g.pos, BLAST_RADIUS, BLAST_DAMAGE);
  }

  return {
    throwGrenade,
    throwSmoke,
    throwFlash,
    FLASH_RADIUS,
    FLASH_FULL_SECONDS,
    FLASH_GLANCE_SECONDS,
    blocksShot,
    step,
    count() { return list.length; },
    clear() {
      for (const g of list) scene.remove(g.mesh);
      list.length = 0;
      for (const c of clouds) scene.remove(c.group);
      clouds.length = 0;
    },
  };
}
