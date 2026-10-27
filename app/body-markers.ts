import * as THREE from 'three';
import { bodies, type BodyId } from './solar-data';

/** Discreet screen-space markers reveal covered moons at sub-pixel physical size.
 * Their centers follow the same historical body groups; absent tracks stay hidden. */
export function createBodyMarkers(pixelRatio: number) {
  const worlds = bodies.filter((body) => body.parent || body.region);
  const positions = new Float32Array(worlds.length * 3);
  const presence = new Float32Array(worlds.length);
  const view = new THREE.Vector3();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('presence', new THREE.BufferAttribute(presence, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { pointSize: { value: 3.4 * pixelRatio } },
    vertexShader: `attribute float presence;
      varying float alpha;
      uniform float pointSize;
      void main() {
        alpha = presence;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        gl_PointSize = pointSize;
      }`,
    fragmentShader: `varying float alpha;
      void main() {
        float radius = length(gl_PointCoord - .5) * 2.;
        float edge = max(fwidth(radius), .12);
        float coverage = 1. - smoothstep(.66 - edge, .66 + edge, radius);
        gl_FragColor = vec4(.75, .81, .8, coverage * .65 * alpha);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return {
    points,
    update(
      groups: Map<BodyId, THREE.Group>,
      camera: THREE.PerspectiveCamera,
      height: number,
      visible: boolean,
      renderPixelRatio = pixelRatio,
    ) {
      points.visible = visible;
      if (!visible) return;
      material.uniforms.pointSize.value = 3.4 * renderPixelRatio;
      worlds.forEach((body, index) => {
        const group = groups.get(body.id);
        if (!group?.visible) {
          presence[index] = 0;
          return;
        }
        group.position.toArray(positions, index * 3);
        view.copy(group.position).applyMatrix4(camera.matrixWorldInverse);
        if (view.z >= -camera.near) {
          presence[index] = 0;
          return;
        }
        // Projected radius depends on view depth, not radial range. Off-axis
        // moons must resolve at the same size as those near the image center.
        const pixels =
          ((body.radius * group.scale.x) /
            -view.z /
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
          height *
          0.5;
        presence[index] = 1 - THREE.MathUtils.smoothstep(pixels, 1.5, 3);
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.presence.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
