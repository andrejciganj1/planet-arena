// Everyone but you: the figure (today two spheres, exactly the shapes shots test) and the tag overhead.
import * as THREE from "three";
import { PLAYER } from "../../tuning.js";

export const DUMMY_COLOUR = 0xff7a3d;

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

// A body sphere and a head sphere, exactly the shapes shots test (PLAYER.hit), the face on the head's
// forward side, and the tag overhead.
export function dummyMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: DUMMY_COLOUR });
  for (const { at, r } of [PLAYER.hit.body, PLAYER.hit.head]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
    ball.position.y = at;
    g.add(ball);
  }
  g.userData.body = { material: mat }; // one material for both, so the colour is set once
  g.userData.tag = tagSprite();
  g.add(g.userData.tag);
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
  return g;
}
