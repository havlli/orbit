import * as THREE from 'three';
import type { Body } from './solar-data';

type SphereBody = Pick<Body, 'id' | 'radius' | 'shape'>;
type SphereLayer = 'surface' | 'atmosphere' | 'clouds';

/** One full-resolution sphere serves every compatible layer. Dimensions stay
 * on each mesh so the shared positions, normals and UVs remain immutable. */
export class SharedBodySpheres {
  readonly geometry = new THREE.SphereGeometry(1, 192, 128);

  create<T extends THREE.Material>(
    body: SphereBody,
    material: T,
    layer: SphereLayer = 'surface',
  ) {
    const mesh = new THREE.Mesh(this.geometry, material);
    const shell =
      layer === 'clouds'
        ? 1.012
        : layer === 'atmosphere'
          ? body.id === 'mars'
            ? 1.009
            : 1.022
          : 1;
    const shape = layer === 'surface' ? body.shape : undefined;
    mesh.scale.set(
      body.radius * shell * (shape?.[0] ?? 1),
      body.radius *
        shell *
        (shape?.[1] ?? 1) *
        (body.id === 'saturn' || body.id === 'jupiter' ? 0.92 : 1),
      body.radius * shell * (shape?.[2] ?? 1),
    );
    return mesh;
  }

  dispose() {
    this.geometry.dispose();
  }
}
