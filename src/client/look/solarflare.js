// A solar flare as seen: glowing arches over a patch of the sun, and a smaller set well round the sun from it so
// it shows from anywhere, that stir during the warning, then the patch snaps white-hot, a shell of light races out and a plasma cloud lifts off. Real flares are a flash from one
// patch's tangled loops (coronal loops); the cloud is a coronal mass ejection, slower in truth, kept for show.
import * as THREE from "three";
import { LOOK, FLARE } from "../../tuning.js";
import { NOISE_GLSL, haloMap, rng } from "./common.js";

const loopVertex = /* glsl */ `
attribute float along;
varying float vAlong, vEdge;
varying vec3 vObj;
void main() {
  vAlong = along;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vEdge = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

// Bright down the tube's middle, soft at its edges; knots of plasma run along it and flicker faster as it heats.
const loopFragment = /* glsl */ `
uniform float heat, time, seed;
varying float vAlong, vEdge;
varying vec3 vObj;
${NOISE_GLSL}
void main() {
  float knots = 0.55 + 0.45 * noise3(vec3(vAlong * 9.0 - time * (1.0 + heat * 3.0), seed, time * 0.7));
  float core = pow(vEdge, 1.6);
  float feet = smoothstep(0.0, 0.12, vAlong) * smoothstep(1.0, 0.88, vAlong) * 0.6 + 0.4;
  vec3 col = mix(vec3(1.0, 0.35, 0.06), vec3(1.0, 0.8, 0.4), smoothstep(0.2, 0.8, heat));
  col = mix(col, vec3(1.0, 0.97, 0.9), smoothstep(0.85, 1.6, heat));
  gl_FragColor = vec4(col * core * knots * feet * heat * BRIGHT, 1.0);
}`;

const shellVertex = /* glsl */ `
varying float vRim;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRim = 1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

// The shell of light: seen edge on, as a ring, while it comes; a faint veil once you are inside it.
const shellFragment = /* glsl */ `
uniform float strength;
varying float vRim;
void main() {
  float a = pow(vRim, 4.0) + 0.03;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a * strength, 1.0);
}`;

// body: the sun. Returns { arches (add to the sun's mesh: unit sun radius), shell and cloud (add to the
// scene), setLevel(level), update(state, t, sunPos) }.
export function flareLook(body, cfg = LOOK.flare) {
  const r = rng(4242), c = cfg.arches;
  const arches = new THREE.Group(), loops = [], beacons = [];
  // The main patch faces dir, the second (smaller) dir2.
  const sides = [{ key: "dir", size: 1, count: c.count }, { key: "dir2", size: cfg.second.size, count: cfg.second.count }];
  for (const side of sides) for (let i = 0; i < side.count; i++) {
    // A half ellipse, its feet on the surface; leaning a little and twisted out of its plane, like the real ones.
    const w = side.size * (c.span[0] + r() * (c.span[1] - c.span[0])), h = side.size * (c.height[0] + r() * (c.height[1] - c.height[0]));
    const lean = (r() - 0.5) * 0.8, twist = (r() - 0.5) * 0.6;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI, s = Math.sin(a);
      pts.push(new THREE.Vector3(-Math.cos(a) * w, s * h, s * h * lean + Math.sin(2 * a) * twist * w));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, Math.sqrt(side.size) * c.thick * (0.7 + 0.6 * r()), 8, false);
    const along = new Float32Array(geo.attributes.position.count);
    for (let k = 0; k < along.length; k++) along[k] = Math.floor(k / 9) / 48;
    geo.setAttribute("along", new THREE.BufferAttribute(along, 1));
    const u = { heat: { value: 0 }, time: { value: 0 }, seed: { value: loops.length * 3.7 } };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: u, defines: { BRIGHT: c.bright.toFixed(2) }, vertexShader: loopVertex, fragmentShader: loopFragment,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    // Feet spread round the patch's centre, each arch turned its own way about the surface normal.
    const holder = new THREE.Group();
    holder.add(mesh);
    const spread = c.spread * side.size;
    holder.userData = { side, off: [(r() - 0.5) * 2 * spread, (r() - 0.5) * 2 * spread], turn: r() * Math.PI, phase: r() * 10 };
    arches.add(holder);
    loops.push({ holder, mesh, u });
  }
  // A glow over each patch, so the warning reads from across the system where the arches are too small to see.
  for (const side of sides) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloMap(), color: new THREE.Color(cfg.beacon.color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    arches.add(m);
    beacons.push({ m, side });
  }
  arches.visible = false;

  const shellU = { strength: { value: 0 } };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({
    uniforms: shellU, vertexShader: shellVertex, fragmentShader: shellFragment,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  shell.visible = false;

  const cl = cfg.cloud, cloud = new THREE.Group(), puffs = [];
  for (let i = 0; i < cl.puffs; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloMap(), color: new THREE.Color(i % 3 ? cl.color : cl.hot), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    // Each puff flies out inside a cone round a patch at its own speed; every third from the smaller one.
    const side = sides[i % 3 === 2 ? 1 : 0], a = r() * Math.PI * 2, o = Math.sqrt(r()) * cl.cone;
    puffs.push({ m, side, off: [Math.cos(a) * o, Math.sin(a) * o], speed: side.size * (cl.speed[0] + r() * (cl.speed[1] - cl.speed[0])), size: side.size * (0.6 + r() * 0.8) });
    cloud.add(m);
  }
  cloud.visible = false;

  const normal = new THREE.Vector3(), tA = new THREE.Vector3(), tB = new THREE.Vector3(), q = new THREE.Quaternion();
  const Yup = new THREE.Vector3(0, 1, 0);
  const frame = (dir) => {
    normal.set(dir[0], dir[1], dir[2]).normalize();
    tA.crossVectors(normal, Math.abs(normal.y) < 0.9 ? Yup : new THREE.Vector3(1, 0, 0)).normalize();
    tB.crossVectors(normal, tA);
  };
  let cloudOn = true;
  return {
    arches, shell, cloud,
    // The plasma cloud's 40 big soft sprites cost fill: the lowest level goes without.
    setLevel(level) {
      cloudOn = level >= cfg.cloudFrom;
    },
    // state: as look/flarepose.js flareView returns; t: s on the match clock; sunPos: [x, y, z].
    update(state, t, sunPos) {
      const on = state.warn > 0 || state.since >= 0 && state.since < FLARE.burn + FLARE.fade;
      arches.visible = on;
      if (on) {
        // Heat climbs through the warning, with a nervous flicker; the burst makes it white-hot, then it cools.
        const after = state.since >= 0 ? state.since : -1;
        const flick = 0.75 + 0.25 * Math.sin(t * (6 + 20 * state.warn)) * Math.sin(t * 2.3 + 1);
        let heat = state.warn > 0 ? (0.25 + 0.75 * state.warn ** 1.5) * flick : state.burn * c.hot;
        const fade = after >= 0 ? 1 - THREE.MathUtils.smoothstep(after, FLARE.burn, FLARE.burn + FLARE.fade) : 1;
        if (after >= 0 && state.burn < 0.05) heat = 0.4 * fade;
        // They rise through the warning, jump at the burst and sag as they fade.
        const rise = state.warn > 0 ? 0.35 + 0.65 * state.warn ** 0.7 : (1 + c.snap * Math.min(1, after / 0.5)) * (0.6 + 0.4 * fade);
        for (const { m, side } of beacons) {
          frame(state[side.key]);
          m.position.copy(normal).multiplyScalar(1 + cfg.beacon.lift * side.size);
          m.scale.setScalar(side.size * cfg.beacon.size * (0.6 + 0.4 * rise));
          m.material.opacity = Math.min(1, heat) * cfg.beacon.opacity;
        }
        for (const l of loops) {
          const { side, off, turn, phase } = l.holder.userData;
          frame(state[side.key]);
          const p = normal.clone().addScaledVector(tA, off[0]).addScaledVector(tB, off[1]).normalize();
          l.holder.position.copy(p).multiplyScalar(c.sink);
          q.setFromUnitVectors(Yup, p);
          l.holder.quaternion.copy(q);
          l.holder.rotateY(turn + 0.15 * Math.sin(t * 0.7 + phase));
          l.mesh.scale.set(1, rise * (0.9 + 0.1 * Math.sin(t * 1.3 + phase)), 1);
          l.u.heat.value = heat * (0.8 + 0.2 * Math.sin(t * 9 + phase * 3));
          l.u.time.value = t;
        }
      }
      // The shell of light runs out from the sun in the burst's first moments.
      const s = state.since;
      shell.visible = s >= 0 && s < cfg.wave.time;
      if (shell.visible) {
        const k = s / cfg.wave.time;
        shell.position.set(sunPos[0], sunPos[1], sunPos[2]);
        shell.scale.setScalar(body.radius + (cfg.wave.reach - body.radius) * (1 - (1 - k) ** 2));
        shellU.strength.value = cfg.wave.strength * (1 - k) ** 1.5;
      }
      // The cloud lifts off the patch, swells and thins out.
      const cloudFor = FLARE.burn + FLARE.fade;
      cloud.visible = cloudOn && s >= 0 && s < cloudFor;
      if (cloud.visible) {
        const k = s / cloudFor;
        for (const p of puffs) {
          frame(state[p.side.key]);
          const d = normal.clone().addScaledVector(tA, p.off[0]).addScaledVector(tB, p.off[1]).normalize();
          const out = body.radius + p.speed * s;
          p.m.position.set(sunPos[0] + d.x * out, sunPos[1] + d.y * out, sunPos[2] + d.z * out);
          p.m.scale.setScalar(p.size * (cl.size[0] + (cl.size[1] - cl.size[0]) * k));
          p.m.material.opacity = cl.opacity * Math.min(1, s / 0.4) * (1 - k) ** 1.3;
        }
      }
    },
  };
}
