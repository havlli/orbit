import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProbe } from '../scripts/qa/analyze-cadence.mjs';

const ring = (values) => ({ total: values.length, dropped: 0, values });
const request = (id, requested, parentDeliveryId = null) => ({
  id,
  handle: id,
  callbackId: 1,
  callbackName: 'scene',
  requested,
  parentDeliveryId,
});
const delivery = (r, arrived, wall = 1, timestamp = arrived) => ({
  id: r.id,
  requestId: r.id,
  handle: r.handle,
  callbackId: r.callbackId,
  requested: r.requested,
  arrived,
  timestamp,
  callbackStart: arrived,
  callbackEnd: arrived + wall,
  wall,
  wait: arrived - r.requested,
});
function capture(
  requests,
  deliveries,
  { stop = 112, cancels = [], restored = null } = {},
) {
  const ended = new Set([
    ...deliveries.map((d) => d.requestId),
    ...cancels.map((c) => c.requestId),
  ]);
  const pending = requests.filter((r) => !ended.has(r.id));
  const native = {
    nativeCodeMarker: true,
    source: 'function () { [native code] }',
  };
  return {
    version: 1,
    started: 0,
    stop,
    running: restored === null,
    restored,
    initial: { perf: 0, focused: true, visibility: 'visible' },
    final: { perf: stop, focused: true, visibility: 'visible' },
    originals: { request: native, cancel: native, timeout: native },
    totals: {
      requests: requests.length,
      deliveries: deliveries.length,
      cancels: cancels.length,
      heartbeats: 1,
      bookkeepingErrors: 0,
    },
    requests: ring(requests),
    deliveries: ring(deliveries),
    cancels: ring(cancels),
    callbacks: ring([]),
    heartbeats: ring([
      {
        perf: 100,
        deltaPerf: 100,
        lateness: 0,
        focused: true,
        visibility: 'visible',
      },
    ]),
    events: ring([
      { type: 'click', perf: 5, focused: true, visibility: 'visible' },
    ]),
    statuses: ring([
      { perf: 6, text: 'In orbit · Ceres' },
      { perf: 8, text: 'In transit · Ceres' },
      { perf: 80, text: 'In orbit · Ceres' },
    ]),
    tasks: ring([]),
    pending,
    pendingCount: pending.length,
    pendingOmitted: 0,
    observerTargets: { longTasks: true },
    conditions: { arbitrary: 'reported without prescribing an experiment' },
  };
}
function queued() {
  const first = request(1, 1),
    next = request(2, 10.2, 1),
    tail = request(3, 110.2, 2);
  return capture(
    [first, next, tail],
    [delivery(first, 10), delivery(next, 110)],
  );
}
const dominant = (result) =>
  result.callbacks.find((c) => c.id === result.dominantCallbackId);

test('links a long delivery interval to a successor queued inside the preceding callback', () => {
  const input = queued(),
    before = structuredClone(input),
    result = analyzeProbe(input);
  assert.equal(result.integrityPass, true);
  assert.deepEqual(input, before, 'pure analysis must preserve the capture');
  const callback = dominant(result);
  assert.equal(callback.actualGaps[0].classification, 'queued-delay');
  assert.equal(callback.actualGaps[0].successorFromPrevious, true);
  assert.equal(callback.requestWait.max, 99.8);
  assert.equal(callback.actualArrivalGap.max, 100);
  assert.equal(callback.tail.classification, 'recent-pending');
  assert.equal(result.status.arrival, 75);
  assert.equal(result.status.ignoredEarlyOrbit, 1);
});

test('distinguishes a late new request from waiting on an already queued successor', () => {
  const first = request(1, 1),
    next = request(2, 109, null);
  const result = analyzeProbe(
    capture([first, next], [delivery(first, 10), delivery(next, 110)]),
  );
  assert.equal(dominant(result).actualGaps[0].classification, 'later-request');
  assert.equal(dominant(result).actualGaps[0].wait, 1);
});

test('reports a missing successor after the last callback without inventing queued waiting', () => {
  const first = request(1, 1),
    result = analyzeProbe(capture([first], [delivery(first, 10)]));
  assert.equal(result.integrityPass, true);
  assert.equal(dominant(result).tail.classification, 'missing-successor');
  assert.equal(dominant(result).tail.sinceLastCallbackEnd, 101);
});

test('distinguishes a cancelled successor from a missing request', () => {
  const first = request(1, 1),
    next = request(2, 10.2, 1);
  const cancel = { requestId: 2, callbackId: 1, handle: 2, called: 11 };
  const result = analyzeProbe(
    capture([first, next], [delivery(first, 10)], { cancels: [cancel] }),
  );
  assert.equal(result.integrityPass, true);
  assert.equal(dominant(result).tail.classification, 'cancelled-successor');
});

test('reports a long unresolved tail separately from a recent pending frame', () => {
  const input = queued();
  input.stop = 300;
  const result = analyzeProbe(input);
  assert.equal(dominant(result).tail.classification, 'long-pending');
  assert.equal(dominant(result).tail.pending[0].age, 189.8);
});

test('restoration bounds coverage and does not infer delivery from a later snapshot', () => {
  const input = queued();
  input.stop = 1000;
  input.running = false;
  input.restored = {
    perf: 112,
    pending: 1,
    requestOwned: true,
    cancelOwned: true,
  };
  input.pending = [];
  input.pendingCount = 0;
  const result = analyzeProbe(input, { windowMs: 300 });
  assert.equal(result.integrityPass, true);
  assert.equal(result.bounds.observationCutoff, 112);
  assert.equal(result.bounds.coversRequestedWindow, false);
  assert.equal(dominant(result).tail.pendingAtObservationStop[0].age, 1.8);
});

test('requires arrival after transit inside the requested window', () => {
  const result = analyzeProbe(queued(), { windowMs: 30 });
  assert.equal(result.status.transit, 3);
  assert.equal(result.status.arrival, null);
  assert.equal(result.status.ignoredEarlyOrbit, 1);
});

test('retains a whole gap straddling the requested end and a separate recent pending tail', () => {
  const result = analyzeProbe(queued(), { windowMs: 50 });
  const callback = dominant(result);
  assert.equal(callback.actualGaps[0].crossesEnd, true);
  assert.equal(callback.actualGaps[0].duration, 100);
  assert.equal(callback.tail.pending[0].id, 2);
  assert.equal(callback.tail.classification, 'recent-pending');
});

test('flags lost ring records and preserves an explicitly truncated trace', () => {
  const input = queued();
  input.requests.total++;
  input.requests.dropped++;
  input.diagnosticTrace = { complete: true, truncated: true };
  const result = analyzeProbe(input);
  assert.equal(result.integrity.completeRings, false);
  assert.equal(result.integrityPass, false);
  assert.equal(result.truncatedTrace, true);
});

test('reports focus and visibility transitions without assigning a cause', () => {
  const input = queued();
  input.events = ring([
    ...input.events.values,
    { type: 'blur', perf: 50, focused: false, visibility: 'hidden' },
  ]);
  const result = analyzeProbe(input);
  assert.deepEqual(result.state.focus, [true, false]);
  assert.deepEqual(result.state.visibility, ['visible', 'hidden']);
  assert.equal(result.state.events[0].type, 'blur');
});

test('flags nonmonotonic records and request-link corruption', () => {
  const input = queued();
  input.deliveries.values.reverse();
  input.deliveries.values[0].handle = 999;
  const result = analyzeProbe(input);
  assert.equal(result.integrity.monotonic, false);
  assert.equal(result.integrity.linkage, false);
  assert.equal(result.integrityPass, false);
});

test('guards stale wrapped originals and invalid capture clocks', () => {
  const input = queued();
  input.originals.request = {
    nativeCodeMarker: false,
    source: '(callback) => wrapped(callback)',
  };
  assert.equal(analyzeProbe(input).integrity.nativeRequest, false);
  assert.throws(() => analyzeProbe({ ...input, stop: NaN }), /bounds/);
});
