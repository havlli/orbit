import * as THREE from 'three';
import { loadSceneTexture, uploadSceneTexture } from './scene-texture';
import { createCatalogGeometry, type CatalogStar } from './celestial-stars';
import {
  createSkyTiles,
  visibleSkyTiles,
  SkyTileCache,
  SKY_COLUMNS,
  SKY_GUTTER,
  SKY_TILE_SIZE,
  SKY_EXTENT,
  SKY_OBLIQUITY,
  SKY_ROWS,
  SKY_ROW_COLUMNS,
} from './sky-tiles';

// Meter contrast from the same continuous image at both resolution levels.
// Grading each detail tile independently would change its average exposure as
// fine stars arrive and reveal the tile boundaries. Color ratios stay intact.
// A gentle shoulder keeps dense stellar texture behind the sharp catalog
// points, while the middle of the curve preserves the broader cloud structure.
const skyGrade = `
  vec3 gradeSky(vec3 detail, vec3 context) {
    float luminance = dot(context, vec3(.2126, .7152, .0722));
    float separation = pow(max(luminance, .0001), .30);
    float shoulder = 1. / (1. + luminance * .70);
    return detail * separation * shoulder * .64;
  }`;

/** Fixed J2000 directions: only camera rotation changes the background.
 * Bright stars are screen-sized points; the separate Milky Way has no baked
 * bright-star disks. Exposure and stellar brightness compression are editorial. */
export function createCelestialSky(renderer: THREE.WebGLRenderer) {
  const mesh = new THREE.Group();
  // Match the detail grid so its UV interpolation stays still during the blend.
  const geometry = new THREE.SphereGeometry(1, 256, 128);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null as THREE.Texture | null },
      presence: { value: 0 },
      exposure: { value: 1 },
    },
    vertexShader: `
      varying vec2 skyUv;
      void main() {
        skyUv = uv;
        vec3 direction = mat3(modelMatrix) * position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * direction, 1.);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float presence, exposure;
      varying vec2 skyUv;
      ${skyGrade}
      void main() {
        vec3 source = texture2D(map, skyUv).rgb;
        gl_FragColor = vec4(gradeSky(source, source) * presence * exposure, 1.);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const backdrop = new THREE.Mesh(geometry, material);
  // Sphere UVs put RA=0 at u=.5, increasing left. Convert NASA's equatorial
  // panorama using the same J2000 obliquity as the bright-star directions.
  backdrop.scale.z = -1;
  backdrop.rotation.x = -SKY_OBLIQUITY;
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1000;
  mesh.add(backdrop);

  const tiles = createSkyTiles();
  const detailMeshes = new Map(
    tiles.map((tile) => {
      const detail = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null as THREE.Texture | null },
          contextMap: material.uniforms.map,
          contextOffset: {
            value: new THREE.Vector2(
              tile.column / SKY_ROW_COLUMNS[tile.row],
              1 - (tile.row + 1) / SKY_ROWS,
            ),
          },
          contextScale: {
            value: new THREE.Vector2(
              1 / SKY_ROW_COLUMNS[tile.row],
              1 / SKY_ROWS,
            ),
          },
          presence: material.uniforms.presence,
          exposure: material.uniforms.exposure,
          detailPresence: { value: 0 },
        },
        vertexShader: material.vertexShader,
        fragmentShader: `
        uniform sampler2D map, contextMap;
        uniform vec2 contextOffset, contextScale;
        uniform float presence, exposure;
        uniform float detailPresence;
        varying vec2 skyUv;
        ${skyGrade}
        void main() {
          vec2 uv = (skyUv * ${SKY_TILE_SIZE.toFixed(1)} + ${SKY_GUTTER.toFixed(1)}) / ${SKY_EXTENT.toFixed(1)};
          vec3 context = texture2D(contextMap, contextOffset + skyUv * contextScale).rgb;
          gl_FragColor = vec4(gradeSky(texture2D(map, uv).rgb, context) * presence * exposure,
            smoothstep(0., 1., detailPresence));
        }`,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        // Transparent detail draws after opaque worlds. Keep it behind them.
        depthTest: true,
      });
      const patch = new THREE.Mesh(tile.geometry, detail);
      patch.scale.z = -1;
      patch.rotation.x = -SKY_OBLIQUITY;
      patch.frustumCulled = false;
      patch.renderOrder = -999;
      patch.visible = false;
      mesh.add(patch);
      return [tile.id, patch] as const;
    }),
  );
  const detailCache = new SkyTileCache(
    (id) =>
      loadSceneTexture(
        `/sky/milkyway/${Math.floor(id / SKY_COLUMNS)}-${id % SKY_COLUMNS}.jpg`,
      ),
    (id, texture) => {
      const patch = detailMeshes.get(id)!;
      patch.material.uniforms.map.value = texture;
      patch.material.uniforms.detailPresence.value = 0;
    },
    (id) => {
      const patch = detailMeshes.get(id)!;
      patch.visible = false;
      patch.material.uniforms.map.value = null;
      patch.material.uniforms.detailPresence.value = 0;
    },
    (texture, current) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );
      return uploadSceneTexture(renderer, texture, current, { staged: true });
    },
  );
  let visibleIds = new Set<number>();
  let selectionAge = Infinity;

  const starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      presence: { value: 0 },
      exposure: material.uniforms.exposure,
      pixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float starSize;
      attribute vec3 color;
      uniform float pixelRatio;
      varying vec3 starColor;
      void main() {
        starColor = color;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
        gl_Position = clip.xyww;
        gl_PointSize = starSize * pixelRatio;
      }`,
    fragmentShader: `
      uniform float presence, exposure;
      varying vec3 starColor;
      void main() {
        float radius = length(gl_PointCoord - .5);
        float edge = max(fwidth(radius), .08);
        float coverage = 1. - smoothstep(.33 - edge, .33 + edge, radius);
        float bright = clamp(max(starColor.r, max(starColor.g, starColor.b)) * .2, 0., 1.);
        float response = mix(exposure * exposure, sqrt(exposure), bright);
        gl_FragColor = vec4(starColor * response, coverage * presence);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Stars lie on the far plane and must be occluded by planets and probes.
    depthTest: true,
  });
  let stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null =
    null;
  // A tiny optical shoulder belongs only to the brightest catalog stars.
  // It supplies a distinct luminous layer without filtering planets or sky.
  const haloMaterial = starMaterial.clone();
  haloMaterial.uniforms = starMaterial.uniforms;
  haloMaterial.vertexShader = starMaterial.vertexShader.replace(
    'starSize * pixelRatio',
    'starSize * pixelRatio * 3.',
  );
  haloMaterial.fragmentShader = `
    uniform float presence, exposure;
    varying vec3 starColor;
    void main() {
      float radius = length(gl_PointCoord - .5);
      float shoulder = max(0., exp(-radius * radius * 32.) - exp(-8.));
      gl_FragColor = vec4(starColor * exposure, shoulder * .014 * presence);
    }`;
  let starHalos: THREE.Points<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  > | null = null;
  let disposed = false;
  const pending = new AbortController();
  void loadSceneTexture('/sky/milkyway/base.jpg')
    .then(async (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      if (!(await uploadSceneTexture(renderer, texture, () => !disposed))) {
        texture.dispose();
        return;
      }
      material.uniforms.map.value = texture;
    })
    .catch(() => console.warn('The Milky Way background could not be loaded.'));
  void fetch('/sky/bright-stars.json', { signal: pending.signal })
    .then((response) => {
      if (!response.ok) throw new Error('Star catalog unavailable');
      return response.json() as Promise<{ stars: CatalogStar[] }>;
    })
    .then((catalog) => {
      if (disposed) return;
      stars = new THREE.Points(
        createCatalogGeometry(catalog.stars),
        starMaterial,
      );
      stars.frustumCulled = false;
      stars.renderOrder = -997;
      starHalos = new THREE.Points(
        createCatalogGeometry(catalog.stars.filter((star) => star[3] < 2)),
        haloMaterial,
      );
      starHalos.frustumCulled = false;
      starHalos.renderOrder = -998;
      mesh.add(starHalos, stars);
    })
    .catch(() => {
      if (!disposed)
        console.warn('The bright-star catalog could not be loaded.');
    });
  return {
    mesh,
    update(
      delta: number,
      reduced: boolean,
      camera: THREE.PerspectiveCamera,
      width: number,
      exposure = 1,
    ) {
      material.uniforms.exposure.value = exposure;
      if (material.uniforms.map.value)
        material.uniforms.presence.value = reduced
          ? 1
          : Math.min(1, material.uniforms.presence.value + delta / 2.5);
      if (stars)
        starMaterial.uniforms.presence.value = reduced
          ? 1
          : Math.min(1, starMaterial.uniforms.presence.value + delta / 1.5);
      starMaterial.uniforms.pixelRatio.value = renderer.getPixelRatio();
      selectionAge += delta;
      if (selectionAge >= 0.12) {
        const visible = visibleSkyTiles(tiles, camera);
        visibleIds = new Set(visible.map((tile) => tile.id));
        detailCache.request(
          visible.map((tile) => tile.id),
          width <= 760 ? 16 : 24,
        );
        selectionAge = 0;
      }
      detailCache.update();
      for (const [id] of detailCache.resident) {
        const patch = detailMeshes.get(id)!;
        patch.visible = visibleIds.has(id);
        patch.material.uniforms.detailPresence.value = reduced
          ? 1
          : Math.min(
              1,
              patch.material.uniforms.detailPresence.value + delta / 1.25,
            );
      }
    },
    dispose() {
      disposed = true;
      pending.abort();
      detailCache.dispose();
      for (const patch of detailMeshes.values()) {
        patch.geometry.dispose();
        patch.material.dispose();
      }
      material.uniforms.map.value?.dispose();
      stars?.geometry.dispose();
      starHalos?.geometry.dispose();
      haloMaterial.dispose();
      starMaterial.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
