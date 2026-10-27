import * as THREE from 'three';

export type CatalogStar = [number, number, number, number, number | null];

/** J2000 equatorial degrees to ORBIT's (ecliptic x, z, -y) direction. */
export function catalogDirection(raDegrees: number, decDegrees: number) {
  const ra = THREE.MathUtils.degToRad(raDegrees);
  const dec = THREE.MathUtils.degToRad(decDegrees);
  const obliquity = THREE.MathUtils.degToRad(84381.448 / 3600);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  return new THREE.Vector3(
    Math.cos(dec) * Math.cos(ra),
    -y * Math.sin(obliquity) + z * Math.cos(obliquity),
    -y * Math.cos(obliquity) - z * Math.sin(obliquity),
  );
}

export function createCatalogGeometry(stars: CatalogStar[]) {
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  const cold = new THREE.Color('#c0d8ff');
  const warm = new THREE.Color('#ffd0a0');
  const neutral = new THREE.Color('#fff7ed');
  stars.forEach(([, ra, dec, magnitude, bv], index) => {
    catalogDirection(ra, dec).toArray(positions, index * 3);
    // B−V supplies a restrained display tint, not calibrated spectral color.
    const color = neutral.clone();
    if (bv !== null) {
      if (bv < 0.5)
        color.lerp(cold, THREE.MathUtils.clamp((0.5 - bv) / 0.8, 0, 1));
      else color.lerp(warm, THREE.MathUtils.clamp((bv - 0.5) / 1.5, 0, 1));
    }
    // Retain a stronger hierarchy between a few bright stars and the much
    // fainter field. The previous floor flattened these into similar dots.
    // This is a display exposure curve, not calibrated stellar photometry.
    color.multiplyScalar(
      THREE.MathUtils.clamp(Math.pow(10, -0.28 * (magnitude - 2.5)), 0.02, 12),
    );
    color.toArray(colors, index * 3);
    sizes[index] = THREE.MathUtils.clamp(2.35 - magnitude * 0.15, 1.1, 2.8);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
  return geometry;
}
