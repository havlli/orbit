import * as THREE from 'three';
import { decodeBitmapOnMain } from './image-bitmap-decoder';

/** Decode and orient images before their first WebGL upload. HTMLImageElement
 * uploads can synchronously decode/convert the entire image during a pan.
 * Keep every source pixel; ImageBitmap does this preparation asynchronously. */
export async function loadSceneTexture(url: string): Promise<THREE.Texture> {
  if (typeof createImageBitmap === 'undefined')
    return new THREE.TextureLoader().loadAsync(url);
  // Start the shared decoder while the unchanged image request is in flight.
  const decoder =
    typeof Worker === 'undefined'
      ? Promise.resolve(decodeBitmapOnMain)
      : import('./image-bitmap-worker-client').then(
          ({ decodeBitmap }) => decodeBitmap,
          () => decodeBitmapOnMain,
        );
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Texture request failed: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await (await decoder)(blob);
  const texture = new THREE.Texture(bitmap);
  // ImageBitmap ignores WebGL's unpack flip flag; orientation is decoded above.
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.addEventListener('dispose', () => bitmap.close());
  return texture;
}

/** Allocate the complete mip chain, but transfer large images in small strips.
 * A single 4K upload can block Metal/ANGLE for hundreds of milliseconds even
 * after decoding. Keep the old map visible until every source pixel is ready. */
export async function uploadSceneTexture(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
  current: () => boolean = () => true,
  options: { staged?: boolean } = {},
): Promise<boolean> {
  if (!current()) return false;
  const bitmap = texture.image;
  if (
    typeof ImageBitmap === 'undefined' ||
    !(bitmap instanceof ImageBitmap) ||
    (!options.staged && bitmap.width * bitmap.height < 2_000_000)
  ) {
    renderer.initTexture(texture);
    return true;
  }
  const mipmaps = texture.generateMipmaps;
  texture.source.dataReady = false;
  renderer.initTexture(texture);
  texture.generateMipmaps = false;
  const offset = new THREE.Vector2();
  // At most 128K pixels per transfer, independent of the source dimensions.
  const rows = Math.max(1, Math.floor(131_072 / bitmap.width));
  try {
    for (let y = 0; y < bitmap.height; y += rows) {
      if (!current()) return false;
      const strip = await createImageBitmap(
        bitmap,
        0,
        y,
        bitmap.width,
        Math.min(rows, bitmap.height - y),
        {
          imageOrientation: 'none',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        },
      );
      const source = new THREE.Texture(strip);
      source.flipY = false;
      try {
        if (!current()) return false;
        // Prepare one strip before reserving its frame; decoding must not
        // move the actual transfer into an unrelated later browser task.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        if (!current()) return false;
        texture.generateMipmaps = mipmaps && y + rows >= bitmap.height;
        renderer.copyTextureToTexture(source, texture, null, offset.set(0, y));
      } finally {
        source.dispose();
        strip.close();
      }
    }
    return true;
  } finally {
    // Retain the original bitmap for context restoration and normal disposal.
    texture.source.dataReady = true;
    texture.generateMipmaps = mipmaps;
  }
}
