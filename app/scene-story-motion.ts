import * as THREE from 'three';
import type { DiscoveryBeat } from './mission-cinematography';
import { isCompactLandscape } from './atlas-camera';

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const ease = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

/** Copy shares the playback clock: pausing never leaves a half-read sentence. */
export function storyCue(
  progress: number,
  beat: DiscoveryBeat | undefined,
  reading: boolean,
) {
  if (reading) return { presence: 1, heading: 1, detail: 1 };
  if (beat) {
    const p = beat.progress;
    const returning = beat.kind !== 'tableau';
    // Reclaim the description's space before the return dolly brings the
    // enlarged probe through the lower frame. The heading follows it out.
    const exit = returning ? 1 - ease((p - 0.68) / 0.16) : 1;
    return {
      presence: ease(p / 0.1) * exit,
      heading: ease((p - 0.025) / 0.12),
      detail: returning
        ? ease((p - 0.06) / 0.08) * (1 - ease((p - 0.65) / 0.09))
        : ease((p - 0.1) / 0.16),
    };
  }
  return {
    presence: ease(progress / 0.035),
    heading: ease(progress / 0.065),
    detail:
      ease((progress - 0.035) / 0.09) * (1 - ease((progress - 0.38) / 0.16)),
  };
}

export interface StorySubject {
  x: number;
  y: number;
  radius: number;
  visible: boolean;
}

/** Stagger the type layers so long outgoing lines do not ghost through the year. */
export function closingCue(progress: number) {
  return {
    outgoing: 1 - ease(progress / 0.65),
    bridge: ease((progress - 0.3) / 0.7),
  };
}

export function transferCue(
  progress: number,
  reading: boolean,
  continuation = false,
) {
  return {
    presence: reading
      ? progress >= 0.88
        ? 0
        : 1
      : (continuation ? 1 : ease(progress / 0.1)) *
        (1 - ease((progress - 0.78) / 0.18)),
    drift: ease(progress) * 32,
    arrival: reading || continuation ? 1 : ease((progress - 0.22) / 0.36),
    incoming: reading && progress >= 0.88 ? 1 : ease((progress - 0.88) / 0.12),
  };
}
export interface StoryBinding {
  root: HTMLDivElement;
  path: SVGPathElement;
  dot: SVGCircleElement;
  width: number;
  height: number;
  presence?: number;
}

/** Caption placement is editorial. The endpoint is the projected silhouette,
 * never an invented geographic location or an off-screen tracking marker. */
export function storyPlacement(
  subject: StorySubject,
  width: number,
  height: number,
  cardWidth: number,
  cardHeight: number,
  companion?: StorySubject,
) {
  const mobile = width <= 760;
  const landscape = isCompactLandscape(width, height);
  const margin = width * (landscape ? 0.03 : mobile ? 0.05 : 0.041);
  const bottom =
    height - (landscape ? 100 : mobile ? (height <= 760 ? 216 : 252) : 212);
  const minY = landscape ? 80 : mobile ? 138 : 164;
  const maxY = Math.max(minY, bottom - cardHeight);
  let x =
    mobile || landscape
      ? margin
      : clamp(
          subject.x - subject.radius - cardWidth - 72,
          margin,
          width * 0.23,
        );
  const y = landscape
    ? minY
    : mobile
      ? maxY
      : clamp(subject.y - cardHeight * 0.38, minY, maxY);
  // In pursuit the caption follows the probe, but the world can pass behind
  // it. Reserve the world's approaching limb before it crosses the type.
  if (
    !mobile &&
    !landscape &&
    companion?.visible &&
    companion.radius > 8 &&
    companion.y + companion.radius > y - 32 &&
    companion.y - companion.radius < y + cardHeight + 32
  )
    x = Math.min(
      x,
      Math.max(margin, companion.x - companion.radius - cardWidth - 72),
    );
  return { x, y, mobile };
}

export class StoryProjector {
  readonly bounds = { x: 0, y: 0, width: 0, height: 0 };
  private point = new THREE.Vector3();
  private view = new THREE.Vector3();
  private x?: number;
  private y?: number;
  private link = 0;
  private viewport = '';

  update(
    binding: StoryBinding,
    camera: THREE.PerspectiveCamera,
    center: THREE.Vector3 | undefined,
    radius: number,
    width: number,
    height: number,
    delta: number,
    reduced: boolean,
    companion?: { center: THREE.Vector3; radius: number },
  ) {
    const subject: StorySubject = {
      x: width * 0.58,
      y: height * 0.43,
      radius: 0,
      visible: false,
    };
    if (center) {
      this.point.copy(center).project(camera);
      this.view.copy(center).applyMatrix4(camera.matrixWorldInverse);
      subject.x = (this.point.x * 0.5 + 0.5) * width;
      subject.y = (-this.point.y * 0.5 + 0.5) * height;
      subject.radius = Math.min(
        width,
        (radius /
          Math.max(1e-10, -this.view.z) /
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
          height *
          0.5,
      );
      const landscape = isCompactLandscape(width, height);
      subject.visible =
        this.view.z < 0 &&
        this.point.z > -1 &&
        this.point.z < 1 &&
        subject.x > 24 &&
        subject.x < width - 24 &&
        subject.y > (landscape ? 80 : 136) &&
        subject.y < height - (landscape ? 100 : 215);
    }
    let companionDisk: StorySubject | undefined;
    if (companion) {
      this.point.copy(companion.center).project(camera);
      this.view.copy(companion.center).applyMatrix4(camera.matrixWorldInverse);
      companionDisk = {
        x: (this.point.x * 0.5 + 0.5) * width,
        y: (-this.point.y * 0.5 + 0.5) * height,
        radius: Math.min(
          width,
          (companion.radius /
            Math.max(1e-10, -this.view.z) /
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
            height *
            0.5,
        ),
        visible: this.view.z < 0 && this.point.z > -1 && this.point.z < 1,
      };
    }
    const layout = storyPlacement(
      subject,
      width,
      height,
      binding.width,
      binding.height,
      companionDisk,
    );
    const viewport = `${width}:${height}`;
    const instant =
      reduced || this.x === undefined || viewport !== this.viewport;
    const blend = instant ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 2.8);
    this.x = (this.x ?? layout.x) + (layout.x - (this.x ?? layout.x)) * blend;
    this.y = (this.y ?? layout.y) + (layout.y - (this.y ?? layout.y)) * blend;
    // Keep a growing description above the controls on every animation frame,
    // instead of waiting for the position damping to catch up after a pause.
    const landscape = isCompactLandscape(width, height);
    const safeBottom =
      height -
      (landscape ? 100 : layout.mobile ? (height <= 760 ? 216 : 252) : 212);
    this.y = Math.min(
      this.y,
      Math.max(
        landscape ? 80 : layout.mobile ? 138 : 164,
        safeBottom - binding.height,
      ),
    );
    this.viewport = viewport;
    Object.assign(this.bounds, {
      x: this.x,
      y: this.y,
      width: binding.width,
      height: binding.height,
    });
    binding.root.style.setProperty('--story-x', `${this.x.toFixed(2)}px`);
    binding.root.style.setProperty('--story-y', `${this.y.toFixed(2)}px`);
    // A short, restrained leader ends just outside the limb. Suppress it when
    // the user rotates the subject behind the text or outside the viewport.
    const startX = this.x + binding.width + 20;
    const startY = this.y + 30;
    const dx = startX - subject.x,
      dy = startY - subject.y;
    const length = Math.hypot(dx, dy);
    const endX = subject.x + (dx / Math.max(length, 1)) * (subject.radius + 12);
    const endY = subject.y + (dy / Math.max(length, 1)) * (subject.radius + 12);
    const linked =
      subject.visible &&
      !layout.mobile &&
      endX > startX + 32 &&
      length > subject.radius + 55;
    this.link +=
      ((linked ? 1 : 0) - this.link) * (instant ? 1 : 1 - Math.exp(-delta * 5));
    if (!subject.visible) this.link = 0;
    binding.root.style.setProperty('--story-link', this.link.toFixed(3));
    if (!linked) return;
    binding.path.setAttribute(
      'd',
      `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${(startX + 24).toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`,
    );
    binding.dot.setAttribute('cx', endX.toFixed(2));
    binding.dot.setAttribute('cy', endY.toFixed(2));
  }
}
