// Everyone but you: the alien (assets/models/alien.glb, from tools/blender/alien.py) and the tag overhead.
// Until the model loads, or if it never does, a figure is two spheres, exactly the shapes shots test
// (PLAYER.hit). The pose comes from look/alienpose.js; this file turns it into the model's nodes.
import * as THREE from "three";
import { PLAYER, LOOK } from "../../tuning.js";
import { placeAlien } from "./alienpose.js";
import { weaponModels, weaponSet, swapMaterials, muzzleFlash, showFlash, spinGun } from "./weapons.js";
import { flashShown } from "./gunpose.js";

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
  g.userData.alien = { model, nodes, rest, mats, lit: [...mats.values()], guns: {}, gunMats: [], flash: muzzleFlash(), colour: null };
  armFigure(g, null);
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
// look/gunpose.js) and seed (its shot count, which turns the flash), dt (s this frame, for the minigun's spin).
export function styleFigure(g, colour, pose, weapon, sun, shot = null, seed = 0, dt = 0) {
  const a = g.userData.alien;
  if (!a) {
    g.userData.simple.userData.material.color.setHex(colour);
    return;
  }
  if (a.colour !== colour) {
    a.colour = colour;
    const c = new THREE.Color(colour);
    a.mats.get("skin")?.color.copy(c);
    const trim = a.mats.get("trim");
    if (trim) trim.emissive.copy(c).multiplyScalar(LOOK.alien.trim);
    a.mats.get("glass")?.userData.rim.value.copy(c).multiplyScalar(LOOK.alien.rim);
  }
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
