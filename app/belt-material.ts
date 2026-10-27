import * as THREE from 'three';

/** Limit individual illustrated rocks when they occupy too much of the frame.
 * This never switches off a field because of a destination or a planet portrait.
 * Small glints retain the belt's continuity even as nearby meshes feather out. */
export function softenNearbyBeltRocks(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float beltRockCoverage;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec4 beltCenter = modelViewMatrix * instanceMatrix[3];
      float beltRadius = max(length(instanceMatrix[0].xyz), max(length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)));
      float projectedRadius = beltRadius * projectionMatrix[1][1] / max(-beltCenter.z, .0001);
      beltRockCoverage = 1. - smoothstep(.012, .045, projectedRadius);`,
    );
    shader.fragmentShader = `varying float beltRockCoverage;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `diffuseColor.a *= beltRockCoverage;\n#include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'orbit-belt-local-clearance-v2';
}
