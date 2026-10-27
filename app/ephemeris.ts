import definitions from '../scripts/ephemeris-missions.json';
import type { BodyId } from './solar-data';

export type EphemerisQuality = 'reconstructed' | 'archival' | 'unavailable';
export type StateVector = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface Encounter {
  body: BodyId;
  label: string;
  et: number;
  utc: string;
  progress: number;
  rangeKm: number;
  closest: boolean;
  source?: string;
}
export interface EphemerisSeam {
  start: number;
  end: number;
  jumpKm: number;
  note: string;
}
export interface EphemerisBundle {
  version: 1;
  id: string;
  frame: 'ECLIPJ2000';
  center: 'SOLAR SYSTEM BARYCENTER';
  timeScale: 'TDB';
  units: 'km, km/s';
  start: number;
  end: number;
  radiiKm: Partial<Record<BodyId, number>>;
  clock: { progress: number; et: number; utc: string }[];
  tracks: Partial<Record<BodyId | 'craft', StateVector[]>>;
  events: Encounter[];
  seams?: Partial<Record<BodyId | 'craft', EphemerisSeam[]>>;
  poles?: Partial<Record<BodyId, number[]>>;
}
export const missionRecords = definitions.map((record) => ({
  ...record,
  quality: record.quality as EphemerisQuality,
  focus: record.focus as BodyId,
}));
export const KM_PER_UNIT = 1_000_000;

/** Hermite interpolation preserves sampled positions AND velocities. No orbit fitting. */
export function sampleState(
  track: StateVector[],
  et: number,
  seams: EphemerisSeam[] = [],
): StateVector {
  if (seams.some((seam) => et > seam.start && et < seam.end))
    throw new RangeError('Source orbit boundary: interpolation is withheld');
  if (
    !track.length ||
    et < track[0][0] - 1e-4 ||
    et > track[track.length - 1][0] + 1e-4
  )
    throw new RangeError('Requested time is outside this ephemeris');
  if (track.length === 1) return [...track[0]];
  let lo = 0,
    hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (track[mid][0] <= et) lo = mid;
    else hi = mid;
  }
  const a = track[lo],
    b = track[hi],
    h = b[0] - a[0];
  const u = Math.max(0, Math.min(1, (et - a[0]) / h));
  const out: StateVector = [et, 0, 0, 0, 0, 0, 0];
  for (let i = 1; i <= 3; i++) {
    out[i] =
      (2 * u ** 3 - 3 * u * u + 1) * a[i] +
      (u ** 3 - 2 * u * u + u) * h * a[i + 3] +
      (-2 * u ** 3 + 3 * u * u) * b[i] +
      (u ** 3 - u * u) * h * b[i + 3];
    out[i + 3] =
      ((6 * u * u - 6 * u) * a[i]) / h +
      (3 * u * u - 4 * u + 1) * a[i + 3] +
      ((-6 * u * u + 6 * u) * b[i]) / h +
      (3 * u * u - 2 * u) * b[i + 3];
  }
  return out;
}

/** One TDB instant drives the spacecraft and every natural body, including when seeking. */
export function missionTime(data: EphemerisBundle, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const clock = data.clock;
  const right = clock.findIndex((anchor) => anchor.progress >= p);
  const b = clock[right < 0 ? clock.length - 1 : right];
  const a = clock[Math.max(0, right - 1)];
  const u =
    b.progress === a.progress
      ? 0
      : (p - a.progress) / (b.progress - a.progress);
  // The historical clock is editorial. A monotone Hermite clock keeps the
  // published anchors exact while removing speed steps between them. Come to
  // rest at an encounter before its camera interlude, then leave gently.
  const slope = (index: number) => {
    if (
      index <= 0 ||
      index >= clock.length - 1 ||
      data.events.some(
        (event) => Math.abs(event.progress - clock[index].progress) < 1e-8,
      )
    )
      return 0;
    const previous = clock[index - 1],
      current = clock[index],
      next = clock[index + 1];
    const h0 = current.progress - previous.progress,
      h1 = next.progress - current.progress;
    const d0 = (current.et - previous.et) / h0,
      d1 = (next.et - current.et) / h1;
    if (d0 <= 0 || d1 <= 0) return 0;
    const w0 = 2 * h1 + h0,
      w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
  };
  const span = b.progress - a.progress;
  let et =
    a.et +
    (b.et - a.et) * (3 * u * u - 2 * u * u * u) +
    span *
      (slope(right - 1) * (u ** 3 - 2 * u * u + u) +
        slope(right) * (u ** 3 - u * u));
  for (const seams of Object.values(data.seams ?? {}))
    for (const seam of seams ?? [])
      if (et > seam.start && et < seam.end) et = seam.end;
  const utcFraction = b.et === a.et ? 0 : (et - a.et) / (b.et - a.et);
  // UTC is displayed to the minute. Interpolating UTC anchors introduces <1 s
  // across this catalogue's leap seconds; geometry always uses continuous TDB.
  const utc = new Date(
    Date.parse(a.utc) + (Date.parse(b.utc) - Date.parse(a.utc)) * utcFraction,
  ).toISOString();
  return { et, utc };
}

export function validateEphemeris(value: unknown): EphemerisBundle {
  const data = value as EphemerisBundle;
  if (
    data?.version !== 1 ||
    data.frame !== 'ECLIPJ2000' ||
    data.timeScale !== 'TDB' ||
    data.center !== 'SOLAR SYSTEM BARYCENTER' ||
    data.units !== 'km, km/s' ||
    !Number.isFinite(data.start) ||
    !Number.isFinite(data.end) ||
    data.end < data.start ||
    !data.tracks?.sun ||
    !Array.isArray(data.events) ||
    !data.clock?.length
  )
    throw new Error('Unsupported ephemeris');
  if (
    data.clock[0].progress !== 0 ||
    data.clock.at(-1)!.progress !== 1 ||
    Math.abs(data.clock[0].et - data.start) > 1e-4 ||
    Math.abs(data.clock.at(-1)!.et - data.end) > 1e-4
  )
    throw new Error('Incomplete historical clock');
  for (let i = 0; i < data.clock.length; i++) {
    const anchor = data.clock[i];
    if (
      !Number.isFinite(anchor.et) ||
      !Number.isFinite(anchor.progress) ||
      !Number.isFinite(Date.parse(anchor.utc)) ||
      (i > 0 &&
        (anchor.progress <= data.clock[i - 1].progress ||
          anchor.et < data.clock[i - 1].et))
    )
      throw new Error('Invalid historical clock');
  }
  for (const event of data.events ?? [])
    if (
      !data.tracks[event.body] ||
      event.et < data.start ||
      event.et > data.end ||
      !Number.isFinite(event.progress) ||
      event.progress < 0 ||
      event.progress > 1
    )
      throw new Error('Encounter outside trajectory coverage');
  for (const [id, seams] of Object.entries(data.seams ?? {}))
    for (const seam of seams ?? [])
      if (
        !data.tracks[id as BodyId | 'craft'] ||
        !Number.isFinite(seam.start) ||
        !Number.isFinite(seam.end) ||
        seam.end <= seam.start ||
        seam.start < data.start ||
        seam.end > data.end
      )
        throw new Error('Invalid source boundary');
  for (const track of Object.values(data.tracks)) {
    if (!track?.length) throw new Error('Empty ephemeris');
    for (let i = 0; i < track.length; i++)
      if (
        track[i].length !== 7 ||
        !track[i].every(Number.isFinite) ||
        (i > 0 && track[i][0] <= track[i - 1][0])
      )
        throw new Error('Invalid state vector');
    if (
      track[0][0] > data.start + 1e-4 ||
      track[track.length - 1][0] < data.end - 1e-4
    )
      throw new Error('Incomplete ephemeris coverage');
  }
  return data;
}
const cache = new Map<string, Promise<EphemerisBundle>>();
export function loadEphemeris(index: number) {
  const id = missionRecords[index].id;
  let pending = cache.get(id);
  if (!pending) {
    pending = fetch(`/ephemeris/${id}.json`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error('The trajectory record could not be loaded.');
        const data = validateEphemeris(await response.json());
        if (data.id !== id) throw new Error('Mismatched trajectory identity');
        return data;
      })
      .catch((error) => {
        cache.delete(id);
        throw error;
      });
    cache.set(id, pending);
  }
  return pending;
}
