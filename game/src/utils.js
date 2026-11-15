// Small shared helpers: a seeded RNG for deterministic shot captures, clamps,
// and the one AABB mover the player and every bot share, so nobody ever walks
// through a wall. No allocations in the hot path: callers pass scratch vectors.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? value : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Move a standing body (position = feet, radius, height) against the world's
// Box3 colliders, one axis at a time. Returns { x: bool, y: bool, z: bool } of
// which axes were blocked. `out` is reused by the caller.
export function moveBody(position, velocity, dt, colliders, radius, height, out, probe) {
  out.x = false;
  out.y = false;
  out.z = false;
  const nextX = position.x + velocity.x * dt;
  probe.min.set(nextX - radius, position.y + 0.04, position.z - radius);
  probe.max.set(nextX + radius, position.y + height - 0.04, position.z + radius);
  let blocked = false;
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) { blocked = true; break; }
  }
  if (!blocked) position.x = nextX;
  else { velocity.x = 0; out.x = true; }
  const nextZ = position.z + velocity.z * dt;
  probe.min.set(position.x - radius, position.y + 0.04, nextZ - radius);
  probe.max.set(position.x + radius, position.y + height - 0.04, nextZ + radius);
  blocked = false;
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) { blocked = true; break; }
  }
  if (!blocked) position.z = nextZ;
  else { velocity.z = 0; out.z = true; }
  position.y += velocity.y * dt;
  probe.min.set(position.x - radius, position.y, position.z - radius);
  probe.max.set(position.x + radius, position.y + height, position.z + radius);
  let floor = null;
  let ceiling = false;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (!probe.intersectsBox(c)) continue;
    if (velocity.y <= 0 && c.max.y <= position.y + 0.3) {
      if (!floor || c.max.y > floor.max.y) floor = c;
    } else if (velocity.y > 0 && c.min.y >= position.y + height - 0.3) {
      ceiling = true;
    }
  }
  if (floor) {
    position.y = floor.max.y;
    velocity.y = 0;
    out.y = true;
  } else if (ceiling) {
    velocity.y = 0;
  }
  if (position.y < 0) {
    position.y = 0;
    velocity.y = 0;
    out.y = true;
  }
  return out;
}

// Distance from a point to a segment, squared (for tracer / grenade tests).
export function distPointSegmentSq(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lenSq > 0) t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq;
  t = clamp(t, 0, 1);
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dy * dy + dz * dz;
}
