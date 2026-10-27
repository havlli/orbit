import * as THREE from 'three';
import {
  KM_PER_UNIT,
  sampleState,
  validateEphemeris,
  type EphemerisBundle,
} from './ephemeris';
import { bodyById, type BodyId } from './solar-data';

export type TransitionPhase = 'departing' | 'timelapse' | 'arriving';
type TransferProfile = 'local' | 'nearby' | 'wide' | 'unclassified';
type ExpeditionFraming = {
  horizontal: number;
  vertical: number;
  portraitHorizontal?: number;
  portraitVertical?: number;
};
export interface ExpeditionView {
  position: THREE.Vector3;
  look: THREE.Vector3;
  bodies: Map<BodyId, THREE.Vector3>;
  radiiKm: EphemerisBundle['radiiKm'];
  poles?: EphemerisBundle['poles'];
  et: number;
  utc: string;
  atlasBlend?: number;
  /** Undated particle illustration. Fade before layout/time starts changing;
   * retain the sampled opacity when a flight is interrupted. */
  atlasParticles?: number;
  focus?: BodyId;
  fovOffset?: number;
  bank?: number;
  framing?: ExpeditionFraming;
  motion?: { angular: THREE.Vector3; radial: number };
}
export interface ExpeditionFrame extends ExpeditionView {
  phase: TransitionPhase;
  progress: number;
  phaseProgress: number;
  overview: number;
  done: boolean;
  fovOffset: number;
  bank: number;
  framing: ExpeditionFraming;
}

let overviewData: Promise<EphemerisBundle> | undefined;
export function loadTimelapse() {
  overviewData ??= fetch('/ephemeris/timelapse.json')
    .then(async (response) => {
      if (!response.ok) throw new Error('Time-lapse ephemerides unavailable');
      return validateTimelapse(await response.json());
    })
    .catch((error) => {
      overviewData = undefined;
      throw error;
    });
  return overviewData;
}

export function validateTimelapse(raw: unknown): EphemerisBundle {
  const data = raw as EphemerisBundle;
  return validateEphemeris({
    ...data,
    id: 'timelapse',
    radiiKm: {},
    events: [],
    clock: [
      { progress: 0, et: data.start, utc: '1957-01-01T00:00:00Z' },
      { progress: 1, et: data.end, utc: '2022-01-01T00:00:00Z' },
    ],
  });
}

export const easeFlight = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return THREE.MathUtils.clamp(t * t * t * (t * (t * 6 - 15) + 10), 0, 1);
};

function turnDirection(a: THREE.Vector3, b: THREE.Vector3, progress: number) {
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    a.clone().normalize(),
    b.clone().normalize(),
  );
  return a
    .clone()
    .normalize()
    .applyQuaternion(new THREE.Quaternion().slerp(rotation, progress));
}

/** Camera-only momentum relative to the subject, independent of epoch speed.
 * Bound interrupted manual moves so a drag cannot launch the next camera arc. */
export function viewMotion(
  from: ExpeditionView,
  to: ExpeditionView,
  delta: number,
) {
  const a = from.position.clone().sub(from.look);
  const b = to.position.clone().sub(to.look);
  const radial = THREE.MathUtils.clamp(
    Math.log(Math.max(b.length(), 1e-10) / Math.max(a.length(), 1e-10)) /
      Math.max(delta, 1e-4),
    -0.15,
    0.15,
  );
  a.normalize();
  b.normalize();
  const axis = new THREE.Vector3().crossVectors(a, b);
  const angle = Math.atan2(axis.length(), a.dot(b));
  const angular = axis
    .normalize()
    .multiplyScalar(Math.min(0.18, angle / Math.max(delta, 1e-4)));
  return { angular, radial };
}

function primaryBody(focus: BodyId | undefined) {
  return focus ? (bodyById[focus]?.parent ?? focus) : undefined;
}

function coveredParent(
  from: ExpeditionView,
  to: ExpeditionView,
  data: EphemerisBundle,
) {
  const primary = primaryBody(from.focus);
  if (
    !primary ||
    primary === 'sun' ||
    primary !== primaryBody(to.focus) ||
    !from.bodies.has(primary) ||
    !to.bodies.has(primary)
  )
    return;
  const track = data.tracks[primary];
  const start = Math.min(from.et, to.et),
    end = Math.max(from.et, to.et);
  if (
    track?.length &&
    track[0][0] <= start &&
    track[track.length - 1][0] >= end &&
    !data.seams?.[primary]?.some((seam) => seam.start < end && seam.end > start)
  )
    return primary;
}

/** One unbroken camera arc. Time and travel overlap; there is no stationary
 * solar-system intermission. Coordinates remain simultaneous ephemerides.
 * The incoming probe can already be moving while the camera acquires it. */
export class ExpeditionFlight {
  private elapsed = 0;
  private arrival?: ExpeditionView;
  private resizeCorrection?: {
    progress: number;
    position: THREE.Vector3;
    look: THREE.Vector3;
    framing: ExpeditionFraming;
  };
  readonly departureSeconds: number;
  readonly timelapseSeconds: number;
  readonly arrivalSeconds: number;
  readonly duration: number;
  readonly profile: TransferProfile;
  private readonly parent?: BodyId;
  private readonly peakDistance: number;
  private readonly highDirection: THREE.Vector3;
  private readonly wideCenter: THREE.Vector3;

  constructor(
    readonly from: ExpeditionView,
    readonly to: ExpeditionView,
    readonly data: EphemerisBundle | null,
    mobile: boolean,
  ) {
    const historical =
      data &&
      !(from.atlasBlend ?? 0) &&
      !(to.atlasBlend ?? 0) &&
      from.focus &&
      to.focus &&
      bodyById[from.focus] &&
      bodyById[to.focus];
    this.parent = historical ? coveredParent(from, to, data) : undefined;
    const inner = new Set<BodyId>(['sun', 'mercury', 'venus', 'earth', 'mars']);
    const firstPrimary = primaryBody(from.focus),
      lastPrimary = primaryBody(to.focus);
    const nearby =
      firstPrimary &&
      lastPrimary &&
      ((inner.has(firstPrimary) && inner.has(lastPrimary)) ||
        (firstPrimary === 'sun' && lastPrimary === 'jupiter') ||
        (firstPrimary === 'jupiter' && lastPrimary === 'sun'));
    this.profile = !historical
      ? 'unclassified'
      : this.parent
        ? 'local'
        : nearby
          ? 'nearby'
          : 'wide';
    this.duration =
      this.profile === 'local'
        ? 7
        : this.profile === 'nearby'
          ? 9
          : this.profile === 'wide'
            ? 11
            : 14;
    this.departureSeconds = this.duration * 0.3;
    this.timelapseSeconds = this.duration * 0.4;
    this.arrivalSeconds = this.duration * 0.3;
    const fromSun = from.bodies.get('sun') ?? new THREE.Vector3();
    const toSun = to.bodies.get('sun') ?? new THREE.Vector3();
    const endpointDistance = Math.max(
      from.position.distanceTo(from.look),
      to.position.distanceTo(to.look),
    );
    if (this.parent) {
      this.wideCenter = new THREE.Vector3();
      const extent =
        (Math.max(
          from.radiiKm[this.parent] ?? 0,
          to.radiiKm[this.parent] ?? 0,
        ) /
          KM_PER_UNIT) *
        (this.parent === 'saturn' ? 2.4 : this.parent === 'uranus' ? 2.1 : 1);
      this.peakDistance = Math.max(extent * 16, endpointDistance * 1.4);
    } else {
      this.wideCenter = fromSun.clone().lerp(toSun, 0.5);
      const solarRadius = Math.max(
        from.look.distanceTo(fromSun),
        to.look.distanceTo(toSun),
        15,
      );
      this.peakDistance = historical
        ? Math.max(
            solarRadius * 3.3 * (mobile ? 2.1 : 1),
            endpointDistance * 1.4,
          )
        : Math.max(solarRadius * (data ? 3.3 : 1.5), endpointDistance * 1.4) *
          (mobile ? 2.1 : 1);
    }
    this.highDirection = new THREE.Vector3(0.55, 1.15, 0.8).normalize();
  }

  get progress() {
    return this.elapsed / this.duration;
  }
  get acquiring() {
    return this.progress >= 0.8;
  }
  setArrival(view: ExpeditionView) {
    this.arrival = view;
  }

  /** Resize only the editorial arrival camera. Preserve the current image and
   * let the remaining arc acquire its new fit; dated geometry and time stay put. */
  resizeArrival(view: Pick<ExpeditionView, 'position' | 'look' | 'framing'>) {
    const previous = this.update(0, true);
    this.arrival = {
      ...(this.arrival ?? this.to),
      position: view.position.clone(),
      look: view.look.clone(),
      framing: view.framing ? { ...view.framing } : undefined,
    };
    this.resizeCorrection = undefined;
    if (this.progress >= 1) return;
    const resized = this.update(0, true);
    this.resizeCorrection = {
      progress: this.progress,
      position: previous.position.sub(resized.position),
      look: previous.look.sub(resized.look),
      framing: {
        horizontal: previous.framing.horizontal - resized.framing.horizontal,
        vertical: previous.framing.vertical - resized.framing.vertical,
        portraitHorizontal:
          (previous.framing.portraitHorizontal ?? 0) -
          (resized.framing.portraitHorizontal ?? 0),
        portraitVertical:
          (previous.framing.portraitVertical ?? previous.framing.vertical) -
          (resized.framing.portraitVertical ?? resized.framing.vertical),
      },
    };
  }

  naturalBodies(et: number) {
    const positions = new Map<BodyId, THREE.Vector3>();
    for (const [id, track] of Object.entries(this.data!.tracks)) {
      const row = sampleState(track!, et);
      positions.set(
        id as BodyId,
        new THREE.Vector3(row[1], row[3], -row[2]).divideScalar(KM_PER_UNIT),
      );
    }
    return positions;
  }

  update(delta: number, paused = false, reduced = false): ExpeditionFrame {
    if (reduced) this.elapsed = this.duration;
    else if (!paused)
      this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, delta));
    const t = this.progress;
    const destination = this.arrival ?? this.to;
    const timeProgress = easeFlight((t - 0.3) / 0.4);
    const et = THREE.MathUtils.lerp(this.from.et, destination.et, timeProgress);
    let bodies = this.data
      ? this.naturalBodies(et)
      : new Map<BodyId, THREE.Vector3>();
    if (!this.data) {
      for (const [id, position] of this.from.bodies)
        bodies.set(
          id,
          position
            .clone()
            .lerp(destination.bodies.get(id) ?? position, timeProgress),
        );
      for (const [id, position] of destination.bodies)
        if (!bodies.has(id)) bodies.set(id, position.clone());
    }
    // Match each source solution before/after calendar travel, while distant.
    const endpoint = t < 0.5 ? this.from : destination;
    const endpointWeight =
      t < 0.3
        ? 1 - easeFlight((t - 0.22) / 0.08)
        : t > 0.7
          ? easeFlight((t - 0.7) / 0.08)
          : 0;
    if (endpointWeight > 0 || t === 0 || t === 1) {
      for (const [id, position] of endpoint.bodies) {
        const natural = bodies.get(id);
        if (natural) natural.lerp(position, endpointWeight);
        else bodies.set(id, position.clone());
      }
    }
    const firstOffset = this.from.position.clone().sub(this.from.look);
    const lastOffset = destination.position.clone().sub(destination.look);
    const outward = t < 0.5;
    // A single crest replaces the old wide-distance plateau. The outward arc
    // is already becoming the inward arc while the calendar keeps advancing.
    const u = outward ? easeFlight(t / 0.5) : easeFlight((t - 0.5) / 0.5);
    const endpointDistance = outward
      ? firstOffset.length()
      : lastOffset.length();
    let distance = Math.exp(
      THREE.MathUtils.lerp(
        Math.log(
          Math.max(outward ? endpointDistance : this.peakDistance, 1e-10),
        ),
        Math.log(
          Math.max(outward ? this.peakDistance : endpointDistance, 1e-10),
        ),
        u,
      ),
    );
    // Retain the subject until its context fits. A covered local handoff follows
    // the shared parent at the same instant, without inventing a moon's orbit.
    const wideAmount = THREE.MathUtils.clamp(
      (distance - endpointDistance) /
        Math.max(this.peakDistance - endpointDistance, 1e-9),
      0,
      1,
    );
    const look = (outward ? this.from.look : destination.look).clone();
    if (this.parent) {
      look.sub(endpoint.bodies.get(this.parent)!);
      const context =
        easeFlight((t - 0.18) / 0.12) * (1 - easeFlight((t - 0.55) / 0.15));
      look.lerp(this.wideCenter, wideAmount + context * (1 - wideAmount));
      look.add(bodies.get(this.parent)!);
    } else look.lerp(this.wideCenter, wideAmount);
    const wideDirection = this.highDirection
      .clone()
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.lerp(-0.12, 0.12, easeFlight(t)),
      );
    const direction = outward
      ? turnDirection(firstOffset, wideDirection, u)
      : turnDirection(wideDirection, lastOffset, u);
    // Carry the orbital move into the pullback, then join the main arc.
    // The correction has zero displacement at both flight endpoints.
    const carry = this.elapsed * (1 - easeFlight(this.elapsed / 2.4));
    if (this.from.motion && carry > 0) {
      const spin = this.from.motion.angular.length();
      if (spin > 1e-10)
        direction.applyAxisAngle(
          this.from.motion.angular.clone().normalize(),
          spin * carry,
        );
      distance *= Math.exp(this.from.motion.radial * carry);
    }
    const position = look.clone().addScaledVector(direction, distance);
    if (t === 0 || t === 1) {
      position.copy(endpoint.position);
      look.copy(endpoint.look);
      bodies = new Map(
        [...endpoint.bodies].map(([id, value]) => [id, value.clone()]),
      );
    }
    const phase: TransitionPhase =
      t < 0.3 ? 'departing' : t > 0.7 ? 'arriving' : 'timelapse';
    const phaseProgress =
      phase === 'departing'
        ? t / 0.3
        : phase === 'arriving'
          ? (t - 0.7) / 0.3
          : (t - 0.3) / 0.4;
    const overview =
      easeFlight((t - 0.18) / 0.12) * (1 - easeFlight((t - 0.7) / 0.12));
    const fromFraming = this.from.framing ?? {
      horizontal: THREE.MathUtils.lerp(0.12, 0.28, this.from.atlasBlend ?? 0),
      vertical: THREE.MathUtils.lerp(0.2, 0.12, this.from.atlasBlend ?? 0),
    };
    const toFraming = destination.framing ?? {
      horizontal: THREE.MathUtils.lerp(0.12, 0.28, destination.atlasBlend ?? 0),
      vertical: THREE.MathUtils.lerp(0.2, 0.12, destination.atlasBlend ?? 0),
    };
    const widestLens = Math.max(
      3,
      this.from.fovOffset ?? 0,
      destination.fovOffset ?? 0,
    );
    const framing: ExpeditionFraming = {
      horizontal: THREE.MathUtils.lerp(
        fromFraming.horizontal,
        toFraming.horizontal,
        timeProgress,
      ),
      vertical: THREE.MathUtils.lerp(
        fromFraming.vertical,
        toFraming.vertical,
        timeProgress,
      ),
    };
    let portraitHorizontal = THREE.MathUtils.lerp(
      fromFraming.portraitHorizontal ?? 0,
      toFraming.portraitHorizontal ?? 0,
      timeProgress,
    );
    let portraitVertical = THREE.MathUtils.lerp(
      fromFraming.portraitVertical ?? fromFraming.vertical,
      toFraming.portraitVertical ?? toFraming.vertical,
      timeProgress,
    );
    if (this.parent) {
      portraitVertical = THREE.MathUtils.lerp(portraitVertical, 0.42, overview);
      const acquisitionShift = THREE.MathUtils.clamp(
        destination.look.distanceTo(destination.bodies.get(this.parent)!) /
          this.peakDistance -
          1,
        0,
        1,
      );
      portraitHorizontal = THREE.MathUtils.lerp(
        portraitHorizontal,
        0.4 * (1 - acquisitionShift * easeFlight((t - 0.55) / 0.15)),
        overview,
      );
    }
    if (this.resizeCorrection) {
      const correction = this.resizeCorrection;
      const remaining =
        1 -
        easeFlight(
          (t - correction.progress) / Math.max(1 - correction.progress, 1e-10),
        );
      position.addScaledVector(correction.position, remaining);
      look.addScaledVector(correction.look, remaining);
      framing.horizontal += correction.framing.horizontal * remaining;
      framing.vertical += correction.framing.vertical * remaining;
      portraitHorizontal +=
        (correction.framing.portraitHorizontal ?? 0) * remaining;
      portraitVertical +=
        (correction.framing.portraitVertical ?? 0) * remaining;
    }
    if (portraitHorizontal !== 0)
      framing.portraitHorizontal = portraitHorizontal;
    if (portraitVertical !== framing.vertical)
      framing.portraitVertical = portraitVertical;
    return {
      position,
      look,
      bodies,
      radiiKm:
        t === 0 || t === 1
          ? { ...endpoint.radiiKm }
          : Object.fromEntries(
              Object.keys({ ...this.from.radiiKm, ...destination.radiiKm }).map(
                (key) => {
                  const id = key as BodyId;
                  let a = this.from.radiiKm[id] ?? destination.radiiKm[id]!,
                    b = destination.radiiKm[id] ?? a;
                  if (!this.data) {
                    if (!this.from.bodies.has(id)) a = 0;
                    if (!destination.bodies.has(id)) b = 0;
                  }
                  return [id, THREE.MathUtils.lerp(a, b, timeProgress)];
                },
              ),
            ),
      poles: endpoint.poles,
      atlasBlend: THREE.MathUtils.lerp(
        this.from.atlasBlend ?? 0,
        destination.atlasBlend ?? 0,
        timeProgress,
      ),
      atlasParticles:
        (this.from.atlasParticles ?? (this.from.atlasBlend === 1 ? 1 : 0)) *
          (1 - easeFlight(t / 0.3)) +
        (destination.atlasParticles ?? (destination.atlasBlend === 1 ? 1 : 0)) *
          easeFlight((t - 0.7) / 0.3),
      focus: endpoint.focus,
      et,
      utc: new Date(
        THREE.MathUtils.lerp(
          Date.parse(this.from.utc),
          Date.parse(destination.utc),
          timeProgress,
        ),
      ).toISOString(),
      phase,
      phaseProgress,
      progress: t,
      overview,
      done: t === 1,
      fovOffset: THREE.MathUtils.lerp(
        outward ? (this.from.fovOffset ?? 0) : widestLens,
        outward ? widestLens : (destination.fovOffset ?? 0),
        u,
      ),
      bank: THREE.MathUtils.lerp(
        this.from.bank ?? 0,
        destination.bank ?? 0,
        easeFlight(t),
      ),
      framing,
    };
  }
}
