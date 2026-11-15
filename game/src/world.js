// Zenith Observatory: a night mountaintop station, 40 x 32 m, built from boxes.
// Two bomb sites (A under the telescope dome, B among the dish array), three
// lanes (A long, mid, B long), attacker spawn south, defender spawn north.
// Every box is a collider for players and bots and a surface a bullet stops on.
// Plain geometry only, plus a few props that make the station read at night:
// mast lights, cryo tanks, hazard stripes at the site doors, an aurora sky
// with stars, and a mountain silhouette beyond the walls.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './utils.js';

// Waypoints the bots walk: nodes on the lanes, at cover and at both sites.
const NODES = [
  [0, 14.5], [0, 10], [0, 4], [0, -1], [0, -7], [0, -14], // 0-5 spine
  [-9, 10], [-10, 2], [-11, -4], [-15, -6], [-8, -8], // 6-10 A lane
  [9, 10], [10, 2], [11, -4], [15, -6], [8, -8], // 11-15 B lane
  [-14, 6], [14, 6], [-5, 0], [5, 0], // 16-19 cover
  [-16, -12], [16, -12], [0, -11], [-6, 13], [6, 13], // 20-24 backs
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
  [0, 23], [0, 24], [23, 6], [24, 11], [1, 6], [1, 11],
  [6, 7], [7, 8], [8, 9], [8, 10], [10, 4], [9, 20], [20, 5],
  [11, 12], [12, 13], [13, 14], [13, 15], [15, 4], [14, 21], [21, 5],
  [2, 18], [2, 19], [18, 7], [19, 12], [16, 6], [17, 11],
  [3, 18], [3, 19], [4, 22], [22, 5], [16, 7], [17, 12],
];

function makeSiteDecal(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#58e6c8';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = '#58e6c8';
  g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function makeHazardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const g = canvas.getContext('2d');
  g.fillStyle = '#101a2c';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#58e6c8';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 32);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'accent']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), roughness: 0.8, metalness: 0.05,
    emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25,
  });
  const colliders = [];
  const shootables = [];
  const map2d = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      map2d.push({ x: x - w / 2, z: z - d / 2, w, d });
    }
    return mesh;
  }

  // Ground and perimeter: 40 x 32 m yard, 5 m walls, open night sky.
  box(40.4, 0.4, 32.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 32.4, -20.2, 2.5, 0, 'surface');
  box(0.4, 5, 32.4, 20.2, 2.5, 0, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, -16.2, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, 16.2, 'surface');

  // Site A dome base: three walls with two door gaps, open roof, with the
  // telescope dome itself sitting on top (visual only, above the sightlines).
  box(0.5, 4.2, 8, -19.6, 2.1, -6, 'surface');
  box(8.5, 4.2, 0.5, -15.4, 2.1, -10.2, 'surface');
  box(3.2, 4.2, 0.5, -17.9, 2.1, -1.8, 'surface');
  box(2.6, 4.2, 0.5, -12.6, 2.1, -1.8, 'surface');
  box(5, 0.5, 3.4, -17.2, 0.25, -8.6, 'hairline'); // loading platform
  // Site B dish array: stacked equipment housings as tall cover.
  box(6.2, 2.6, 2.4, 16.4, 1.3, -11.6, 'hairline');
  box(6.2, 2.6, 2.4, 16.4, 3.9, -11.6, 'surface');
  box(2.4, 2.6, 6.2, 12.4, 1.3, -6.4, 'hairline');
  box(2.4, 2.6, 2.4, 18.2, 1.3, -4.2, 'surface');

  // Mid: a crate stack the lanes pivot around, plus low walls.
  box(2.4, 2.2, 2.4, 0, 1.1, -1, 'hairline');
  box(1.6, 1.1, 1.6, 0, 2.75, -1, 'surface');
  box(4.4, 1.1, 0.8, -5.4, 0.55, 2.6, 'hairline');
  box(4.4, 1.1, 0.8, 5.4, 0.55, 2.6, 'hairline');
  box(0.8, 1.1, 4.4, -8.6, 0.55, -6.4, 'hairline');
  box(0.8, 1.1, 4.4, 8.6, 0.55, -6.4, 'hairline');

  // Lane cover: crates to crouch behind, pillars to peek around.
  box(1.6, 1.1, 1.6, -9, 0.55, 6, 'hairline');
  box(1.6, 1.1, 1.6, 9, 0.55, 6, 'hairline');
  box(1.2, 3.4, 1.2, -4, 1.7, 8, 'surface');
  box(1.2, 3.4, 1.2, 4, 1.7, 8, 'surface');
  box(1.2, 3.4, 1.2, -4, 1.7, -11, 'surface');
  box(1.2, 3.4, 1.2, 4, 1.7, -11, 'surface');
  box(2.2, 0.9, 2.2, -13, 0.45, 3, 'hairline');
  box(2.2, 0.9, 2.2, 13, 0.45, 3, 'hairline');
  box(1.6, 1.1, 3.4, -14.5, 0.55, 10.5, 'hairline');
  box(1.6, 1.1, 3.4, 14.5, 0.55, 10.5, 'hairline');
  // Defender-side platform with a sightline down mid.
  box(6, 0.5, 2.6, 0, 0.25, -13.4, 'surface');
  box(0.5, 1.0, 2.6, -3, 0.75, -13.4, 'hairline');
  box(0.5, 1.0, 2.6, 3, 0.75, -13.4, 'hairline');

  // Cryo tanks: round cover tucked against the walls, clear of the bot lanes.
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3d5a74'), roughness: 0.7, metalness: 0.25 });
  const barrelMat2 = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a6b5a'), roughness: 0.7, metalness: 0.25 });
  for (const [x, z, mat, collide] of [
    [-18.9, 1.5, barrelMat, true], [-18.9, 3.0, barrelMat2, true],
    [18.9, 1.5, barrelMat2, true], [18.9, 3.0, barrelMat, true],
    [-2.5, 15.2, barrelMat, true], [16.9, 13.8, barrelMat2, false],
  ]) {
    const barrel = new THREE.Mesh(barrelGeo, mat);
    barrel.position.set(x, 0.58, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(barrel));
      shootables.push(barrel);
      map2d.push({ x: x - 0.55, z: z - 0.55, w: 1.1, d: 1.1 });
    }
  }

  // Site markers: glowing floor plates the bomb can be planted on.
  const siteA = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.08, 5.4), siteMat);
  siteA.position.set(-15, 0.05, -6);
  siteA.receiveShadow = true;
  group.add(siteA);
  const siteB = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.08, 5.4), siteMat);
  siteB.position.set(15, 0.05, -6);
  siteB.receiveShadow = true;
  group.add(siteB);
  for (const [letter, x, z] of [['A', -15, -6], ['B', 15, -6]]) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: makeSiteDecal(letter), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.1, z);
    group.add(decal);
  }

  // Hazard stripes across each site's door, so the plant zone reads at a glance.
  const hazardTex = makeHazardTexture();
  const hazardMat = new THREE.MeshBasicMaterial({ map: hazardTex, transparent: true, opacity: 0.9, depthWrite: false });
  for (const [x, z, rot] of [[-12.4, -1.8, 0], [12.4, -1.8, 0]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), hazardMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = rot;
    strip.position.set(x, 0.09, z);
    group.add(strip);
  }

  // Mast lights: one over mid, one over each site approach. The lamp heads
  // glow cool white; two teal point lights (no shadows) lift the night.
  const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#141a26'), roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfe8ff') });
  for (const [x, z, tiltX, tiltZ] of [[-6.5, 0, 0.5, 0.35], [6.5, 0, 0.5, -0.35], [0, -12.5, 0.6, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 8), poleMat);
    pole.position.set(x, 3.2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), lampMat);
    head.position.set(x, 6.4, z);
    head.rotation.x = tiltX;
    head.rotation.z = tiltZ;
    group.add(head);
  }
  const warmA = new THREE.PointLight(new THREE.Color('#58e6c8'), 22, 26);
  warmA.position.set(-6.5, 6.2, 0);
  scene.add(warmA);
  const warmB = new THREE.PointLight(new THREE.Color('#8fb8ff'), 22, 26);
  warmB.position.set(6.5, 6.2, 0);
  scene.add(warmB);

  // Light: cold moonlight from the north-west, a cool fill, and a night sky.
  const sky = new THREE.HemisphereLight(new THREE.Color('#9db8dd'), new THREE.Color(PALETTE.canvas), 1.1);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#bcd3ff'), 2.6);
  sun.position.set(-18, 12, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6b8a'), 0.7);
  fill.position.set(14, 10, -12);
  scene.add(fill);

  // Night sky dome: a vertical gradient from deep navy overhead to a teal
  // aurora band at the horizon, so the sky above the walls is never a flat void.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const sg = skyCanvas.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#04060f');
  grad.addColorStop(0.45, '#0a1120');
  grad.addColorStop(0.68, '#0e2a33');
  grad.addColorStop(0.82, '#1d5a4e');
  grad.addColorStop(0.92, '#58e6c8');
  grad.addColorStop(1, '#0a1120');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  // Stars: a few hundred fixed points on the upper sky, seeded so every
  // load draws the same night.
  const starRand = mulberry32(7);
  const starCount = 320;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const theta = starRand() * Math.PI * 2;
    const phi = starRand() * Math.PI * 0.42;
    const r = 110;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi) + 4;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfeaff, size: 0.7, sizeAttenuation: false, fog: false }));
  scene.add(stars);

  // The telescope dome over Site A (visual only, above the sightlines) and
  // a dish on the Site B housings, so each site reads at a glance.
  const domeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b3a52'), roughness: 0.5, metalness: 0.35 });
  const domeCap = new THREE.Mesh(new THREE.SphereGeometry(4.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  domeCap.position.set(-15.5, 4.2, -6);
  scene.add(domeCap);
  const domeRing = new THREE.Mesh(
    new THREE.RingGeometry(4.0, 4.45, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), side: THREE.DoubleSide }),
  );
  domeRing.rotation.x = -Math.PI / 2;
  domeRing.position.set(-15.5, 4.25, -6);
  scene.add(domeRing);
  const dishMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8fa3bd'), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
  const dish = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.3, 20, 1, true), dishMat);
  dish.position.set(16.4, 5.9, -11.6);
  dish.rotation.x = Math.PI * 0.78;
  dish.rotation.z = 0.3;
  scene.add(dish);
  const dishPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.0, 10), domeMat);
  dishPedestal.position.set(16.4, 5.5, -11.6);
  scene.add(dishPedestal);

  // More of the station beyond the walls: a second dome to the west and a
  // dish pair to the east, silhouettes against the aurora. No collision.
  const farDome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  farDome.position.set(-28, 0, -9);
  scene.add(farDome);
  for (const [x, z, tilt] of [[27, -9, 0.7], [29, -2, 0.9]]) {
    const farDish = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.2, 20, 1, true), dishMat);
    farDish.position.set(x, 4.2, z);
    farDish.rotation.x = Math.PI * tilt;
    scene.add(farDish);
  }

  // Mountain silhouette beyond the walls: dark cones and slabs at varied
  // heights, so the horizon reads as a range instead of a gradient. No
  // collision, never lit.
  const skylineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#070b16'), fog: false });
  for (const [x, z, r, h] of [
    [-30, -26, 9, 18], [-14, -32, 7, 24], [4, -34, 10, 15],
    [22, -28, 8, 21], [34, -10, 7, 14], [-34, 8, 8, 19],
    [34, 14, 9, 13], [-28, 28, 10, 17], [10, 32, 8, 22],
    [28, 28, 7, 12],
  ]) {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4), skylineMat);
    peak.position.set(x, h / 2 - 1, z);
    peak.rotation.y = Math.PI / 4;
    scene.add(peak);
  }

  // Aurora strip lights on the perimeter walls, for depth after dark.
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  for (const [x, z, w, d] of [[-19.9, 0, 0.1, 8], [19.9, 0, 0.1, 8], [0, -15.9, 8, 0.1]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), stripMat);
    strip.position.set(x, 3.6, z);
    group.add(strip);
  }

  // Nav graph: adjacency from the edge list, plus node positions.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    map2d,
    bounds: { minX: -20, maxX: 20, minZ: -16, maxZ: 16 },
    sites: {
      A: { minX: -18.4, maxX: -11.6, minZ: -8.8, maxZ: -3.2, center: { x: -15, z: -6 } },
      B: { minX: 11.6, maxX: 18.4, minZ: -8.8, maxZ: -3.2, center: { x: 15, z: -6 } },
    },
    spawns: {
      atk: [{ x: -6, z: 14.8 }, { x: -3, z: 14.5 }, { x: 0, z: 15 }, { x: 3, z: 14.5 }, { x: 6, z: 14.8 }],
      def: [{ x: -6, z: -14.8 }, { x: -3, z: -14.5 }, { x: 0, z: -15 }, { x: 3, z: -14.5 }, { x: 6, z: -14.8 }],
    },
    nodes: NODES.map(([x, z]) => ({ x, z })),
    adjacency,
    nearestNode(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < NODES.length; i += 1) {
        const dx = NODES[i][0] - x;
        const dz = NODES[i][1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    },
    // BFS path of node indices from `from` to `to` (inclusive), or [to].
    path(from, to) {
      if (from === to) return [to];
      const prev = new Array(NODES.length).fill(-1);
      const queue = [from];
      prev[from] = from;
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const next of adjacency[cur]) {
          if (prev[next] !== -1) continue;
          prev[next] = cur;
          if (next === to) {
            const out = [to];
            let n = cur;
            while (n !== from) { out.unshift(n); n = prev[n]; }
            out.unshift(from);
            return out;
          }
          queue.push(next);
        }
      }
      return [to];
    },
  };
}
