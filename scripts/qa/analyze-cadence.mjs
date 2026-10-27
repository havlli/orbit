import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const rounded = (value) => (finite(value) ? Number(value.toFixed(3)) : null);
const names = [
  'requests',
  'deliveries',
  'cancels',
  'heartbeats',
  'events',
  'statuses',
  'tasks',
  'callbacks',
];
const ordered = (rows, key) =>
  rows.every((row, index) => !index || row[key] >= rows[index - 1][key]);
function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b),
    n = sorted.length;
  return {
    count: n,
    median: n
      ? rounded(
          (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) /
            2,
        )
      : null,
    p95: n ? rounded(sorted[Math.ceil(n * 0.95) - 1]) : null,
    max: n ? rounded(sorted.at(-1)) : null,
  };
}

/** Analyze saved observations without contacting a browser or changing the input. */
export function analyzeProbe(data, { windowMs, thresholdMs = 50 } = {}) {
  if (
    !finite(data.started) ||
    !finite(data.stop) ||
    data.stop <= data.started ||
    !finite(thresholdMs) ||
    thresholdMs <= 0
  )
    throw new TypeError('Invalid capture bounds or threshold.');
  const rings = Object.fromEntries(
    names.map((name) => {
      const ring = data[name];
      if (
        !ring ||
        !Array.isArray(ring.values) ||
        !Number.isInteger(ring.total) ||
        !Number.isInteger(ring.dropped)
      )
        throw new TypeError(`Invalid ${name} ring.`);
      return [name, ring];
    }),
  );
  const restored = data.restored?.perf;
  if (
    restored !== undefined &&
    (!finite(restored) || restored < data.started || restored > data.stop)
  )
    throw new TypeError('Invalid restoration cutoff.');
  const observedStop = restored ?? data.stop;
  const raw = Object.fromEntries(
    names.map((name) => [name, rings[name].values]),
  );
  if (
    raw.requests.some(
      (r) => ![r.id, r.callbackId, r.requested].every(finite),
    ) ||
    raw.deliveries.some(
      (d) =>
        ![
          d.id,
          d.requestId,
          d.callbackId,
          d.requested,
          d.arrived,
          d.timestamp,
          d.callbackStart,
          d.callbackEnd,
          d.wall,
          d.wait,
        ].every(finite),
    ) ||
    raw.cancels.some((c) => !finite(c.called)) ||
    raw.heartbeats.some((h) => ![h.perf, h.deltaPerf].every(finite)) ||
    raw.events.some((e) => !finite(e.perf)) ||
    raw.statuses.some((s) => !finite(s.perf)) ||
    raw.tasks.some((t) => ![t.start, t.duration].every(finite))
  )
    throw new TypeError('Invalid record clock.');
  const activation = raw.events.find(
    (e) =>
      e.type === 'click' && e.perf >= data.started && e.perf <= observedStop,
  );
  const begin = activation?.perf ?? data.started;
  const requestedMs = windowMs ?? observedStop - begin;
  if (!finite(requestedMs) || requestedMs <= 0)
    throw new TypeError('Invalid observation window.');
  const end = Math.min(begin + requestedMs, observedStop);
  const relative = (time) => rounded(time - begin);
  const requests = raw.requests.filter((r) => r.requested <= observedStop);
  const deliveries = raw.deliveries.filter(
    (d) => d.callbackEnd <= observedStop,
  );
  const cancels = raw.cancels.filter((c) => c.called <= observedStop);
  const requestById = new Map(requests.map((r) => [r.id, r]));
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]));
  const delivered = new Map(deliveries.map((d) => [d.requestId, d]));
  const cancelled = new Map(
    cancels.filter((c) => c.requestId !== null).map((c) => [c.requestId, c]),
  );
  const unresolved = (time) =>
    requests.filter(
      (r) =>
        r.requested <= time &&
        !(delivered.get(r.id)?.arrived <= time) &&
        !(cancelled.get(r.id)?.called <= time),
    );
  const pendingAtStop = unresolved(observedStop),
    pendingAtEnd = unresolved(end);
  const native = (key) =>
    data.originals?.[key]?.nativeCodeMarker === true &&
    /\[native code\]/.test(data.originals[key].source ?? '');
  const integrity = {
    completeRings: names.every(
      (name) =>
        rings[name].dropped === 0 && rings[name].total === raw[name].length,
    ),
    noBookkeepingErrors: data.totals?.bookkeepingErrors === 0,
    nativeRequest: native('request'),
    nativeCancel: native('cancel'),
    nativeTimer: native('timeout'),
    totals: ['requests', 'deliveries', 'cancels', 'heartbeats'].every(
      (name) => data.totals?.[name] === rings[name].total,
    ),
    monotonic:
      ordered(raw.requests, 'requested') &&
      ordered(raw.deliveries, 'arrived') &&
      ordered(raw.heartbeats, 'perf'),
    uniqueIds:
      requestById.size === requests.length &&
      deliveryById.size === deliveries.length &&
      delivered.size === deliveries.length,
    linkage:
      deliveries.every((d) => {
        const r = requestById.get(d.requestId);
        return (
          r &&
          r.handle === d.handle &&
          r.callbackId === d.callbackId &&
          Math.abs(r.requested - d.requested) < 0.001 &&
          Math.abs(d.wait - (d.arrived - r.requested)) < 0.001
        );
      }) &&
      requests.every(
        (r) =>
          r.parentDeliveryId === null || deliveryById.has(r.parentDeliveryId),
      ) &&
      [...cancelled.keys()].every(
        (id) => requestById.has(id) && !delivered.has(id),
      ),
    clocks:
      deliveries.every(
        (d) =>
          d.requested <= d.arrived &&
          d.arrived <= d.callbackStart &&
          d.callbackStart <= d.callbackEnd &&
          d.wall >= 0 &&
          Math.abs(d.wall - (d.callbackEnd - d.callbackStart)) < 0.001,
      ) && raw.tasks.every((t) => t.duration >= 0),
    pending:
      data.pendingOmitted === 0 &&
      pendingAtStop.length ===
        (restored !== undefined ? data.restored.pending : data.pendingCount) &&
      (restored !== undefined ||
        (data.pending?.length === pendingAtStop.length &&
          data.pending.every((r) => pendingAtStop.some((p) => p.id === r.id)))),
    longTaskObserver: data.observerTargets?.longTasks === true,
    restoreOwnership:
      restored === undefined ||
      (data.restored.requestOwned === true &&
        data.restored.cancelOwned === true),
  };
  const heartbeat = raw.heartbeats.filter(
    (h) => h.perf >= begin && h.perf <= end,
  );
  const events = raw.events.filter((e) => e.perf >= begin && e.perf <= end);
  const tasks = raw.tasks.filter(
    (t) => t.start < end && t.start + t.duration >= begin,
  );
  const states = [data.initial, ...heartbeat, ...events].filter(
    (s) => s?.perf >= data.started && s.perf <= end,
  );
  const statuses = raw.statuses.filter((s) => s.perf >= begin && s.perf <= end);
  const transit = statuses.find((s) => /^In transit\b/.test(s.text ?? ''));
  const arrival =
    transit &&
    statuses.find(
      (s) => s.perf > transit.perf && /^In orbit\b/.test(s.text ?? ''),
    );
  function gap(previous, next, key) {
    const from = previous[key],
      to = next[key],
      request = requestById.get(next.requestId);
    return {
      from: relative(from),
      to: relative(to),
      duration: rounded(to - from),
      requestId: next.requestId,
      wait: rounded(next.wait),
      previousWall: rounded(previous.wall),
      nextWall: rounded(next.wall),
      successorFromPrevious: request?.parentDeliveryId === previous.id,
      classification:
        request?.requested > previous.callbackEnd
          ? 'later-request'
          : next.wait >= thresholdMs
            ? 'queued-delay'
            : 'callback-or-other-interval',
      crossesActivation: from < begin,
      crossesEnd: to > end,
      taskOverlap: tasks.filter(
        (t) => t.start < to && t.start + t.duration > from,
      ).length,
      timerIntervals: heartbeat
        .filter((h) => h.perf >= from && h.perf <= to)
        .map((h) => rounded(h.deltaPerf)),
    };
  }
  const callbacks = [...new Set(requests.map((r) => r.callbackId))]
    .map((id) => {
      const own = deliveries.filter((d) => d.callbackId === id),
        ownRequests = requests.filter((r) => r.callbackId === id);
      const within = own.filter((d) => d.arrived >= begin && d.arrived < end);
      const gaps = (key) =>
        own
          .slice(1)
          .map((next, index) => [own[index], next])
          .filter(
            ([previous, next]) => previous[key] < end && next[key] >= begin,
          )
          .map(([a, b]) => gap(a, b, key));
      const actual = gaps('arrived'),
        timestamps = gaps('timestamp'),
        last = own.filter((d) => d.arrived < end).at(-1);
      const pending = pendingAtEnd.filter((r) => r.callbackId === id);
      const successor =
        last && ownRequests.find((r) => r.parentDeliveryId === last.id);
      const age = last ? Math.max(0, end - last.callbackEnd) : null;
      const tail = pending.length
        ? pending.some((r) => end - r.requested >= thresholdMs)
          ? 'long-pending'
          : 'recent-pending'
        : successor && cancelled.get(successor.id)?.called <= end
          ? 'cancelled-successor'
          : last
            ? 'missing-successor'
            : 'no-delivery';
      return {
        id,
        name: ownRequests[0]?.callbackName,
        requests: ownRequests.length,
        deliveries: own.length,
        inWindow: within.length,
        cancels: cancels.filter((c) => c.callbackId === id).length,
        actualArrivalGap: stats(actual.map((g) => g.duration)),
        timestampGap: stats(timestamps.map((g) => g.duration)),
        requestWait: stats(within.map((d) => d.wait)),
        callbackWall: stats(within.map((d) => d.wall)),
        actualGaps: actual.filter((g) => g.duration >= thresholdMs),
        timestampGaps: timestamps.filter((g) => g.duration >= thresholdMs),
        tail: {
          classification: tail,
          sinceLastCallbackEnd: rounded(age),
          lastArrival: last ? relative(last.arrived) : null,
          pending: pending.map((r) => ({
            id: r.id,
            age: rounded(end - r.requested),
            parentDeliveryId: r.parentDeliveryId,
          })),
          pendingAtObservationStop: pendingAtStop
            .filter((r) => r.callbackId === id)
            .map((r) => ({
              id: r.id,
              age: rounded(observedStop - r.requested),
            })),
        },
      };
    })
    .sort((a, b) => b.inWindow - a.inWindow || a.id - b.id);
  return {
    version: data.version,
    label: data.label,
    conditions: data.conditions ?? null,
    bounds: {
      begin,
      requestedEnd: begin + requestedMs,
      observedEnd: end,
      observationCutoff: observedStop,
      snapshotStop: data.stop,
      requestedMs,
      observedMs: rounded(end - begin),
      coversRequestedWindow: end >= begin + requestedMs,
      restoredCutoff: restored !== undefined,
    },
    integrity,
    integrityPass: Object.values(integrity).every(Boolean),
    thresholdMs,
    dominantCallbackId: callbacks[0]?.id ?? null,
    callbacks,
    timer: {
      targetMs: 100,
      delta: stats(heartbeat.map((h) => h.deltaPerf)),
      lateness: stats(heartbeat.map((h) => h.lateness)),
      first: heartbeat.length ? relative(heartbeat[0].perf) : null,
      last: heartbeat.length ? relative(heartbeat.at(-1).perf) : null,
    },
    state: {
      visibility: [...new Set(states.map((s) => s.visibility))],
      focus: [...new Set(states.map((s) => s.focused))],
      events: events
        .filter((e) => !['click', 'keydown', 'mark'].includes(e.type))
        .map((e) => ({
          type: e.type,
          at: relative(e.perf),
          focused: e.focused,
          visibility: e.visibility,
        })),
    },
    longTasks: tasks
      .filter((t) => t.duration >= thresholdMs)
      .map((t) => ({ at: relative(t.start), duration: t.duration })),
    status: {
      transit: transit ? relative(transit.perf) : null,
      arrival: arrival ? relative(arrival.perf) : null,
      arrivalText: arrival?.text ?? null,
      ignoredEarlyOrbit: statuses.filter(
        (s) =>
          (!transit || s.perf < transit.perf) &&
          /^In orbit\b/.test(s.text ?? ''),
      ).length,
    },
    truncatedTrace: data.diagnosticTrace?.truncated ?? null,
    limits: [
      'Milliseconds describe observed scheduling and callback wall time, not graphics duration or displayed frame rate.',
      'A timer heartbeat can perturb scheduling. Native function markers do not establish the absence of every other hook.',
      'Callbacks queued before installation and deliveries after restoration are unobserved. Recent or restored pending tails are censored.',
      'Dropped records, observer boundary delivery and transient interface text limit attribution. Arrival is an observed post-transit status.',
      'Dominance is based on callback count, not a sampled script stack. No cause or physical-device result is inferred.',
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (!process.argv[2])
      throw new Error(
        'Usage: node scripts/qa/analyze-cadence.mjs capture.json [window-ms] [threshold-ms]',
      );
    const bytes = readFileSync(process.argv[2]);
    const result = analyzeProbe(JSON.parse(bytes), {
      windowMs:
        process.argv[3] === undefined ? undefined : Number(process.argv[3]),
      thresholdMs: process.argv[4] === undefined ? 50 : Number(process.argv[4]),
    });
    console.log(
      JSON.stringify(
        {
          input: {
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
          ...result,
        },
        null,
        2,
      ),
    );
    if (!result.integrityPass) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
