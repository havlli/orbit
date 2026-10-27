// Published centre radii and representative widths in kilometres. Visibility
// and opacity are schematic; provenance and omitted rings are in SOLAR-ASSETS.
const uranusEquatorialRadiusKm = 25_559;
const uranusRingBands = [
  ['5', 42_234, 2, 0.12],
  ['4', 42_571, 2, 0.1],
  ['Alpha', 44_718, 7, 0.24],
  ['Beta', 45_661, 8, 0.2],
  ['Eta', 47_176, 1.6, 0.12],
  ['Gamma', 47_627, 2.5, 0.18],
  ['Delta', 48_300, 5, 0.2],
  ['Lambda', 50_024, 2, 0.08],
  ['Epsilon', 51_149, 58, 0.42],
] as const;
const uranusProfile = uranusRingBands
  .map(
    ([name, radiusKm, widthKm, opacity]) => `
    // ${name}
    profile = max(profile, ${opacity.toFixed(3)} * uranusBand(
      radiusRatio, ${(radiusKm / uranusEquatorialRadiusKm).toFixed(9)},
      ${(widthKm / uranusEquatorialRadiusKm).toFixed(9)}, pixel));`,
  )
  .join('\n');

/** The credited texture supplies Saturn's radial structure and transparency.
 * Uranus uses narrow schematic bands at published radial locations. Lighting
 * distinguishes reflected and transmitted sunlight; opacity is an editorial
 * response to the artwork or bands, not a calibrated optical-depth measurement. */
export const ringFragment = `
  uniform sampler2D map;
  uniform float mapped, planetRadius, flattening, innerRadius, outerRadius;
  uniform vec3 sun;
  varying vec3 vLocal, vWorld, vNormal;
  float uranusBand(float radiusRatio, float centre, float width, float pixel) {
    // Six times the representative full width, with a filtered pixel minimum.
    float halfWidth = max(width * 3., pixel * .55);
    float feather = max(pixel * .6, .00001);
    return 1. - smoothstep(halfWidth - feather, halfWidth + feather,
      abs(radiusRatio - centre));
  }
  float uranusBands(float radiusRatio, float pixel) {
    float profile = 0.;
    ${uranusProfile}
    return profile;
  }
  void main() {
    float radial = length(vLocal.xz);
    float u = (radial - innerRadius) / (outerRadius - innerRadius);
    vec4 source;
    if (mapped > .5) {
      source = texture2D(map, vec2(u, .5));
    } else {
      float radiusRatio = radial / planetRadius;
      float pixel = max(fwidth(radiusRatio), .00002);
      source = vec4(.14, .16, .17, uranusBands(radiusRatio, pixel));
    }
    if (source.a < .003) discard;

    vec3 view = normalize(cameraPosition - vWorld);
    float facing = dot(normalize(vNormal), view);
    float muView = max(abs(facing), .08);
    float muSun = max(abs(sun.y), .06);
    float depth = -log(max(1. - source.a, .001));
    float opacity = 1. - exp(-depth * .65 / muView);
    float reflected = .32 + .88 * sqrt(muSun);
    // Dense rings darken on the unlit face; thinner regions transmit light.
    float transmitted = .10 + .94 * exp(-depth / muSun);
    float illumination = facing * sun.y >= 0. ? reflected : transmitted;

    // Intersect the Sun ray with the same oblate shape as the planet mesh.
    vec3 shape = vec3(1., flattening, 1.);
    vec3 p = vLocal / planetRadius / shape;
    vec3 ray = sun / shape;
    float a = dot(ray, ray), b = dot(p, ray);
    float discriminant = b*b - a*(dot(p,p)-1.);
    float edge = max(fwidth(discriminant), .0001);
    float occluded = (1. - step(0., b)) * smoothstep(-edge, edge, discriminant);
    float shadow = mix(1., .055, occluded);
    gl_FragColor = vec4(source.rgb * illumination * shadow, opacity);
  }
`;
