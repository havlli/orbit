import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Give small, low-density previews enough samples for stars and thin rings.
 * Extra sampling has a two-megapixel budget; native HiDPI keeps its existing
 * 2× cap. A large desktop canvas never inherits phone-sized supersampling. */
export function scenePixelRatio(width: number, height: number, native: number) {
  const previewRatio = Math.sqrt(2_000_000 / Math.max(1, width * height));
  return Math.min(2, Math.max(1, native, previewRatio));
}

/** Resolve the multisampled scene once, then tone-map directly to the screen.
 * Glows belong to the Sun and atmospheres; filtering the entire image also
 * spreads bright cloud bands, stars and spacecraft highlights into a haze. */
export function createSceneRendering(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
) {
  // Native resolution and edge coverage solve different problems. Keep four
  // MSAA samples at HiDPI too, especially for ring silhouettes and fine lines.
  const sampleCount = () => Math.min(4, renderer.capabilities.maxSamples);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: sampleCount(),
    resolveDepthBuffer: false,
    stencilBuffer: false,
  });
  const output = new OutputPass();
  output.renderToScreen = true;
  const drawingSize = new THREE.Vector2();
  return {
    setSize() {
      const samples = sampleCount();
      if (samples !== target.samples) {
        target.samples = samples;
        target.dispose();
      }
      // Three floors the canvas dimensions. Rounding them independently made
      // a 715px scene resolve into a 714px canvas at 1.3× browser scaling,
      // filtering every pixel a second time. Always use the actual buffer.
      renderer.getDrawingBufferSize(drawingSize);
      target.setSize(drawingSize.x, drawingSize.y);
    },
    compile: (object: THREE.Object3D, lighting = scene) => {
      const previous = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace();
      const level = renderer.getActiveMipmapLevel();
      try {
        // Scene shaders write linear HDR; only the output pass maps to screen.
        renderer.setRenderTarget(target);
        return renderer.compileAsync(object, camera, lighting);
      } finally {
        // Compilation collects its parameters synchronously, then waits for
        // programs without holding the live renderer on a preparation target.
        renderer.setRenderTarget(previous, face, level);
      }
    },
    render() {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      output.render(renderer, target, target, 0, false);
    },
    dispose() {
      output.dispose();
      target.dispose();
    },
  };
}
