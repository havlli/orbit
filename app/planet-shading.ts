import type { BodyId } from './solar-data';

// Surface appearance is an editorial material treatment of credited maps.
// No height, storm animation, or extra terrain is inferred from albedo.
export function surfaceProfile(id: BodyId) {
  if (id === 'jupiter')
    return { contrast: 1.2, limb: 0.32, wrap: 0.08, lightGain: 0.95 };
  if (id === 'saturn')
    return { contrast: 1.16, limb: 0.4, wrap: 0.1, lightGain: 0.94 };
  if (['venus', 'titan', 'uranus', 'neptune'].includes(id))
    return { contrast: 1.08, limb: 0.42, wrap: 0.14, lightGain: 1.2 };
  if (id === 'mars')
    return { contrast: 1.08, limb: 0.12, wrap: 0.02, lightGain: 1.26 };
  return { contrast: 1, limb: 0, wrap: 0, lightGain: 1.2 };
}

export const bodyVertex = `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    vWorld = (modelMatrix * vec4(position, 1.)).xyz;
    // normalMatrix handles ellipsoids and any nonuniform object scaling.
    vNormal = normalize(vec3(vec4(normalMatrix * normal, 0.) * viewMatrix));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }`;

export const bodyFragment = `
  uniform sampler2D map, detailMap, nightMap, ringMap;
  uniform float hasNight, hasMap, textureWest, isSun, time, detailMix;
  uniform float contrast, limb, wrap, lightGain, hasRings, bodyRadius;
  uniform vec3 tint, center, sunPosition, ringNormal;
  varying vec2 vUv;
  varying vec3 vWorld, vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 light = normalize(sunPosition - vWorld);
    vec3 view = normalize(cameraPosition - vWorld);
    float d = dot(n, light);
    vec2 uv = vec2(textureWest > .5 ? 1.-vUv.x : vUv.x, vUv.y);
    // Once detail has arrived, the preview map no longer contributes a pixel.
    // Keep the exact blend while loading, then fetch only the resolved map.
    vec3 tex;
    if (detailMix >= 1.) tex = texture2D(detailMap, uv).rgb;
    else {
      tex = hasMap > .5 ? texture2D(map, uv).rgb : tint;
      if (detailMix > 0.) tex = mix(tex, texture2D(detailMap, uv).rgb, detailMix);
    }
    // A modest grade separates existing cloud bands without manufacturing detail.
    tex = max(vec3(0.), (tex - .18) * contrast + .18);
    float diffuse = max(0., (d + wrap)/(1.+wrap)) * smoothstep(-wrap-.015, .08, d);
    float limbShade = mix(1., pow(max(.001, dot(n, view)), .4), limb);
    float shadow = 1.;
    if (hasRings > .5) {
      vec3 p = (vWorld-center)/bodyRadius;
      float angle = dot(light, ringNormal);
      if (abs(angle) > .001) {
        float travel = -dot(p, ringNormal)/angle;
        float radial = length(p + light*travel);
        if (travel > 0. && radial > 1.14 && radial < 2.31) {
          float density = texture2D(ringMap, vec2((radial-1.14)/1.17, .5)).a;
          shadow = 1. - density * .86;
        }
      }
    }
    vec3 c = tex * (.012 + lightGain * diffuse * limbShade * shadow);
    if (hasNight > .5)
      c += texture2D(nightMap, vUv).rgb * (1.-smoothstep(-.18,.16,d)) * 1.7;
    if (isSun > .5) {
      float wave = 1.+.035*sin(vUv.y*180.+time*.35);
      c = tex*vec3(2.6,1.65,.85)*wave;
    }
    gl_FragColor = vec4(c,1.);
  }`;

export const atmosphereFragment = `
  uniform vec3 glow, sunPosition;
  uniform float strength;
  varying vec3 vWorld, vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float facing = abs(dot(n, normalize(cameraPosition-vWorld)));
    float day = smoothstep(-.12,.45,dot(n,normalize(sunPosition-vWorld)));
    float rim = pow(1.-facing, 3.8);
    // Lit limb and a short twilight falloff; no luminous ring on the night side.
    gl_FragColor = vec4(glow, rim * day * strength);
  }`;
