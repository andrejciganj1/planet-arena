// The HUD: crosshair, health and booster bars, weapon, the dummy's health, toasts, and "Click to play".
import { BOOST, DUMMY, PLAYER } from "../tuning.js";

const NAMES = { pistol: "Pistol", rocket: "Rocket launcher" };
const DEATHS = { sun: "Into the sun!", void: "Lost in the void", damage: "Blown up" };

function el(parent, cls, html = "") {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

export function createHud(root) {
  el(root, "hud crosshair");
  // Health matters even alone: your own rockets hurt you.
  const bottom = el(root, "hud bottom", `<div class="health">Health<div class="bar"><div></div></div></div><div class="weapon"></div><div class="fuel bar"><div></div></div>`);
  const dummy = el(root, "hud dummy", `Dummy<div class="bar"><div></div></div>`);
  const toast = el(root, "hud toast");
  const play = el(root, "hud play", `Click to play<small>WASD move · mouse look · space jump, hold in the air to boost · click fire · 1 / 2 / wheel weapons</small>`);
  let toastUntil = 0;

  const say = (text, now) => {
    toast.textContent = text;
    toast.classList.add("on");
    toastUntil = now + 1.6;
  };

  return {
    event(ev, now) {
      if (ev.type === "death" && ev.id === "dummy" && ev.cause === "sun") say("Sun kill!", now);
      else if (ev.type === "death" && ev.id === "player") say(DEATHS[ev.cause], now);
    },
    update(world, locked, now) {
      const p = world.entities.player, d = world.entities.dummy;
      bottom.querySelector(".weapon").textContent = NAMES[p.weapon];
      bottom.querySelector(".fuel > div").style.width = `${(100 * p.fuel) / BOOST.fuel}%`;
      bottom.querySelector(".health .bar > div").style.width = `${p.alive ? (100 * Math.max(0, p.health)) / PLAYER.health : 0}%`;
      dummy.querySelector(".bar > div").style.width = `${d.alive ? (100 * Math.max(0, d.health)) / DUMMY.health : 0}%`;
      play.style.display = locked ? "none" : "flex";
      if (now > toastUntil) toast.classList.remove("on");
    },
  };
}
