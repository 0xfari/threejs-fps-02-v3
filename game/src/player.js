// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// through the shared AABB mover, so a wall never swallows the player. The same
// mover drives the bots; only the wish direction differs.
import * as THREE from 'three';
import { moveBody } from './utils.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const state = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: 0, // attackers face north (-Z), up the map toward the sites
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    scoped: false,
  };
  const probe = new THREE.Box3();
  const blocked = { x: false, y: false, z: false };
  const wish = new THREE.Vector3();
  let stepAcc = 0;

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys, onStep) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && state.crouching) {
      probe.min.set(state.position.x - RADIUS, state.position.y + 0.02, state.position.z - RADIUS);
      probe.max.set(state.position.x + RADIUS, state.position.y + STAND_HEIGHT - 0.02, state.position.z + RADIUS);
      let clear = true;
      for (const c of colliders) {
        if (probe.intersectsBox(c)) { clear = false; break; }
      }
      if (clear) {
        state.crouching = false;
        state.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = (state.crouching ? CROUCH_SPEED : WALK_SPEED) * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.55 : 1);
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y = Math.max(-30, state.velocity.y - GRAVITY * dt);
    moveBody(state.position, state.velocity, dt, colliders, RADIUS, state.height, blocked, probe);
    state.onGround = blocked.y && state.velocity.y === 0;

    const planar = Math.hypot(state.velocity.x, state.velocity.z);
    if (state.onGround && planar > 1.5) {
      stepAcc += dt * planar;
      if (stepAcc > 2.4) {
        stepAcc = 0;
        if (onStep) onStep(planar > 4.5);
      }
    }
  }

  return {
    state,
    step,
    look,
    recoil,
    respawn(spawnPoint, yaw) {
      state.position.set(spawnPoint.x, 0, spawnPoint.z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.crouching = false;
      state.height = STAND_HEIGHT;
      state.eye = STAND_EYE;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
