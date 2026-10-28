// The HUD: crosshair (with a ring when the hook can reach something), health, weapon and ammo, the weapons
// you hold, booster fuel (extra fuel from a pickup in a second colour), the dummy's health, toasts,
// "Click to play", and online the name box and the connection's status screens.
import { BOOST, DUMMY, PLAYER, HOOK, WEAPON_ORDER, NET } from "../tuning.js";
import { segmentHit } from "../sim/collide.js";
import { viewDir } from "../sim/entity.js";
import { add, scale } from "../sim/vec.js";

const NAMES = { pistol: "Pistol", shotgun: "Shotgun", rocket: "Rocket launcher", minigun: "Minigun", sniper: "Sniper rifle", railgun: "Railgun" };
const DEATHS = { sun: "Into the sun!", void: "Lost in the void", damage: "Blown up" };

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

export function createHud(root) {
  const cross = el(root, "hud crosshair");
  // Health matters even alone: your own rockets hurt you.
  const slots = WEAPON_ORDER.map((w, i) => `<span data-w="${w}">${i + 1}</span>`).join("");
  const bottom = el(root, "hud bottom", `<div class="health">Health<div class="bar"><div></div></div></div><div class="slots">${slots}</div><div class="weapon"></div><div class="fuel">Booster<div class="bar"><div></div><div class="over"></div></div></div>`);
  const dummy = el(root, "hud dummy", `Dummy<div class="bar"><div></div></div>`);
  const toast = el(root, "hud toast");
  const screen = el(root, "hud screen");
  const play = el(root, "hud play", `Click to play<small>WASD move · mouse look · space jump, hold in the air to boost · click fire · right mouse hook · 1 to 6 / wheel weapons · Shift zoom (sniper)</small>`);
  let toastUntil = 0;

  const say = (text, now) => {
    toast.textContent = text;
    toast.classList.add("on");
    toastUntil = now + 1.6;
  };

  return {
    event(ev, now, selfId = "player") {
      if (ev.type === "death" && ev.id === "dummy" && ev.cause === "sun") say("Sun kill!", now);
      else if (ev.type === "death" && ev.id === selfId) say(DEATHS[ev.cause], now);
    },
    // A status line over the game (online: connecting, full, ...), or null for none.
    screen(text) {
      screen.style.display = text ? "flex" : "none";
      if (text && screen.textContent !== text) screen.textContent = text;
    },
    update(world, locked, now, selfId = "player") {
      const p = world.entities[selfId], d = world.entities.dummy;
      // Online there is no body until the first snapshot, and the dummy only while you are alone.
      for (const x of [bottom, cross, play]) x.style.display = p ? "" : "none";
      dummy.style.display = d ? "" : "none";
      if (now > toastUntil) toast.classList.remove("on");
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
      if (d) dummy.querySelector(".bar > div").style.width = `${d.alive ? (100 * Math.max(0, d.health)) / DUMMY.health : 0}%`;
      cross.classList.toggle("hookable", locked && hookable(world, p));
      play.style.display = locked ? "none" : "flex";
    },
  };
}
