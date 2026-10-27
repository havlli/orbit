import * as THREE from 'three';
import { loadSceneTexture, uploadSceneTexture } from './scene-texture';
import type { BodyId, Destination } from './solar-data';

type DetailId = BodyId | 'earth-clouds';
type DetailSurface = Pick<THREE.ShaderMaterial, 'uniforms'>;

const detailMaps: Partial<Record<DetailId, string>> = {
  earth: '/textures/solar/earth-day-4k.jpg',
  'earth-clouds': '/textures/solar/earth-clouds-4k.jpg',
  moon: '/textures/solar/moon-4k.jpg',
  mars: '/textures/solar/mars-4k.jpg',
  jupiter: '/textures/solar/jupiter-4k.jpg',
  saturn: '/textures/solar/saturn-4k.jpg',
};

/** Keep the established cloud lighting while blending only its opacity detail. */
export function cloudDetailSurface(material: THREE.MeshPhongMaterial) {
  const uniforms = {
    map: { value: material.alphaMap },
    detailMap: { value: material.alphaMap },
    detailMix: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cloudDetailMap = uniforms.detailMap;
    shader.uniforms.cloudDetailMix = uniforms.detailMix;
    shader.fragmentShader = `
      uniform sampler2D cloudDetailMap;
      uniform float cloudDetailMix;
      ${shader.fragmentShader}
    `.replace(
      '#include <alphamap_fragment>',
      `#ifdef USE_ALPHAMAP
        float cloudOpacity;
        if (cloudDetailMix >= 1.)
          cloudOpacity = texture2D(cloudDetailMap, vAlphaMapUv).g;
        else {
          cloudOpacity = texture2D(alphaMap, vAlphaMapUv).g;
          if (cloudDetailMix > 0.)
            cloudOpacity = mix(cloudOpacity,
              texture2D(cloudDetailMap, vAlphaMapUv).g, cloudDetailMix);
        }
        diffuseColor.a *= cloudOpacity;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'orbit-cloud-detail-resolved';
  return { uniforms };
}

/** Keep detail on every resolved world until it leaves the shot. Three normal
 * resident slots accommodate Earth's two layers plus the next destination.
 * Visible layers take precedence over that soft limit and over prefetching. */
export class PlanetDetail {
  private readonly materials = new Map<DetailId, DetailSurface>();
  private readonly bodies = new Map<
    DetailId,
    { object: THREE.Object3D; radius: number }
  >();
  private readonly resident = new Map<DetailId, THREE.Texture>();
  private readonly failed = new Set<DetailId>();
  private readonly projected = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private wanted: DetailId[] = [];
  private capacity = 3;
  private loading = false;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly loadTexture = loadSceneTexture,
  ) {}

  register(
    body: DetailId,
    material: DetailSurface,
    object?: THREE.Object3D,
    radius = 1,
  ) {
    this.materials.set(body, material);
    if (object && detailMaps[body]) this.bodies.set(body, { object, radius });
  }

  update(
    focus: Destination,
    delta: number,
    reduced: boolean,
    upcoming: Destination = focus,
    view?: { camera: THREE.PerspectiveCamera; height: number },
  ) {
    const visible: Array<{ id: DetailId; pixels: number }> = [];
    if (view) {
      const { camera, height } = view;
      for (const [id, { object, radius }] of this.bodies) {
        if (!object.visible) continue;
        object.getWorldPosition(this.projected);
        object.getWorldScale(this.scale);
        this.projected.applyMatrix4(camera.matrixWorldInverse);
        const size =
          radius * Math.max(this.scale.x, this.scale.y, this.scale.z);
        const depth = -this.projected.z;
        if (depth + size <= 0) continue;
        const yRadius =
          (size * camera.projectionMatrix.elements[5]) / Math.max(size, depth);
        const pixels = (yRadius * height) / 2;
        this.projected.applyMatrix4(camera.projectionMatrix);
        if (
          pixels >= 24 &&
          Math.abs(this.projected.x) < 1 + yRadius / camera.aspect &&
          Math.abs(this.projected.y) < 1 + yRadius
        )
          visible.push({ id, pixels });
      }
      visible.sort((a, b) => b.pixels - a.pixels);
    }
    this.capacity = Math.max(3, visible.length);
    // The outgoing planet can still fill the frame after the request has
    // switched. Its projected footprint, not its chapter ID, protects detail.
    const candidates: Array<Destination | 'earth-clouds'> = [
      ...visible.map(({ id }) => id),
      focus,
      upcoming,
    ].flatMap((id) =>
      id === 'earth' ? (['earth', 'earth-clouds'] as const) : [id],
    );
    this.wanted = [...new Set(candidates)]
      .filter(
        (id): id is DetailId =>
          id !== 'overview' && !!detailMaps[id] && this.materials.has(id),
      )
      .slice(0, this.capacity);
    while (this.resident.size > this.capacity) {
      const unused = [...this.resident.keys()].find(
        (id) => !this.wanted.includes(id),
      );
      if (!unused) break;
      this.release(unused);
    }
    for (const [id] of this.resident) {
      const uniform = this.materials.get(id)!.uniforms.detailMix;
      uniform.value = reduced ? 1 : Math.min(1, uniform.value + delta / 1.4);
    }
    const active = this.wanted[0];
    const cached = active && this.resident.get(active);
    if (cached) {
      // Touch the most recently viewed map without changing its GPU resource.
      if ([...this.resident.keys()].at(-1) !== active) {
        this.resident.delete(active);
        this.resident.set(active, cached);
      }
    }
    const next = this.wanted.find(
      (id) => !this.resident.has(id) && !this.failed.has(id),
    );
    if (next && !this.loading) void this.load(next);
  }

  private async load(id: DetailId) {
    this.loading = true;
    try {
      const texture = await this.loadTexture(detailMaps[id]!);
      if (this.disposed || !this.wanted.includes(id)) {
        texture.dispose();
        return;
      }
      texture.colorSpace =
        id === 'earth-clouds' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      if (
        !(await uploadSceneTexture(
          this.renderer,
          texture,
          () => !this.disposed && this.wanted.includes(id),
        ))
      ) {
        texture.dispose();
        return;
      }
      while (this.resident.size >= this.capacity) {
        const oldest = [...this.resident.keys()].find(
          (key) => !this.wanted.includes(key),
        );
        if (!oldest) {
          texture.dispose();
          return;
        }
        this.release(oldest);
      }
      this.resident.set(id, texture);
      this.materials.get(id)!.uniforms.detailMap.value = texture;
    } catch {
      this.failed.add(id);
      console.warn(
        'A detail map could not be loaded; retaining the base texture.',
        id,
      );
    } finally {
      this.loading = false;
    }
  }

  private release(id: DetailId) {
    const material = this.materials.get(id)!;
    material.uniforms.detailMix.value = 0;
    material.uniforms.detailMap.value = material.uniforms.map.value;
    this.resident.get(id)!.dispose();
    this.resident.delete(id);
  }

  dispose() {
    this.disposed = true;
    this.resident.forEach((texture) => texture.dispose());
    this.resident.clear();
  }
}
