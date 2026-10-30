// The things around the bodies: pickups, pads and their cue path, the hook's rope, comet tails, the
// asteroid belt and the flying asteroids. The models (assets/models/props.glb, from tools/blender/props.py; a
// weapon pickup shows its gun from weapons.glb) replace the simple shapes when they load; which model shows
// for a pickup and where the tails run are in look/proppose.js.
import * as THREE from "three";
import { BELT, ASTEROID, ROCK_LOOK, LOOK } from "../../tuning.js";
import { v3, Y, haloMap } from "./common.js";
import { add, sub, scale, cross, norm, len, anyPerpendicular } from "../../sim/vec.js";
import { WEAPON_COLORS } from "./weapons.js";
import { alienMaterial } from "./aliens.js";
import { pickupModel, tailAt, cometStir, comaLook, jetVents, jetLook } from "./proppose.js";

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

const nightTint = new THREE.Color();

// A pickup: { group, dress(files), show(ready, sun) }. The caller places and turns the group (up +y). dress
// swaps the model in once its file is in (files: { props, weapons }, GLTFLoader results or null); show sets
// whether it is there to take (else the ghost) and how much sunlight reaches it (0..1).
export function pickupLook(pk) {
  const group = new THREE.Group(), choice = pickupModel(pk);
  const colour = choice.tint ?? (pk.kind === "weapon" ? WEAPON_COLORS[pk.weapon] : pk.kind === "health" ? 0xff6a5a : 0xffa040);
  // The pickup's colour at full brightness: a dim one (the rocket's green, the sniper's blue) would give a dark
  // crate almost no glow and a faint halo at night.
  const tint = new THREE.Color(colour), most = Math.max(tint.r, tint.g, tint.b, 1e-6);
  tint.multiplyScalar(1 / most);
  const glow = halo(tint, P.pickups.halo);
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
      // Its own colour, and a little of the pickup's, so a dark part (the crate) still glows.
      const dark = 1 - sun;
      for (const m of dull) m.emissive.copy(m.color).multiplyScalar(P.pickups.night * dark).add(nightTint.copy(tint).multiplyScalar(P.pickups.nightTint * dark));
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

// One shape for every comet jet: a tube from a narrow vent (at the origin) widening to a unit-wide end at -y.
// `along` runs 0 at the vent to 1 at the end.
let plume = null;
function plumeShape() {
  if (plume) return plume;
  const g = new THREE.CylinderGeometry(0.15, 1, 1, 14, 6, true);
  g.translate(0, -0.5, 0);
  const p = g.attributes.position;
  g.setAttribute("along", new THREE.BufferAttribute(Float32Array.from({ length: p.count }, (_, i) => -p.getY(i)), 1));
  return (plume = g);
}

// A soft plume, as the tails are: fading to its end and at its edges, where the view grazes it.
function plumeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float along;
      varying float vAlong, vFace;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(mat3(modelMatrix) * normal), normalize(cameraPosition - w.xyz)));
        vAlong = along;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlong, vFace;
      void main() {
        gl_FragColor = vec4(color, opacity * pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.08, vAlong) * vFace * vFace);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// A comet's coma and jets, to add to the comet's mesh: { group, update(pos, sun, eye) } (positions in the
// world). The coma is a haze round it (behind its disc, as the sprite sits at its centre); the jets are plumes
// from its vents (look/proppose.js). Both unlit and added on.
export function cometHalo(body) {
  const cfg = P.comets, group = new THREE.Group();
  const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap(), color: cfg.coma.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(coma);
  const jets = jetVents(body.id).map((at) => {
    const mesh = new THREE.Mesh(plumeShape(), plumeMaterial(cfg.jets.color));
    mesh.position.set(...scale(at, body.radius * 0.97));
    group.add(mesh);
    return { at, mesh };
  });
  const down = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0);
  return {
    group,
    update(pos, sun, eye) {
      const toSun = norm(sub(sun, pos)), gap = len(sub(eye, pos)) - body.radius;
      const stir = cometStir(len(sub(sun, pos)));
      const c = comaLook(stir, gap, body.radius);
      coma.visible = c.opacity > 0.005;
      coma.scale.setScalar(c.size);
      coma.material.opacity = c.opacity;
      for (const { at, mesh } of jets) {
        const j = jetLook(at, toSun, stir);
        mesh.visible = j.opacity > 0.005;
        if (!mesh.visible) continue;
        mesh.material.uniforms.opacity.value = j.opacity;
        mesh.quaternion.setFromUnitVectors(d, down.set(...j.dir));
        mesh.scale.set(cfg.jets.width, j.length, cfg.jets.width);
      }
    },
  };
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

// The asteroid belt: tumbling rocks turning round the sun the way the planets go. Looks only, so it lives here
// and not in the simulation. Until the model loads it is one instanced mesh of dodecahedra; then one per rock
// shape (rock i shows shape i % 4), so each draw carries only its own shape's vertices.
export function asteroidBelt(rand) {
  const plain = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const rocks = [], base = new THREE.Color(P.rocks.belt);
  for (let i = 0; i < BELT.rocks; i++) {
    const r = BELT.inner + rand() * (BELT.outer - BELT.inner), a = rand() * 2 * Math.PI;
    const s = BELT.size[0] + rand() * (BELT.size[1] - BELT.size[0]);
    rocks.push({
      pos: new THREE.Vector3(r * Math.cos(a), (rand() - 0.5) * BELT.thick, r * Math.sin(a)),
      scale: new THREE.Vector3(s, s * (0.6 + rand() * 0.4), s * (0.7 + rand() * 0.3)),
      axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      rate: 0.2 + rand() * 0.8,
      color: base.clone().multiplyScalar(1 + (rand() - 0.5) * 2 * P.rocks.variety),
    });
  }
  const group = new THREE.Group();
  // An instanced mesh of `geo` drawing the rocks in `ids`, each in its own shade.
  const draw = (geo, mat, ids) => {
    const mesh = new THREE.InstancedMesh(geo, mat, ids.length);
    ids.forEach((id, j) => mesh.setColorAt(j, rocks[id].color));
    mesh.userData.ids = ids;
    group.add(mesh);
    return mesh;
  };
  let meshes = [draw(simpleRock(), plain, rocks.map((_, i) => i))];
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  return {
    group,
    dress(props) {
      const parts = props && [0, 1, 2, 3].map((k) => props.scene.getObjectByName(`rock_${k}`));
      if (meshes.length > 1 || !parts || parts.some((p) => !p?.isMesh)) return;
      const mat = plain.clone();
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float hollow;\nvarying float vHollow;")
          .replace(HOLLOW_VERTEX[0], HOLLOW_VERTEX[1]);
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vHollow;")
          .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.55 * vHollow;");
      };
      mat.customProgramCacheKey = () => "belt-rock";
      for (const old of meshes) group.remove(old), old.geometry.dispose(), old.dispose();
      meshes = parts.map((p, k) => draw(withHollows(p.geometry), mat, rocks.map((_, i) => i).filter((i) => i % parts.length === k)));
    },
    update(t) {
      group.rotation.y = (-2 * Math.PI * t) / BELT.period; // three's +y turn runs x towards -z; orbits go x towards +z
      for (const mesh of meshes) {
        mesh.userData.ids.forEach((id, j) => {
          const k = rocks[id];
          mesh.setMatrixAt(j, m.compose(k.pos, q.setFromAxisAngle(k.axis, k.rate * t), k.scale));
        });
        mesh.instanceMatrix.needsUpdate = true; // rocks only tumble in place, so the first frame's bounds hold
      }
    },
  };
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
