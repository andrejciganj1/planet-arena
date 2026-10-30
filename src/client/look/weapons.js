// The guns (assets/models/weapons.glb, from tools/blender/weapons.py), their muzzle flashes, and what shots
// and beams look like. A gun is built with the grip at its origin and the barrel along -z, at its
// first-person size; userData.muzzle is the barrel's tip and userData.spin the part that turns (the minigun's).
import * as THREE from "three";
import { LOOK, WEAPON_ORDER } from "../../tuning.js";

export const WEAPON_COLORS = LOOK.weapons.colors;
export const WEAPON_ASSETS = [{ name: "weapons", url: "assets/models/weapons.glb" }];

// The muzzle of a simple gun: the middle of its front face.
function withMuzzle(g) {
  const box = new THREE.Box3().setFromObject(g), muzzle = new THREE.Object3D();
  muzzle.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
  g.add(muzzle);
  g.userData = { muzzle, spin: null };
  return g;
}

// The guns until the model loads, or if it never does: boxes and a tube, each in its own colour, lit by it
// so they read on a night side too.
export function weaponModels() {
  const lit = (color) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const gun = (color, parts) => {
    const g = new THREE.Group();
    for (const [w, h, d, x, y, z] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit(color));
      m.position.set(x, y, z);
      g.add(m);
    }
    return withMuzzle(g);
  };
  const rocket = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 14, 1, true), new THREE.MeshLambertMaterial({ color: WEAPON_COLORS.rocket, emissive: WEAPON_COLORS.rocket, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.07, -0.05);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.052, 14), new THREE.MeshBasicMaterial({ color: 0x15171c }));
  bore.position.set(0, 0.07, -0.299);
  rocket.add(tube, bore);
  return {
    pistol: gun(WEAPON_COLORS.pistol, [[0.035, 0.09, 0.045, 0, -0.035, 0.02], [0.04, 0.045, 0.16, 0, 0.02, -0.04]]),
    shotgun: gun(WEAPON_COLORS.shotgun, [[0.06, 0.06, 0.42, 0, 0.04, -0.17], [0.07, 0.05, 0.18, 0, -0.01, 0.01]]),
    rocket: withMuzzle(rocket),
    minigun: gun(WEAPON_COLORS.minigun, [[0.11, 0.11, 0.36, 0, 0.05, -0.12], [0.04, 0.04, 0.2, 0.03, 0.08, -0.38], [0.04, 0.04, 0.2, -0.03, 0.02, -0.38]]),
    sniper: gun(WEAPON_COLORS.sniper, [[0.04, 0.05, 0.6, 0, 0.03, -0.25], [0.05, 0.05, 0.14, 0, 0.09, -0.15]]),
    railgun: gun(WEAPON_COLORS.railgun, [[0.07, 0.07, 0.5, 0, 0.04, -0.2], [0.09, 0.02, 0.4, 0, 0.09, -0.2], [0.09, 0.02, 0.4, 0, -0.01, -0.2]]),
  };
}

// Passes the guns' materials through `material`, each source once, so the set shares them. Returns the new ones.
export function swapMaterials(guns, material) {
  const mats = new Map();
  for (const gun of Object.values(guns)) {
    gun.traverse((o) => {
      if (!o.isMesh) return;
      if (!mats.has(o.material)) mats.set(o.material, material(o.material));
      o.material = mats.get(o.material);
    });
  }
  return [...mats.values()];
}

// The guns from the model, one each, their materials passed through `material`; accents glow in their colour.
//   gltf: GLTFLoader's result for weapons.glb
export function weaponSet(gltf, material = (m) => m) {
  const guns = {};
  for (const name of WEAPON_ORDER) {
    const gun = gltf.scene.getObjectByName(name).clone(true);
    gun.position.set(0, 0, 0);
    gun.userData = { muzzle: gun.getObjectByName(`${name}_muzzle`), spin: gun.getObjectByName("minigun_spin") };
    guns[name] = gun;
  }
  const materials = swapMaterials(guns, (src) => {
    const m = material(src);
    if (src.name.endsWith("_accent")) m.emissiveIntensity = LOOK.weapons.glow;
    return m;
  });
  return { guns, materials };
}

// One star-shaped burst for every flash, painted once.
let burst = null;
function burstTexture() {
  if (burst) return burst;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.translate(64, 64);
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 7; k++) {
    // Long and short spikes in turn, so it reads as a burst, not a disc.
    const r = k % 2 ? 40 : 62, w = k % 2 ? 7 : 10;
    ctx.rotate((2 * Math.PI) / 7);
    const g = ctx.createLinearGradient(0, 0, r, 0);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -w);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, w);
    ctx.fill();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.4, "rgba(255,255,255,0.6)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-34, -34, 68, 68);
  burst = new THREE.CanvasTexture(c);
  burst.colorSpace = THREE.SRGBColorSpace;
  return burst;
}

// A muzzle flash: a sprite (no light, so a burst of minigun fire costs nothing extra), hidden until shown.
// userData.show(gun, seed) shows it for the weapon that fired, turned by the shot's number so no two match.
export function muzzleFlash() {
  const mat = new THREE.SpriteMaterial({ map: burstTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.visible = false;
  s.userData.show = (gun, seed) => {
    const { size, color } = LOOK.weapons.flash;
    const r = size[gun] ?? size.pistol;
    s.visible = true;
    s.scale.setScalar(r);
    s.position.set(0, 0, -0.35 * r); // in front of the muzzle, not half inside the barrel
    mat.color.setHex(color[gun] ?? color.pistol);
    mat.rotation = seed * 2.39996; // the golden angle: shot after shot never lines up
  };
  return s;
}

// Places a flash at a gun's muzzle (moving it there if it was on another gun) and shows it, or hides it.
//   shot: { since, gun } from look/gunpose.js createGunWatch; seed: the shot count
export function showFlash(flash, gun, show, shot, seed) {
  if (!show) {
    flash.visible = false;
    return;
  }
  const muzzle = gun.userData.muzzle;
  if (flash.parent !== muzzle) muzzle.add(flash);
  flash.userData.show(shot.gun, seed);
}

// Turns a gun's spinning part while it fires (the minigun's barrels).
//   since: s since its last shot; dt: s this frame
export function spinGun(gun, since, dt) {
  const spin = gun.userData.spin;
  if (spin && since < LOOK.weapons.spin.for) spin.rotation.z += LOOK.weapons.spin.speed * dt;
}

// Rockets and bullets share one pool of meshes (geometry and material swapped per shot); each beam gets its own
// material, as their opacity fades one by one. Blasts are look/blast.js.
export function shotLooks() {
  const rocketGeo = new THREE.CapsuleGeometry(0.12, 0.45, 4, 8), rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8dde6 });
  const bulletGeo = new THREE.SphereGeometry(0.09, 8, 6), bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  return {
    rocketGeo, rocketMat, bulletGeo, bulletMat,
    shot: () => new THREE.Mesh(rocketGeo, rocketMat),
    beam: () => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true }));
      l.frustumCulled = false;
      return l;
    },
  };
}
