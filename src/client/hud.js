// The HUD: crosshair (with a ring when the hook can reach something), health, weapon and ammo, the weapons
// you hold, booster fuel (extra fuel from a pickup in a second colour), toasts, "Click to play", hit
// feedback (a red vignette and an arc towards the shooter), the kill feed, scores, and online the name box
// and the connection's status screens. Names come from the server: only ever set as text.
import { BOOST, PLAYER, HOOK, WEAPON_ORDER, NET, FEEDBACK } from "../tuning.js";
import { segmentHit } from "../sim/collide.js";
import { viewDir } from "../sim/entity.js";
import { add, sub, scale, dot } from "../sim/vec.js";

const NAMES = { pistol: "Pistol", shotgun: "Shotgun", rocket: "Rocket launcher", minigun: "Minigun", sniper: "Sniper rifle", railgun: "Railgun" };
const DEATHS = { sun: "Into the sun!", void: "Lost in the void", damage: "Blown up" };

const MARKS = { sun: "☀", damage: "✹", void: "⋯" };
const nameOf = (players, id) => players[id]?.name ?? (id === "dummy" ? "Dummy" : id);

// Score table rows, best first: most kills, then fewer deaths, then name. players: { id: { name, kills, deaths } }.
export function scoreRows(players) {
  return Object.entries(players)
    .map(([id, p]) => ({ id, name: p.name, kills: p.kills, deaths: p.deaths }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// One kill feed line for a death event: "Ana ☀ Ben", or just the victim when nobody gets the kill.
export function feedText(ev, players) {
  const victim = nameOf(players, ev.id);
  return ev.by && ev.by !== ev.id ? `${nameOf(players, ev.by)} ${MARKS[ev.cause] ?? "✹"} ${victim}` : victim;
}

// Where on screen the hit came from, as an angle round the crosshair: 0 is straight up, clockwise positive.
// camera: { pos, right, up, forward }. A source right behind you has no side, so it gets the bottom.
export function arcAngle(camera, from) {
  const d = sub(from, camera.pos), x = dot(d, camera.right), y = dot(d, camera.up);
  if (Math.hypot(x, y) < 1e-9) return dot(d, camera.forward) < 0 ? Math.PI : 0;
  return Math.atan2(x, y);
}

function el(parent, cls, html = "") {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

// Whether the hook would catch something where the player is looking (same rules as the sim).
export function hookable(world, p) {
  if (!p.alive || p.hook || p.hookCooldown > 0) return false;
  const eye = add(p.pos, scale(p.up, PLAYER.eye));
  const hit = segmentHit(world.system, world.poses, eye, add(eye, scale(viewDir(p), HOOK.range)));
  return !!hit && world.system.byId[hit.id].kind !== "sun" && hit.id !== p.groundId;
}

// The name box before an online game: resolves with the name typed when Play is pressed.
export function askName(root, saved) {
  const box = el(root, "hud screen ask", `<div>Your name</div><input maxlength="${NET.nameMax}" spellcheck="false"><button>Play</button>`);
  const field = box.querySelector("input");
  field.value = saved; // a value, never markup
  field.focus();
  return new Promise((resolve) => {
    const go = () => {
      box.remove();
      resolve(field.value.trim());
    };
    box.querySelector("button").addEventListener("click", go);
    field.addEventListener("keydown", (e) => e.key === "Enter" && go());
  });
}

// online: show your kills and deaths in a corner and answer to the scoreboard.
export function createHud(root, online = false) {
  const cross = el(root, "hud crosshair");
  // Health matters even alone: your own rockets hurt you.
  const slots = WEAPON_ORDER.map((w, i) => `<span data-w="${w}">${i + 1}</span>`).join("");
  const bottom = el(root, "hud bottom", `<div class="health">Health<div class="bar"><div></div></div></div><div class="slots">${slots}</div><div class="weapon"></div><div class="fuel">Booster<div class="bar"><div></div><div class="over"></div></div></div>`);
  const vignette = el(root, "hud vignette");
  const score = el(root, "hud score");
  const feed = el(root, "hud feed");
  const board = el(root, "hud board");
  const toast = el(root, "hud toast");
  const screen = el(root, "hud screen");
  const play = el(root, "hud play", `Click to play<small>WASD move · mouse look · space jump, hold in the air to boost · click fire · right mouse hook · 1 to 6 / wheel weapons · Shift zoom (sniper)</small>`);
  let toastUntil = 0, vignetteAt = -1, vignetteStrength = 0, boardOn = false;
  const arcs = []; // { from, at, node }
  const lines = []; // { at, node }

  const say = (text, now) => {
    toast.textContent = text;
    toast.classList.add("on");
    toastUntil = now + 1.6;
  };

  return {
    // Tab held: the scoreboard (online only).
    scores(on) {
      boardOn = on && online;
    },
    event(ev, now, selfId = "player", players = {}) {
      if (ev.type === "hit" && ev.id === selfId) {
        vignetteAt = now;
        vignetteStrength = Math.min(FEEDBACK.vignetteMax, (FEEDBACK.vignetteMax * ev.damage) / FEEDBACK.full);
        const node = el(root, "hud arc");
        arcs.push({ from: ev.from, at: now, node });
      } else if (ev.type === "death") {
        const line = el(feed, "line");
        line.textContent = feedText(ev, players);
        lines.push({ at: now, node: line });
        while (lines.length > FEEDBACK.feedMax) lines.shift().node.remove();
        const mine = ev.by === selfId && ev.id !== selfId;
        if (mine || (ev.id === "dummy" && ev.cause === "sun")) say(ev.cause === "sun" ? "Sun kill!" : "Kill!", now);
        else if (ev.id === selfId) say(DEATHS[ev.cause] + (ev.by && ev.by !== ev.id ? ` (by ${nameOf(players, ev.by)})` : ""), now);
      }
    },
    // A status line over the game (online: connecting, full, ...), or null for none.
    screen(text) {
      screen.style.display = text ? "flex" : "none";
      if (text && screen.textContent !== text) screen.textContent = text;
    },
    // camera: { pos, right, up, forward } as drawn, to aim the hit arcs; null when there is none.
    update(world, locked, now, selfId = "player", camera = null) {
      const p = world.entities[selfId];
      // Online there is no body until the first snapshot.
      for (const x of [bottom, cross, play]) x.style.display = p ? "" : "none";
      if (now > toastUntil) toast.classList.remove("on");
      vignette.style.opacity = Math.max(0, vignetteStrength * (1 - (now - vignetteAt) / FEEDBACK.vignetteFade));
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i], k = (now - a.at) / FEEDBACK.arcFade;
        if (k >= 1 || !camera) {
          a.node.remove();
          arcs.splice(i, 1);
        } else {
          a.node.style.opacity = 1 - k;
          a.node.style.transform = `rotate(${arcAngle(camera, a.from)}rad)`;
        }
      }
      while (lines.length && now - lines[0].at > FEEDBACK.feedFor) lines.shift().node.remove();
      const mine = world.scores[selfId];
      score.style.display = online && p && mine ? "" : "none";
      if (online && mine) score.textContent = `Kills ${mine.kills} · Deaths ${mine.deaths}`;
      board.style.display = boardOn ? "" : "none";
      if (boardOn) {
        const all = {};
        for (const [id, pl] of Object.entries(world.players)) all[id] = { name: pl.name, ...(world.scores[id] || { kills: 0, deaths: 0 }) };
        board.replaceChildren();
        const head = el(board, "row head");
        for (const t of ["Player", "Kills", "Deaths"]) el(head, "cell").textContent = t;
        for (const r of scoreRows(all)) {
          const row = el(board, r.id === selfId ? "row me" : "row");
          for (const t of [r.name, r.kills, r.deaths]) el(row, "cell").textContent = t;
        }
      }
      if (!p) return;
      const ammo = world.tuning.WEAPONS[p.weapon].ammo ? ` ${p.ammo[p.weapon] || 0}` : "";
      bottom.querySelector(".weapon").textContent = NAMES[p.weapon] + ammo;
      for (const s of bottom.querySelectorAll(".slots span")) {
        s.classList.toggle("held", p.weapons.includes(s.dataset.w));
        s.classList.toggle("hand", p.weapon === s.dataset.w);
      }
      bottom.querySelector(".fuel .bar > div").style.width = `${(100 * Math.min(p.fuel, BOOST.fuel)) / BOOST.fuel}%`;
      bottom.querySelector(".fuel .over").style.width = `${(100 * Math.max(0, p.fuel - BOOST.fuel)) / BOOST.fuel}%`;
      bottom.querySelector(".health .bar > div").style.width = `${p.alive ? (100 * Math.max(0, p.health)) / PLAYER.health : 0}%`;
      cross.classList.toggle("hookable", locked && hookable(world, p));
      play.style.display = locked ? "none" : "flex";
    },
  };
}
