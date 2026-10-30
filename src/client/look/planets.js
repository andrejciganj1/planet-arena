// The planets and moons, the giant's ring, the ice world's aurora and the orbit lines (comets keep the faceted
// sphere until they get their own look).
//
// Each planet and moon is a smooth sphere with one shader. Its big picture (continents, canyons, bands,
// craters) is painted by a shader into a cube map per body: no download, no seam or pinch at the poles, and
// drawing it is one texture lookup. One body is painted per frame from the second frame on, nearest first,
// so the game never waits on it; until then a body shows its flat colour. The colour is in rgb and a height
// in alpha; the height lights the relief (its slope from neighbouring texels) and marks what is water, lava
// or cracks, so one texture carries both. Close up a detail layer is computed in the shader (ripples, fine cracks, sand, frost) and fades out
// by LOOK.planets.far metres, so the ground holds up underfoot and costs nothing from afar. Shadows from
// other bodies and the ring are exact sphere and plane tests per pixel (shadow.js); blob shadows under
// figures are the same pass.
import * as THREE from "three";
import { posesAt } from "../../sim/system.js";
import { LOOK } from "../../tuning.js";
import { NOISE_GLSL, v3 } from "./common.js";
import { SHADOW_GLSL } from "./shadow.js";

const WORLDS = { lava: 1, jungle: 2, ocean: 3, desert: 4, gas: 5, ice: 6, rock: 7 };
const OCCLUDERS = 4; // nearest bodies tested for shadows, per body

// The faceted sphere the comets still use. Its faces vary a little in shade, so running across it shows motion.
export function sphereMesh(body, rand) {
  const geo = new THREE.IcosahedronGeometry(body.radius, 3); // already one vertex per face corner
  const base = new THREE.Color(body.color), colors = [];
  for (let i = 0; i < geo.attributes.position.count; i += 3) {
    const c = base.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.12);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  // Low mounds pressed into the surface: landmarks you can walk over.
  const mound = new THREE.MeshLambertMaterial({ color: base.clone().offsetHSL(0, -0.05, -0.12), flatShading: true });
  const n = Math.round(body.radius * body.radius * 0.35);
  for (let i = 0; i < n; i++) {
    const u = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const r = 0.5 + rand() * 1.4;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mound);
    m.scale.set(1, 0.25, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    m.position.copy(u).multiplyScalar(body.radius - 0.05);
    mesh.add(m);
  }
  return mesh;
}

// The faceted planets drew from the shared random stream (a shade per face, then the mounds); drawing as many
// keeps everything made after them (the belt) as it was.
function skipFacets(body, rand) {
  const n = 320 + 4 * Math.round(body.radius * body.radius * 0.35);
  for (let i = 0; i < n; i++) rand();
}

// Feature points on a unit grid: distance to the nearest and second nearest, and a 0..1 value per nearest
// cell. Edges (y - x small) make cracks and plates, x alone round blobs (crowns, craters).
const CELLS_GLSL = /* glsl */ `
vec3 cells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)), o = hash3(i + g) * 0.5 + 0.5, r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = o.x * 0.61 + o.y * 0.29 + o.z * 0.1; }
    else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), fract(id * 7.31));
}
`;

// The ring's density across its band, x 0 at the inner edge to 1 at the outer: broad bands, a dark gap and a
// faint inner ring. Shared by the ring and the shadow it throws on the giant.
const RING_GLSL = /* glsl */ `
float ringDensity(float x) {
  if (x <= 0.0 || x >= 1.0) return 0.0;
  float b = 0.62 + 0.22 * sin(x * 23.0 + 1.3) + 0.16 * sin(x * 57.0 + 0.4) * sin(x * 13.0);
  b *= smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.9, 1.0, x));
  b *= 1.0 - 0.92 * (smoothstep(0.57, 0.59, x) - smoothstep(0.63, 0.65, x));
  b *= mix(0.35, 1.0, smoothstep(0.14, 0.26, x));
  return clamp(b, 0.0, 1.0);
}
`;

// ---- Painting the big picture: one function per kind of world, d the unit direction, out linear colour and
// height 0..1. Uniforms: col (the world's colours), seed, radius (m), feature (the island or the great storm),
// craters (how many on a moon).
const bakeFragment = /* glsl */ `
uniform vec3 col[6];
uniform vec3 seed, feature;
uniform float radius, craters;
varying vec3 vDir;
${NOISE_GLSL}
${CELLS_GLSL}
vec3 warp(vec3 q) { return vec3(fbm(q, 4), fbm(q + 5.1, 4), fbm(q + 9.3, 4)); }
// Two axes across the surface at a point.
void frame(vec3 a, out vec3 t1, out vec3 t2) {
  t1 = normalize(cross(a, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  t2 = cross(a, t1);
}

#if WORLD == 1
// Lava: dark crust in plates, glowing cracks between them and molten lakes; low is molten.
vec4 world(vec3 d) {
  vec3 q = d * 2.6 + seed, w = warp(q);
  vec3 a = cells(q * 1.5 + w * 0.9), b = cells(q * 5.0 + w * 1.6);
  float crack = 1.0 - smoothstep(0.0, 0.12, a.y - a.x), fine = 1.0 - smoothstep(0.0, 0.07, b.y - b.x);
  float lake = smoothstep(0.3, 0.42, fbm(d * 1.4 + seed * 1.7 + w * 0.6, 5));
  float crust = fbm(q * 3.0 + w, 5);
  float molten = max(max(crack, fine * 0.7), lake);
  vec3 rock = mix(col[0], col[1], smoothstep(-0.4, 0.5, crust + 0.3 * (a.z - 0.5)));
  rock = mix(rock, col[2], (1.0 - smoothstep(0.0, 0.32, a.y - a.x)) * 0.8);
  vec3 c = mix(rock, col[3], smoothstep(0.45, 0.85, molten));
  return vec4(c, mix(0.55 + 0.3 * crust + 0.1 * a.z, 0.05, smoothstep(0.3, 0.9, molten)));
}
#elif WORLD == 2
// Jungle: tree crowns about a metre across in patches of green, rivers and a few lakes; water is low.
vec4 world(vec3 d) {
  vec3 q = d * 2.0 + seed, w = warp(q);
  float tone = fbm(q * 1.7 + w, 6);
  vec3 c = mix(col[0], col[1], smoothstep(-0.35, 0.35, tone));
  c = mix(c, col[2], smoothstep(0.2, 0.5, fbm(q * 3.1 + w * 1.3 + 7.0, 5)) * 0.75);
  vec3 cr = cells(d * radius * 0.85 + w * 2.0);
  float crown = 1.0 - smoothstep(0.05, 0.75, cr.x), gap = smoothstep(0.0, 0.14, cr.y - cr.x);
  c *= (0.5 + 0.65 * crown) * (0.78 + 0.44 * cr.z) * (0.45 + 0.55 * gap);
  float clearing = smoothstep(0.4, 0.48, fbm(q * 2.3 + 3.0, 5));
  c = mix(c, col[4], clearing);
  float rv = abs(fbm(q * 0.9 + w * 0.5 + 11.0, 5));
  float river = 1.0 - smoothstep(0.018, 0.04, rv), lake = 1.0 - smoothstep(-0.46, -0.38, tone);
  float water = max(river, lake), bank = (1.0 - smoothstep(0.04, 0.075, rv)) * (1.0 - water);
  c = mix(c, col[4] * 0.75, bank * 0.6);
  c = mix(c, col[3], water);
  return vec4(c, mix(0.4 + 0.4 * crown * gap * (1.0 - clearing) + 0.1 * tone, 0.1, water));
}
#elif WORLD == 3
// Ocean: shallows everywhere over sand and sea grass, a few deeper channels, and one low sandbar round
// feature. Sea level is height 0.5.
vec4 world(vec3 d) {
  vec3 q = d * 1.8 + seed, w = warp(q);
  float floorH = fbm(q * 1.3 + w * 0.8, 6), bars = 1.0 - abs(noise3(q * 4.0 + w * 2.0));
  float depth = clamp(0.42 - 0.6 * floorH - 0.2 * bars * bars, 0.04, 1.0);
  vec3 t1, t2;
  frame(feature, t1, t2);
  vec2 xy = vec2(dot(d, t1), dot(d, t2)) * radius;
  xy.y += 0.1 * xy.x * xy.x; // a gentle bend
  float shape = length(xy / vec2(3.4, 1.15)) + 0.3 * fbm(d * 14.0 + seed, 4);
  float land = 1.0 - smoothstep(0.88, 1.0, shape), shoal = 1.0 - smoothstep(1.0, 2.6, shape);
  depth = mix(depth, 0.03, shoal * 0.85);
  vec3 sea = mix(col[2], col[1], smoothstep(0.03, 0.22, depth));
  sea = mix(sea, col[0], smoothstep(0.3, 0.75, depth));
  sea = mix(sea, col[5], smoothstep(0.15, 0.45, fbm(q * 3.5 + 2.0, 5)) * smoothstep(0.08, 0.25, depth) * 0.6);
  vec3 sand = mix(col[3], col[4], smoothstep(0.55, 0.95, shape));
  return vec4(mix(sea, sand, land), mix(0.5 - 0.45 * depth, 0.52 + 0.1 * clamp(1.0 - shape, 0.0, 1.0), land));
}
#elif WORLD == 4
// Desert: dunes, red rock tables, salt pans and canyons with banded walls; canyon floors are low.
vec4 world(vec3 d) {
  vec3 q = d * 2.2 + seed, w = warp(q), pm = d * radius;
  float region = fbm(q * 0.9 + w * 0.7, 5);
  float dune = 1.0 - abs(noise3(pm * vec3(0.22, 0.5, 0.22) + w * 5.0));
  dune *= dune;
  float cv = abs(fbm(q * 1.1 + w * 0.6 + 4.0, 6));
  float canyon = 1.0 - smoothstep(0.02, 0.055, cv), wall = 1.0 - smoothstep(0.055, 0.1, cv);
  float mesa = smoothstep(0.3, 0.34, region) * (1.0 - wall);
  float basin = 1.0 - smoothstep(-0.42, -0.32, region);
  vec3 c = mix(col[1], col[0], clamp(dune * 0.7 + 0.2 + 0.4 * region, 0.0, 1.0));
  c = mix(c, col[4], basin * 0.85);
  c = mix(c, col[2] * (0.9 + 0.2 * fbm(q * 6.0, 3)), mesa);
  float strata = 0.5 + 0.5 * sin(cv * 160.0 + region * 5.0);
  c = mix(c, mix(col[2], col[3], 0.25 + 0.45 * strata), wall);
  c = mix(c, col[3], canyon);
  return vec4(c, clamp(0.55 + 0.05 * dune + 0.2 * mesa - 0.22 * wall - 0.25 * canyon, 0.0, 1.0));
}
#elif WORLD == 5
// Gas giant: wavy bands by latitude (the planets don't spin, so they run round the orbit axis), a great storm
// round feature that swirls them, and small white ovals.
vec3 turn(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
vec4 world(vec3 d) {
  vec3 t1, t2;
  frame(feature, t1, t2);
  vec2 xy = vec2(dot(d, t1), dot(d, t2));
  float front = step(0.0, dot(d, feature)), ov = length(xy / vec2(0.3, 0.17));
  vec3 e = turn(d, feature, 3.2 * exp(-ov * ov * 1.1) * front);
  float lat = e.y + 0.05 * fbm(e * vec3(2.0, 7.0, 2.0) + seed, 5) + 0.025 * fbm(e * vec3(7.0, 24.0, 7.0) + seed, 4);
  float band = 0.5 + 0.28 * sin(lat * 17.0) + 0.16 * sin(lat * 7.0 + 1.0) + 0.06 * sin(lat * 43.0);
  vec3 c = mix(col[4], col[0], smoothstep(0.05, 0.32, band));
  c = mix(c, col[1], smoothstep(0.3, 0.55, band));
  c = mix(c, col[2], smoothstep(0.62, 0.92, band));
  c = mix(c, col[3], smoothstep(0.25, 0.65, fbm(e * vec3(3.0, 11.0, 3.0) + seed * 2.0, 4)) * 0.45);
  float storm = exp(-ov * ov * 2.2) * front;
  c = mix(c, col[5], storm * 0.85);
  float collar = (ov - 1.0) * 4.0;
  c = mix(c, col[2], exp(-collar * collar) * front * 0.35); // its pale collar
  vec3 s = cells(e * vec3(6.0, 9.0, 6.0) + seed);
  float oval = (1.0 - smoothstep(0.1, 0.17, s.x)) * step(0.84, s.z) * (1.0 - storm);
  return vec4(mix(c, col[2], oval * 0.9), 0.5);
}
#elif WORLD == 6
// Ice: white and pale teal sheets, deep blue rifts and cracks, whiter polar caps; cracks are low.
vec4 world(vec3 d) {
  vec3 q = d * 2.4 + seed, w = warp(q);
  float tone = fbm(q * 1.5 + w, 6);
  vec3 c = mix(col[1], col[0], smoothstep(-0.3, 0.35, tone));
  float cap = smoothstep(0.55, 0.8, abs(d.y) + 0.15 * w.x);
  c = mix(c, col[3], cap);
  c = mix(c, col[4], smoothstep(0.15, 0.45, fbm(q * 3.0 + 3.0, 4)) * 0.4 * (1.0 - cap));
  vec3 a = cells(q * 1.4 + w * 0.8);
  float crack = (1.0 - smoothstep(0.0, 0.03, a.y - a.x)) * smoothstep(-0.1, 0.3, fbm(q * 1.1 + 2.0, 3));
  float rift = 1.0 - smoothstep(0.0, 0.016, abs(fbm(q * 0.9 + w * 0.4 + 7.0, 5)));
  float blue = max(crack * 0.55, rift * 0.85);
  c = mix(c, mix(col[2], col[1], 0.3), blue);
  return vec4(c, clamp(0.6 + 0.12 * tone - 0.4 * blue, 0.0, 1.0));
}
#else
// Rock: a grey moon with darker plains and craters at four sizes, each with a dark bowl and a bright rim.
vec4 world(vec3 d) {
  vec3 q = d * 2.0 + seed, w = warp(q);
  float tone = fbm(q * 2.0 + w * 0.5, 6);
  vec3 c = mix(col[0], col[1], smoothstep(-0.4, 0.4, tone));
  float mare = smoothstep(0.08, 0.25, fbm(q * 0.8 + 4.0, 4));
  c = mix(c, col[2], mare * 0.7);
  float h = 0.6 + 0.1 * tone - 0.05 * mare;
  for (int k = 0; k < 4; k++) {
    float s = (2.5 + 2.4 * float(k) * float(k)) * craters, weight = 1.0 / sqrt(1.0 + float(k) * 1.5);
    vec3 cl = cells(d * s + seed * float(k + 1));
    if (fract(cl.z * 13.7) > 0.55 + 0.1 * float(k)) continue;
    float x = cl.x / (0.16 + 0.26 * cl.z);
    float e = (x - 1.0) * 5.0, bowl = 1.0 - smoothstep(0.7, 1.0, x), rim = exp(-e * e);
    h += (-0.3 * bowl * (1.0 - x * x) + 0.12 * rim) * weight;
    c *= 1.0 - 0.3 * bowl * (1.0 - x) * weight;
    c = mix(c, col[1] * 1.12, rim * 0.4 * weight);
  }
  return vec4(c, clamp(h, 0.0, 1.0));
}
#endif

void main() {
  gl_FragColor = world(normalize(vDir));
}`;

const bakeVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// ---- Drawing a body.
const surfaceVertex = /* glsl */ `
varying vec3 vObj, vWorld;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const surfaceFragment = /* glsl */ `
uniform samplerCube map;
uniform float useMap, texel, radius, relief, time, detailNear, detailFar, sunR, ringOn, ringIn, ringOut, ringOpacity;
uniform vec3 base, sunPos, sunCol, night, glowCol, rimCol, feature, ringN, ringC;
uniform vec4 occ[${OCCLUDERS}], blobs[${LOOK.planets.blob.max}];
uniform float blobK[${LOOK.planets.blob.max}];
varying vec3 vObj, vWorld;
${NOISE_GLSL}
${CELLS_GLSL}
${SHADOW_GLSL}
${RING_GLSL}

// The ring's shadow: where the line to the sun crosses the ring's plane, how dense the ring is there,
// averaged across the width the sun's disc blurs it to.
float ringShadow(vec3 p) {
  vec3 l = sunPos - p;
  float ls = length(l);
  l /= ls;
  float den = dot(l, ringN);
  if (abs(den) < 1e-4) return 1.0;
  float t = dot(ringC - p, ringN) / den;
  if (t <= 0.0) return 1.0;
  float x = (length(p + l * t - ringC) - ringIn) / (ringOut - ringIn);
  float blur = t * sunR / ls / (ringOut - ringIn) * 0.6;
  float dens = (ringDensity(x - blur) + ringDensity(x) + ringDensity(x + blur)) / 3.0;
  return 1.0 - dens * ringOpacity;
}

// Tilts the normal by the slope of h (m), from how h and the position change between neighbouring pixels.
// Used for the detail layer, which is smooth noise; the painted relief uses the map's own slope (below), as
// derivatives of a magnified 8-bit map come out in blocks a texel wide.
vec3 bump(vec3 n, float h) {
  vec3 dpx = dFdx(vObj), dpy = dFdy(vObj);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - g);
}

void main() {
  vec3 n = normalize(vObj), centre = vWorld - vObj;
  vec4 tex = useMap > 0.5 ? textureCube(map, n) : vec4(base, 0.5);
  vec3 albedo = tex.rgb;
  float h = tex.a, hm = h * relief;
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist, L = normalize(sunPos - vWorld);
  float ndl = dot(n, L);
  float fade = DETAIL > 0 ? 1.0 - smoothstep(detailNear, detailFar, dist) : 0.0;
  vec3 q = vObj;
  vec3 emit = vec3(0.0);
  float wet = 0.0, shine = 0.0, gloss = 40.0;

#if WORLD == 1
  float molten = 1.0 - smoothstep(0.08, 0.32, h);
  if (molten > 0.0) emit = glowCol * molten * (0.75 + 0.25 * noise3(q * 0.5 + vec3(0.0, time * 0.3, 0.0)));
  #if DETAIL > 0
  if (fade > 0.0) {
    float cr = 1.0 - abs(noise3(q * 1.6));
    float seam = smoothstep(0.94, 0.985, cr) * (1.0 - molten) * fade;
    hm -= 0.06 * seam;
    hm += 0.04 * noise3(q * 5.0) * fade;
    albedo *= 1.0 + (0.3 * noise3(q * 3.0)) * fade;
    emit += glowCol * seam * 0.6;
    #if DETAIL > 1
    albedo *= 1.0 - 0.25 * fade * smoothstep(0.3, 0.6, noise3(q * 11.0));
    #endif
  }
  #endif
#elif WORLD == 2
  wet = 1.0 - smoothstep(0.12, 0.2, h);
  shine = 0.6 * wet;
  #if DETAIL > 0
  if (fade > 0.0) {
    float leaf = noise3(q * 4.0);
    albedo *= 1.0 + 0.35 * leaf * fade * (1.0 - wet);
    hm += (0.06 * noise3(q * 2.2) + 0.02 * leaf) * fade * (1.0 - wet);
    #if DETAIL > 1
    float fleck = smoothstep(0.55, 0.7, noise3(q * 9.0 + 3.0)) * (1.0 - wet) * fade;
    albedo = mix(albedo, albedo * vec3(1.5, 1.4, 0.6), fleck);
    #endif
  }
  #endif
#elif WORLD == 3
  wet = 1.0 - smoothstep(0.495, 0.515, h);
  float depthW = clamp((0.5 - h) / 0.45, 0.0, 1.0);
  shine = wet;
  gloss = mix(30.0, 140.0, fade);
  #if DETAIL > 0
  if (fade > 0.0) {
    vec3 tq = q * 1.4 + vec3(time * 0.25, 0.0, time * 0.18);
    float rip = noise3(tq) + 0.5 * noise3(tq * 2.3 + vec3(0.0, time * 0.3, 0.0));
    hm += 0.05 * rip * wet * fade;
    #if DETAIL > 1
    float caus = 1.0 - abs(noise3(q * 1.1 + vec3(0.0, time * 0.4, time * 0.2)) + 0.6 * noise3(q * 2.1 - vec3(time * 0.3, 0.0, 0.0)));
    albedo *= 1.0 + 0.5 * pow(clamp(caus, 0.0, 1.0), 6.0) * wet * (1.0 - smoothstep(0.05, 0.3, depthW)) * fade;
    #endif
    albedo *= 1.0 + 0.12 * noise3(q * 6.0) * (1.0 - wet) * fade;
  }
  #endif
  // The sandbar's few lights (camp fires, say), at night only: a bright spot with a soft halo.
  float land = smoothstep(0.505, 0.52, h) * (1.0 - smoothstep(-0.12, 0.08, ndl));
  if (land > 0.0) {
    vec3 c = cells(q * 0.9);
    float on = step(0.5, c.z);
    emit += glowCol * land * ((1.0 - smoothstep(0.06, 0.16, c.x)) * on * 3.0 + exp(-c.x * 4.0) * on * 0.35 + 0.015);
  }
#elif WORLD == 4
  #if DETAIL > 0
  if (fade > 0.0) {
    float sw = noise3(q * 0.35) * 4.0;
    float rip = sin(dot(q, vec3(2.3, 1.1, 1.7)) * 2.2 + sw);
    float open = smoothstep(0.42, 0.5, h);
    hm += 0.025 * rip * open * fade;
    albedo *= 1.0 + 0.07 * rip * open * fade;
    #if DETAIL > 1
    float peb = smoothstep(0.5, 0.65, noise3(q * 7.0));
    albedo *= 1.0 - 0.12 * peb * fade;
    hm += 0.02 * peb * fade;
    #endif
  }
  #endif
#elif WORLD == 5
  #if DETAIL > 0
  if (fade > 0.0) albedo *= 1.0 + 0.16 * noise3(q * vec3(0.5, 3.0, 0.5)) * fade;
  #endif
#elif WORLD == 6
  shine = 0.35;
  gloss = 30.0;
  #if DETAIL > 0
  if (fade > 0.0) {
    hm += 0.04 * noise3(q * 2.5) * fade;
    float frost = noise3(q * 6.0);
    albedo *= 1.0 + 0.12 * frost * fade;
    #if DETAIL > 1
    float c = 1.0 - abs(noise3(q * 1.3 + 4.0));
    float line = smoothstep(0.95, 0.99, c) * fade;
    albedo = mix(albedo, albedo * vec3(0.55, 0.75, 1.0), line);
    hm -= 0.03 * line;
    #endif
  }
  #endif
#else
  #if DETAIL > 0
  if (fade > 0.0) {
    float g = noise3(q * 4.5);
    albedo *= 1.0 + 0.22 * g * fade;
    hm += (0.05 * noise3(q * 1.8) + 0.015 * g) * fade;
    #if DETAIL > 1
    vec3 c = cells(q * 0.6);
    float pit = 1.0 - smoothstep(0.1, 0.3, c.x);
    hm -= 0.08 * pit * step(0.7, c.z) * fade;
    #endif
  }
  #endif
#endif

  // The painted relief's slope from two more taps a texel and a half away, then the detail's on top.
  vec3 nb = n;
  if (relief > 0.0 && useMap > 0.5) {
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(n, t1);
    float e = 1.5 * texel;
    vec2 sl = vec2(textureCube(map, n + t1 * e).a - h, textureCube(map, n + t2 * e).a - h) * relief / (e * radius);
    sl *= min(1.0, 1.5 / max(length(sl), 1e-4)); // the steepest walls stay lit at a slant, not black
    nb = normalize(n - t1 * sl.x - t2 * sl.y);
  }
  #if DETAIL > 0
  nb = bump(nb, hm - h * relief); // outside any branch: derivatives need every pixel of a quad
  #endif
  // Light from the sun past the other bodies and the ring, and the blob shadows of things standing about.
  float sun = 1.0;
  for (int i = 0; i < ${OCCLUDERS}; i++) if (occ[i].w > 0.0) sun *= sphereShadow(vWorld, sunPos, sunR, occ[i].xyz, occ[i].w);
  if (ringOn > 0.5) sun *= ringShadow(vWorld);
  float blob = 0.0;
  for (int i = 0; i < ${LOOK.planets.blob.max}; i++) {
    if (blobs[i].w <= 0.0) continue;
    float b = length(vWorld - blobs[i].xyz) / blobs[i].w;
    blob = max(blob, blobK[i] * (1.0 - smoothstep(0.25, 1.0, b)));
  }
  // The terminator follows the smooth sphere, so relief can't light up the night side.
  float day = smoothstep(-0.06, 0.1, ndl);
  float diff = max(dot(nb, L), 0.0) * day * sun * (1.0 - blob);
  vec3 col = albedo * (sunCol * diff + night * (0.55 + 0.45 * h) * (1.0 - 0.6 * blob));
  vec3 H = normalize(L + V);
  col += sunCol * shine * pow(max(dot(nb, H), 0.0), gloss) * diff * (gloss / 160.0);
  // Water mirrors the dark sky at a slant: darker towards the horizon, which is what makes it read as water
  // (and shows the ripples' tilt).
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nb, V), 0.0), 5.0);
  col = mix(col, vec3(0.006, 0.008, 0.02), fres * wet * 0.75);
  col += emit * (1.0 - 0.45 * day);
  // A thin haze round the lit limb, seen from afar only (on the ground it would wash the horizon).
  float limb = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += rimCol * limb * smoothstep(-0.25, 0.35, ndl) * smoothstep(radius * 1.3, radius * 2.6, length(cameraPosition - centre));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const ringVertex = /* glsl */ `
varying vec3 vWorld;
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const ringFragment = /* glsl */ `
uniform vec3 sunPos, sunCol, night, ringN, ringCol[3];
uniform float sunR, ringIn, ringOut, ringOpacity;
uniform vec4 occ[${OCCLUDERS}];
varying vec3 vWorld;
varying vec2 vLocal;
${SHADOW_GLSL}
${RING_GLSL}
float hash(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
void main() {
  float x = (length(vLocal) - ringIn) / (ringOut - ringIn);
  float dens = ringDensity(x);
  if (dens < 0.01) discard;
  vec3 c = mix(ringCol[0], ringCol[1], 0.5 + 0.5 * sin(x * 31.0));
  c = mix(c, ringCol[2], smoothstep(0.55, 1.0, x) * 0.6);
  c *= 0.82 + 0.36 * hash(floor(x * 260.0)); // fine ringlets
  float sun = 1.0;
  for (int i = 0; i < ${OCCLUDERS}; i++) if (occ[i].w > 0.0) sun *= sphereShadow(vWorld, sunPos, sunR, occ[i].xyz, occ[i].w);
  vec3 L = normalize(sunPos - vWorld), V = normalize(cameraPosition - vWorld);
  float nl = dot(ringN, L), nv = dot(ringN, V);
  // Lit face bright; seen from the dark face, light filters through, dimmer.
  float lit = nl * nv > 0.0 ? 0.55 + 0.6 * abs(nl) : 0.25 + 0.3 * (1.0 - dens);
  gl_FragColor = vec4(c * (sunCol * lit * sun + night * 1.5), dens * ringOpacity);
  #include <colorspace_fragment>
}`;

// The ice world's aurora: a glowing band round each magnetic pole on a shell above the ground, on the night
// side only, brighter towards its edge where you look through more of it.
const auroraVertex = /* glsl */ `
varying vec3 vObj, vWorld;
void main() {
  vObj = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const auroraFragment = /* glsl */ `
uniform vec3 sunPos, colA, colB, pole;
uniform float time;
varying vec3 vObj, vWorld;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vObj);
  float dark = 1.0 - smoothstep(-0.3, 0.05, dot(n, normalize(sunPos - vWorld)));
  float lat = abs(dot(n, pole)) + 0.06 * noise3(n * 4.0 + vec3(0.0, time * 0.05, 0.0));
  float k = (lat - 0.8) / 0.07, band = exp(-k * k);
  float folds = 0.5 + 0.5 * noise3(n * vec3(11.0, 3.0, 11.0) + vec3(time * 0.08, 0.0, 0.0));
  folds = pow(folds, 2.0);
  float edge = 1.0 / (0.35 + abs(dot(n, normalize(cameraPosition - vWorld))));
  vec3 c = mix(colA, colB, smoothstep(0.75, 0.9, lat));
  gl_FragColor = vec4(c * band * folds * dark * edge * 0.22, 1.0);
}`;

// Paints one body's big picture into a cube map; null after one warning if it couldn't (the body is then
// drawn in its flat colour, lit and shadowed as usual). No pixel is read back, as that would stall the GPU
// mid-game: three's own check of the shader program says whether it could run.
function bake(renderer, body, w, size) {
  let rt = null, error = null, runnable = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      col: { value: Array.from({ length: 6 }, (_, i) => new THREE.Color(w.colors[i] ?? w.colors[0])) },
      seed: { value: new THREE.Vector3(w.seed * 7.13, w.seed * 3.71, w.seed * 5.29) },
      feature: { value: new THREE.Vector3(...(w.feature ?? [0, 1, 0])).normalize() },
      radius: { value: body.radius },
      craters: { value: w.craters ?? 1 },
    },
    defines: { WORLD: WORLDS[w.world] },
    vertexShader: bakeVertex, fragmentShader: bakeFragment, side: THREE.BackSide, depthTest: false, depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  try {
    // Colour only: a depth buffer would be six unused renderbuffers per body.
    rt = new THREE.WebGLCubeRenderTarget(size, {
      colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false, stencilBuffer: false,
    });
    const scene = new THREE.Scene();
    scene.add(box);
    new THREE.CubeCamera(0.1, 10, rt).update(renderer, scene);
    runnable = renderer.properties.get(mat).currentProgram?.diagnostics?.runnable !== false;
  } catch (e) {
    error = e;
  }
  box.geometry.dispose();
  mat.dispose();
  if (!error && runnable) return rt;
  console.warn(`look: ${body.id} could not be painted (${error?.message ?? "its shader did not build"}), flat colour instead`);
  try {
    rt?.dispose();
  } catch {} // a broken context may refuse even this
  return null;
}

// The planets and moons of `system`. Returns { meshes: { id: mesh }, setLevel(level), update(t, poses, blobs, eye) }:
// the caller adds the meshes to the scene and moves them; update, before each frame is drawn, sets the sun,
// the shadows and the blob shadows ([{ at, radius, strength }], nearest first; at most cfg.blob.max) and
// paints the next body's map.
export function planetLooks(system, renderer, rand, cfg = LOOK.planets) {
  const sunBody = system.bodies.find((b) => b.kind === "sun");
  const casters = system.bodies.filter((b) => b.kind !== "sun");
  const sunCol = new THREE.Color(cfg.sun).multiplyScalar(cfg.light);
  const night = new THREE.Color(cfg.night).multiplyScalar(cfg.nightLight);
  const shared = {
    sunPos: { value: new THREE.Vector3() }, sunR: { value: sunBody.radius }, sunCol: { value: sunCol }, night: { value: night },
    time: { value: 0 }, detailNear: { value: cfg.near }, detailFar: { value: cfg.far },
    blobs: { value: Array.from({ length: cfg.blob.max }, () => new THREE.Vector4()) },
    blobK: { value: new Array(cfg.blob.max).fill(0) },
  };
  const meshes = {}, looks = [], materials = [];
  let level = null;
  for (const b of system.bodies) {
    const w = cfg.worlds[b.id];
    if (!w || (b.kind !== "planet" && b.kind !== "moon")) continue;
    skipFacets(b, rand);
    const ring = b.ring ?? system.bodies.find((p) => p.id === b.orbit?.around)?.ring;
    const ringOwner = b.ring ? b : ring && system.byId[b.orbit.around];
    const own = {
      map: { value: null }, useMap: { value: 0 }, texel: { value: 2 / (w.bake ?? cfg.bake[b.kind]) }, base: { value: new THREE.Color(b.color) },
      radius: { value: b.radius }, relief: { value: w.relief },
      glowCol: { value: new THREE.Color(w.glow ?? 0x000000).multiplyScalar(1.6) },
      rimCol: { value: new THREE.Color(w.rim ?? 0x000000).multiplyScalar(0.55) },
      feature: { value: new THREE.Vector3(...(w.feature ?? [0, 1, 0])).normalize() },
      occ: { value: Array.from({ length: OCCLUDERS }, () => new THREE.Vector4()) },
      ringOn: { value: ring ? 1 : 0 }, ringN: { value: new THREE.Vector3(0, 1, 0) }, ringC: { value: new THREE.Vector3() },
      ringIn: { value: ring ? ringOwner.radius * ring.inner : 1 }, ringOut: { value: ring ? ringOwner.radius * ring.outer : 2 },
      ringOpacity: { value: ring ? cfg.worlds[ringOwner.id].ring.opacity : 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, ...own }, defines: { WORLD: WORLDS[w.world], DETAIL: cfg.detail.at(-1) },
      vertexShader: surfaceVertex, fragmentShader: surfaceFragment,
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(b.radius, b.kind === "moon" ? 16 : 28), mat);
    const look = { body: b, w, own, mesh, ringOwner, rt: null };
    if (b.ring) {
      const rw = w.ring, rmesh = ringMesh(b, rw, shared);
      mesh.add(rmesh);
      look.ringUniforms = rmesh.material.uniforms;
      // The ring's plane, the same for the giant and its moons: the ring's local z in the world.
      own.ringN.value.set(0, 0, 1).applyQuaternion(rmesh.quaternion);
    }
    if (w.aurora) mesh.add(auroraMesh(b, w, shared));
    meshes[b.id] = mesh;
    looks.push(look);
  }
  // Moons share their planet's ring plane.
  for (const l of looks) if (!l.body.ring && l.own.ringOn.value) l.own.ringN.value.copy(looks.find((k) => k.body === l.ringOwner).own.ringN.value);

  // Bodies whose map is still to paint; all again after a lost WebGL context, which loses what was drawn.
  let toPaint = [], frames = 0;
  const unpaint = () => {
    for (const l of looks) {
      l.rt?.dispose();
      l.rt = l.own.map.value = null;
      l.own.useMap.value = 0;
    }
    toPaint = looks.slice();
    frames = 0;
  };
  unpaint();
  renderer.domElement.addEventListener("webglcontextrestored", unpaint);
  // The nearest surface to the eye first, so where you stand gets its look first.
  const paintNext = (poses, eye) => {
    let k = 0, best = Infinity;
    for (let i = 0; i < toPaint.length; i++) {
      const b = toPaint[i].body, q = poses[b.id];
      const d = Math.hypot(q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]) - b.radius;
      if (d < best) (best = d), (k = i);
    }
    const l = toPaint.splice(k, 1)[0];
    l.rt = bake(renderer, l.body, l.w, l.w.bake ?? cfg.bake[l.body.kind]);
    l.own.map.value = l.rt?.texture ?? null;
    l.own.useMap.value = l.rt ? 1 : 0;
  };
  // Shadow casters per body, nearest first: reused every frame.
  const near = Array.from({ length: OCCLUDERS }, () => ({ c: null, gap: 0 }));

  return {
    meshes,
    setLevel(l) {
      if (l === level) return;
      level = l;
      for (const m of materials) {
        m.defines.DETAIL = cfg.detail[l];
        m.needsUpdate = true;
      }
    },
    // t: s on the match clock; poses: id -> [x, y, z]; blobs as returned by blobUnder; eye: [x, y, z].
    update(t, poses, blobs, eye) {
      if (frames++ > 0 && toPaint.length) paintNext(poses, eye); // the first frame goes out unpainted
      shared.time.value = t;
      shared.sunPos.value.fromArray(poses[sunBody.id]);
      for (let i = 0; i < cfg.blob.max; i++) {
        const b = i < blobs.length ? blobs[i] : null;
        if (b) shared.blobs.value[i].set(b.at[0], b.at[1], b.at[2], b.radius), (shared.blobK.value[i] = b.strength);
        else shared.blobs.value[i].w = 0;
      }
      for (const l of looks) {
        // The nearest other bodies are the ones whose shadow can fall here.
        const p = poses[l.body.id];
        for (const k of near) (k.c = null), (k.gap = Infinity);
        for (const c of casters) {
          if (c === l.body) continue;
          const q = poses[c.id], gap = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) - c.radius;
          if (gap >= near[OCCLUDERS - 1].gap) continue;
          // Insert in order, the farthest drops off the end.
          let i = OCCLUDERS - 1;
          for (; i > 0 && near[i - 1].gap > gap; i--) (near[i].c = near[i - 1].c), (near[i].gap = near[i - 1].gap);
          (near[i].c = c), (near[i].gap = gap);
        }
        if (l.ringOwner) l.own.ringC.value.fromArray(poses[l.ringOwner.id]);
        for (let i = 0; i < OCCLUDERS; i++) {
          const k = near[i], o = l.own.occ.value[i];
          if (k.c) o.set(poses[k.c.id][0], poses[k.c.id][1], poses[k.c.id][2], k.c.radius);
          else o.w = 0;
        }
        if (l.ringUniforms) for (let i = 0; i < OCCLUDERS; i++) {
          // The ring is shadowed by its planet first, then the nearest moons.
          const c = i === 0 ? l.body : near[i - 1].c, o = l.ringUniforms.occ.value[i];
          if (c) o.set(poses[c.id][0], poses[c.id][1], poses[c.id][2], c.radius);
          else o.w = 0;
        }
      }
    },
  };
}

function ringMesh(body, rw, shared) {
  const { inner, outer, tilt } = body.ring;
  const geo = new THREE.RingGeometry(body.radius * inner, body.radius * outer, 192, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunPos: shared.sunPos, sunCol: shared.sunCol, sunR: shared.sunR, night: shared.night,
      ringN: { value: new THREE.Vector3() }, ringIn: { value: body.radius * inner }, ringOut: { value: body.radius * outer },
      ringOpacity: { value: rw.opacity }, ringCol: { value: rw.colors.map((c) => new THREE.Color(c)) },
      occ: { value: Array.from({ length: OCCLUDERS }, () => new THREE.Vector4()) },
    },
    vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2 + (tilt * Math.PI) / 180;
  ring.updateMatrix();
  mat.uniforms.ringN.value.set(0, 0, 1).applyQuaternion(ring.quaternion);
  return ring;
}

function auroraMesh(body, w, shared) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunPos: shared.sunPos, time: shared.time, colA: { value: new THREE.Color(w.aurora[0]) }, colB: { value: new THREE.Color(w.aurora[1]) },
      pole: { value: new THREE.Vector3(0.25, 1, 0.1).normalize() },
    },
    vertexShader: auroraVertex, fragmentShader: auroraFragment,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.IcosahedronGeometry(body.radius * 1.3, 12), mat);
}

// Faint orbit rings, so you can see where a planet will come round. A moon's ring rides on its planet.
// A comet's ellipse is sampled from the simulation's own poses, so the line is exactly its path.
// Returns [{ ring, around }]; the caller adds them to the scene and moves each with its `around` body.
export function orbitLines(system) {
  const rings = [];
  for (const b of system.bodies.filter((b) => b.orbit)) {
    const pts = [];
    if (b.orbit.peri) {
      for (let i = 0; i <= 256; i++) pts.push(v3(posesAt(system, (i / 256) * b.orbit.period)[b.id].pos));
    } else {
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * 2 * Math.PI;
        pts.push(new THREE.Vector3(b.orbit.radius * Math.cos(a), 0, b.orbit.radius * Math.sin(a)));
      }
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x39406a }));
    rings.push({ ring, around: b.orbit.around });
  }
  return rings;
}
