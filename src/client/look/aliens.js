// Everyone but you: the alien (assets/models/alien.glb, from tools/blender/alien.py) and the tag overhead.
// Until the model loads, or if it never does, a figure is two spheres, exactly the shapes shots test
// (PLAYER.hit). The pose comes from look/alienpose.js; this file turns it into the model's nodes.
import * as THREE from "three";
import { PLAYER, LOOK } from "../../tuning.js";
import { placeAlien } from "./alienpose.js";
import { weaponModels, weaponSet, swapMaterials, muzzleFlash, showFlash, spinGun } from "./weapons.js";
import { flashShown } from "./gunpose.js";
import { haloMap } from "./common.js";

export const DUMMY_COLOUR = LOOK.alien.dummy;
export const ALIEN_ASSETS = [{ name: "alien", url: "assets/models/alien.glb" }];

// The name and health bar over a head: a canvas drawn again only when what it shows changes. The depth
// test hides it behind planets; it shrinks with distance like anything else in the scene.
export function tagSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = PLAYER.height + 0.5;
  let shown = null;
  // fraction: health 0..1; flash: the bar is white for a moment after a hit.
  sprite.userData.show = (name, fraction, flash) => {
    const key = `${name}|${Math.round(fraction * 200)}|${flash}`;
    if (key === shown) return;
    shown = key;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#000a";
    ctx.strokeText(name, 128, 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, 128, 28);
    ctx.fillStyle = "#000a";
    ctx.fillRect(24, 40, 208, 16);
    ctx.fillStyle = flash ? "#fff" : "#5fd36b";
    ctx.fillRect(28, 44, 200 * Math.max(0, Math.min(1, fraction)), 8);
    tex.needsUpdate = true;
  };
  return sprite;
}

// The stand-in: a body sphere and a head sphere with a face on the head's forward side.
function simpleFigure() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: DUMMY_COLOUR });
  for (const { at, r } of [PLAYER.hit.body, PLAYER.hit.head]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
    ball.position.y = at;
    g.add(ball);
  }
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), white);
    eye.position.set(sx * 0.17, 1.32, -0.5);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), black);
    pupil.position.set(sx * 0.17, 1.32, -0.6);
    g.add(eye, pupil);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI), black);
  mouth.position.set(0, 1.08, -0.5);
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  g.userData.material = mat; // one material for both spheres, so the colour is set once
  return g;
}

// A figure in the scene: the stand-in and the tag; dressFigure swaps in the alien. The caller sets its matrix
// (feet at the origin, up +y, facing -z).
export function figureMesh() {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  const simple = simpleFigure();
  g.add(simple);
  g.userData = { simple, alien: null, tag: tagSprite() };
  g.add(g.userData.tag);
  return g;
}

// The model's materials, patched so the sun's light on a figure can be taken away where a planet hides the
// sun (the scene's sun is a point light that shines through planets, so a figure on a night side would be
// lit from below), and the bubble glows at its rim in the player's colour. The guns use it too: the one in
// view, and those in hands, which share their figure's shadow.
export function alienMaterial(src) {
  const m = src.clone();
  const sun = { value: 1 }, rim = { value: new THREE.Color(0) };
  const glass = src.name === "glass";
  m.userData.sun = sun;
  m.userData.rim = rim;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.sunSeen = sun;
    sh.uniforms.rimColour = rim;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float sunSeen;\nuniform vec3 rimColour;")
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= sunSeen;
        reflectedLight.directSpecular *= sunSeen;`);
    if (glass) {
      // The edge of the bubble, where the view grazes it: brighter and more solid, like a lit glass rim.
      sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float rimK = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += rimColour * rimK;
        diffuseColor.a = mix(diffuseColor.a, 1.0, 0.5 * rimK);`);
    }
  };
  m.customProgramCacheKey = () => (glass ? "alien-glass" : "alien");
  return m;
}

// Gives a figure's materials (by name) a player's colour: the skin, the trim's glow and the bubble's rim.
// Returns the colour.
function tint(mats, colour) {
  const c = new THREE.Color(colour);
  mats.get("skin")?.color.copy(c);
  const trim = mats.get("trim");
  if (trim) trim.emissive.copy(c).multiplyScalar(LOOK.alien.trim);
  mats.get("glass")?.userData.rim.value.copy(c).multiplyScalar(LOOK.alien.rim);
  return c;
}

// Your own arm in first person: the model's right arm (sleeve, glowing cuff and hand), placed so its hand
// holds the gun in view as a figure's hand holds its gun. That is the model's `hand` node undone, at the gun's
// size in view (1 / LOOK.alien.hold of the model's). Add it next to the guns in view. Returns { arm, lit,
// paint(colour) } (lit: its materials, which take the sun as the gun's do), or null if the model has no arm.
//   gltf: GLTFLoader's result for alien.glb
export function viewArm(gltf) {
  const src = gltf.scene.getObjectByName("armR"), hand = gltf.scene.getObjectByName("hand");
  if (!src || !hand) return null;
  const arm = src.clone(true), held = arm.getObjectByName("hand");
  held.parent.remove(held);
  const mats = new Map();
  arm.traverse((o) => {
    if (!o.isMesh) return;
    if (!mats.has(o.material.name)) mats.set(o.material.name, alienMaterial(o.material));
    o.material = mats.get(o.material.name);
  });
  mats.get("suit")?.color.setHex(LOOK.alien.suit);
  hand.updateMatrix();
  const k = 1 / LOOK.alien.hold;
  arm.matrixAutoUpdate = false;
  arm.matrix.makeScale(k, k, k).multiply(hand.matrix.clone().invert());
  let shown = null;
  return {
    arm, lit: [...mats.values()],
    paint(colour) {
      if (colour !== shown) tint(mats, (shown = colour));
    },
  };
}

// Dresses a figure as the alien (once the model has loaded). Each figure gets its own materials, as skin, trim
// and rim take its colour, and its own guns in the hand.
//   gltf: GLTFLoader's result for alien.glb
export function dressFigure(g, gltf) {
  const model = gltf.scene.clone(true);
  const mats = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    if (!mats.has(src.name)) mats.set(src.name, alienMaterial(src));
    o.material = mats.get(src.name);
  });
  mats.get("suit")?.color.setHex(LOOK.alien.suit);
  const nodes = {};
  for (const name of ["head", "body", "armL", "armR", "legL", "legR", "hand"]) nodes[name] = model.getObjectByName(name);
  const rest = {};
  for (const name of ["body", "armL", "armR", "legL", "legR"]) rest[name] = nodes[name].position.toArray();
  g.remove(g.userData.simple);
  g.add(model);
  const jets = jetFlames(["jetL", "jetR"].map((name) => model.getObjectByName(name)).filter(Boolean));
  g.userData.alien = { model, nodes, rest, mats, lit: [...mats.values()], guns: {}, gunMats: [], flash: muzzleFlash(), colour: null, jets, clock: 0 };
  armFigure(g, null);
}

// One flame shape for every nozzle: an open cone from the nozzle (its base, at the origin) to the tip at -y,
// bright at the nozzle and fading to nothing at the tip (vertex colours, added onto what is behind it).
let flameShape = null;
function flameGeometry() {
  if (flameShape) return flameShape;
  const g = new THREE.ConeGeometry(1, 1, 12, 4, true);
  g.rotateX(Math.PI);
  g.translate(0, -0.5, 0);
  const pos = g.attributes.position, col = new Float32Array(3 * pos.count);
  for (let i = 0; i < pos.count; i++) col.fill((1 + pos.getY(i)) ** 1.5, 3 * i, 3 * i + 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return (flameShape = g);
}

// The booster's flames, one at each of the model's nozzles (jetL and jetR, under body, so they lean with it):
// a white-hot core inside a longer flame in the player's colour, and a glow round the nozzle. Unlit and added
// onto the scene, so they read on a night side. Hidden until styleFigure lights them; none if the model has
// no nozzles. Returns { nozzles, flame, glow } (the last two the materials styleFigure colours).
function jetFlames(nozzles) {
  const { jet } = LOOK.alien;
  const added = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true };
  const flame = new THREE.MeshBasicMaterial({ ...added, opacity: jet.opacity });
  const core = new THREE.MeshBasicMaterial({ ...added, color: jet.core });
  const glow = new THREE.SpriteMaterial({ map: haloMap(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: jet.glow[1] });
  for (const n of nozzles) {
    const outer = new THREE.Mesh(flameGeometry(), flame), inner = new THREE.Mesh(flameGeometry(), core), light = new THREE.Sprite(glow);
    inner.scale.set(jet.coreShare[1], jet.coreShare[0], jet.coreShare[1]);
    outer.add(inner);
    const fire = new THREE.Group();
    fire.rotation.x = -jet.tilt; // tip down and back (+z is the figure's back)
    fire.add(outer);
    light.scale.setScalar(jet.glow[0]);
    n.add(fire, light);
    n.userData.jet = { fire, outer, light };
    fire.visible = light.visible = false;
  }
  return { nozzles, flame, glow, k: 0 };
}

// Where a dressed figure's flames start, in the world (the middle of its nozzles), or null if it has none or
// they are out. Call after styleFigure, which moves them.
export function jetAt(g) {
  const jets = g.userData.alien?.jets;
  if (!jets || !jets.nozzles.length || jets.k < 0.05) return null;
  g.updateMatrixWorld(true);
  const at = new THREE.Vector3(), p = new THREE.Vector3();
  for (const n of jets.nozzles) at.add(n.getWorldPosition(p));
  return at.divideScalar(jets.nozzles.length).toArray();
}

// Puts guns in a dressed figure's hand: the model's (once weapons.glb has loaded), else the simple ones. The
// hand's -z runs along the arm, as the guns' barrels do.
//   gltf: GLTFLoader's result for weapons.glb, or null
export function armFigure(g, gltf) {
  const a = g.userData.alien;
  for (const gun of Object.values(a.guns)) a.nodes.hand.remove(gun);
  a.lit = a.lit.filter((m) => !a.gunMats.includes(m));
  let guns, materials;
  if (gltf) ({ guns, materials } = weaponSet(gltf, alienMaterial));
  else materials = swapMaterials((guns = weaponModels()), alienMaterial);
  for (const gun of Object.values(guns)) {
    gun.scale.setScalar(LOOK.alien.hold);
    gun.visible = false;
    a.nodes.hand.add(gun);
  }
  a.guns = guns;
  a.gunMats = materials;
  a.lit.push(...materials);
  a.armed = !!gltf;
}

// This frame's look: colour (skin, trim and rim; hex), pose (look/alienpose.js), weapon (the held one's
// name), sun (0..1, how much sunlight reaches the figure), shot (its last shot, { since, gun } from
// look/gunpose.js) and seed (its shot count, which turns the flash), dt (s this frame, for the minigun's spin
// and the flames), boosting (the booster is firing: its flames burn).
export function styleFigure(g, colour, pose, weapon, sun, shot = null, seed = 0, dt = 0, boosting = false) {
  const a = g.userData.alien;
  if (!a) {
    g.userData.simple.userData.material.color.setHex(colour);
    return;
  }
  if (a.colour !== colour) {
    a.colour = colour;
    const c = tint(a.mats, colour);
    a.jets.flame.color.copy(c);
    a.jets.glow.color.copy(c);
  }
  burnJets(a, boosting, dt);
  for (const m of a.lit) m.userData.sun.value = sun * LOOK.alien.sun;
  const placed = placeAlien(pose, a.rest);
  for (const name in placed) {
    const n = a.nodes[name], { pos, rx } = placed[name];
    n.position.set(pos[0], pos[1], pos[2]);
    n.rotation.set(rx, 0, 0);
  }
  for (const [name, gun] of Object.entries(a.guns)) gun.visible = name === weapon;
  const held = a.guns[weapon];
  if (held && shot) spinGun(held, shot.since, dt);
  showFlash(a.flash, held, !!held && !!shot && flashShown(shot.since), shot, seed);
}

// Lights or puts out a figure's flames (easing in and out, as boosts start and stop all the time) and makes
// them flicker: each nozzle's flame wavers in length on its own beat.
function burnJets(a, boosting, dt) {
  const { jet } = LOOK.alien, jets = a.jets;
  a.clock += dt;
  jets.k += ((boosting ? 1 : 0) - jets.k) * (1 - Math.exp(-Math.max(0, dt) / jet.ease));
  const on = jets.k > 0.02;
  jets.nozzles.forEach((n, i) => {
    const { fire, outer, light } = n.userData.jet;
    fire.visible = light.visible = on;
    if (!on) return;
    const t = jet.rate * a.clock + 2.1 * i;
    const waver = 1 + jet.flicker * 0.5 * (Math.sin(t) + Math.sin(1.73 * t + 1));
    const w = jet.width * Math.sqrt(jets.k);
    outer.scale.set(w, jet.length * jets.k * waver, w);
    light.scale.setScalar(jet.glow[0] * jets.k);
  });
}
