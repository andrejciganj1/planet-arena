// The sun: a churning surface, a soft corona round it and a glow over the screen when you look at it. The
// glow is one additive full-screen quad, not a post-processing pass, so it costs a single cheap fill.
import * as THREE from "three";
import { LOOK, FLARE } from "../../tuning.js";
import { NOISE_GLSL } from "./common.js";
import { sunInSight } from "./sunsight.js";

// These shaders write screen colours as they are (no conversion), like the flat colours they replace.
const surfaceVertex = /* glsl */ `
varying vec3 vObj, vN, vV;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const surfaceFragment = /* glsl */ `
uniform float time, spotHeat, burn;
uniform vec3 spotDir, spotDir2;
varying vec3 vObj, vN, vV;
${NOISE_GLSL}
vec3 ramp(float h) {
  vec3 c = mix(vec3(0.62, 0.16, 0.03), vec3(1.0, 0.46, 0.08), smoothstep(0.0, 0.4, h));
  c = mix(c, vec3(1.0, 0.74, 0.24), smoothstep(0.35, 0.7, h));
  return mix(c, vec3(1.0, 0.96, 0.74), smoothstep(0.68, 1.0, h));
}
void main() {
  vec3 p = normalize(vObj);
  float t = time;
  // Large slow cells drift and fold into each other; small granules boil on top.
  vec3 w = vec3(fbm(p * 2.0 + vec3(0.0, t, 0.0), 3), fbm(p * 2.0 + vec3(5.2, -t, 1.3), 3), fbm(p * 2.0 + vec3(t, 9.1, 2.0), 3));
  float big = fbm(p * 3.2 + w * 1.6, OCTAVES);
  float heat = 0.62 + big * 0.9;
#if OCTAVES > 2
  float gran = 1.0 - abs(noise3(p * 16.0 + w * 3.0 + vec3(0.0, 0.0, t * 3.0)));
  heat += (gran * gran - 0.45) * 0.4;
#endif
  vec3 col = ramp(clamp(heat, 0.0, 1.0));
  // A flare's patches (the main one and a smaller one): white-hot ribbons where its arches stand, then the whole face brightens in the burst.
  float spot = max(smoothstep(0.93, 0.995, dot(p, spotDir)), SECOND * smoothstep(0.972, 0.998, dot(p, spotDir2)));
  float ribbons = 1.0 - abs(noise3(p * 18.0 + w * 2.0));
  col = mix(col, vec3(1.0, 0.97, 0.9) * 1.4, clamp(spot * (0.4 + 0.6 * ribbons * ribbons) * spotHeat, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.95, 0.8), burn * 0.35) * (1.0 + burn * 0.4);
  // Darker and redder towards the edge (limb darkening), so it reads as a ball, not a disc.
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  col *= mix(0.62, 1.0, pow(mu, 0.45));
  col = mix(vec3(1.0, 0.42, 0.1), col, smoothstep(0.0, 0.3, mu));
  gl_FragColor = vec4(col, 1.0);
}`;

// The corona is a disc through the sun's centre, square to the line from the eye, sized so its unit circle
// is exactly the sun's outline from there; the sun hides its middle, so only the ring round the edge shows.
// Units are sun outlines.
const coronaVertex = /* glsl */ `
uniform float reach, radius;
varying vec2 vP;
void main() {
  vP = position.xy * reach;
  vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float d = length(c);
  vec3 f = c / d, right = normalize(cross(f, abs(f.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 up = cross(right, f);
  float k = radius / d, outline = radius / sqrt(max(1.0 - k * k, 1e-3));
  gl_Position = projectionMatrix * vec4(c + (right * vP.x + up * vP.y) * outline, 1.0);
}`;

const coronaFragment = /* glsl */ `
uniform float time, reach, boost;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  vec2 a = vP / max(r, 1e-4);
  // Streamers: the falloff stretches where noise round the rim (seamless, from the angle's cos and sin) is high.
  float rays = fbm(vec3(a * 2.6, time * 0.6), STREAMERS);
  float k = mix(4.2, 1.7, smoothstep(-0.3, 0.45, rays));
  float glow = exp(-max(r - 1.0, 0.0) * k) * (1.0 - smoothstep(reach * 0.7, reach, r));
  vec3 col = mix(vec3(0.9, 0.32, 0.06), vec3(1.0, 0.82, 0.45), glow * glow);
  gl_FragColor = vec4(col * glow * 0.9 * (1.0 + boost), 1.0);
}`;

// The glow over the screen: a bright halo round the sun, a long flat streak and a warm wash over everything
// when it is near the middle of the view. NDC in and out, so the quad always covers the screen.
const flareVertex = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const flareFragment = /* glsl */ `
uniform vec2 sun;
uniform float aspect, size, strength, centre, flash;
varying vec2 vNdc;
void main() {
  vec2 d = (vNdc - sun) * vec2(aspect, 1.0);
  float r = length(d);
  float halo = 0.55 * exp(-r / (0.35 * size + 0.05)) + 0.25 * exp(-r / (1.2 * size + 0.25));
  float streak = exp(-abs(d.y) / (0.012 + 0.03 * size)) * exp(-abs(d.x) / (0.6 + size)) * 0.3;
  float wash = 0.05 * centre * (0.5 + min(size, 1.0)); // stronger the nearer the sun
  vec3 col = vec3(1.0, 0.78, 0.45) * halo + vec3(1.0, 0.7, 0.4) * streak + vec3(1.0, 0.72, 0.42) * wash;
  // A flare's burst whitens the whole view while you stand in its light.
  gl_FragColor = vec4(col * strength + vec3(1.0, 0.9, 0.75) * flash, 1.0);
}`;

// body: the sun from BODIES; rand: the shared look random stream.
// Returns { mesh, flare, setLevel(level), setStorm(state), update(t, dt, camera, sunPos, blockers) }: add the
// mesh to the scene as the sun's body and the flare (the glare in the eye) to the scene; blockers are
// { pos, radius } of every other body. setStorm takes a solar flare's state (look/flarepose.js flareView).
export function sunLook(body, rand, cfg = LOOK.sun) {
  // The faceted sun this replaced drew a shade per face from the shared random stream; drawing as many keeps
  // every body made after it looking as it did. It was an icosahedron split 4 times: 20 (4 + 1)^2 faces.
  for (let i = 20 * 5 * 5; i > 0; i--) rand();
  const time = { value: 0 }, storm = { spotDir: { value: new THREE.Vector3(0, 1, 0) }, spotDir2: { value: new THREE.Vector3(0, -1, 0) }, spotHeat: { value: 0 }, burn: { value: 0 } };
  let burn = 0, flash = 0;
  const surface = new THREE.ShaderMaterial({
    uniforms: { time, ...storm }, defines: { OCTAVES: cfg.octaves.at(-1), SECOND: LOOK.flare.second.glow.toFixed(2) }, vertexShader: surfaceVertex, fragmentShader: surfaceFragment,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), surface);
  mesh.scale.setScalar(body.radius);

  const reach = { value: cfg.corona }, radius = { value: body.radius }, boost = { value: 0 };
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: { time, reach, radius, boost }, defines: { STREAMERS: cfg.streamers.at(-1) }, vertexShader: coronaVertex, fragmentShader: coronaFragment,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMat);
  corona.frustumCulled = false; // moved in the shader
  mesh.add(corona);

  const u = {
    sun: { value: new THREE.Vector2() }, aspect: { value: 1 }, size: { value: 0.1 },
    strength: { value: 0 }, centre: { value: 0 }, flash: { value: 0 },
  };
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: u, vertexShader: flareVertex, fragmentShader: flareFragment,
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  }));
  flare.frustumCulled = false;
  flare.renderOrder = 1000; // over everything, the weapon too: it is glare in the eye

  let level = null, sight = null;
  const at = new THREE.Vector3(), view = new THREE.Vector3(), eye = [0, 0, 0];
  return {
    mesh, flare,
    setLevel(l) {
      if (l === level) return;
      level = l;
      surface.defines.OCTAVES = cfg.octaves[l];
      coronaMat.defines.STREAMERS = cfg.streamers[l];
      surface.needsUpdate = coronaMat.needsUpdate = true;
    },
    setStorm(state, f = LOOK.flare) {
      storm.spotDir.value.fromArray(state.dir);
      storm.spotDir2.value.fromArray(state.dir2);
      const fading = state.since >= 0 ? 1 - THREE.MathUtils.smoothstep(state.since, FLARE.burn, FLARE.burn + FLARE.fade) : 1;
      storm.spotHeat.value = state.warn > 0 ? state.warn ** 1.5 : state.since >= 0 ? Math.max(state.burn * 1.5, 0.5 * fading) : 0;
      burn = storm.burn.value = state.burn;
      mesh.scale.setScalar(body.radius * (1 + f.swell * burn));
      reach.value = cfg.corona * (1 + f.corona * burn);
      boost.value = f.coronaBoost * burn + 0.3 * state.warn;
      flash = state.since >= 0 && state.since < f.flash.time ? f.flash.strength * (1 - state.since / f.flash.time) ** 2 : 0;
    },
    // t: s on the match clock, so a still clock shows a still sun; dt: real s since the last frame.
    update(t, dt, camera, sunPos, blockers) {
      time.value = t * cfg.churn;
      camera.updateMatrixWorld();
      at.set(sunPos[0], sunPos[1], sunPos[2]);
      view.copy(at).applyMatrix4(camera.matrixWorldInverse);
      at.project(camera);
      const edge = Math.max(Math.abs(at.x), Math.abs(at.y));
      const inView = view.z < 0 ? 1 - THREE.MathUtils.smoothstep(edge, 0.85, 1.35) : 0;
      // Off screen, behind you or at a level without the glow, nothing to work out; the next look starts
      // from what is in sight then rather than easing in from a stale value.
      camera.position.toArray(eye);
      // The burst's whitening needs only the sun to be in sight, wherever you look.
      u.flash.value = flash > 0 ? flash * sunInSight(eye, sunPos, body.radius, blockers) : 0;
      if (inView === 0 || level < cfg.flareFrom) {
        sight = null;
        u.strength.value = 0;
        flare.visible = u.flash.value > 0.002;
        return;
      }
      const seen = sunInSight(eye, sunPos, body.radius, blockers);
      sight = sight === null ? seen : sight + (seen - sight) * (1 - Math.exp(-cfg.fade * Math.max(0, dt)));
      const d = view.length(), half = Math.tan((camera.fov * Math.PI) / 360);
      const size = Math.tan(Math.asin(Math.min(1, body.radius / Math.max(d, body.radius)))) / half;
      u.sun.value.set(at.x, at.y);
      u.aspect.value = camera.aspect;
      u.size.value = Math.min(size, 1.5);
      u.centre.value = (1 - THREE.MathUtils.smoothstep(Math.hypot(at.x, at.y), 0, 1.2)) ** 2;
      u.strength.value = cfg.flare * sight * inView * (1 + LOOK.flare.glare * burn);
      flare.visible = u.strength.value > 0.002 || u.flash.value > 0.002;
    },
  };
}
