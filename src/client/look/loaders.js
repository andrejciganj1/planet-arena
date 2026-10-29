// The page's loaders for loadAssets: a file's bytes in, a three.js object out. A glTF model comes back as
// GLTFLoader's result ({ scene, ... }), an image as a Texture (colour space left to the caller: colour maps
// want sRGB, data maps don't).
import * as THREE from "three";

const image = (type) => (bytes) => new Promise((done, fail) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  new THREE.TextureLoader().load(
    url,
    (tex) => (URL.revokeObjectURL(url), done(tex)),
    undefined,
    () => (URL.revokeObjectURL(url), fail(new Error("not an image"))),
  );
});

export function threeLoaders() {
  return {
    glb: async (bytes) => {
      // Fetched with the first model, so the page starts without it.
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      return new Promise((done, fail) => new GLTFLoader().parse(bytes, "", done, fail));
    },
    png: image("image/png"),
    jpg: image("image/jpeg"),
    webp: image("image/webp"),
  };
}
