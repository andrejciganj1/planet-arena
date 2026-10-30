// Look assets (models, images). Every load starts at once and none can break the game: a file that is
// missing, offline or corrupt logs one warning and get() stays null, so that look keeps its simple shape.
// The loaders (bytes in, object out, keyed by file extension) are passed in, look/loaders.js in the page,
// so this runs under node tests without three.js.
//   list: [{ name, url }]
export function loadAssets(list, { fetchImpl = (url) => fetch(url), loaders = {} } = {}) {
  const got = new Map(), failed = [];
  const one = async ({ name, url }) => {
    try {
      const ext = url.split(/[?#]/)[0].split(".").pop().toLowerCase();
      const load = loaders[ext];
      if (!load) throw new Error(`no loader for .${ext}`);
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got.set(name, await load(await res.arrayBuffer(), url));
    } catch (e) {
      failed.push(url);
      console.warn(`look: ${url} did not load (${e?.message ?? e}), keeping the simple shape`);
    }
  };
  const ready = Promise.all(list.map(one)).then(() => {});
  return { get: (name) => got.get(name) ?? null, ready, failed };
}
