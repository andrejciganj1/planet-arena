// The sound test page: every sound on a button, played through the game's mixer, so the owner can listen
// to each one. tools/sound_check.cjs reads window.soundtest to render the recipes offline.
import { SOUNDS } from "./sounds.js";
import { RECIPES, LOOPS } from "./synth.js";
import { createAudio } from "./audio.js";

window.soundtest = { SOUNDS, RECIPES, LOOPS };

// You stand at the origin looking down -z. Your own sounds are in your head; others' come from a place.
const WHERE = {
  "in your head (yours)": null,
  "another player 15 m to the left": [-15, 0, 0],
  "another player 60 m behind, right": [25, 0, 55],
};
const audio = createAudio();
const playing = new Set();
let where = null;

const select = document.getElementById("where");
for (const label of Object.keys(WHERE)) select.add(new Option(label, label));
const sound = (name) => ({ name, pos: where, own: !where });
const loops = () => new Map([...playing].map((name) => [name, sound(name)]));
select.addEventListener("change", () => {
  where = WHERE[select.value];
  audio.setLoops(new Map()); // a loop moving into or out of your head needs a new voice
  audio.setLoops(loops());
});

// The context wakes on the press, so it runs by the click that plays.
document.addEventListener("pointerdown", () => {
  audio.unlock();
  audio.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]);
});

const list = document.getElementById("list");
for (const name of SOUNDS) {
  const b = document.createElement("button");
  b.textContent = name;
  if (LOOPS.has(name)) {
    b.className = "loop";
    b.addEventListener("click", () => {
      if (playing.has(name)) playing.delete(name);
      else playing.add(name);
      b.classList.toggle("on", playing.has(name));
      audio.setLoops(loops());
    });
  } else b.addEventListener("click", () => audio.play(sound(name)));
  list.append(b);
}
