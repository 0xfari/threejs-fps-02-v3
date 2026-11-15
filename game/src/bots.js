// The bots: nine of them, four allies and five opponents in a 5v5. Each one
// walks a waypoint graph to its objective, holds angles, peeks from cover, falls
// back when hurt, reacts to what it sees and hears, and shoots back with burst
// fire whose accuracy depends on distance, movement and its own skill. No bot is
// a hitscan turret: every shot is a real ray against the same hitboxes the
// player's bullets use. Smoke blinds them like it blinds the player, a
// flashbang whites out their vision for a couple of seconds, and they talk:
// the carrier calls the round's plan on the radio, bots call contacts as they
// spot them, and the carrier calls the plant.
import * as THREE from 'three';
import { moveBody, clamp } from './utils.js';
import { WEAPONS } from './weapons.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.6;
const WALK_SPEED = 4.4;
const GRAVITY = 20;

const NAMES = {
  atk: ['Vex', 'Mira', 'Juno', 'Kade'],
  def: ['Rook', 'Sable', 'Ivy', 'Noor', 'Pike'],
};

function nameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 128, 32);
  g.fillStyle = color;
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

export function createBots(scene, world, fx) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const probe = new THREE.Box3();
  const blocked = { x: false, y: false, z: false };
  const eyePos = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  const bots = [];
  const hitMeshes = [];
  const bodyGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 12, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.24);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);

  function makeBot(team, index, random) {
    const teamColor = team === 'atk' ? '#58e6c8' : '#8fb8ff';
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'atk' ? '#3a2a1c' : '#1d2836'), roughness: 0.85 });
    const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeo, cloth);
    legL.position.set(-0.13, 0.25, 0);
    const legR = new THREE.Mesh(legGeo, cloth);
    legR.position.set(0.13, 0.25, 0);
    const torso = new THREE.Mesh(bodyGeo, vest);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.53;
    const gun = new THREE.Mesh(gunGeo, cloth);
    gun.position.set(0.2, 1.15, -0.3);
    group.add(legL, legR, torso, head, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    const tag = nameSprite(NAMES[team][index], teamColor);
    tag.position.y = 2.05;
    group.add(tag);
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      name: NAMES[team][index],
      team,
      role: team === 'atk'
        ? (index === 0 ? 'carrier' : index === 1 ? 'entry' : index === 2 ? 'lurk' : 'support')
        : (index <= 1 ? 'holder' : index === 4 ? 'anchor' : 'roamer'),
      group, torso, head, tag,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      health: 100, armor: false, alive: true,
      weaponId: team === 'atk'
        ? (index === 0 ? 'AR77' : index === 1 ? 'VK9' : index === 2 ? 'AR77' : 'LW50')
        : (index === 1 ? 'VK9' : index === 3 ? 'LW50' : 'AR77'),
      mag: 30, reserve: 90,
      cooldown: 0, reloadLeft: 0,
      state: 'move', path: [], pathIndex: 0, holdUntil: 0,
      target: null, lastSeen: null, lastSeenAt: -99, seenAt: -99,
      investigate: null, heardAt: -99,
      burstLeft: 0, burstPause: 0, strafeDir: 1, strafeUntil: 0,
      skill: 0.55 + random() * 0.3,
      reaction: 0.35 + random() * 0.3,
      site: null, plantProgress: 0, defuseProgress: 0, smokeUsed: false, flashUsed: false,
      flashedUntil: 0, calloutAt: -99, plantCalled: false, defuseCalled: false,
      fall: 0, stuckAt: 0, lastPos: new THREE.Vector3(), walkPhase: 0,
      spottedUntil: 0,
      retreatUntil: 0, retreatFrom: null, peekUntil: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function spawnAll(random) {
    for (const b of bots) scene.remove(b.group);
    bots.length = 0;
    hitMeshes.length = 0;
    for (let i = 0; i < 4; i += 1) makeBot('atk', i, random);
    for (let i = 0; i < 5; i += 1) makeBot('def', i, random);
  }

  function resetRound(random, plan) {
    // plan: { atkSite: 'A'|'B', fakeSite, defPosts: {site assignments}, push, lurk }
    for (const bot of bots) {
      const spawnList = world.spawns[bot.team];
      const idx = Number.parseInt(bot.id.split('-')[1], 10);
      const s = spawnList[idx % spawnList.length];
      bot.position.set(s.x, 0, s.z);
      bot.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.pitch = 0;
      bot.health = 100;
      bot.armor = false;
      bot.alive = true;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.copy(bot.position);
      bot.group.visible = true;
      bot.tag.visible = true;
      bot.fall = 0;
      const def = WEAPONS[bot.weaponId];
      bot.mag = def.mag;
      bot.reserve = def.reserve;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.state = 'move';
      bot.target = null;
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.seenAt = -99;
      bot.investigate = null;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.stuckAt = 0;
      bot.lastPos.copy(bot.position);
      bot.site = plan.atkSite;
      bot.smokeUsed = false;
      bot.flashUsed = false;
      bot.flashedUntil = 0;
      bot.calloutAt = -99;
      bot.plantCalled = false;
      bot.defuseCalled = false;
      bot.retreatUntil = 0;
      bot.retreatFrom = null;
      bot.peekUntil = 0;
      // Objective: the push hits the called site; the lurkers take the fake
      // site's lane and hold it to cut rotations. Defenders post up around it.
      if (bot.team === 'atk') {
        const siteNode = plan.atkSite === 'A' ? 9 : 14;
        const fakeNode = plan.fakeSite === 'A' ? 9 : 14;
        const lurking = (plan.lurk || []).includes(bot.id);
        const targetNode = lurking ? fakeNode : siteNode;
        // Lanes: A-long 6 / B-long 11 for the push, mid cover 18 / 19 for the lurk.
        const laneNode = plan.atkSite === 'A'
          ? (lurking ? 19 : (bot.id === 'atk-0' ? 6 : 18))
          : (lurking ? 18 : (bot.id === 'atk-0' ? 11 : 19));
        const from = world.nearestNode(bot.position.x, bot.position.z);
        const via = world.path(from, laneNode);
        const rest = world.path(laneNode, targetNode);
        bot.path = via.concat(rest.slice(1));
        bot.pathIndex = 0;
      } else {
        const post = plan.defPosts[bot.id];
        const from = world.nearestNode(bot.position.x, bot.position.z);
        bot.path = world.path(from, post);
        bot.pathIndex = 0;
      }
    }
    // The carrier calls the round's plan on the radio as the buy phase ends.
    if (fx.callout) {
      const carrier = bots.find((b) => b.id === 'atk-0');
      if (carrier) {
        fx.callout(`${carrier.name}: hitting ${plan.atkSite} — push up ${plan.atkSite === 'A' ? 'A-long' : 'B-long'}, two lurk ${plan.fakeSite}`, 'atk');
      }
    }
  }

  function canSee(bot, combatant, now) {
    // A flashed bot sees nothing until the white clears.
    if (now < bot.flashedUntil) return false;
    const dx = combatant.pos.x - bot.position.x;
    const dz = combatant.pos.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 42) return false;
    toTarget.set(dx, 0, dz).normalize();
    const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const dot = facing.dot(toTarget);
    const close = dist < 3.5;
    if (!close && dot < 0.25) return false; // outside ~75 deg half-cone
    eyePos.set(bot.position.x, bot.position.y + EYE, bot.position.z);
    targetPos.set(combatant.pos.x, combatant.pos.y + 1.1, combatant.pos.z);
    dir.copy(targetPos).sub(eyePos);
    const len = dir.length();
    dir.normalize();
    raycaster.set(eyePos, dir);
    raycaster.far = len + 0.5;
    const hits = raycaster.intersectObjects(world.shootables, false);
    if (hits.length > 0 && hits[0].distance < len - 0.4) return false;
    if (fx.smokeBlocks && fx.smokeBlocks(eyePos.x, eyePos.y, eyePos.z, targetPos.x, targetPos.y, targetPos.z)) return false;
    return { dist, point: targetPos.clone() };
  }

  function perceive(bot, combatants, now) {
    let best = null;
    let bestScore = Infinity;
    for (const c of combatants) {
      if (!c.alive || c.team === bot.team) continue;
      const seen = canSee(bot, c, now);
      if (!seen) continue;
      const score = seen.dist - (c.noisy ? 8 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { combatant: c, point: seen.point, dist: seen.dist };
      }
    }
    if (best) {
      if (!bot.lastSeen || bot.target !== best.combatant) bot.seenAt = now;
      // Radio the contact once per sighting, so the team knows where the fight is.
      if (bot.target !== best.combatant && now - bot.calloutAt > 6 && fx.callout) {
        bot.calloutAt = now;
        const c = best.combatant;
        const lane = Math.abs(c.pos.x) < 5 ? 'mid' : c.pos.x < 0 ? 'A side' : 'B side';
        fx.callout(`${bot.name}: contact ${lane} — ${c.bot ? c.bot.name : 'one'} pushing`, bot.team);
      }
      bot.target = best.combatant;
      bot.lastSeen = best.point;
      bot.lastSeenAt = now;
      bot.spottedUntil = now + 2.5;
    } else if (bot.target && now - bot.lastSeenAt > 1.4) {
      bot.target = null;
    }
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const want = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += clamp(diff, -rate * dt, rate * dt);
  }

  function moveToward(bot, x, z, dt, speed) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    bot.velocity.x += (vx - bot.velocity.x) * Math.min(1, dt * 8);
    bot.velocity.z += (vz - bot.velocity.z) * Math.min(1, dt * 8);
    faceToward(bot, x, z, dt, 8);
    return false;
  }

  function shootAt(bot, now, random) {
    const def = WEAPONS[bot.weaponId];
    if (bot.cooldown > 0 || bot.reloadLeft > 0) return;
    if (bot.mag <= 0) {
      bot.reloadLeft = def.reload;
      return;
    }
    if (bot.burstLeft <= 0) {
      if (bot.burstPause > 0) return;
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.burstPause = 0;
    }
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.burstPause = 0.45 + random() * 0.4;
    bot.cooldown = def.gap;
    bot.mag -= 1;
    const t = bot.target;
    if (!t) return;
    // Aim error grows with distance, target speed and the bot's own skill.
    const dist = Math.hypot(t.pos.x - bot.position.x, t.pos.z - bot.position.z);
    const targetSpeed = t.speed ? t.speed() : 0;
    const error = (0.012 + dist * 0.0011 + targetSpeed * 0.004) * (1.15 - bot.skill);
    eyePos.set(bot.position.x, bot.position.y + EYE, bot.position.z);
    const aimAt = t.aim ? t.aim() : new THREE.Vector3(t.pos.x, t.pos.y + 1.1, t.pos.z);
    dir.copy(aimAt).sub(eyePos).normalize();
    dir.x += (random() * 2 - 1) * error;
    dir.y += (random() * 2 - 1) * error;
    dir.z += (random() * 2 - 1) * error;
    dir.normalize();
    fx.shoot(bot, eyePos.clone(), dir.clone(), def);
  }

  function stepBot(bot, dt, now, combatants, random, game) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    bot.burstPause = Math.max(0, bot.burstPause - dt);
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) {
        const def = WEAPONS[bot.weaponId];
        const need = def.mag - bot.mag;
        const take = Math.min(need, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
    }
    perceive(bot, combatants, now);

    const bombPlanted = game.state.bomb.state === 'planted';
    const mySite = bot.site;
    // Objective overrides: plant / defuse / converge on a planted bomb.
    if (bot.team === 'atk' && game.state.bomb.state === 'bot' && game.state.bomb.carrierBot === bot && !bot.target) {
      const site = world.sites[mySite];
      const inSite = bot.position.x > site.minX && bot.position.x < site.maxX && bot.position.z > site.minZ && bot.position.z < site.maxZ;
      if (inSite) {
        bot.state = 'plant';
        if (!bot.plantCalled && fx.callout) {
          bot.plantCalled = true;
          fx.callout(`${bot.name}: planting ${mySite} — cover me`, 'atk');
        }
        // The execute: smoke the site once as the plant starts, so the
        // defenders holding the site lose their sightlines while it goes down.
        if (!bot.smokeUsed) {
          bot.smokeUsed = true;
          if (fx.throwSmoke) fx.throwSmoke(bot);
        }
        bot.plantProgress += dt;
        fx.plantTick(bot, bot.plantProgress);
        bot.velocity.x *= 0.8;
        bot.velocity.z *= 0.8;
      } else if (bot.state !== 'plant') {
        const from = world.nearestNode(bot.position.x, bot.position.z);
        const siteNode = mySite === 'A' ? 9 : 14;
        bot.path = world.path(from, siteNode);
        bot.pathIndex = 0;
        bot.state = 'move';
      }
    } else if (bot.team === 'def' && bombPlanted && !bot.target) {
      const site = world.sites[game.state.bomb.site];
      const inSite = bot.position.x > site.minX && bot.position.x < site.maxX && bot.position.z > site.minZ && bot.position.z < site.maxZ;
      if (inSite && game.state.bomb.state === 'planted') {
        bot.state = 'defuse';
        if (!bot.defuseCalled && fx.callout) {
          bot.defuseCalled = true;
          fx.callout(`${bot.name}: defusing ${game.state.bomb.site} — hold the site`, 'def');
        }
        bot.defuseProgress += dt;
        fx.defuseTick(bot, bot.defuseProgress);
        bot.velocity.x *= 0.8;
        bot.velocity.z *= 0.8;
      } else if (bot.state !== 'defuse') {
        const from = world.nearestNode(bot.position.x, bot.position.z);
        const siteNode = game.state.bomb.site === 'A' ? 9 : 14;
        bot.path = world.path(from, siteNode);
        bot.pathIndex = 0;
        bot.state = 'move';
      }
    } else if (bot.state === 'plant' || bot.state === 'defuse') {
      bot.state = 'move';
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
    }

    // Hurt badly and out of the fight: fall back toward the own half for a
    // couple of seconds instead of standing in the open and dying.
    if (bot.alive && bot.health <= 35 && bot.health > 0 && now > bot.retreatUntil && bot.target) {
      bot.retreatUntil = now + 2.2;
      bot.retreatFrom = { x: bot.target.pos.x, z: bot.target.pos.z };
    }
    if (bot.retreatUntil > now && bot.retreatFrom) {
      const dx = bot.position.x - bot.retreatFrom.x;
      const dz = bot.position.z - bot.retreatFrom.z;
      const len = Math.hypot(dx, dz) || 1;
      const backX = bot.position.x + (dx / len) * 4;
      const backZ = bot.position.z + (dz / len) * 4;
      moveToward(bot, backX, backZ, dt, WALK_SPEED * 0.9);
      if (bot.target) faceToward(bot, bot.target.pos.x, bot.target.pos.z, dt, 5);
    } else if (bot.target && now - bot.seenAt > bot.reaction) {
      bot.state = 'engage';
    } else if (bot.state === 'engage' && !bot.target) {
      bot.state = 'move';
      if (bot.lastSeen) {
        const from = world.nearestNode(bot.position.x, bot.position.z);
        bot.path = world.path(from, world.nearestNode(bot.lastSeen.x, bot.lastSeen.z));
        bot.pathIndex = 0;
      }
    }

    if (bot.state === 'engage' && bot.target && bot.retreatUntil <= now) {
      const t = bot.target;
      // Strafe to be a harder target, switching direction every couple seconds.
      if (now > bot.strafeUntil) {
        bot.strafeDir *= -1;
        bot.strafeUntil = now + 1.2 + random() * 1.4;
      }
      const dx = t.pos.x - bot.position.x;
      const dz = t.pos.z - bot.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * bot.strafeDir;
      const pz = dx / len * bot.strafeDir;
      const wantDist = bot.weaponId === 'LW50' ? 16 : 9;
      const approach = len > wantDist + 2 ? 1 : len < wantDist - 3 ? -0.7 : 0;
      bot.velocity.x += ((dx / len) * approach * WALK_SPEED * 0.7 + px * 1.6 - bot.velocity.x) * Math.min(1, dt * 6);
      bot.velocity.z += ((dz / len) * approach * WALK_SPEED * 0.7 + pz * 1.6 - bot.velocity.z) * Math.min(1, dt * 6);
      faceToward(bot, t.pos.x, t.pos.z, dt, 7);
      const aimY = t.pos.y + 1.15;
      bot.pitch = clamp(Math.atan2(aimY - (bot.position.y + EYE), len), -1.2, 1.2);
      shootAt(bot, now, random);
    } else if ((bot.state === 'move' || bot.state === 'hold') && bot.retreatUntil <= now) {
      if (bot.state === 'hold' && now < bot.holdUntil) {
        // A fresh noise pulls a holding bot to investigate.
        if (bot.investigate && now - bot.heardAt < 4) {
          const from = world.nearestNode(bot.position.x, bot.position.z);
          bot.path = world.path(from, world.nearestNode(bot.investigate.x, bot.investigate.z));
          bot.pathIndex = 0;
          bot.investigate = null;
          bot.state = 'move';
        } else {
          // Scan the lane: slow yaw sweep while holding.
          bot.yaw += Math.sin(now * 0.7 + bot.pathIndex) * dt * 0.35;
          bot.velocity.x *= 0.85;
          bot.velocity.z *= 0.85;
        }
      } else {
        bot.state = 'move';
        const node = bot.path[bot.pathIndex];
        if (node == null) {
          // At the post: sometimes peek a nearby lane node before settling,
          // so a holding bot is not a statue between rounds.
          if (bot.peekUntil <= now && random() < 0.4) {
            const from = world.nearestNode(bot.position.x, bot.position.z);
            const neighbours = world.adjacency[from] || [];
            if (neighbours.length > 0) {
              const pick = neighbours[Math.floor(random() * neighbours.length)];
              bot.path = [from, pick, from];
              bot.pathIndex = 0;
              bot.peekUntil = now + 6 + random() * 4;
              bot.state = 'move';
            } else {
              bot.state = 'hold';
              bot.holdUntil = now + 2 + random() * 3;
            }
          } else {
            bot.state = 'hold';
            bot.holdUntil = now + 1.5 + random() * 3;
          }
        } else {
          const p = world.nodes[node];
          const arrived = moveToward(bot, p.x, p.z, dt, WALK_SPEED);
          if (arrived) {
            bot.pathIndex += 1;
            if (bot.pathIndex >= bot.path.length) {
              bot.state = 'hold';
              bot.holdUntil = now + 1.5 + random() * 3;
            }
          }
        }
      }
    }

    // Gravity and collision, shared with the player.
    bot.velocity.y = Math.max(-30, bot.velocity.y - GRAVITY * dt);
    moveBody(bot.position, bot.velocity, dt, world.colliders, RADIUS, HEIGHT, blocked, probe);
    // Stuck detection: barely moved for 1.5 s while trying to walk.
    const moved = Math.hypot(bot.position.x - bot.lastPos.x, bot.position.z - bot.lastPos.z);
    if (bot.state === 'move' && moved < 0.05) {
      if (now - bot.stuckAt > 1.5) {
        bot.stuckAt = now;
        const from = world.nearestNode(bot.position.x, bot.position.z);
        const randomNode = Math.floor(random() * world.nodes.length);
        bot.path = world.path(from, randomNode);
        bot.pathIndex = 0;
      }
    } else {
      bot.lastPos.copy(bot.position);
      bot.stuckAt = now;
    }

    // Walk cycle and mesh sync. No new objects: reuse the group's vectors.
    const planar = Math.hypot(bot.velocity.x, bot.velocity.z);
    bot.walkPhase += dt * planar * 2.2;
    bot.group.position.set(bot.position.x, bot.position.y, bot.position.z);
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.tag.visible = bot.alive;
  }

  return {
    bots,
    hitMeshes,
    spawnAll,
    resetRound,
    step(dt, now, combatants, random, game) {
      for (const bot of bots) stepBot(bot, dt, now, combatants, random, game);
    },
    damage(bot, amount, part) {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.fall = 0;
      bot.target = null;
      fx.carrierDied(bot);
      return true;
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    // A flashbang pop: blind the bot until `until` (sim seconds). Looking
    // straight at the pop blinds longer; main.js scales the duration.
    flash(bot, until) {
      if (!bot.alive) return;
      if (until > bot.flashedUntil) bot.flashedUntil = until;
    },
    hear(x, z, radius, now) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.position.x - x, bot.position.z - z);
        if (d < radius) {
          bot.investigate = { x, z };
          bot.heardAt = now;
        }
      }
    },
  };
}
