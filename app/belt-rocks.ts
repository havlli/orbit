import * as THREE from 'three';

export interface BeltRockAppearance {
  proportions: [number, number, number];
  tint: THREE.Color;
}

/** One shared illustrative fragment, not a measured asteroid shape. Broad
 * shoulders and shallow recesses break symmetry without invented surface maps. */
export function createBeltRockGeometry() {
  const base = new THREE.IcosahedronGeometry(1, 1);
  const source = base.getAttribute('position');
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertices = new Map<string, number>();
  let outerRadius = 0;

  for (let i = 0; i < source.count; i++) {
    const direction = new THREE.Vector3()
      .fromBufferAttribute(source, i)
      .normalize();
    const { x, y, z } = direction;
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    let index = vertices.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      vertices.set(key, index);
      const shoulder = Math.max(0, x * 0.36 + y * 0.84 - z * 0.4);
      const flank = Math.max(0, -x * 0.79 + y * 0.18 + z * 0.58);
      const relief =
        0.96 +
        0.13 * x * y -
        0.09 * y * z +
        0.08 * z * x +
        0.045 * x -
        0.035 * z -
        0.14 * shoulder * shoulder -
        0.065 * flank * flank * flank;
      positions.push(x * relief, y * relief, z * relief);
      outerRadius = Math.max(outerRadius, relief);
      const shade =
        0.93 +
        0.04 * (x * 0.5 - y * 0.3 + z * 0.2) -
        0.055 * shoulder * shoulder;
      colors.push(shade, shade * 0.985, shade * 0.965);
    }
    indices.push(index);
  }
  base.dispose();

  // Stay inside the instance's original scalar envelope, including rounding.
  const scale = (1 - 1e-6) / outerRadius;
  for (let i = 0; i < positions.length; i++) positions[i] *= scale;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function sample(index: number, seed: number, channel: number) {
  let value = (index >>> 0) ^ Math.imul(seed | 0, 0x9e3779b9) ^ channel;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}

/** Stable per-instance variation consumes none of the scene's layout sequence.
 * Every axis remains at or below the caller's existing scalar size. */
export function beltRockAppearance(
  index: number,
  fieldSeed = 0,
): BeltRockAppearance {
  const proportions: [number, number, number] = [
    0.58 + sample(index, fieldSeed, 0x68bc21eb) * 0.42,
    0.58 + sample(index, fieldSeed, 0x02e5be93) * 0.42,
    0.58 + sample(index, fieldSeed, 0x967a889b) * 0.42,
  ];
  const longest = Math.max(...proportions);
  for (let axis = 0; axis < 3; axis++) proportions[axis] /= longest;
  const shade = 0.82 + sample(index, fieldSeed, 0xb5297a4d) * 0.18;
  const warmth = sample(index, fieldSeed, 0x1b56c4e9);
  const tint = new THREE.Color().setRGB(
    shade,
    shade * (0.97 + warmth * 0.02),
    shade * (0.93 + warmth * 0.04),
  );
  return { proportions, tint };
}
