// Explosions as drawn (rockets, asteroid blasts, sun and damage deaths): a bright flash, a fireball of rolling
// noise that swells to the blast's reach and dies into smoke, a fast shock ring, sparks and a short warm light.
// The game keeps a blast only ROCKET.showFor s; each one seen here plays its own LOOK.blast.life s, from a pool
// that never grows past LOOK.blast.max (look/blastpose.js).
import * as THREE from "three";
import { LOOK } from "../../tuning.js";
import { NOISE_GLSL, haloMap, rng, v3 } from "./common.js";
import { blastLook, pickSlot } from "./blastpose.js";

const C = LOOK.blast;

const ballVertex = /* glsl */ `
uniform float time, seed;
varying vec3 vN, vV, vP;
${NOISE_GLSL}
void main() {
  vP = position;
  float bump = fbm(position * 1.6 + vec3(seed, time * 1.3, -time), 3);
  vec3 p = position * (1.0 + 0.38 * bump);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// Fire: white-hot in the middle of the view, through yellow and orange to deep red at its rim, flickering.
const fireFragment = /* glsl */ `
uniform float time, seed, fire;
varying vec3 vN, vV, vP;
${NOISE_GLSL}
void main() {
  float face = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float n = fbm(vP * 2.6 + vec3(seed, -time * 2.0, time), 5) * 0.5 + 0.5;
  // Ragged, licking edges: the fire thins out where the noise is low towards the rim, and burns out from there.
  float body = smoothstep(0.2, 0.6, face * 0.9 + n * 0.7 - 0.3 - (1.0 - fire) * 0.5);
  float heat = clamp(fire * (0.25 + 0.95 * face) + (n - 0.5) * 0.8, 0.0, 1.4);
  vec3 col = mix(vec3(0.45, 0.05, 0.01), vec3(1.0, 0.38, 0.06), smoothstep(0.1, 0.5, heat));
  col = mix(col, vec3(1.0, 0.8, 0.35), smoothstep(0.5, 0.9, heat));
  col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.9, 1.25, heat));
  gl_FragColor = vec4(col * body * (0.6 + 0.9 * fire), 1.0);
}`;

// Smoke: soft dark puffs, ragged at the edge, warm underneath while the fire still glows in it.
const smokeFragment = /* glsl */ `
uniform float time, seed, smoke, fire;
varying vec3 vN, vV, vP;
${NOISE_GLSL}
void main() {
  float face = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float n = fbm(vP * 2.4 + vec3(-seed, time * 0.6, 0.0), 4) * 0.5 + 0.5;
  float a = smoke * smoothstep(0.1, 0.6, face * 0.8 + n * 0.6 - 0.2) * smoothstep(0.3, 0.6, n);
  vec3 col = mix(vec3(0.16, 0.15, 0.15), vec3(0.45, 0.2, 0.08), fire);
  gl_FragColor = vec4(col, a * 0.85);
}`;

// A thin bright ring on a canvas, for the shock ring sprite.
function ringMap() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d"), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.72, "rgba(255,255,255,0)");
  g.addColorStop(0.86, "rgba(255,240,210,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function createBlasts(scene) {
  const rand = rng(77), ball = new THREE.IcosahedronGeometry(1, 4), ring = ringMap();
  const slots = [], ages = [], seen = new WeakSet();
  let level = null, sparksOn = true;
  const light = new THREE.PointLight(0xffa04a, 0, C.lightRange, 2);
  scene.add(light); // always in the scene: adding and removing lights makes every lit material recompile

  const make = () => {
    const u = { time: { value: 0 }, seed: { value: rand() * 50 }, fire: { value: 0 }, smoke: { value: 0 } };
    const fire = new THREE.Mesh(ball, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: ballVertex, fragmentShader: fireFragment,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    const smoke = new THREE.Mesh(ball, new THREE.ShaderMaterial({
      uniforms: u, vertexShader: ballVertex, fragmentShader: smokeFragment, transparent: true, depthWrite: false,
    }));
    smoke.renderOrder = 1; // over the fire it hides
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap(), color: 0xfff0d0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    const shock = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: 0xffe0b0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    // Sparks fly out along fixed directions at their own speeds, slowing as they go.
    const n = C.sparkCount, dirs = [], pos = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
      dirs.push([r * Math.cos(a), z, r * Math.sin(a), 6 + rand() * 14]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: haloMap(), color: 0xffc070, size: 0.5, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sparks.frustumCulled = false;
    const group = new THREE.Group();
    group.add(fire, smoke, flash, shock, sparks);
    group.visible = false;
    scene.add(group);
    return { group, fire, smoke, flash, shock, sparks, dirs, u, at: [0, 0, 0], size: 1, born: 0 };
  };

  return {
    // The lowest level goes without sparks and the light.
    setLevel(l) {
      level = l;
      sparksOn = l >= C.from;
    },
    // explosions: the world's, { pos, age, splash? }; now: real s.
    update(explosions, now) {
      for (const x of explosions) {
        if (seen.has(x)) continue;
        seen.add(x);
        const k = pickSlot(ages, C.max);
        const s = slots[k] || (slots[k] = make());
        Object.assign(s, { at: x.pos, size: x.splash ?? C.death, born: now - x.age });
        ages[k] = x.age;
      }
      let bright = 0, where = null;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k];
        if (ages[k] === null) continue;
        const age = now - s.born, b = blastLook(age, s.size);
        ages[k] = age;
        if (age >= C.life) {
          ages[k] = null;
          s.group.visible = false;
          continue;
        }
        s.group.visible = true;
        s.group.position.copy(v3(s.at));
        s.u.time.value = age;
        s.u.fire.value = b.fire;
        s.u.smoke.value = b.smoke;
        s.fire.visible = b.fire > 0.01;
        s.fire.scale.setScalar(b.fireSize);
        s.smoke.visible = b.smoke > 0.01;
        s.smoke.scale.setScalar(b.smokeSize);
        s.flash.visible = b.flash > 0.01;
        s.flash.scale.setScalar(s.size * 3.5);
        s.flash.material.opacity = b.flash;
        s.shock.visible = b.ring > 0.01;
        s.shock.scale.setScalar(2 * b.ringSize);
        s.shock.material.opacity = b.ring * 0.8;
        s.sparks.visible = sparksOn && b.sparks > 0.01;
        if (s.sparks.visible) {
          const pos = s.sparks.geometry.attributes.position, flown = age * (1 - 0.5 * age);
          for (let i = 0; i < s.dirs.length; i++) {
            const [x, y, z, v] = s.dirs[i];
            pos.setXYZ(i, x * v * flown, y * v * flown, z * v * flown);
          }
          pos.needsUpdate = true;
          s.sparks.material.opacity = b.sparks;
        }
        if (b.light > bright) (bright = b.light), (where = s.at);
      }
      light.intensity = sparksOn && where ? C.light * bright : 0;
      if (where) light.position.copy(v3(where));
    },
  };
}
