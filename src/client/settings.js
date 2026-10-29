// Your own on-screen choices (toggles), remembered by the browser. The storage is passed in so tests can
// load this under node; private windows may block or throw, so every access is guarded and the choice then
// lives in memory only. Names are free: the sounds round adds "sound" (all sound) and "hits" (the hit sound).
const KEY = "planet-arena.settings";
const DEFAULTS = { orbits: true, cues: true };

export function createSettings(storage) {
  const values = { ...DEFAULTS };
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved && typeof saved === "object") for (const [k, v] of Object.entries(saved)) if (typeof v === "boolean") values[k] = v;
  } catch {
    // missing, blocked or corrupt: keep the defaults
  }
  return {
    get: (name) => values[name] ?? true,
    toggle(name) {
      values[name] = !(values[name] ?? true);
      try {
        storage.setItem(KEY, JSON.stringify(values));
      } catch {
        // not saved, still applied
      }
      return values[name];
    },
  };
}
