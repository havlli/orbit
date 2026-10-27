import * as THREE from 'three';

export function createCometMaterial(): THREE.PointsMaterial {
  const material = new THREE.PointsMaterial({
    size: 0.13,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float cometParticleRadius = length(gl_PointCoord - .5) * 2.;
      diffuseColor.a *= 1. - smoothstep(.15, 1., cometParticleRadius);
      #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'orbit-comet-soft-points-v1';
  return material;
}
