import * as THREE from 'three';
import type { Body } from './solar-data';

type PortraitBody = Pick<Body, 'id' | 'radius' | 'tilt' | 'shape'>;

/** Show the tilted Uranian rings obliquely from their illuminated face. */
export function atlasRingViewDirection(
  body: Pick<Body, 'id' | 'tilt'>,
  towardSun: THREE.Vector3,
) {
  if (body.id !== 'uranus') return new THREE.Vector3(0.1, 0.9, 1).normalize();
  const pole = new THREE.Vector3(0, 1, 0).applyAxisAngle(
    new THREE.Vector3(0, 0, 1),
    body.tilt ?? 0.05,
  );
  const sunlight = towardSun.dot(pole);
  const inPlane = towardSun.clone().addScaledVector(pole, -sunlight);
  if (inPlane.lengthSq() < 1e-10) inPlane.set(0, 0, 1);
  return inPlane
    .normalize()
    .addScaledVector(pole, sunlight < 0 ? -0.85 : 0.85)
    .normalize();
}

export interface AtlasSubject {
  body: PortraitBody;
  /** Body center relative to the chosen camera gaze, in the undated layout. */
  center: THREE.Vector3;
}

export interface AtlasFraming {
  horizontal: number;
  vertical: number;
}

/** Acquire a nearby moon midway through travel without an abrupt gaze stop. */
export function atlasArrivalLookProgress(progress: number) {
  return THREE.MathUtils.smootherstep(progress, 0, 0.5);
}

export interface AtlasOrbitContext {
  radius: number;
  pitch: number;
  target: THREE.Vector3;
  subject: THREE.Vector3;
  parent: THREE.Vector3;
  parentRadius: number;
  viewport?: AtlasOrbitViewport;
}

export interface AtlasOrbitViewport {
  width: number;
  height: number;
  subject: PortraitBody;
  parent?: PortraitBody;
  minimumRingAperture?: number;
}

/** Keep an automatic moon portrait in its clear angular interval. Manual
 * inspection remains unrestricted; a changed pose starts a new arc in place. */
export class AtlasAutoOrbit {
  private geometry: number[] = [];
  private angle = NaN;
  private anchor = 0;
  private phase = 0;
  private amplitude = 0.45;
  private direction = 1;
  private initialDirection = 1;
  private viewport?: AtlasOrbitViewport;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewportAperture = 0;

  reset() {
    this.geometry = [];
    this.angle = NaN;
    this.direction = 1;
  }

  advance(delta: number, angle: number, context: AtlasOrbitContext) {
    const { radius, pitch, target, subject, parent, parentRadius, viewport } =
      context;
    const geometry = [
      radius,
      pitch,
      ...target.toArray(),
      ...subject.toArray(),
      ...parent.toArray(),
      parentRadius,
    ];
    if (
      !Number.isFinite(this.angle) ||
      Math.abs(angle - this.angle) > 1e-10 ||
      viewport !== this.viewport ||
      (viewport?.width ?? 0) !== this.viewportWidth ||
      (viewport?.height ?? 0) !== this.viewportHeight ||
      (viewport?.minimumRingAperture ?? 0) !== this.viewportAperture ||
      geometry.some((value, i) => value !== this.geometry[i])
    ) {
      this.geometry = geometry;
      this.viewport = viewport;
      this.viewportWidth = viewport?.width ?? 0;
      this.viewportHeight = viewport?.height ?? 0;
      this.viewportAperture = viewport?.minimumRingAperture ?? 0;
      this.anchor = angle;
      this.phase = 0;
      this.initialDirection = this.direction;
      const observer = new THREE.Vector3();
      const segment = new THREE.Vector3();
      const nearest = new THREE.Vector3();
      const relativeObserver = new THREE.Vector3();
      const visible = viewport
        ? orbitViewportFits(viewport, target, subject, parent)
        : undefined;
      const clearance = parentRadius * 1.05;
      const clear = (yaw: number) => {
        observer
          .setFromSphericalCoords(radius, Math.PI / 2 - pitch, yaw)
          .add(target);
        segment.copy(observer).sub(subject);
        const along = THREE.MathUtils.clamp(
          nearest.copy(parent).sub(subject).dot(segment) /
            Math.max(segment.lengthSq(), 1e-12),
          0,
          1,
        );
        nearest.copy(subject).addScaledVector(segment, along);
        return (
          nearest.distanceToSquared(parent) >= clearance * clearance &&
          (!visible || visible(relativeObserver.copy(observer).sub(target)))
        );
      };
      this.amplitude = 0.45;
      if (!clear(angle)) this.amplitude = 0;
      else {
        const step = (Math.PI * 2) / 256;
        let negative = 0.45,
          positive = 0.45;
        for (const direction of [-1, 1]) {
          const steps = viewport ? Math.ceil(0.45 / (step * 0.8)) : 256;
          for (let i = 1; i <= steps; i++) {
            if (clear(angle + direction * step * i)) continue;
            let lower = step * (i - 1),
              upper = step * i;
            for (let j = 0; j < 24; j++) {
              const middle = (lower + upper) / 2;
              if (clear(angle + direction * middle)) lower = middle;
              else upper = middle;
            }
            const extent = Math.min(0.45, lower * 0.8);
            if (direction < 0) negative = extent;
            else positive = extent;
            this.amplitude = Math.min(this.amplitude, extent);
            break;
          }
        }
        if (viewport) {
          this.anchor += (positive - negative) / 2;
          this.amplitude = (positive + negative) / 2;
          if (this.amplitude > 1e-6)
            this.phase = Math.asin(
              THREE.MathUtils.clamp(
                (angle - this.anchor) / this.amplitude,
                -1,
                1,
              ),
            );
        }
      }
    }
    if (this.amplitude > 1e-6 && delta !== 0) {
      // A constrained pair keeps the full arc's calm cycle instead of rocking faster.
      this.phase +=
        (delta * 0.027 * this.initialDirection) /
        (viewport ? 0.45 : this.amplitude);
      angle = this.anchor + this.amplitude * Math.sin(this.phase);
      const velocity = this.initialDirection * Math.cos(this.phase);
      if (Math.abs(velocity) > 1e-8) this.direction = Math.sign(velocity);
    }
    this.angle = angle;
    return angle;
  }
}

function orbitViewportFits(
  viewport: AtlasOrbitViewport,
  target: THREE.Vector3,
  subject: THREE.Vector3,
  parent: THREE.Vector3,
) {
  const { width, height } = viewport;
  const mobile = width <= 760;
  const framing = atlasPortraitFraming(width, height);
  const horizontal =
    mobile && !isCompactLandscape(width, height) ? 0 : framing.horizontal;
  const vertical = framing.vertical + (mobile && height <= 760 ? 0.055 : 0);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad((mobile ? 49 : 42) / 2));
  const halfWidth = halfHeight * (width / height);
  const safe = safeAtlasArea(width, height);
  const left = ((safe.left + 2) / width) * 2 - 1;
  const right = ((safe.right - 2) / width) * 2 - 1;
  const top = 1 - ((safe.top + 2) / height) * 2;
  const bottom = 1 - ((safe.bottom - 2) / height) * 2;
  const subjects = [{ body: viewport.subject, position: subject }];
  if (viewport.parent)
    subjects.push({ body: viewport.parent, position: parent });
  const bounds = subjects.map(({ body, position }) => ({
    center: position.clone().sub(target),
    radius: body.radius * Math.max(1.022, ...(body.shape ?? [])),
    ringRadius:
      body.radius *
      (body.id === 'saturn' ? 2.31 : body.id === 'uranus' ? 2.05 : 0),
    ringNormal: new THREE.Vector3(
      -Math.sin(body.tilt ?? 0.05),
      Math.cos(body.tilt ?? 0.05),
      0,
    ),
  }));
  const ring = bounds.find((bound) => bound.ringRadius > 0);
  const minimumAperture = viewport.minimumRingAperture ?? 0;
  const worldUp = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();
  const viewRight = new THREE.Vector3();
  const viewUp = new THREE.Vector3();
  const optical = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const planes = Array.from({ length: 4 }, () => new THREE.Vector3());
  return (offset: THREE.Vector3) => {
    if (
      ring &&
      Math.abs(ring.ringNormal.dot(offset)) < minimumAperture * offset.length()
    )
      return false;
    forward.copy(offset).normalize().negate();
    viewRight.crossVectors(forward, worldUp).normalize();
    viewUp.crossVectors(viewRight, forward);
    optical
      .copy(forward)
      .addScaledVector(viewRight, -horizontal * halfWidth)
      .addScaledVector(viewUp, -vertical * halfHeight)
      .normalize();
    viewRight.crossVectors(optical, worldUp).normalize();
    viewUp.crossVectors(viewRight, optical);
    planes[0].copy(viewRight).addScaledVector(optical, -left * halfWidth);
    planes[1]
      .copy(optical)
      .multiplyScalar(right * halfWidth)
      .sub(viewRight);
    planes[2].copy(viewUp).addScaledVector(optical, -bottom * halfHeight);
    planes[3]
      .copy(optical)
      .multiplyScalar(top * halfHeight)
      .sub(viewUp);
    // Analytic supports cover complete globes and tilted ring disks without
    // sampling vertices. This predicate runs only when the cached arc changes.
    for (const plane of planes) {
      const squared = plane.lengthSq();
      const length = Math.sqrt(squared);
      for (const bound of bounds) {
        const distance = plane.dot(relative.copy(bound.center).sub(offset));
        if (distance < bound.radius * length) return false;
        const normal = plane.dot(bound.ringNormal);
        if (
          distance <
          bound.ringRadius * Math.sqrt(Math.max(0, squared - normal * normal))
        )
          return false;
      }
    }
    return true;
  };
}

/** Composition follows the same eased travel as the observer. Retargeting a
 * resized destination keeps the currently rendered framing and joins its end. */
export class AtlasFramingTransition {
  private readonly from: AtlasFraming;
  private to: AtlasFraming;
  private correction?: { progress: number; offset: AtlasFraming };

  constructor(from: AtlasFraming, to: AtlasFraming) {
    this.from = { ...from };
    this.to = { ...to };
  }

  at(progress: number): AtlasFraming {
    const amount = THREE.MathUtils.smootherstep(progress, 0, 1);
    const framing = {
      horizontal: THREE.MathUtils.lerp(
        this.from.horizontal,
        this.to.horizontal,
        amount,
      ),
      vertical: THREE.MathUtils.lerp(
        this.from.vertical,
        this.to.vertical,
        amount,
      ),
    };
    if (this.correction) {
      const remaining =
        1 -
        THREE.MathUtils.smootherstep(
          (progress - this.correction.progress) /
            Math.max(1 - this.correction.progress, 1e-10),
          0,
          1,
        );
      framing.horizontal += this.correction.offset.horizontal * remaining;
      framing.vertical += this.correction.offset.vertical * remaining;
    }
    return framing;
  }

  retarget(to: AtlasFraming, progress: number) {
    const previous = this.at(progress);
    this.to = { ...to };
    this.correction = undefined;
    if (progress >= 1) return;
    const resized = this.at(progress);
    this.correction = {
      progress,
      offset: {
        horizontal: previous.horizontal - resized.horizontal,
        vertical: previous.vertical - resized.vertical,
      },
    };
  }
}

/** Match the compact landscape notes and toolbar layout. */
export function isCompactLandscape(width: number, height: number) {
  return width >= 500 && width <= 1000 && height <= 500 && width > height;
}

function safeAtlasArea(width: number, height: number) {
  if (isCompactLandscape(width, height))
    return {
      left: width * 0.03 + THREE.MathUtils.clamp(width * 0.32, 230, 285) + 18,
      right: width * 0.97 - 48,
      top: 80,
      bottom: height - 100,
    };
  const mobile = width <= 760;
  return {
    left: mobile
      ? width * 0.05
      : width * 0.041 + (width <= 1100 ? 255 : 285) + 32,
    right: mobile ? width * 0.95 : width * 0.959 - 54,
    top: mobile ? (height <= 650 ? 205 : Math.max(280, height * 0.34)) : 116,
    bottom: height - (mobile ? (height <= 650 ? 232 : 275) : 212),
  };
}

/** Keep each label's full footprint clear of the responsive interface. */
export function atlasLabelFits(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const safe = safeAtlasArea(width, height);
  const bottom = isCompactLandscape(width, height)
    ? Math.min(safe.bottom, height - 132)
    : safe.bottom;
  return (
    x - 55 >= safe.left &&
    x + 55 <= safe.right &&
    y >= safe.top &&
    y + 26 <= bottom
  );
}

/** Centre phone portraits in the space between their notes and controls. */
export function atlasPortraitFraming(width: number, height: number) {
  const mobile = width <= 760;
  if (!mobile || isCompactLandscape(width, height))
    return { horizontal: 0.28, vertical: mobile ? 0 : 0.12 };
  const safe = safeAtlasArea(width, height);
  return {
    horizontal: 0.28,
    vertical:
      1 - (safe.top + safe.bottom) / height - (height <= 760 ? 0.055 : 0),
  };
}

function fittedDistance(
  offset: THREE.Vector3,
  fits: (distance: number) => boolean,
) {
  const initial = offset.length();
  if (fits(initial)) return offset;
  let lower = initial,
    upper = initial;
  for (let i = 0; i < 12 && !fits(upper); i++) upper *= 1.5;
  // A viewport too short to hold its interface cannot be repaired by an
  // unbounded pullback. Preserve a finite, inspectable view in that case.
  if (!fits(upper)) return offset;
  for (let i = 0; i < 20; i++) {
    const middle = (lower + upper) / 2;
    if (fits(middle)) upper = middle;
    else lower = middle;
  }
  return offset.multiplyScalar(upper / initial);
}

/** Fit the actual ring plane separately from the globe: using the ring's outer
 * radius as a sphere would make Saturn needlessly small. Only the camera's
 * distance changes; body dimensions and the illustrated axial tilt stay put. */
export function fitAtlasPortrait(
  offset: THREE.Vector3,
  body: PortraitBody,
  width: number,
  height: number,
) {
  return fitAtlasFeature(
    offset,
    [{ body, center: new THREE.Vector3() }],
    width,
    height,
  );
}

/** Fit just the selected solid silhouettes. A moon-system view includes its
 * parent, while a comet's diffuse tail can continue through the backdrop. */
export function fitAtlasFeature(
  offset: THREE.Vector3,
  subjects: AtlasSubject[],
  width: number,
  height: number,
  composition: 'globe' | 'detail' = 'globe',
) {
  const mobile = width <= 760;
  const framing = atlasPortraitFraming(width, height);
  const vertical = framing.vertical + (mobile && height <= 760 ? 0.055 : 0);
  const horizontal =
    mobile && !isCompactLandscape(width, height) ? 0 : framing.horizontal;
  const halfHeight = Math.tan(THREE.MathUtils.degToRad((mobile ? 49 : 42) / 2));
  const halfWidth = halfHeight * (width / height);
  const camera = new THREE.PerspectiveCamera(mobile ? 49 : 42, width / height);
  const direction = offset.clone().normalize();
  camera.position.copy(direction);
  const forward = direction.clone().negate();
  const right = new THREE.Vector3()
    .crossVectors(forward, camera.up)
    .normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  camera.lookAt(
    right
      .multiplyScalar(-halfWidth * horizontal)
      .addScaledVector(up, -halfHeight * vertical),
  );

  const safe = safeAtlasArea(width, height);
  // The fit leaves a few pixels for sampling and the atmosphere's thin limb.
  const margin = 3;
  const globes = subjects.map(({ body, center }) => {
    const radius =
      body.radius *
      (body.id === 'comet'
        ? 1.9
        : body.id === 'sun'
          ? 1.045
          : Math.max(1.022, ...(body.shape ?? [])));
    if (composition === 'detail') {
      // Keep the central surface cap clear while its larger globe can continue
      // through the backdrop. The camera stays well outside the full body.
      offset.setLength(
        Math.max(offset.length(), center.length() + radius * 2.6),
      );
      return {
        center: center.clone().addScaledVector(direction, radius * 0.8),
        radius: radius * 0.6,
      };
    }
    return { center, radius };
  });
  const ring = subjects.flatMap(({ body, center }) => {
    const outer = body.id === 'saturn' ? 2.31 : body.id === 'uranus' ? 2.05 : 0;
    return outer
      ? Array.from({ length: 128 }, (_, i) => {
          const angle = (i / 128) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
            .multiplyScalar(body.radius * outer)
            .applyAxisAngle(new THREE.Vector3(0, 0, 1), body.tilt ?? 0.05)
            .add(center);
        })
      : [];
  });
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  function fits(distance: number) {
    camera.position.copy(direction).multiplyScalar(distance);
    camera.updateMatrixWorld();
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const globe of globes) {
      center.copy(globe.center).applyMatrix4(camera.matrixWorldInverse);
      const depth = -center.z;
      const denominator = depth * depth - globe.radius * globe.radius;
      if (depth <= 0 || denominator <= 0) return false;
      // Exact perspective tangencies include a parent's off-axis placement.
      const xSpread =
        globe.radius * Math.sqrt(center.x * center.x + denominator);
      const ySpread =
        globe.radius * Math.sqrt(center.y * center.y + denominator);
      minX = Math.min(
        minX,
        (((center.x * depth - xSpread) / denominator / halfWidth) * 0.5 + 0.5) *
          width,
      );
      maxX = Math.max(
        maxX,
        (((center.x * depth + xSpread) / denominator / halfWidth) * 0.5 + 0.5) *
          width,
      );
      minY = Math.min(
        minY,
        (0.5 -
          ((center.y * depth + ySpread) / denominator / halfHeight) * 0.5) *
          height,
      );
      maxY = Math.max(
        maxY,
        (0.5 -
          ((center.y * depth - ySpread) / denominator / halfHeight) * 0.5) *
          height,
      );
    }
    for (const vertex of ring) {
      point.copy(vertex).applyMatrix4(camera.matrixWorldInverse);
      if (point.z >= 0) return false;
      point.copy(vertex).project(camera);
      const x = (point.x * 0.5 + 0.5) * width,
        y = (-point.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return (
      minX >= safe.left + margin &&
      maxX <= safe.right - margin &&
      minY >= safe.top + margin &&
      maxY <= safe.bottom - margin
    );
  }
  return fittedDistance(offset, fits);
}

export function atlasRegionFraming(width: number, height: number) {
  return {
    horizontal: 0.28,
    vertical: width > 760 ? 0.12 : height > 650 && height <= 760 ? -0.055 : 0,
  };
}

/** The default region view shows the complete illustrated annulus around the
 * Sun. Fit both faces of its vertical particle extent; inspection cameras can
 * still enter the field without changing its geometry or particle count. */
export function fitAtlasRegion(
  offset: THREE.Vector3,
  outerRadius: number,
  width: number,
  height: number,
) {
  const mobile = width <= 760;
  const framing = atlasRegionFraming(width, height);
  const camera = new THREE.PerspectiveCamera(mobile ? 49 : 42, width / height);
  const direction = offset.clone().normalize();
  camera.position.copy(direction);
  const forward = direction.clone().negate();
  const right = new THREE.Vector3()
    .crossVectors(forward, camera.up)
    .normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.lookAt(
    right
      .multiplyScalar(
        -halfHeight *
          camera.aspect *
          (mobile && !isCompactLandscape(width, height)
            ? 0
            : framing.horizontal),
      )
      .addScaledVector(
        up,
        -halfHeight *
          (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
      ),
  );
  const safe = safeAtlasArea(width, height);
  const shell = Array.from({ length: 256 }, (_, i) => {
    const angle = (Math.floor(i / 2) / 128) * Math.PI * 2;
    return new THREE.Vector3(
      Math.cos(angle) * outerRadius,
      i % 2 ? 1.2 : -1.2,
      Math.sin(angle) * outerRadius,
    );
  });
  const point = new THREE.Vector3();
  const view = new THREE.Vector3();
  return fittedDistance(offset, (distance) => {
    camera.position.copy(direction).multiplyScalar(distance);
    camera.updateMatrixWorld();
    for (const vertex of shell) {
      view.copy(vertex).applyMatrix4(camera.matrixWorldInverse);
      if (view.z >= 0) return false;
      point.copy(vertex).project(camera);
      const x = (point.x * 0.5 + 0.5) * width,
        y = (-point.y * 0.5 + 0.5) * height;
      if (
        x < safe.left + 3 ||
        x > safe.right - 3 ||
        y < safe.top + 3 ||
        y > safe.bottom - 3
      )
        return false;
    }
    return true;
  });
}
