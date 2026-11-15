// Zenith: boot and the one loop. A fixed 60 Hz simulation (player, bots,
// grenades, the match state machine) feeds a render at the display's rate.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE_PRICE, SMOKE_PRICE, FLASH_PRICE, ARMOR_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createGame, PLANT_SECONDS, DEFUSE_SECONDS, HALFTIME_ROUND } from './game.js';
import { createAudio } from './audio.js';
import { createGrenades } from './grenades.js';
import { mulberry32, clamp } from './utils.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#0a1120'), 20, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud(world);
const game = createGame(random);
const grenades = createGrenades(scene, world);
const player = createPlayer(world.colliders, world.spawns.atk[2]);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);

// The player's own hitboxes, so bots can shoot back at something real.
// Invisible (no colour, no depth write) but still raycastable.
const playerHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), playerHitMat);
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), playerHitMat);
playerTorso.userData = { kind: 'player', part: 'torso' };
playerHead.userData = { kind: 'player', part: 'head' };
scene.add(playerTorso, playerHead);

// The bomb: a spike box with an ember light, shown when planted or dropped.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.2, 0.42),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombLight.position.y = 0.14;
const bombPoint = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 8);
bombMesh.add(bombBody, bombLight, bombPoint);
bombMesh.visible = false;
scene.add(bombMesh);

// Tracers and impact flashes: fixed pools, no allocation while playing.
const tracerPool = [];
for (let i = 0; i < 16; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerNext = 0;
const flashPool = [];
for (let i = 0; i < 8; i += 1) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false }),
  );
  scene.add(flash);
  flashPool.push({ mesh: flash, life: 0 });
}
let flashNext = 0;

function spawnTracer(from, to, color) {
  const t = tracerPool[tracerNext];
  tracerNext = (tracerNext + 1) % tracerPool.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.set(color);
  t.line.material.opacity = 0.9;
  t.life = 0.12;
}

function spawnFlash(point) {
  const f = flashPool[flashNext];
  flashNext = (flashNext + 1) % flashPool.length;
  f.mesh.position.copy(point);
  f.mesh.material.opacity = 0.9;
  f.life = 0.14;
}

const raycaster = new THREE.Raycaster();
const shootOrigin = new THREE.Vector3();
const shootDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const scratchVec = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const dir = new THREE.Vector3();
let allShootables = null;

function refreshShootables() {
  allShootables = world.shootables.concat(bots.hitMeshes, [playerTorso, playerHead]);
}

function raycastShot(origin, direction, far, filter) {
  // Bot groups move every step; their matrices are only refreshed by the
  // renderer, so update them here or a shot can pass through a bot that
  // moved since the last frame (notably in the deterministic shot captures,
  // which run before the first render).
  scene.updateMatrixWorld(true);
  raycaster.set(origin, direction);
  raycaster.far = far;
  const hits = raycaster.intersectObjects(allShootables, false);
  for (const hit of hits) {
    if (filter && !filter(hit.object)) continue;
    // Smoke eats the shot: a target behind a cloud is never hit, and no
    // impact flash appears through it.
    if (grenades.blocksShot(origin.x, origin.y, origin.z, hit.point.x, hit.point.y, hit.point.z)) return null;
    return hit;
  }
  return null;
}

// ---- bots: what they need from the game -------------------------------
let botPlanting = null;
let botDefusing = null;
const bots = createBots(scene, world, {
  shoot(bot, origin, dirVec, def) {
    const hit = raycastShot(origin, dirVec, def.range, (obj) => {
      if (obj.userData.bot === bot) return false;
      if (obj.userData.bot && obj.userData.bot.team === bot.team) return false;
      return true;
    });
    const end = hit ? hit.point : scratchVec.copy(origin).addScaledVector(dirVec, def.range);
    spawnTracer(origin, end, bot.team === 'atk' ? 0x58e6c8 : 0xff5340);
    spawnFlash(origin); // muzzle flash at the shooter's gun
    const distToPlayer = camera.position.distanceTo(origin);
    audio.shot(def.kind, distToPlayer);
    bots.hear(origin.x, origin.z, 26, simNow);
    if (!hit) return;
    if (hit.object.userData.kind === 'player') {
      damagePlayer(def.damage * (hit.object.userData.part === 'head' ? 4 : 1), bot);
    } else if (hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const killed = damageBot(victim, def.damage * (hit.object.userData.part === 'head' ? 4 : 1), hit.object.userData.part, bot, def.id);
      if (killed) audio.kill();
      else audio.hit();
    } else {
      spawnFlash(hit.point);
    }
  },
  plantTick(bot) {
    botPlanting = bot;
  },
  defuseTick(bot) {
    botDefusing = bot;
  },
  carrierDied(bot) {
    const bomb = game.state.bomb;
    if (bomb.state === 'bot' && bomb.carrierBot === bot) {
      bomb.state = 'dropped';
      bomb.pos = { x: bot.position.x, z: bot.position.z };
      bomb.carrierBot = null;
    }
  },
  // Smoke sightlines, shared by the bots' spotting and the shots: a segment
  // that crosses a cloud is blind.
  smokeBlocks(ax, ay, az, bx, by, bz) {
    return grenades.blocksShot(ax, ay, az, bx, by, bz);
  },
  // The carrier's execute smoke: lobbed from the bot toward the middle of the
  // site it is planting, so the cloud sits between it and the defenders.
  throwSmoke(bot) {
    const site = world.sites[bot.site];
    const cx = (site.minX + site.maxX) / 2;
    const cz = (site.minZ + site.maxZ) / 2;
    grenades.throwSmoke(
      new THREE.Vector3(bot.position.x, bot.position.y + 1.5, bot.position.z),
      new THREE.Vector3(cx - bot.position.x, 0.4, cz - bot.position.z).normalize(),
    );
  },
  // The radio: a bot's callout goes to the HUD feed with a soft blip.
  callout(text, team) {
    hud.addCallout(text, team);
    audio.radio();
  },
});
bots.spawnAll(random);
refreshShootables();

// ---- match state -------------------------------------------------------
const playerState = {
  hp: 100,
  alive: true,
  grenades: 0,
  smokes: 0,
  flashes: 0,
  armor: false,
  scoped: false,
};
let simNow = 0;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let lastBeep = 0;
let minimapAt = 0;
let rightHeld = false;
const facts = {
  playerAlive: true, playerIsAtk: true, atkAlive: 5, defAlive: 5,
  playerPos: null, playerPlanting: false, playerSite: null, playerDefusing: false,
  botPlanting: null, botSite: null, botDefusing: null, carrierBot: null,
  planterIsPlayer: false, defuserIsPlayer: false,
};

window.addEventListener('mousedown', (event) => {
  if (event.button === 2) rightHeld = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) rightHeld = false;
});
window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('wheel', (event) => {
  if (game.state.phase !== 'playing' || !playerState.alive) return;
  const owned = ['P9', 'VK9', 'AR77', 'LW50'].filter((id) => weapon.own(id));
  if (owned.length < 2) return;
  const idx = owned.indexOf(weapon.state.current);
  const next = owned[(idx + (event.deltaY > 0 ? 1 : owned.length - 1)) % owned.length];
  weapon.equip(next);
}, { passive: true });

function playerSite() {
  const p = player.state.position;
  for (const [key, site] of Object.entries(world.sites)) {
    if (p.x > site.minX && p.x < site.maxX && p.z > site.minZ && p.z < site.maxZ) return key;
  }
  return null;
}

function resetPositions() {
  const plan = game.state.plan;
  const side = game.state.playerSide;
  player.respawn(world.spawns[side][2], side === 'atk' ? 0 : Math.PI);
  playerState.hp = 100;
  playerState.alive = true;
  playerState.grenades = 0;
  playerState.smokes = 0;
  playerState.flashes = 0;
  playerState.armor = false;
  weapon.refillAll();
  weapon.equip('P9');
  bots.resetRound(random, plan);
  // Second half the player defends, so the spike starts with the enemy
  // carrier bot instead of the player.
  if (side === 'def') {
    const carrier = bots.bots.find((b) => b.id === 'atk-0');
    game.state.bomb.state = 'bot';
    game.state.bomb.carrierBot = carrier || null;
  } else {
    game.state.bomb.state = 'player';
    game.state.bomb.carrierBot = null;
  }
  grenades.clear();
  bombMesh.visible = false;
  hud.setTeamLabel(side === 'atk' ? 'ZENITH · ATTACK' : 'ZENITH · DEFENSE');
  hud.setHealth(100, false);
  hud.setAmmo(weapon.mag(), weapon.reserve(), 0, 0, 0);
  hud.setScope(false);
}

function startMatch() {
  audio.unlock();
  game.newMatch();
  resetPositions();
  started = true;
  hud.hideOverlay();
  hud.closeBuy();
  hud.banner('Match started — first to 7 rounds');
  input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    if (hud.isBuyOpen()) hud.closeBuy();
  } else if (started && game.state.phase === 'playing' && playerState.alive) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (game.state.phase === 'menu') startMatch();
  else if (game.state.phase === 'matchEnd') startMatch();
  else if (game.state.phase === 'roundEnd') input.requestLock();
  else input.requestLock();
});

hud.onBuy((id) => {
  if (game.state.phase !== 'buy') return;
  const def = WEAPONS[id];
  if (def) {
    if (weapon.own(id)) {
      weapon.equip(id);
      return;
    }
    if (game.buy(def.price)) {
      weapon.buy(id);
      weapon.equip(id);
      audio.buy();
    }
  } else if (id === 'grenade') {
    if (playerState.grenades > 0) return;
    if (game.buy(GRENADE_PRICE)) {
      playerState.grenades = 1;
      audio.buy();
    }
  } else if (id === 'smoke') {
    if (playerState.smokes > 0) return;
    if (game.buy(SMOKE_PRICE)) {
      playerState.smokes = 1;
      audio.buy();
    }
  } else if (id === 'flash') {
    if (playerState.flashes > 0) return;
    if (game.buy(FLASH_PRICE)) {
      playerState.flashes = 1;
      audio.buy();
    }
  } else if (id === 'armor') {
    if (playerState.armor) return;
    if (game.buy(ARMOR_PRICE)) {
      playerState.armor = true;
      audio.buy();
    }
  }
  hud.setMoney(game.state.money);
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes, playerState.flashes);
  hud.setHealth(playerState.hp, playerState.armor);
  hud.openBuy(game.state.money, ownedSnapshot());
});

function ownedSnapshot() {
  return {
    P9: true, VK9: weapon.own('VK9'), AR77: weapon.own('AR77'), LW50: weapon.own('LW50'),
    grenades: playerState.grenades, smokes: playerState.smokes, flashes: playerState.flashes, armor: playerState.armor,
  };
}

function damagePlayer(amount, attacker) {
  if (!playerState.alive) return;
  const finalAmount = playerState.armor ? Math.round(amount * 0.5) : amount;
  playerState.hp -= finalAmount;
  hud.damageFlash();
  // Point the damage arc at the shooter: angle of the attacker relative to
  // where the player is looking (0 = ahead, positive = right).
  if (attacker && attacker.position) {
    const dx = attacker.position.x - player.state.position.x;
    const dz = attacker.position.z - player.state.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const viewAngle = player.state.yaw;
    let rel = worldAngle - viewAngle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    hud.showDamageDir(-rel);
  }
  audio.hurt();
  hud.setHealth(Math.max(0, playerState.hp), playerState.armor);
  if (playerState.hp <= 0) {
    playerState.alive = false;
    game.registerKill(attacker, { name: 'You', isPlayer: true, team: game.state.playerSide }, false, attacker ? attacker.weaponId : 'AR77');
    const bomb = game.state.bomb;
    if (bomb.state === 'player') {
      bomb.state = 'dropped';
      bomb.pos = { x: player.state.position.x, z: player.state.position.z };
      bomb.carrierBot = null;
    }
    playerState.scoped = false;
    hud.setScope(false);
    input.releaseLock();
    hud.showOverlay('roundEnd', { title: 'You are down', copy: 'Your team fights on. Next round starts soon.', stats: '' });
    hud.banner('You were eliminated');
  }
}

function damageBot(bot, amount, part, attacker, weaponId) {
  const killed = bots.damage(bot, amount, part);
  if (attacker && attacker.isPlayer) {
    hud.hitMarker(killed, shot ? 4000 : 90);
    if (killed) audio.kill();
    else audio.hit();
  }
  if (killed) {
    game.registerKill(attacker, { name: bot.name, isPlayer: false, team: bot.team }, part === 'head', weaponId, attacker && attacker.isPlayer ? amount : 0);
    if (game.state.bomb.state === 'bot' && game.state.bomb.carrierBot === bot) {
      const bomb = game.state.bomb;
      bomb.state = 'dropped';
      bomb.pos = { x: bot.position.x, z: bot.position.z };
      bomb.carrierBot = null;
    }
  }
  return killed;
}

function playerShoot() {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(shootDir);
  const spread = weapon.spread(player.groundSpeed());
  shootDir.x += (random() * 2 - 1) * spread;
  shootDir.y += (random() * 2 - 1) * spread;
  shootDir.z += (random() * 2 - 1) * spread;
  shootDir.normalize();
  muzzlePos.set(0.26, -0.2, -0.75);
  camera.localToWorld(muzzlePos);
  const hit = raycastShot(camera.position, shootDir, def.range, (obj) => obj.userData.kind !== 'player');
  // Record the last shot for local play-testing.
  window.__lastShot = {
    hit: hit ? { part: hit.object.userData.part || null, bot: hit.object.userData.bot ? hit.object.userData.bot.id : null, dist: +hit.distance.toFixed(2) } : null,
    dir: [+shootDir.x.toFixed(3), +shootDir.y.toFixed(3), +shootDir.z.toFixed(3)],
    origin: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
  };
  const end = hit ? hit.point : scratchVec.copy(camera.position).addScaledVector(shootDir, def.range);
  spawnTracer(muzzlePos, end, def.tracer);
  audio.shot(def.kind, 0);
  bots.hear(player.state.position.x, player.state.position.z, 30, simNow);
  weapon.pullTrigger();
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.4);
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes);
  if (!hit) return;
  if (hit.object.userData.bot) {
    const victim = hit.object.userData.bot;
    const part = hit.object.userData.part;
    damageBot(victim, def.damage * (part === 'head' ? def.headMult : 1), part, { name: 'You', isPlayer: true, team: game.state.playerSide }, def.id);
  } else {
    spawnFlash(hit.point);
  }
}

function throwGrenade() {
  if (playerState.grenades <= 0 || game.state.phase !== 'playing' || !playerState.alive) return;
  playerState.grenades -= 1;
  camera.getWorldDirection(shootDir);
  shootOrigin.copy(camera.position);
  grenades.throwGrenade(shootOrigin, shootDir);
  audio.grenadeThrow();
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes, playerState.flashes);
}

function throwSmoke() {
  if (playerState.smokes <= 0 || game.state.phase !== 'playing' || !playerState.alive) return;
  playerState.smokes -= 1;
  camera.getWorldDirection(shootDir);
  shootOrigin.copy(camera.position);
  grenades.throwSmoke(shootOrigin, shootDir);
  audio.grenadeThrow();
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes, playerState.flashes);
}

function throwFlash() {
  if (playerState.flashes <= 0 || game.state.phase !== 'playing' || !playerState.alive) return;
  playerState.flashes -= 1;
  camera.getWorldDirection(shootDir);
  shootOrigin.copy(camera.position);
  grenades.throwFlash(shootOrigin, shootDir);
  audio.grenadeThrow();
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes, playerState.flashes);
}

// A flashbang pop: whoever was looking at it, with a clear sightline and in
// range, is blinded — full white if they faced it, a short glance otherwise.
// Bots lose their vision outright; the player gets the white screen.
function applyFlash(pos) {
  const range = grenades.FLASH_RADIUS;
  const full = grenades.FLASH_FULL_SECONDS;
  const glance = grenades.FLASH_GLANCE_SECONDS;
  // Line of sight: the pop has to be visible, not behind a wall.
  function visibleFrom(eye) {
    dir.copy(pos).sub(eye);
    const len = dir.length();
    if (len > range) return 0;
    dir.normalize();
    raycaster.set(eye, dir);
    raycaster.far = len;
    const hits = raycaster.intersectObjects(world.shootables, false);
    if (hits.length > 0 && hits[0].distance < len - 0.4) return 0;
    return len;
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    eyePos.set(bot.position.x, bot.position.y + 1.6, bot.position.z);
    const len = visibleFrom(eyePos);
    if (!len) continue;
    // Facing: a bot staring at the pop eats the full blind.
    toTarget.copy(pos).sub(eyePos).normalize();
    const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const dot = facing.dot(toTarget);
    const dur = dot > 0.2 ? full : glance;
    bots.flash(bot, simNow + dur);
  }
  if (playerState.alive) {
    eyePos.copy(camera.position);
    const len = visibleFrom(eyePos);
    if (len) {
      camera.getWorldDirection(dir);
      toTarget.copy(pos).sub(eyePos).normalize();
      const dot = dir.dot(toTarget);
      const strength = dot > 0.2 ? 1 : 0.45;
      const ms = (dot > 0.2 ? full : glance) * 1000;
      hud.flashScreen(strength, ms);
      audio.flash();
    }
  }
}

function damageAt(pos, radius, damage) {
  audio.explosion(camera.position.distanceTo(pos));
  const pd = Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z);
  const py = Math.abs((player.state.position.y + 1.2) - pos.y);
  if (pd < radius && py < 3 && playerState.alive) {
    const falloff = 1 - (pd / radius) * 0.7;
    damagePlayer(Math.round(damage * falloff), { name: 'HE Grenade', weaponId: 'HE' });
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.position.x - pos.x, bot.position.z - pos.z);
    if (d < radius) {
      const falloff = 1 - (d / radius) * 0.7;
      damageBot(bot, Math.round(damage * falloff), 'torso', { name: 'You', isPlayer: true, team: game.state.playerSide }, 'HE');
    }
  }
}

function handleEvents() {
  for (const event of game.drainEvents()) {
    if (event.type === 'kill') {
      hud.addKill(event.killer, event.victim, event.headshot, event.weapon);
      hud.setMoney(game.state.money);
    } else if (event.type === 'firstBlood') {
      hud.banner(`First blood — ${event.killer} takes ${event.victim}`);
    } else if (event.type === 'halftime') {
      hud.banner('Halftime — sides swap. Zenith defends now.');
      audio.roundWin();
    } else if (event.type === 'roundStart') {
      resetPositions();
      const siteName = event.plan.atkSite === 'A' ? 'Dome' : 'Dish';
      const copy = event.playerSide === 'atk'
        ? `Round ${event.round} — plant at Site ${event.plan.atkSite} (${siteName})`
        : `Round ${event.round} — hold Dome and Dish`;
      hud.banner(copy);
      hud.showOverlay('roundEnd', { title: `Round ${event.round}${event.half === 2 ? ' · 2nd half' : ''}`, copy: 'Buy phase — press B to buy.', stats: '' });
    } else if (event.type === 'roundLive') {
      hud.hideOverlay();
      hud.banner(game.state.playerSide === 'atk' ? 'Round live — plant the spike' : 'Round live — hold the sites');
      input.requestLock();
    } else if (event.type === 'roundEnd') {
      const won = event.playerWon;
      hud.banner(won ? `Round won — ${event.reason}` : `Round lost — ${event.reason}`);
      hud.setRoundHistory(game.state.roundHistory);
      if (won) audio.roundWin();
      else audio.roundLose();
      hud.showOverlay('roundEnd', {
        title: won ? 'Round won' : 'Round lost',
        copy: `${event.reason}. Zenith ${event.scoreZen} — ${event.scoreUmb} Umbra.`,
        stats: '',
      });
      input.releaseLock();
    } else if (event.type === 'matchEnd') {
      const won = event.winner === 'zen';
      const s = game.state.stats;
      const history = game.state.roundHistory.join(' ');
      hud.showOverlay('matchEnd', {
        title: won ? 'Match won — Zenith takes it' : 'Match lost — Umbra takes it',
        copy: `Final: Zenith ${event.scoreZen} — ${event.scoreUmb} Umbra. Rounds: ${history}.`,
        stats: `Kills ${s.kills} · Deaths ${s.deaths} · Headshots ${s.headshots} · Plants ${s.plants} · Defuses ${s.defuses} · Damage ${s.damageDealt}`,
      });
      input.releaseLock();
    } else if (event.type === 'bombPlanted') {
      hud.banner(`Spike planted at Site ${event.site} — defend it`);
      hud.setBomb(`SPIKE PLANTED · SITE ${event.site}`);
    } else if (event.type === 'bombExploded') {
      hud.setBomb('');
    } else if (event.type === 'bombDefused') {
      hud.setBomb('');
    } else if (event.type === 'bombPickup') {
      hud.banner(event.by === 'player' ? 'You picked up the spike' : `${event.by} picked up the spike`);
    }
  }
}

function step(dt) {
  simNow += dt;
  elapsed += dt;
  botPlanting = null;
  botDefusing = null;
  const keys = input.state.keys;
  const phase = game.state.phase;

  // One-shot keys.
  for (const code of input.drainPressed()) {
    if (code === 'KeyB' && phase === 'buy' && playerState.alive) {
      if (hud.isBuyOpen()) { hud.closeBuy(); input.requestLock(); }
      else { hud.openBuy(game.state.money, ownedSnapshot()); input.releaseLock(); }
    } else if (code === 'KeyG') {
      throwGrenade();
    } else if (code === 'KeyH') {
      throwSmoke();
    } else if (code === 'KeyF') {
      throwFlash();
    } else if (code === 'KeyR') {
      if (weapon.reload()) audio.reload();
    } else if (code === 'Digit1') weapon.equip('P9');
    else if (code === 'Digit2' && weapon.own('VK9')) weapon.equip('VK9');
    else if (code === 'Digit3' && weapon.own('AR77')) weapon.equip('AR77');
    else if (code === 'Digit4' && weapon.own('LW50')) weapon.equip('LW50');
    else if (hud.isBuyOpen()) {
      const map = { Digit1: 'VK9', Digit2: 'AR77', Digit3: 'LW50', Digit4: 'grenade', Digit5: 'smoke', Digit6: 'flash', Digit7: 'armor' };
      if (map[code]) hud.buyKey(map[code]);
    }
  }

  if (phase === 'playing' && playerState.alive) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const wantScope = rightHeld && weapon.state.current === 'LW50' && weapon.state.reloadLeft === 0;
    if (wantScope !== playerState.scoped) {
      playerState.scoped = wantScope;
      hud.setScope(wantScope);
    }
    if (input.state.firing && weapon.ready()) playerShoot();
    player.step(dt, keys, (run) => audio.step(run));
    weapon.step(dt, player.groundSpeed() > 0.5, playerState.scoped);
  } else if (phase === 'buy' && playerState.alive) {
    player.step(dt, keys, (run) => audio.step(run));
    weapon.step(dt, player.groundSpeed() > 0.5, false);
  }

  // Player hitboxes follow the body, so bots can return fire.
  playerTorso.position.set(player.state.position.x, player.state.position.y + 1.0, player.state.position.z);
  playerHead.position.set(player.state.position.x, player.state.position.y + 1.53, player.state.position.z);
  playerTorso.visible = playerState.alive;
  playerHead.visible = playerState.alive;

  // Bomb facts for the state machine.
  const site = playerSite();
  const bomb = game.state.bomb;
  const side = game.state.playerSide;
  facts.playerAlive = playerState.alive;
  facts.playerIsAtk = side === 'atk';
  facts.atkAlive = (side === 'atk' && playerState.alive ? 1 : 0) + bots.aliveCount('atk');
  facts.defAlive = (side === 'def' && playerState.alive ? 1 : 0) + bots.aliveCount('def');
  facts.playerPos = player.state.position;
  facts.playerPlanting = bomb.state === 'player' && !!site && keys.has('KeyE') && playerState.alive;
  facts.playerSite = site;
  facts.playerDefusing = bomb.state === 'planted' && !!site && keys.has('KeyE') && playerState.alive;
  facts.botPlanting = botPlanting;
  facts.botSite = botPlanting ? botPlanting.site : null;
  facts.botDefusing = botDefusing;
  facts.planterIsPlayer = facts.playerPlanting;
  facts.defuserIsPlayer = facts.playerDefusing;
  // Nearest alive attacker carries a dropped spike.
  if (bomb.state === 'dropped' && bomb.pos) {
    let best = null;
    let bestD = Infinity;
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'atk') continue;
      const d = Math.hypot(bot.position.x - bomb.pos.x, bot.position.z - bomb.pos.z);
      if (d < bestD) { bestD = d; best = bot; }
    }
    facts.carrierBot = best;
  } else {
    facts.carrierBot = bomb.carrierBot;
  }

  // Combatants the bots can see: the player plus every living bot. Bots only
  // fight once the round is live; before that they walk to their posts.
  const combatants = [];
  if (phase === 'playing') {
    if (playerState.alive) {
      combatants.push({
        team: game.state.playerSide, pos: player.state.position, alive: true, noisy: input.state.firing,
        speed: () => player.groundSpeed(),
        aim: () => scratchVec.set(player.state.position.x, player.state.position.y + 1.1, player.state.position.z),
      });
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      combatants.push({
        team: bot.team, pos: bot.position, alive: true, noisy: bot.cooldown > 0.08,
        speed: () => Math.hypot(bot.velocity.x, bot.velocity.z),
        aim: () => scratchVec.set(bot.position.x, bot.position.y + 1.1, bot.position.z),
        bot,
      });
    }
  }
  if (phase !== 'menu' && phase !== 'matchEnd') {
    bots.step(dt, simNow, combatants, random, game);
    grenades.step(dt, damageAt, applyFlash);
  }
  game.update(dt, facts);
  handleEvents();

  // Bomb mesh follows the spike.
  if (bomb.state === 'planted' && bomb.site) {
    const c = world.sites[bomb.site].center;
    bombMesh.position.set(c.x, 0.15, c.z);
    bombMesh.visible = true;
    bombPoint.intensity = 4;
    if (bomb.timer < 10 && simNow - lastBeep > 0.5) {
      lastBeep = simNow;
      audio.plantBeep(true);
    } else if (bomb.timer >= 10 && simNow - lastBeep > 1) {
      lastBeep = simNow;
      audio.plantBeep(false);
    }
  } else if (bomb.state === 'dropped' && bomb.pos) {
    bombMesh.position.set(bomb.pos.x, 0.15, bomb.pos.z);
    bombMesh.visible = true;
    bombPoint.intensity = 1.5;
  } else {
    bombMesh.visible = false;
  }

  // Camera follows the player; scope narrows the field of view.
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  const targetFov = playerState.scoped ? 32 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  // HUD sync.
  hud.setHealth(playerState.hp, playerState.armor);
  hud.setAmmo(weapon.mag(), weapon.reserve(), playerState.grenades, playerState.smokes, playerState.flashes);
  hud.setMoney(game.state.money);
  hud.setScore(game.state.scoreZen, game.state.scoreUmb, game.state.round);
  hud.setAlive(facts.atkAlive, facts.defAlive);
  const planted = bomb.state === 'planted';
  hud.setTimer(planted ? bomb.timer : game.state.timer, planted);
  hud.setSpread(6 + weapon.spread(player.groundSpeed()) * 900);
  if (bomb.state === 'player' && site) {
    hud.setHint('Hold E to plant the spike');
  } else if (bomb.state === 'planted' && site) {
    hud.setHint('Hold E to defuse the spike');
  } else {
    hud.setHint('');
  }
  const plantProgress = bomb.state === 'player' || bomb.state === 'bot'
    ? bomb.progress / PLANT_SECONDS
    : bomb.state === 'planted' ? bomb.progress / DEFUSE_SECONDS : 0;
  const plantLabel = (bomb.state === 'player' || bomb.state === 'bot') && plantProgress > 0
    ? 'PLANTING SPIKE'
    : bomb.state === 'planted' && plantProgress > 0 ? 'DEFUSING SPIKE' : null;
  hud.setPlant(plantLabel, plantProgress);
  if (simNow - minimapAt > 0.15) {
    minimapAt = simNow;
    hud.drawMinimap(player.state, bots.bots.map((b) => ({
      ...b,
      spottedUntil: b.spottedUntil > simNow ? 1 : 0,
    })), bomb);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    for (const t of tracerPool) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      }
    }
    for (const f of flashPool) {
      if (f.life > 0) {
        f.life -= dt;
        f.mesh.material.opacity = Math.max(0, f.life / 0.14) * 0.9;
      }
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.closeBuy();
  game.newMatch();
  resetPositions();
  started = true;
  if (name === 'start') {
    player.state.position.set(0.6, 0, 13.5);
    player.state.yaw = 0;
    player.state.pitch = 0.02;
    settle(20);
    hud.showOverlay('menu');
    paintTwiceThenReady();
    return;
  }
  if (name === 'buy') {
    settle(10);
    hud.openBuy(game.state.money, ownedSnapshot());
    player.state.position.set(-2, 0, 12);
    player.state.yaw = 0.3;
    settle(10);
    paintTwiceThenReady();
    return;
  }
  // play / end: jump straight into a live round with enemies in sight.
  game.state.phase = 'playing';
  game.state.timer = 87;
  const plan = game.state.plan;
  bots.resetRound(random, plan);
  const defBot = bots.bots.find((b) => b.id === 'def-1');
  const defBot2 = bots.bots.find((b) => b.id === 'def-0');
  if (defBot) {
    defBot.position.set(2.5, 0, -2);
    defBot.yaw = 0;
    defBot.state = 'hold';
    defBot.holdUntil = 999;
  }
  if (defBot2) {
    defBot2.position.set(-4.5, 0, -6.5);
    defBot2.yaw = Math.PI / 2;
    defBot2.state = 'hold';
    defBot2.holdUntil = 999;
  }
  player.state.position.set(0, 0, 8.5);
  player.state.yaw = 0;
  player.state.pitch = 0;
  settle(30);
  if (name === 'play') {
    // Aim down mid at the defender holding the crates, then fire: a tracer
    // in the air, a hit marker, and one bot down for the kill feed. The bot
    // hunts the gunfire, so re-aim before every shot to track it.
    const aimBot = bots.bots.find((b) => b.id === 'def-1');
    function aimAtBot(bot) {
      const dx = bot.position.x - player.state.position.x;
      const dy = 1.1 - (player.state.position.y + player.state.eye);
      const dz = bot.position.z - player.state.position.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      player.state.yaw = Math.atan2(-dx, -dz);
      player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      settle(1); // let the camera sync to the new aim before firing
    }
    if (aimBot) {
      for (let i = 0; i < 4; i += 1) {
        aimAtBot(aimBot);
        playerShoot();
        settle(3);
      }
      settle(8);
    }
    hud.setScore(0, 0, 1);
    paintTwiceThenReady();
    return;
  }
  // end: attackers take the round.
  game.endRound('atk', 'Enemy team eliminated');
  handleEvents();
  hud.hideBanner();
  settle(10);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.showOverlay('menu');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
window.__gameReady = true;
// Debug handle for local play-testing (read-only state, no cheats).
window.__ember = { game, bots, player, weapon, playerState };
