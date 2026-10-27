import * as THREE from 'three';
import type { BodyId } from './solar-data';
import type { Encounter } from './ephemeris';
import { easeFlight } from './expedition-flight';

export interface DiscoveryBeat {
  body: BodyId;
  label: string;
  primary: boolean;
  progress: number;
  amount: number;
  stage: 'reveal' | 'observe' | 'return';
  subject?: 'world' | 'probe';
  kind?: 'encounter' | 'tableau';
}

/** A camera interlude holds the exact encounter epoch. It does not invent a
 * spacecraft loiter or extend source coverage. The shared clock resumes when
 * the camera has returned to its pursuit pose. */
export class MissionPlayback {
  static readonly revealSeconds = 14;
  private time: number;
  private readonly stops: {
    progress: number;
    body: BodyId;
    label: string;
    primary: boolean;
  }[];
  private readonly visited = new Set<number>();
  private active?: { index: number; elapsed: number };
  private tableauTime = 0;
  static readonly tableauSeconds = 16;

  constructor(
    readonly duration: number,
    events: Encounter[],
    fallback: { body: BodyId; label: string; subject?: 'world' | 'probe' },
    readonly snapshot: boolean,
  ) {
    this.time = snapshot ? duration : 0;
    this.stops = events.length
      ? events.map((event, index) => ({
          ...event,
          primary: index === events.length - 1,
        }))
      : [{ ...fallback, progress: 1, primary: true }];
  }

  get progress() {
    return this.time / this.duration;
  }
  get tableauProgress() {
    return this.tableauTime / MissionPlayback.tableauSeconds;
  }
  get complete() {
    if (this.snapshot) return this.tableauProgress === 1;
    return (
      this.progress >= 1 &&
      !this.active &&
      this.visited.size === this.stops.length
    );
  }
  get closingProgress() {
    if (this.snapshot) return easeFlight((this.tableauProgress - 0.86) / 0.14);
    if (this.active) {
      const stop = this.stops[this.active.index];
      return stop.primary && stop.progress >= 0.98
        ? easeFlight(
            (this.active.elapsed / MissionPlayback.revealSeconds - 0.83) / 0.17,
          )
        : 0;
    }
    if (this.visited.size < this.stops.length) return 0;
    return easeFlight((this.progress - 0.94) / 0.06);
  }
  get outroProgress() {
    if (this.snapshot || this.active || this.visited.size < this.stops.length)
      return 0;
    // Leave the completed encounter's return intact before the final portrait.
    // The source clock keeps traversing its final interval at the same rate.
    const start = Math.max(0.86, this.stops.at(-1)!.progress + 0.02);
    return start >= 1 ? 0 : easeFlight((this.progress - start) / (1 - start));
  }
  get beat(): DiscoveryBeat | undefined {
    if (this.snapshot) {
      return {
        ...this.stops[0],
        kind: 'tableau',
        progress: this.tableauProgress,
        amount: 1,
        stage: this.tableauProgress < 0.12 ? 'reveal' : 'observe',
      };
    }
    if (!this.active) return;
    const progress = this.active.elapsed / MissionPlayback.revealSeconds;
    const amount =
      easeFlight(progress / 0.28) * (1 - easeFlight((progress - 0.67) / 0.33));
    return {
      ...this.stops[this.active.index],
      kind: 'encounter',
      progress,
      amount,
      stage:
        progress < 0.28 ? 'reveal' : progress < 0.67 ? 'observe' : 'return',
    };
  }

  advance(delta: number, paused: boolean, reduced: boolean) {
    if (paused) return;
    if (this.snapshot) {
      this.tableauTime = reduced
        ? MissionPlayback.tableauSeconds
        : Math.min(
            MissionPlayback.tableauSeconds,
            this.tableauTime + Math.max(0, delta),
          );
      return;
    }
    if (reduced) {
      this.seek(1);
      return;
    }
    let remaining = Math.max(0, delta);
    while (remaining > 1e-10) {
      if (this.active) {
        const used = Math.min(
          remaining,
          MissionPlayback.revealSeconds - this.active.elapsed,
        );
        this.active.elapsed += used;
        remaining -= used;
        if (this.active.elapsed >= MissionPlayback.revealSeconds - 1e-10)
          this.active = undefined;
      } else {
        const index = this.stops.findIndex((_, i) => !this.visited.has(i));
        const until =
          index < 0
            ? Infinity
            : Math.max(
                0,
                this.stops[index].progress * this.duration - this.time,
              );
        if (until > remaining) {
          this.time = Math.min(this.duration, this.time + remaining);
          break;
        }
        this.time = this.stops[index].progress * this.duration;
        remaining -= until;
        this.visited.add(index);
        this.active = { index, elapsed: 0 };
      }
    }
  }

  seek(progress: number) {
    this.time = THREE.MathUtils.clamp(progress, 0, 1) * this.duration;
    this.active = undefined;
    this.visited.clear();
    this.stops.forEach((stop, i) => {
      if (stop.progress <= progress) this.visited.add(i);
    });
  }
}

/** One sustained orbital camera passage for a dated milestone without a probe
 * track. Geometry stays at its recorded epoch; the viewpoint crosses the limb. */
export function tableauCamera(
  position: THREE.Vector3,
  look: THREE.Vector3,
  center: THREE.Vector3,
  sun: THREE.Vector3,
  radius: number,
  body: BodyId,
  progress: number,
  mobile: boolean,
  pole = new THREE.Vector3(0, 1, 0),
) {
  const light = sun.clone().sub(center).normalize();
  const axis = pole.clone().normalize();
  // Retain a quiet orbital drift for the following camera arc to inherit.
  const passage = easeFlight(progress) * 0.82 + progress * 0.18;
  // Cross the terminator into a three-quarter portrait. Ending short of a
  // full-face view keeps the limb dimensional as the next departure begins.
  const angle = THREE.MathUtils.lerp(1.75, 0.55, passage);
  const direction = light
    .applyAxisAngle(axis, angle)
    .addScaledVector(axis, 0.14)
    .normalize();
  const distance =
    radius *
    (body === 'comet' ? 6.6 : 5.1) *
    (mobile ? 1.7 : 1) *
    THREE.MathUtils.lerp(1.12, 0.94, easeFlight(progress));
  position.copy(center).addScaledVector(direction, distance);
  look.copy(center);
}

export function discoveryCamera(
  position: THREE.Vector3,
  look: THREE.Vector3,
  center: THREE.Vector3,
  sun: THREE.Vector3,
  radius: number,
  beat: DiscoveryBeat,
  mobile: boolean,
  pole = new THREE.Vector3(0, 1, 0),
) {
  const start = position.clone().sub(center);
  const light =
    beat.body === 'sun' && beat.subject !== 'probe'
      ? start.clone().normalize()
      : sun.clone().sub(center).normalize();
  const startDirection = start.clone().normalize();
  const lightAngle = startDirection.angleTo(light);
  const towardLight = new THREE.Quaternion().setFromUnitVectors(
    startDirection,
    light,
  );
  // Preserve phase instead of always flattening the world into full sunlight.
  // Night-side arrivals are allowed a bounded turn toward the illuminated limb.
  const phaseCorrection = Math.min(0.28, Math.max(0, lightAngle - 0.95));
  const direction = startDirection
    .clone()
    .applyQuaternion(
      new THREE.Quaternion().slerp(
        towardLight,
        phaseCorrection / Math.max(lightAngle, 1e-6),
      ),
    );
  // A slow lateral reveal continues throughout the observation hold. The
  // envelope below returns exactly to the original pursuit pose at both ends.
  const passage = easeFlight((beat.progress - 0.16) / 0.68);
  const arc =
    beat.subject === 'probe' ? 0.1 : beat.body === 'saturn' ? 0.24 : 0.3;
  direction.applyAxisAngle(
    pole,
    THREE.MathUtils.lerp(-arc / 2, arc / 2, passage),
  );
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    start.clone().normalize(),
    direction,
  );
  const dollyDirection = start
    .clone()
    .normalize()
    .applyQuaternion(new THREE.Quaternion().slerp(rotation, beat.amount));
  const closeDistance =
    radius *
    (beat.body === 'saturn' || (mobile && beat.body === 'uranus') ? 8.4 : 4.8) *
    (mobile ? 1.55 : 1);
  const distance = Math.exp(
    THREE.MathUtils.lerp(
      Math.log(Math.max(start.length(), radius * 1.3)),
      Math.log(closeDistance),
      beat.amount,
    ),
  );
  position.copy(center).addScaledVector(dollyDirection, distance);
  // Follow the changing field of view; a linear gaze blend can still miss a
  // small world when only 1% of an interplanetary offset remains.
  const span = start.length() - closeDistance;
  const gaze =
    Math.abs(span) < 1e-10
      ? beat.amount
      : 1 - (distance - closeDistance) / span;
  look.lerp(center, THREE.MathUtils.clamp(gaze, 0, 1));
}

/** Close the final dated interval on its star while the shared clock continues.
 * The added dolly and gaze shift begin with zero correction speed. */
export function outroCamera(
  position: THREE.Vector3,
  look: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
  amount: number,
  mobile: boolean,
) {
  if (amount <= 0) return;
  const offset = position.clone().sub(center);
  const start = offset.length();
  const portrait = radius * (mobile ? 9 : 4.8);
  const distance = Math.exp(
    THREE.MathUtils.lerp(Math.log(start), Math.log(portrait), amount),
  );
  const direction = offset.normalize();
  position.copy(center).addScaledVector(direction, distance);
  const span = start - portrait;
  const gaze = Math.abs(span) < 1e-10 ? amount : (start - distance) / span;
  const target = center.clone();
  if (mobile) {
    // Leave room below the star for the mobile closing copy.
    const forward = direction.clone().negate();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    target.addScaledVector(
      up,
      -portrait * Math.tan(THREE.MathUtils.degToRad(49 / 2)) * 0.15,
    );
  }
  look.lerp(target, THREE.MathUtils.clamp(gaze, 0, 1));
}
