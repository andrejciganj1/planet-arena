// The weapon in view, and what shots, blasts and beams look like.
import * as THREE from "three";

export const WEAPON_COLORS = { pistol: 0x8fa1b8, shotgun: 0xc98a4b, rocket: 0x5f8f4e, minigun: 0x9a9fa8, sniper: 0x4b7bc9, railgun: 0x3fe0d0 };

// Small and low in the corner of the view, lit by their own colour so they read on the night side too.
export function weaponModels() {
  const lit = (color) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
  const pistol = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.045), lit(0x4a5160));
  grip.position.set(0, -0.045, 0.02);
  grip.rotation.x = -0.3;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.16), lit(0x8fa1b8));
  barrel.position.set(0, 0.01, -0.04);
  pistol.add(grip, barrel);
  pistol.position.set(0.16, -0.15, -0.42);
  const rocket = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.5, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0x5f8f4e, emissive: 0x5f8f4e, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  tube.rotation.x = Math.PI / 2;
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.052, 14), new THREE.MeshBasicMaterial({ color: 0x15171c }));
  bore.position.z = -0.249;
  rocket.add(tube, bore);
  rocket.position.set(0.18, -0.17, -0.5);
  // The other four from boxes and tubes, each in its own colour (as their pickups are).
  const gun = (color, parts, at) => {
    const g = new THREE.Group();
    for (const [w, h, d, x, y, z] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit(color));
      m.position.set(x, y, z);
      g.add(m);
    }
    g.position.set(...at);
    return g;
  };
  const shotgun = gun(WEAPON_COLORS.shotgun, [[0.06, 0.06, 0.42, 0, 0.01, -0.12], [0.07, 0.05, 0.18, 0, -0.04, 0.06]], [0.17, -0.16, -0.45]);
  const minigun = gun(WEAPON_COLORS.minigun, [[0.11, 0.11, 0.36, 0, 0, -0.1], [0.04, 0.04, 0.2, 0.03, 0.03, -0.36], [0.04, 0.04, 0.2, -0.03, -0.03, -0.36]], [0.18, -0.17, -0.48]);
  const sniper = gun(WEAPON_COLORS.sniper, [[0.04, 0.05, 0.6, 0, 0, -0.18], [0.05, 0.05, 0.14, 0, 0.06, -0.08]], [0.16, -0.15, -0.45]);
  const railgun = gun(WEAPON_COLORS.railgun, [[0.07, 0.07, 0.5, 0, 0, -0.14], [0.09, 0.02, 0.4, 0, 0.05, -0.14], [0.09, 0.02, 0.4, 0, -0.05, -0.14]], [0.17, -0.16, -0.47]);
  return { pistol, shotgun, rocket, minigun, sniper, railgun };
}

// Rockets and bullets share one pool of meshes (geometry and material swapped per shot); each blast and
// beam gets its own material, as their opacity fades one by one.
export function shotLooks() {
  const rocketGeo = new THREE.CapsuleGeometry(0.12, 0.45, 4, 8), rocketMat = new THREE.MeshLambertMaterial({ color: 0xd8dde6 });
  const bulletGeo = new THREE.SphereGeometry(0.09, 8, 6), bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  const blastGeo = new THREE.SphereGeometry(1, 16, 12);
  return {
    rocketGeo, rocketMat, bulletGeo, bulletMat,
    shot: () => new THREE.Mesh(rocketGeo, rocketMat),
    blast: () => new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, depthWrite: false })),
    beam: () => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x6fe3ff, transparent: true }));
      l.frustumCulled = false;
      return l;
    },
  };
}
