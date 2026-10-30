// Every player's grappling hook and rope: flying nose first and spinning, snapping open and digging in on a
// catch with a puff of dust, and reeled back to the hand when let go. The game only knows the hook in flight
// (hookShot) and the caught one (hook); the reel back is looks only.
import * as THREE from "three";
import { LOOK, HOOK, TICK } from "../../tuning.js";
import { add, sub, scale, norm, len, lerp } from "../../sim/vec.js";
import { v3, Y, haloMap } from "./common.js";
import { hookPose } from "./proppose.js";

const P = LOOK.props.hook;
const COLLAR = 0.47; // m behind the nose, where the rope ties on (tools/blender/props.py)

// One hook: a simple cone until props.glb arrives, then the model with three prongs round the crown.
function hookMesh() {
  const group = new THREE.Group(), spinner = new THREE.Group();
  group.add(spinner);
  const plain = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 8).translate(0, -0.2, 0), new THREE.MeshLambertMaterial({ color: 0x9aa1ab }));
  spinner.add(plain);
  const prongs = [];
  let dressed = false;
  return {
    group,
    dress(props) {
      const body = !dressed && props?.scene.getObjectByName("hook"), prong = props?.scene.getObjectByName("hook_prong");
      if (!body || !prong) return;
      dressed = true;
      spinner.remove(plain);
      spinner.add(body.clone(true));
      for (let k = 0; k < 3; k++) {
        // Each prong pivots at the crown, turned a third of the way round from the last, swinging outward.
        const turn = new THREE.Group(), pivot = new THREE.Group();
        turn.rotation.y = (k * 2 * Math.PI) / 3;
        pivot.position.set(0, -0.02, 0.035);
        pivot.add(prong.clone(true));
        turn.add(pivot);
        spinner.add(turn);
        prongs.push(pivot);
      }
    },
    pose(open, spin) {
      spinner.rotation.y = spin;
      for (const p of prongs) p.rotation.x = -P.openAngle * open;
    },
  };
}

export function createGrapples(scene) {
  const all = new Map(); // entity id -> { mesh, rope, ropeGeo, state, since, pos, dir }
  const puffs = [];
  const make = () => {
    const mesh = hookMesh();
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9d2c0 }));
    rope.frustumCulled = false;
    scene.add(mesh.group, rope);
    return { mesh, rope, ropeGeo, state: null, since: 0, pos: null, dir: [0, 1, 0] };
  };
  const puff = (at, colour, now) => {
    let s = puffs.find((x) => !x.sprite.visible);
    if (!s) {
      s = { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap(), transparent: true, depthWrite: false })), at: 0 };
      scene.add(s.sprite);
      puffs.push(s);
    }
    s.sprite.visible = true;
    s.sprite.position.copy(v3(at));
    s.sprite.material.color.setHex(colour);
    s.at = now;
  };
  const q = new THREE.Quaternion();

  return {
    // hand(e): where e's rope starts, as drawn; props: the loaded props.glb or null; now: real s.
    update(world, poses, alpha, now, hand, props) {
      const seen = new Set();
      for (const e of Object.values(world.entities)) {
        let g = all.get(e.id);
        const flying = e.alive && e.hookShot, caught = e.alive && e.hook;
        if (!g && !flying && !caught) continue;
        if (!g) all.set(e.id, (g = make()));
        seen.add(e.id);
        g.mesh.dress(props);
        const was = g.state;
        if (flying) {
          // Drawn between ticks: back along its line by the part of a tick not yet run.
          g.pos = add(e.hookShot.pos, scale(e.hookShot.dir, HOOK.fly * (alpha - 1) * TICK));
          g.dir = e.hookShot.dir;
          g.state = "flying";
        } else if (caught) {
          g.pos = add(poses[e.hook.body], e.hook.offset);
          if (was !== "flying" && was !== "caught") g.dir = norm(sub(g.pos, hand(e)));
          g.state = "caught";
          if (was !== "caught") puff(g.pos, world.system.byId[e.hook.body].color, now);
        } else if (was === "flying" || was === "caught") g.state = "reeling";
        if (g.state !== was) (g.since = now), (g.from = g.pos);
        const k = g.state === "reeling" ? (now - g.since) / P.reel : 0;
        if (g.state === "reeling" && (k >= 1 || !e.alive)) g.state = null;
        const show = !!g.state;
        g.mesh.group.visible = g.rope.visible = show;
        if (!show) continue;
        const h = hand(e);
        if (g.state === "reeling") g.pos = lerp(g.from, h, Math.min(1, k));
        const { open, spin } = hookPose(g.state, now - g.since);
        g.mesh.pose(open, spin);
        g.mesh.group.position.copy(v3(g.pos));
        g.mesh.group.quaternion.copy(q.setFromUnitVectors(Y, v3(g.dir)));
        const tail = len(sub(g.pos, h)) > COLLAR ? sub(g.pos, scale(g.dir, COLLAR)) : g.pos;
        g.ropeGeo.setFromPoints([v3(h), v3(tail)]);
      }
      // Players who left: their hooks go too.
      for (const [id, g] of all) {
        if (seen.has(id)) continue;
        scene.remove(g.mesh.group, g.rope);
        g.ropeGeo.dispose();
        all.delete(id);
      }
      for (const s of puffs) {
        if (!s.sprite.visible) continue;
        const k = (now - s.at) / P.dust.life;
        if (k >= 1 || k < 0) {
          s.sprite.visible = false;
          continue;
        }
        s.sprite.scale.setScalar(P.dust.size * (0.3 + 0.7 * Math.sqrt(k)));
        s.sprite.material.opacity = P.dust.opacity * (1 - k);
      }
    },
  };
}
