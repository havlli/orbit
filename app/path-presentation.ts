import * as THREE from 'three';
import { isCompactLandscape } from './atlas-camera';

export interface ReadingArea {
  x: number;
  y: number;
  width: number;
  height: number;
  presence: number;
}

/** Screen-space line treatment only. Source geometry and depth testing remain
 * intact; the route gently clears the copy and the timeline while they are shown. */
export class PathPresentation {
  private readonly uniforms = {
    pathViewport: { value: new THREE.Vector3(1, 1, 1) },
    pathFrame: { value: new THREE.Vector2(0, 1) },
    pathCaption: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    pathReading: { value: new THREE.Vector2() },
    pathChrome: { value: 0 },
    pathPresence: { value: 1 },
  };

  attach(material: THREE.LineBasicMaterial) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = `
        uniform vec3 pathViewport;
        uniform vec2 pathFrame;
        uniform vec4 pathCaption[2];
        uniform vec2 pathReading;
        uniform float pathChrome;
        uniform float pathPresence;
        ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        vec2 pathPixel = vec2(gl_FragCoord.x / pathViewport.z,
          pathViewport.y - gl_FragCoord.y / pathViewport.z);
        float frameMask = smoothstep(pathFrame.x - 24., pathFrame.x + 12., pathPixel.y)
          * (1. - smoothstep(pathFrame.y - 20., pathFrame.y + 28., pathPixel.y));
        diffuseColor.a *= pathPresence * mix(1., frameMask, pathChrome);
        for (int i = 0; i < 2; i++) {
          vec2 outsideCopy = max(max(pathCaption[i].xy - pathPixel,
            pathPixel - pathCaption[i].xy - pathCaption[i].zw), vec2(0.));
          float copyMask = smoothstep(0., 32., length(outsideCopy));
          diffuseColor.a *= mix(1., copyMask, pathReading[i] * pathChrome);
        }
        #include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () => 'orbit-path-presentation-v3';
  }

  setPresence(presence: number) {
    this.uniforms.pathPresence.value = presence;
  }

  update(
    width: number,
    height: number,
    pixelRatio: number,
    chrome: boolean,
    reading?: ReadingArea,
    secondary?: ReadingArea,
  ) {
    const mobile = width <= 760;
    const bottom =
      height -
      (isCompactLandscape(width, height)
        ? 100
        : mobile
          ? height <= 760
            ? 216
            : 252
          : 212);
    this.uniforms.pathViewport.value.set(width, height, pixelRatio);
    this.uniforms.pathFrame.value.set(mobile ? 112 : 120, bottom);
    this.uniforms.pathChrome.value = chrome ? 1 : 0;
    this.uniforms.pathReading.value.set(
      reading?.presence ?? 0,
      secondary?.presence ?? 0,
    );
    for (let i = 0; i < 2; i++) {
      const area = i === 0 ? reading : secondary;
      if (area)
        this.uniforms.pathCaption.value[i].set(
          area.x - 8,
          area.y - 8,
          area.width + 16,
          area.height + 16,
        );
    }
  }
}
