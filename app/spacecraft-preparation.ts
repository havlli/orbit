import * as THREE from 'three';
import { uploadSceneTexture } from './scene-texture';

/** Prepare the actual flight surfaces in this renderer before their reveal.
 * Template textures are shared across flights, so concurrent chapter requests
 * share one upload instead of modifying the same GPU texture twice. */
export function createSpacecraftPreparation(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  current: () => boolean,
  options: {
    lights?: readonly THREE.Light[];
    nextFrame?: () => Promise<void>;
    compile?: (craft: THREE.Group, lighting: THREE.Scene) => Promise<unknown>;
  } = {},
) {
  const nextFrame =
    options.nextFrame ??
    (() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const uploads = new WeakMap<THREE.Texture, Promise<boolean>>();
  let queue = Promise.resolve();
  const schedule = (texture: THREE.Texture) => {
    const upload = queue
      .then(async () => {
        if (!current()) return false;
        await nextFrame();
        return uploadSceneTexture(renderer, texture, current);
      })
      .then(
        (ready) => {
          if (!ready) uploads.delete(texture);
          return ready;
        },
        (error: unknown) => {
          uploads.delete(texture);
          throw error;
        },
      );
    // A failed or obsolete preparation must not hold up subsequent requests.
    queue = upload.then(
      () => {},
      () => {},
    );
    return upload;
  };
  return async (
    craft: THREE.Group,
    arrival: { group?: THREE.Group; current?: () => boolean } = {},
  ) => {
    const active = () => current() && (arrival.current?.() ?? true);
    if (!active()) return;
    const textures = new Set<THREE.Texture>();
    craft.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        material.userData.baseTransparent ??= material.transparent;
        material.transparent = true;
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const texture of textures) {
      if (!active()) return;
      let upload = uploads.get(texture);
      if (!upload) {
        upload = schedule(texture);
        uploads.set(texture, upload);
      }
      if (!(await upload)) return;
    }
    if (!active()) return;
    // Compile for the arrival, when only the incoming mission's lights remain.
    // Detached copies leave the displayed scene intact throughout compilation.
    const target = new THREE.Scene();
    target.environment = scene.environment;
    target.environmentIntensity = scene.environmentIntensity;
    target.environmentRotation.copy(scene.environmentRotation);
    target.fog = scene.fog;
    const craftLights = new Set<THREE.Object3D>();
    craft.traverseVisible((object) => {
      if (object instanceof THREE.Light) craftLights.add(object);
    });
    const addLight = (object: THREE.Object3D) => {
      if (
        object instanceof THREE.Light &&
        object.visible &&
        object.layers.test(camera.layers) &&
        !craftLights.has(object)
      )
        target.add(object.clone(false));
    };
    for (const light of options.lights ?? []) addLight(light);
    (arrival.group ?? craft).traverseVisible(addLight);
    await (options.compile
      ? options.compile(craft, target)
      : renderer.compileAsync(craft, camera, target));
  };
}
