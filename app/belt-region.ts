import * as THREE from 'three';
import { KM_PER_UNIT } from './ephemeris';

/** Persistent geographic context, not invented historical asteroid states.
 * Approximate main-belt extent: NASA Dawn FAQ, 2.2–3.2 AU.
 * The undated atlas uses its own illustrated scale; the band moves with the
 * same layout blend as the bodies so neither mode loses the belt's structure. */
export function createBeltRegion() {
  const au = 149_597_870.7 / KM_PER_UNIT;
  const geometry = new THREE.RingGeometry(2.2 * au, 3.2 * au, 256, 8);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      innerRadius: { value: 47 },
      outerRadius: { value: 56 },
      opacity: { value: 0.012 },
      pixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float innerRadius;
      uniform float outerRadius;
      varying float beltDepth;
      varying vec2 beltMap;
      void main() {
        float radius = length(position.xy);
        beltMap = position.xy / ${au.toFixed(10)};
        beltDepth = clamp((radius / ${au.toFixed(10)} - 2.2), 0., 1.);
        vec3 point = vec3(position.xy / radius * mix(innerRadius, outerRadius, beltDepth), position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.);
      }`,
    fragmentShader: `
      varying float beltDepth;
      varying vec2 beltMap;
      uniform float opacity;
      uniform float pixelRatio;
      vec3 mapRandom(vec2 cell) {
        vec3 point = fract(vec3(cell.xyx) * vec3(.1031, .1030, .0973));
        point += dot(point, point.yxz + 33.33);
        return fract((point.xxy + point.yzz) * point.zyx);
      }
      void main() {
        float edge = smoothstep(0., .18, beltDepth) * (1. - smoothstep(.82, 1., beltDepth));
        // A fixed map pattern denotes the region, never dated asteroid states.
        // Carry its coordinates through the layout blend and floating origin.
        vec2 grid = beltMap * 14.;
        vec3 random = mapRandom(floor(grid));
        vec2 center = .36 + random.xy * .28;
        float radius = .085 + random.z * .055;
        float distance = length(fract(grid) - center);
        vec2 gridDx = dFdx(grid);
        vec2 gridDy = dFdy(grid);
        float dxSquared = dot(gridDx, gridDx);
        float dySquared = dot(gridDy, gridDy);
        float footprint = sqrt(max(dxSquared, dySquared));
        float determinant = abs(gridDx.x * gridDy.y - gridDx.y * gridDy.x);
        float gradientTrace = dxSquared + dySquared;
        float majorFootprint = sqrt(max(.5 * (gradientTrace + sqrt(max(
          gradientTrace * gradientTrace - 4. * determinant * determinant, 0.
        ))), 0.));
        float minorFootprint = determinant / max(majorFootprint, .000001);
        // Keep every mark's feather inside its cell. Crossing a hash-cell
        // boundary then has zero coverage on both sides, even while moving.
        float antialias = clamp(footprint * .55, .002, .20);
        float coverage = 1. - smoothstep(radius - antialias, radius + antialias, distance);
        // Retire unresolved marks instead of letting them sparkle or collect
        // into another solid surface at oblique angles and wide distances.
        float resolved = 1. - smoothstep(.45, 1.05, footprint);
        // A map circle can remain resolved while projecting to a long oval.
        // Retire only those glyphs: radius 3–7 CSS pixels, aspect ratio 3–8.
        // The faint continuous region and its geographic guides remain.
        float screenRadius = radius / max(minorFootprint * pixelRatio, .000001);
        float aspect = majorFootprint / max(minorFootprint, .000001);
        float compact = 1. - smoothstep(3., 7., screenRadius);
        float rounded = 1. - smoothstep(3., 8., aspect);
        float stipple = coverage * resolved * compact * rounded * step(.58, random.z);
        float annotation = .045 + stipple * 7.;
        gl_FragColor = vec4(.46, .40, .30, edge * opacity * annotation);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  const band = new THREE.Mesh(geometry, material);
  band.onBeforeRender = (renderer) => {
    material.uniforms.pixelRatio.value = renderer.getPixelRatio();
  };
  band.rotation.x = -Math.PI / 2;
  group.add(band);
  const guides: THREE.LineLoop[] = [];
  for (const radius of [2.2, 3.2]) {
    const points = Array.from({ length: 512 }, (_, i) => {
      const theta = (i / 512) * Math.PI * 2;
      return new THREE.Vector3(
        Math.cos(theta) * radius * au,
        0,
        Math.sin(theta) * radius * au,
      );
    });
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: '#b5a080',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    group.add(line);
    guides.push(line);
  }
  // Vertex deformation covers both layouts; do not cull by the atlas bounds.
  band.frustumCulled = false;
  return {
    group,
    update(sun: THREE.Vector3, atlasBlend: number, guidePresence: number) {
      group.position.copy(sun);
      const inner = THREE.MathUtils.lerp(2.2 * au, 47, atlasBlend);
      const outer = THREE.MathUtils.lerp(3.2 * au, 56, atlasBlend);
      material.uniforms.innerRadius.value = inner;
      material.uniforms.outerRadius.value = outer;
      material.uniforms.opacity.value = THREE.MathUtils.lerp(
        0.028,
        0.012,
        atlasBlend,
      );
      guides.forEach((line, index) => {
        line.scale.setScalar(
          index === 0 ? inner / (2.2 * au) : outer / (3.2 * au),
        );
        (line.material as THREE.LineBasicMaterial).opacity =
          0.035 * guidePresence;
        line.visible = guidePresence > 0.001;
      });
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      guides.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
    },
  };
}
