// The things around the bodies: pickups, pads and their cue path, the hook's rope, comet tails, the
// asteroid belt and the flying asteroids. The models (assets/models/props.glb, from tools/blender/props.py; a
// weapon pickup shows its gun from weapons.glb) replace the simple shapes when they load; which model shows
// for a pickup and where the tails run are in look/proppose.js.
import * as THREE from "three";
import { BELT, ASTEROID, ROCK_LOOK, LOOK } from "../../tuning.js";
import { v3, Y } from "./common.js";
import { add, scale, cross, norm, len, anyPerpendicular } from "../../sim/vec.js";
import { WEAPON_COLORS } from "./weapons.js";
import { alienMaterial } from "./aliens.js";
import { pickupModel, tailAt } from "./proppose.js";

export const PROP_ASSETS = [{ name: "props", url: "assets/models/props.glb" }];
const P = LOOK.props;

// The parts that glow in their own colour, so a pickup or pad reads on a night side.
const glows = (name) => name.endsWith("_accent") || ["cross", "fuel_glow", "pad_light", "lens"].includes(name);

// A model's material, patched like the figures' so the sun is taken away where a planet hides it (the scene's
// sun is a point light that shines through planets), its glowing parts lit by their own colour.
function propMaterial(src, glow) {
  const m = alienMaterial(src);
  if (glows(src.name)) m.emissiveIntensity = glow;
  return m;
}

// Each source material once, passed through `make`; returns the new ones.
function swapAll(root, make) {
  const mats = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!mats.has(o.material)) mats.set(o.material, make(o.material));
    o.material = mats.get(o.material);
  });
  return [...mats.values()];
}

// One soft round light, shared by every halo.
let haloTexture = null;
function haloMap() {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d"), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (haloTexture = new THREE.CanvasTexture(c));
}
const haloMaterial = (color, opacity) => new THREE.SpriteMaterial({ map: haloMap(), color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function halo(color, [size, opacity]) {
  const s = new THREE.Sprite(haloMaterial(color, opacity));
  s.scale.set(size, size, 1);
  return s;
}

// A pickup's simple look, until the model loads: health a white box with a red cross, fuel an orange can, a
// weapon a long bar and ammo a small box in the weapon's colour. The same shape as a faint wireframe marks a
// spot waiting to refill.
export function pickupMesh(pk, wire) {
  const mat = (color) => (wire
    ? new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 })
    : new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4 }));
  const g = new THREE.Group();
  if (pk.kind === "health") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(0xffffff)));
    if (!wire) {
      for (const [w, h] of [[0.62, 0.18], [0.18, 0.62]]) g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.62), mat(0xe0443e)));
    }
  } else if (pk.kind === "fuel") {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 12), mat(0xff9a2e)));
  } else if (pk.kind === "weapon") {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 1.1), mat(WEAPON_COLORS[pk.weapon])));
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(WEAPON_COLORS[pk.weapon])));
  }
  return g;
}

// A spot waiting to refill shows its model as a faint ghost.
const GHOST = new THREE.MeshBasicMaterial({ color: 0xa8c4e8, transparent: true, opacity: 0.14, depthWrite: false });

const dispose = (root) => root.traverse((o) => {
  if (!o.isMesh) return;
  o.geometry.dispose();
  if (o.material !== GHOST) o.material.dispose();
});

// A pickup: { group, dress(files), show(ready, sun) }. The caller places and turns the group (up +y). dress
// swaps the model in once its file is in (files: { props, weapons }, GLTFLoader results or null); show sets
// whether it is there to take (else the ghost) and how much sunlight reaches it (0..1).
export function pickupLook(pk) {
  const group = new THREE.Group(), choice = pickupModel(pk);
  const colour = choice.tint ?? (pk.kind === "weapon" ? WEAPON_COLORS[pk.weapon] : pk.kind === "health" ? 0xff6a5a : 0xffa040);
  const glow = halo(colour, P.pickups.halo);
  let solid = pickupMesh(pk, false), ghost = pickupMesh(pk, true), lit = [], dull = [], dressed = false;
  group.add(solid, ghost, glow);
  return {
    group,
    dress(files) {
      const node = !dressed && files[choice.file]?.scene.getObjectByName(choice.node);
      if (!node) return;
      dressed = true;
      // A gun is built at its first-person size with the grip at its origin: bigger here, and centred.
      const model = new THREE.Group(), copy = node.clone(true);
      copy.position.set(0, 0, 0);
      if (choice.file === "weapons") {
        copy.scale.setScalar(P.pickups.weapon);
        copy.position.sub(new THREE.Box3().setFromObject(copy).getCenter(new THREE.Vector3()));
      }
      model.add(copy);
      const shade = model.clone(true);
      lit = swapAll(model, (src) => propMaterial(src, P.pickups.glow));
      if (choice.tint !== null) for (const m of lit) if (m.name === "ammo_accent") m.color.setHex(choice.tint), m.emissive.setHex(choice.tint);
      dull = lit.filter((m) => !glows(m.name));
      shade.traverse((o) => o.isMesh && (o.material = GHOST));
      group.remove(solid, ghost);
      dispose(solid), dispose(ghost);
      group.add((solid = model), (ghost = shade));
    },
    show(ready, sun) {
      solid.visible = glow.visible = ready;
      ghost.visible = !ready;
      for (const m of lit) m.userData.sun.value = sun * P.pickups.sun;
      for (const m of dull) m.emissive.copy(m.color).multiplyScalar(P.pickups.night * (1 - sun));
    },
  };
}

// A pad: { group, dress(props), cue(colour, sun) }, on the ground (n its up) with an arrow along its launch
// direction. Until the model loads a disk and a cone in one material, recoloured by the cue; then a metal plate
// whose lights and arrow take the cue's colour. sun: 0..1, how much sunlight reaches it.
export function padLook(n, dir) {
  const fallback = new THREE.MeshLambertMaterial({ color: P.pads.misses });
  const group = new THREE.Group();
  const toN = new THREE.Quaternion().setFromUnitVectors(Y, v3(n)), toDir = new THREE.Quaternion().setFromUnitVectors(Y, v3(dir));
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.25, 20), fallback);
  disk.quaternion.copy(toN);
  disk.position.copy(v3(scale(n, 0.1)));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 10), fallback);
  arrow.quaternion.copy(toDir);
  arrow.position.copy(v3(add(scale(n, 0.5), scale(dir, 0.5))));
  const glow = halo(P.pads.misses, P.pads.halo);
  glow.position.copy(v3(scale(n, 0.4)));
  group.add(disk, arrow, glow);
  let lights = [], lit = [];
  return {
    group,
    dress(props) {
      const plate = props?.scene.getObjectByName("pad"), point = props?.scene.getObjectByName("pad_arrow");
      if (lit.length || !plate || !point) return;
      const p = plate.clone(true), a = point.clone(true);
      p.position.set(0, 0, 0);
      p.quaternion.copy(toN);
      a.quaternion.copy(toDir);
      a.position.copy(v3(scale(n, 0.35)));
      const mats = [...swapAll(p, (src) => propMaterial(src, P.pads.glow)), ...swapAll(a, (src) => propMaterial(src, P.pads.glow))];
      lights = mats.filter((m) => m.name === "pad_light");
      lit = mats.filter((m) => !lights.includes(m));
      group.remove(disk, arrow);
      disk.geometry.dispose(), arrow.geometry.dispose();
      group.add(p, a);
    },
    cue(colour, sun) {
      fallback.color.setHex(colour);
      for (const m of lights) m.color.setHex(colour), m.emissive.setHex(colour);
      glow.material.color.setHex(colour);
      for (const m of lit) m.userData.sun.value = sun * P.pickups.sun; // lit like a pickup
    },
  };
}

// The nearest pad's cue: where a launch from it goes.
export function cuePath() {
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
  // Dashed, so a cue can't be mistaken for an orbit line.
  const pathMat = new THREE.LineDashedMaterial({ color: P.pads.lands, dashSize: 1, gapSize: 0.7 });
  const path = new THREE.Line(pathGeo, pathMat);
  path.frustumCulled = false;
  return { path, pathGeo, pathMat };
}

// The rope, from the hand to where the hook caught.
export function ropeLine() {
  const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9d2c0 }));
  rope.frustumCulled = false;
  return { rope, ropeGeo };
}

// One comet tail: a tube along tailAt, rewritten each frame (a few hundred points), glowing and fading to its
// tip. Its edges fade where the view grazes them, so it reads as a soft plume, not a pipe. The dust tail is a
// fan, flatter across the plane it curves in.
const ALONG = 32, ROUND = 12;
function tailTube(cfg, flat) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(3 * ALONG * ROUND), nrm = new Float32Array(3 * ALONG * ROUND), along = new Float32Array(ALONG * ROUND);
  const index = [];
  for (let i = 0; i < ALONG; i++) {
    for (let j = 0; j < ROUND; j++) {
      along[i * ROUND + j] = i / (ALONG - 1);
      if (i === ALONG - 1) continue;
      const a = i * ROUND + j, b = i * ROUND + ((j + 1) % ROUND);
      index.push(a, a + ROUND, b, b, a + ROUND, b + ROUND);
    }
  }
  geo.setIndex(index);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("along", new THREE.BufferAttribute(along, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(cfg.color) }, opacity: { value: cfg.opacity } },
    vertexShader: /* glsl */ `
      attribute float along;
      varying float vAlong, vFace;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(normal), normalize(cameraPosition - w.xyz)));
        vAlong = along;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlong, vFace;
      void main() {
        float a = opacity * pow(1.0 - vAlong, 1.3) * vFace * vFace;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // tail: from look/proppose.js cometTails.
  mesh.userData.set = (tail) => {
    // The tail curves in the plane of `away` and `lag`; its normal stays square to the tail all along.
    const side = len(tail.lag) > 0 ? norm(cross(tail.away, tail.lag)) : anyPerpendicular(tail.away);
    for (let i = 0; i < ALONG; i++) {
      const s = i / (ALONG - 1), c = tailAt(tail, s);
      const along = norm(add(tail.away, scale(tail.lag, 2 * tail.bend * s)));
      const across = cross(along, side), r = (tail.width[0] + (tail.width[1] - tail.width[0]) * s) / 2;
      for (let j = 0; j < ROUND; j++) {
        const a = (2 * Math.PI * j) / ROUND, cs = Math.cos(a), sn = Math.sin(a), k = 3 * (i * ROUND + j);
        for (let d = 0; d < 3; d++) {
          pos[k + d] = c[d] + r * (side[d] * cs * flat + across[d] * sn);
          nrm[k + d] = side[d] * cs + across[d] * sn; // side and across are square unit vectors
        }
      }
    }
    geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true;
  };
  return mesh;
}

// A comet's two tails: { group, update(tails) } with tails from look/proppose.js cometTails.
export function cometTailLook() {
  const dust = tailTube(P.comets.dust, 0.45), ion = tailTube(P.comets.ion, 1);
  const group = new THREE.Group();
  group.add(dust, ion);
  return { group, update: ({ ion: i, dust: d }) => (ion.userData.set(i), dust.userData.set(d)) };
}

// The rocks' hollows: each vertex's `hollow`, 0 on the outer 85 % of the rock's vertices (by distance from its
// centre) up to 1 at its deepest dent. Ranked per rock, as some rocks are lumpier than others. Darker in the
// belt, glowing on a flying rock. The simple rock has none (0 everywhere).
function withHollows(geo) {
  if (geo.attributes.hollow) return geo;
  const p = geo.attributes.position, r = Float32Array.from({ length: p.count }, (_, i) => Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
  const sorted = [...r].sort((a, b) => a - b), low = sorted[0], edge = sorted[Math.floor(0.15 * (sorted.length - 1))];
  geo.setAttribute("hollow", new THREE.BufferAttribute(r.map((x) => Math.min(1, Math.max(0, (edge - x) / Math.max(edge - low, 1e-6)))), 1));
  return geo;
}
const simpleRock = () => {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  geo.setAttribute("hollow", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  return geo;
};
const HOLLOW_VERTEX = ["#include <begin_vertex>", "#include <begin_vertex>\nvHollow = hollow;"];

// The asteroid belt: one instanced mesh of tumbling rocks, turning round the sun the way the planets go.
// Looks only, so it lives here and not in the simulation. Until the model loads each rock is a dodecahedron;
// then the four rocks share one geometry and each instance shows one (the others fold to a point), so the
// whole belt stays one draw.
export function asteroidBelt(rand) {
  const plain = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const mesh = new THREE.InstancedMesh(simpleRock(), plain, BELT.rocks);
  const rocks = [], base = new THREE.Color(P.rocks.belt);
  for (let i = 0; i < BELT.rocks; i++) {
    const r = BELT.inner + rand() * (BELT.outer - BELT.inner), a = rand() * 2 * Math.PI;
    const s = BELT.size[0] + rand() * (BELT.size[1] - BELT.size[0]);
    rocks.push({
      pos: new THREE.Vector3(r * Math.cos(a), (rand() - 0.5) * BELT.thick, r * Math.sin(a)),
      scale: new THREE.Vector3(s, s * (0.6 + rand() * 0.4), s * (0.7 + rand() * 0.3)),
      axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      rate: 0.2 + rand() * 0.8,
    });
    mesh.setColorAt(i, base.clone().offsetHSL(0, 0, (rand() - 0.5) * 2 * P.rocks.variety));
  }
  const group = new THREE.Group();
  group.add(mesh);
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  let dressed = false;
  return {
    group,
    dress(props) {
      const parts = props && [0, 1, 2, 3].map((k) => props.scene.getObjectByName(`rock_${k}`));
      if (dressed || !parts || parts.some((p) => !p?.isMesh)) return;
      dressed = true;
      const geo = mergeRocks(parts.map((p) => withHollows(p.geometry)));
      geo.setAttribute("pick", new THREE.InstancedBufferAttribute(Float32Array.from(rocks, (_, i) => i % parts.length), 1));
      const mat = plain.clone();
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float variant, pick, hollow;\nvarying float vHollow;")
          .replace(HOLLOW_VERTEX[0], `${HOLLOW_VERTEX[1]}\nif (abs(variant - pick) > 0.5) transformed = vec3(0.0);`);
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vHollow;")
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.55 * vHollow;");
      };
      mat.customProgramCacheKey = () => "belt-rock";
      mesh.geometry.dispose();
      mesh.geometry = geo;
      mesh.material = mat;
    },
    update(t) {
      group.rotation.y = (-2 * Math.PI * t) / BELT.period; // three's +y turn runs x towards -z; orbits go x towards +z
      rocks.forEach((k, i) => mesh.setMatrixAt(i, m.compose(k.pos, q.setFromAxisAngle(k.axis, k.rate * t), k.scale)));
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// The rocks' geometries as one, each vertex marked with the rock it belongs to (`variant`).
function mergeRocks(geos) {
  const pos = [], nrm = [], hollow = [], variant = [], index = [];
  geos.forEach((g, k) => {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    hollow.push(...g.attributes.hollow.array);
    for (let i = 0; i < g.attributes.position.count; i++) variant.push(k);
    for (const i of g.index.array) index.push(base + i);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("hollow", new THREE.Float32BufferAttribute(hollow, 1));
  geo.setAttribute("variant", new THREE.Float32BufferAttribute(variant, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

// Flying asteroids: a dark rough rock, glowing orange-hot in its hollows and round its edge, in a hot haze, and
// a fading streak of where it has been. Returns { make(), fit(mesh, id), dress(props) }: make gives one rock's
// { mesh, line } (the caller keeps them per rock id); fit gives a rock its shape (one of the four, by id, once
// the model is in); dress takes the model.
export function flyingRocks() {
  let shapes = [simpleRock()];
  const rockMat = new THREE.MeshLambertMaterial({ color: ROCK_LOOK.rock, emissive: ROCK_LOOK.hot, flatShading: true });
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.cracks = { value: P.rocks.cracks };
    sh.uniforms.rim = { value: P.rocks.rim };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float hollow;\nvarying float vHollow;")
      .replace(HOLLOW_VERTEX[0], HOLLOW_VERTEX[1]);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHollow;\nuniform float cracks, rim;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
        totalEmissiveRadiance *= cracks * vHollow * vHollow + rim * edge;`);
  };
  rockMat.customProgramCacheKey = () => "flying-rock";
  const glowMat = haloMaterial(ROCK_LOOK.hot, ROCK_LOOK.glowOpacity);
  const shape = (id) => shapes[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % shapes.length];
  return {
    make() {
      const mesh = new THREE.Mesh(shapes[0], rockMat);
      mesh.scale.setScalar(ASTEROID.radius);
      const haze = new THREE.Sprite(glowMat);
      haze.scale.setScalar(2 * ROCK_LOOK.glow); // in the rock's own (unit) size
      mesh.add(haze);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * ROCK_LOOK.trail), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3 * ROCK_LOOK.trail), 3));
      // Points, not a line: a line is one pixel wide and vanishes at distance. Close together they read as a streak.
      // Soft round dots, so the streak glows rather than showing squares up close.
      const line = new THREE.Points(geo, new THREE.PointsMaterial({ size: ROCK_LOOK.trailSize, map: haloMap(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      line.frustumCulled = false;
      return { mesh, line };
    },
    fit(mesh, id) {
      const g = shape(id);
      if (mesh.geometry !== g) mesh.geometry = g;
    },
    dress(props) {
      const parts = props && [0, 1, 2, 3].map((k) => props.scene.getObjectByName(`rock_${k}`));
      if (shapes.length > 1 || !parts || parts.some((p) => !p?.isMesh)) return;
      shapes = parts.map((p) => withHollows(p.geometry));
    },
  };
}
