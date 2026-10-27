import * as THREE from 'three';
import { type BodyId, type Milestone } from './solar-data';
import {
  KM_PER_UNIT,
  sampleState,
  missionTime,
  type EphemerisBundle,
} from './ephemeris';
import { createSpacecraft } from './spacecraft';
import { createRouteCoverage } from './route-coverage';
import { PathPresentation } from './path-presentation';
import {
  MissionPlayback,
  discoveryCamera,
  tableauCamera,
  outroCamera,
  type DiscoveryBeat,
} from './mission-cinematography';

export type MissionPhase = 'departure' | 'cruise' | 'encounter' | 'discovery';
export const missionPhase = (progress: number): MissionPhase =>
  progress >= 1
    ? 'discovery'
    : progress < 0.16
      ? 'departure'
      : progress < 0.76
        ? 'cruise'
        : 'encounter';

export interface MissionFrame {
  position: THREE.Vector3;
  look: THREE.Vector3;
  progress: number;
  phase: MissionPhase;
  utc: string;
  et: number;
  focus: BodyId;
  rangeKm?: number;
  relativeSpeedKmS?: number;
  discovery?: DiscoveryBeat;
  chapterComplete: boolean;
  closingProgress: number;
}
const vector = (state: number[], offset = 1) =>
  new THREE.Vector3(
    state[offset],
    state[offset + 2],
    -state[offset + 1],
  ).divideScalar(KM_PER_UNIT);

/** Positions are ephemerides; only the camera and playback rate are editorial.
 * Rendering rebases on the spacecraft in double precision before GPU conversion.
 * The path is drawn in the named body's translating frame, using its position
 * at EACH historical sample, so a moving planet cannot fake a gravity assist.
 */
export class MissionFlight {
  readonly group = new THREE.Group();
  readonly craft: THREE.Group;
  readonly bodyPositions = new Map<BodyId, THREE.Vector3>();
  readonly origin = new THREE.Vector3();
  readonly planned: THREE.Line;
  readonly trail: THREE.Line;
  readonly trailHead: THREE.Line;
  readonly presentation = new PathPresentation();
  private readonly playback: MissionPlayback;
  private pathFocus?: BodyId;
  private pathTimes: number[] = [];
  private routeCoverage = (_epoch: number) => 0;
  private readonly duration: number;
  private readonly cameraDirections = new Map<BodyId, THREE.Vector3>();

  constructor(
    readonly milestone: Milestone,
    readonly data: EphemerisBundle,
    model?: THREE.Group,
    private readonly options: { terminal?: boolean } = {},
  ) {
    this.duration = milestone.journey.seconds;
    this.playback = new MissionPlayback(
      this.duration,
      data.events,
      {
        body: milestone.body === 'belt' ? 'sun' : milestone.body,
        label: milestone.journey.eventLabel,
        subject: milestone.body === 'belt' ? 'probe' : 'world',
      },
      !data.tracks.craft,
    );
    this.craft =
      model ??
      createSpacecraft(
        milestone.journey.craft,
        /MARINER/.test(milestone.mission),
        milestone.mission,
      );
    this.craft.visible = !!data.tracks.craft;
    this.group.add(this.craft);
    this.planned = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: '#8bbebf',
        vertexColors: true,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    this.trail = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: '#a9efdb',
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.trailHead = new THREE.LineSegments(
      new THREE.BufferGeometry()
        .setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(6), 3),
        )
        .setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(8), 4),
        ),
      new THREE.LineBasicMaterial({
        color: '#a9efdb',
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.trailHead.frustumCulled = false;
    for (const line of [this.planned, this.trail, this.trailHead])
      this.presentation.attach(line.material as THREE.LineBasicMaterial);
    this.group.add(this.planned, this.trail, this.trailHead);
    this.group.add(new THREE.HemisphereLight(0xd9eaff, 0x343c53, 2.3));
  }

  private makePath(focus: BodyId) {
    if (focus === this.pathFocus || !this.data.tracks.craft) return;
    this.pathFocus = focus;
    const craftTrack = this.data.tracks.craft;
    const bodyTrack = this.data.tracks[focus]!;
    // Include both native adaptive samples and regular playback samples. The
    // rendered polyline never replaces the underlying position/velocity sampler.
    const times = [
      ...new Set([
        ...craftTrack.map((row) => row[0]),
        ...Array.from(
          { length: 721 },
          (_, i) => missionTime(this.data, i / 720).et,
        ),
      ]),
    ].sort((a, b) => a - b);
    const seams = [
      ...(this.data.seams?.craft ?? []),
      ...(this.data.seams?.[focus] ?? []),
    ];
    this.routeCoverage = createRouteCoverage(
      this.data.start,
      this.data.end,
      seams,
    );
    const points: THREE.Vector3[] = [];
    this.pathTimes = [];
    for (let i = 1; i < times.length; i++) {
      const a = times[i - 1],
        b = times[i];
      if (seams.some((seam) => a < seam.end && b > seam.start)) continue;
      for (const t of [a, b]) {
        points.push(
          vector(sampleState(craftTrack, t)).sub(
            vector(sampleState(bodyTrack, t)),
          ),
        );
        this.pathTimes.push(t);
      }
    }
    this.planned.geometry.dispose();
    this.trail.geometry.dispose();
    this.planned.geometry = new THREE.BufferGeometry().setFromPoints(points);
    // Fade the recorded window's boundaries. This is not an extension of the
    // route: every vertex still comes from a covered spacecraft state.
    const colors = this.pathTimes.flatMap((t) => {
      return [1, 1, 1, this.routeCoverage(t)];
    });
    this.planned.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 4),
    );
    this.trail.geometry = this.planned.geometry.clone();
  }

  private directionFor(body: BodyId) {
    const cached = this.cameraDirections.get(body);
    if (cached) return cached.clone();
    const epoch =
      this.data.events.find((event) => event.body === body)?.et ??
      this.data.start;
    const center = vector(sampleState(this.data.tracks[body]!, epoch));
    const light = vector(sampleState(this.data.tracks.sun!, epoch))
      .sub(center)
      .normalize();
    if (light.lengthSq() < 0.1) light.set(0.7, 0.2, 0.6).normalize();
    const craft = this.data.tracks.craft;
    const normal = new THREE.Vector3(0, 1, 0);
    if (craft) {
      const state = sampleState(craft, epoch);
      const relative = vector(state).sub(center);
      const velocity = vector(state, 4).sub(
        vector(sampleState(this.data.tracks[body]!, epoch), 4),
      );
      normal.crossVectors(relative, velocity).normalize();
      if (normal.lengthSq() < 0.1) normal.set(0, 1, 0);
      if (normal.y < 0) normal.negate();
    }
    const direction = normal
      .multiplyScalar(0.85)
      .addScaledVector(light, 0.7)
      .normalize();
    if (['jupiter', 'saturn', 'uranus', 'neptune'].includes(body)) {
      const pole = this.poleFor(body);
      const latitude = direction.dot(pole);
      const equatorial = direction.clone().addScaledVector(pole, -latitude);
      if (equatorial.lengthSq() > 1e-8) {
        // See cloud bands across the disk and rings as an ellipse, using the
        // real pole. The body's orientation is never tilted for the camera.
        const opening = Math.sin(
          THREE.MathUtils.degToRad(body === 'saturn' ? 24 : 30),
        );
        // Saturn's dense rings obscure their structure from the unlit side.
        // Choose the Sun-facing hemisphere for this editorial camera, keeping
        // the actual pole and every body/spacecraft position unchanged.
        const hemisphere =
          body === 'saturn'
            ? Math.sign(light.dot(pole) || latitude || 1)
            : Math.sign(latitude || 1);
        const height = hemisphere * Math.min(Math.abs(latitude), opening);
        direction
          .copy(equatorial.normalize())
          .multiplyScalar(Math.sqrt(1 - height * height))
          .addScaledVector(pole, height);
      }
    }
    this.cameraDirections.set(body, direction);
    return direction.clone();
  }

  private poleFor(body: BodyId) {
    const pole = this.data.poles?.[body];
    return pole
      ? new THREE.Vector3(pole[0], pole[2], -pole[1]).normalize()
      : new THREE.Vector3(0, 1, 0);
  }

  update(
    delta: number,
    paused: boolean,
    reduced: boolean,
    mobile: boolean,
  ): MissionFrame {
    this.playback.advance(delta, paused, reduced);
    const progress = this.playback.progress;
    const discovery = this.playback.beat;
    const { et, utc } = missionTime(this.data, progress);
    const states = new Map<BodyId | 'craft', number[]>();
    for (const [id, track] of Object.entries(this.data.tracks))
      states.set(
        id as BodyId | 'craft',
        sampleState(track!, et, this.data.seams?.[id as BodyId | 'craft']),
      );
    const craftState = states.get('craft');
    let focus =
      this.data.events.length > 1 && progress < 0.5
        ? this.data.events[0].body
        : (this.data.events.at(-1)?.body ??
          (this.milestone.body === 'belt' ? 'sun' : this.milestone.body));
    if (!states.has(focus)) focus = 'sun';
    const target = vector(states.get(focus)!);
    this.origin.copy(craftState ? vector(craftState) : target);
    for (const [id, state] of states)
      if (id !== 'craft')
        this.bodyPositions.set(id, vector(state).sub(this.origin));
    const center = this.bodyPositions.get(focus)!;
    const radius = (this.data.radiiKm[focus] ?? 1) / KM_PER_UNIT;
    const range = center.length();
    const sun = this.bodyPositions.get('sun')!;
    const cameraCenter = center.clone();
    let cameraRadius = radius;
    const cameraSide = this.directionFor(focus);
    if (this.data.events.length > 1) {
      const first = this.data.events[0].body;
      const last = this.data.events.at(-1)!.body;
      const blend = THREE.MathUtils.smoothstep(progress, 0.4, 0.6);
      cameraCenter.lerpVectors(
        this.bodyPositions.get(first)!,
        this.bodyPositions.get(last)!,
        blend,
      );
      cameraRadius =
        THREE.MathUtils.lerp(
          this.data.radiiKm[first]!,
          this.data.radiiKm[last]!,
          blend,
        ) / KM_PER_UNIT;
      const firstDirection = this.directionFor(first);
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        firstDirection,
        this.directionFor(last),
      );
      cameraSide
        .copy(firstDirection)
        .applyQuaternion(new THREE.Quaternion().slerp(rotation, blend));
    }
    const velocity = craftState
      ? vector(craftState, 4).sub(vector(states.get(focus)!, 4))
      : new THREE.Vector3(0, 0, 1);
    const tangent = velocity.clone().normalize();
    // An observer off the trajectory plane sees the incoming and outgoing bend.
    // Keep both the true-size world and enlarged spacecraft within the frame.
    const look = craftState
      ? cameraCenter.clone().multiplyScalar(0.46)
      : cameraCenter.clone();
    const extent = Math.max(
      cameraRadius * (focus === 'saturn' ? 9.5 : 4.8),
      cameraCenter.length() * 2.7,
    );
    const distance = extent * (mobile ? 1.65 : 1);
    const position = look.clone().addScaledVector(cameraSide, distance);
    if (position.distanceTo(center) < radius * 1.2)
      position.copy(center).addScaledVector(cameraSide, radius * 1.3);
    this.craft.position.set(0, 0, 0);
    this.craft.scale.setScalar(Math.max(1e-8, position.length() * 0.022));
    if (!craftState) {
      tableauCamera(
        position,
        look,
        center,
        sun,
        radius,
        focus,
        this.playback.tableauProgress,
        mobile,
        this.poleFor(focus),
      );
    } else if (discovery) {
      const discoveryCenter =
        discovery.subject === 'probe'
          ? new THREE.Vector3()
          : this.bodyPositions.get(discovery.body)!;
      discoveryCamera(
        position,
        look,
        discoveryCenter,
        sun,
        discovery.subject === 'probe'
          ? this.craft.scale.x * 1.8
          : (this.data.radiiKm[discovery.body] ?? 1) / KM_PER_UNIT,
        discovery,
        mobile,
        this.poleFor(discovery.body),
      );
      if (discovery.subject !== 'probe')
        this.craft.scale.multiplyScalar(1 - discovery.amount * 0.75);
    }
    if (this.options.terminal && craftState && this.data.radiiKm.sun)
      outroCamera(
        position,
        look,
        sun,
        this.data.radiiKm.sun / KM_PER_UNIT,
        this.playback.outroProgress,
        mobile,
      );
    const direction =
      this.milestone.journey.craft === 'solar-probe'
        ? sun.clone().normalize()
        : tangent;
    this.craft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      direction,
    );
    this.makePath(focus);
    const pathPresence = 1 - (discovery?.amount ?? 0) * 0.88;
    (this.planned.material as THREE.LineBasicMaterial).opacity =
      0.12 * pathPresence;
    (this.trail.material as THREE.LineBasicMaterial).opacity =
      0.5 * pathPresence;
    this.planned.position.copy(center);
    this.trail.position.copy(center);
    const count = this.pathTimes.findIndex((t) => t > et);
    this.trail.geometry.setDrawRange(
      0,
      count < 0 ? this.pathTimes.length : count - (count % 2),
    );
    // Finish the current segment at the exact live state, rather than leaving
    // the probe floating beyond the last whole imported line segment.
    const segment = count > 0 && count % 2 === 1 ? count - 1 : -1;
    this.trailHead.geometry.setDrawRange(0, segment >= 0 ? 2 : 0);
    if (segment >= 0 && craftState) {
      const positions = this.trail.geometry.getAttribute('position');
      const head = this.trailHead.geometry.getAttribute('position');
      head.setXYZ(
        0,
        positions.getX(segment) + center.x,
        positions.getY(segment) + center.y,
        positions.getZ(segment) + center.z,
      );
      head.setXYZ(1, 0, 0, 0);
      head.needsUpdate = true;
      const colors = this.trailHead.geometry.getAttribute('color');
      colors.setXYZW(0, 1, 1, 1, this.routeCoverage(this.pathTimes[segment]));
      colors.setXYZW(1, 1, 1, 1, this.routeCoverage(et));
      colors.needsUpdate = true;
      this.trailHead.position.set(0, 0, 0);
      (this.trailHead.material as THREE.LineBasicMaterial).opacity =
        0.5 * pathPresence;
    }
    return {
      position,
      look,
      progress,
      phase: missionPhase(progress),
      utc,
      et,
      focus,
      rangeKm: craftState ? range * KM_PER_UNIT : undefined,
      relativeSpeedKmS: craftState
        ? velocity.length() * KM_PER_UNIT
        : undefined,
      discovery,
      chapterComplete: this.playback.complete,
      closingProgress: this.playback.closingProgress,
    };
  }
  showPath(presence: number) {
    this.presentation.setPresence(presence);
    const visible = presence > 0.001 && this.craft.visible;
    this.planned.visible = visible;
    this.trail.visible = visible;
    this.trailHead.visible = visible;
  }
  seek(progress: number) {
    this.playback.seek(progress);
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.group.removeFromParent();
  }
}
