import { MathUtils } from 'three';
import type { EphemerisSeam } from './ephemeris';

/** Feather only the covered side of a source boundary. The same epoch-based
 * envelope is used by stored vertices and the live segment ending at the probe. */
export function createRouteCoverage(
  start: number,
  end: number,
  seams: Pick<EphemerisSeam, 'start' | 'end'>[],
) {
  const spans: { start: number; end: number }[] = [];
  let cursor = start;
  for (const seam of [...seams].sort((a, b) => a.start - b.start)) {
    const before = Math.max(start, Math.min(end, seam.start));
    if (before > cursor) spans.push({ start: cursor, end: before });
    cursor = Math.max(cursor, Math.min(end, seam.end));
  }
  if (cursor < end) spans.push({ start: cursor, end });
  return (epoch: number) => {
    const span = spans.find((part) => epoch >= part.start && epoch <= part.end);
    if (!span) return 0;
    const width = Math.max(1e-6, (span.end - span.start) * 0.035);
    return (
      MathUtils.smoothstep(epoch, span.start, span.start + width) *
      (1 - MathUtils.smoothstep(epoch, span.end - width, span.end))
    );
  };
}
