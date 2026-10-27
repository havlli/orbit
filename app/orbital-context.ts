import * as THREE from 'three';
import { KM_PER_UNIT, sampleState, type EphemerisBundle } from './ephemeris';
import type { BodyId } from './solar-data';

export const contextBodies: BodyId[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
];
const orbitalDays = [0, 88, 225, 365.25, 687, 4333, 10759, 30687, 60190, 90560];

/** Same dated context curves, with shared endpoints sampled only once.
 * Cache coverage-clamped windows in double precision; rebase before Float32.
 * The Sun is a current-position marker, not a zero-length orbital line. */
export class OrbitalContext {
  readonly segments = 160;
  readonly positions = new Float32Array(
    (contextBodies.length - 1) * this.segments * 6,
  );
  private data?: EphemerisBundle;
  private windows = new Map<BodyId, { start: number; points: Float64Array }>();

  update(data: EphemerisBundle, et: number, origin: THREE.Vector3) {
    if (this.data !== data) {
      this.windows.clear();
      this.data = data;
    }
    let samples = 0;
    for (let i = 1; i < contextBodies.length; i++) {
      const id = contextBodies[i];
      const span = Math.min(orbitalDays[i] * 86400, data.end - data.start);
      const start = THREE.MathUtils.clamp(
        et - span / 2,
        data.start,
        data.end - span,
      );
      let window = this.windows.get(id);
      if (!window || window.start !== start) {
        const points =
          window?.points ?? new Float64Array((this.segments + 1) * 3);
        for (let j = 0; j <= this.segments; j++) {
          const row = sampleState(
            data.tracks[id]!,
            start + (span * j) / this.segments,
          );
          points[j * 3] = row[1] / KM_PER_UNIT;
          points[j * 3 + 1] = row[3] / KM_PER_UNIT;
          points[j * 3 + 2] = -row[2] / KM_PER_UNIT;
          samples++;
        }
        window = { start, points };
        this.windows.set(id, window);
      }
      for (let j = 0; j < this.segments; j++) {
        const offset = ((i - 1) * this.segments + j) * 6;
        for (let end = 0; end < 2; end++) {
          const source = (j + end) * 3;
          this.positions[offset + end * 3] = window.points[source] - origin.x;
          this.positions[offset + end * 3 + 1] =
            window.points[source + 1] - origin.y;
          this.positions[offset + end * 3 + 2] =
            window.points[source + 2] - origin.z;
        }
      }
    }
    return samples;
  }
}
