(() => {
  'use strict';

  window.__orbitCadence?.restore?.();

  const nativeRequest = window.requestAnimationFrame;
  const nativeCancel = window.cancelAnimationFrame;
  const nativeTimeout = window.setTimeout;
  const nativeClearTimeout = window.clearTimeout;
  const now = performance.now.bind(performance);
  const dateNow = Date.now.bind(Date);
  const started = now();
  const startedDate = dateNow();
  let running = true;
  let heartbeatHandle = null;
  let currentDelivery = null;
  let nextCallbackId = 0;
  let nextRequestId = 0;
  let nextDeliveryId = 0;
  let maxPending = 0;
  let restored = null;
  let statusState = '';
  let statusObserver = null;
  let taskObserver = null;
  const pending = new Map();
  const callbackIds = new WeakMap();
  const removers = [];
  const totals = {
    requests: 0,
    deliveries: 0,
    cancels: 0,
    knownCancels: 0,
    heartbeats: 0,
    bookkeepingErrors: 0,
  };
  const overhead = {};

  function ring(capacity) {
    const values = Array.from({ length: capacity });
    let count = 0;
    return {
      push(value) {
        values[count++ % capacity] = value;
      },
      snapshot() {
        const size = Math.min(count, capacity);
        const offset = Math.max(0, count - capacity);
        return {
          total: count,
          dropped: count - size,
          values: Array.from(
            { length: size },
            (_, i) => values[(offset + i) % capacity],
          ),
        };
      },
    };
  }

  const requests = ring(24000);
  const deliveries = ring(24000);
  const cancels = ring(4000);
  const heartbeats = ring(2400);
  const events = ring(2000);
  const statuses = ring(1000);
  const tasks = ring(1000);
  const callbacks = ring(2000);

  function measure(kind, start) {
    const duration = now() - start;
    const entry = (overhead[kind] ??= { count: 0, total: 0, max: 0 });
    entry.count += 1;
    entry.total += duration;
    entry.max = Math.max(entry.max, duration);
  }

  function observe(kind, operation) {
    const start = now();
    try {
      return operation();
    } catch {
      totals.bookkeepingErrors += 1;
    } finally {
      measure(kind, start);
    }
  }

  function focusState() {
    const element = document.activeElement;
    return {
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      active: element
        ? {
            tag: element.tagName,
            id: element.id,
            role: element.getAttribute('role'),
            label: element.getAttribute('aria-label')?.slice(0, 160) ?? null,
          }
        : null,
    };
  }

  function clockState() {
    return { perf: now(), date: dateNow(), ...focusState() };
  }

  function functionState(fn) {
    const source = Function.prototype.toString.call(fn);
    return {
      name: fn.name,
      nativeCodeMarker: source.includes('[native code]'),
      source: source.slice(0, 700),
    };
  }

  function context() {
    const canvas = document.querySelector('canvas');
    const scriptResources = performance
      .getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'script')
      .map((entry) => entry.name);
    return {
      ...clockState(),
      href: location.href,
      timeOrigin: performance.timeOrigin,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      visualViewport: window.visualViewport
        ? {
            width: visualViewport.width,
            height: visualViewport.height,
            scale: visualViewport.scale,
          }
        : null,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      scriptUrls: Array.from(document.scripts, (script) => script.src)
        .filter(Boolean)
        .slice(0, 1000),
      scriptResourceUrls: scriptResources.slice(0, 1000),
      scriptResourceCount: scriptResources.length,
    };
  }

  const initial = context();
  const originals = {
    request: functionState(nativeRequest),
    cancel: functionState(nativeCancel),
    timeout: functionState(nativeTimeout),
  };

  function callbackMeta(callback) {
    let meta = callbackIds.get(callback);
    if (!meta) {
      meta = {
        id: ++nextCallbackId,
        name: String(callback.name || '(anonymous)').slice(0, 100),
        requests: 0,
        deliveries: 0,
        cancels: 0,
        wallTotal: 0,
        wallMax: 0,
      };
      callbackIds.set(callback, meta);
      callbacks.push(meta);
    }
    return meta;
  }

  function wrappedRequest(callback) {
    if (!running || typeof callback !== 'function')
      return nativeRequest.call(window, callback);
    const bookkeepingStart = now();
    const meta = callbackMeta(callback);
    const entry = {
      id: ++nextRequestId,
      handle: null,
      callbackId: meta.id,
      callbackName: meta.name,
      requested: now(),
      parentDeliveryId: currentDelivery?.id ?? null,
    };
    const nativeStart = now();
    const handle = nativeRequest.call(window, (timestamp) => {
      if (!running) {
        pending.delete(handle);
        callback.call(window, timestamp);
        return;
      }
      const arrived = now();
      const beforeStart = arrived;
      const beforePending = pending.size;
      pending.delete(handle);
      const previousDelivery = currentDelivery;
      const delivery = {
        id: ++nextDeliveryId,
        requestId: entry.id,
        handle,
        callbackId: meta.id,
        callbackName: meta.name,
        requested: entry.requested,
        arrived,
        timestamp,
        wait: arrived - entry.requested,
        timestampLag: arrived - timestamp,
        pendingBefore: beforePending,
        pendingAfter: pending.size,
        parentDeliveryId: entry.parentDeliveryId,
        callbackStart: null,
        callbackEnd: null,
        wall: null,
        threw: false,
      };
      currentDelivery = delivery;
      measure('deliveryBefore', beforeStart);
      delivery.callbackStart = now();
      try {
        callback.call(window, timestamp);
      } catch (error) {
        delivery.threw = true;
        throw error;
      } finally {
        delivery.callbackEnd = now();
        delivery.wall = delivery.callbackEnd - delivery.callbackStart;
        const afterStart = now();
        currentDelivery = previousDelivery;
        observe('deliveryRecord', () => {
          totals.deliveries += 1;
          meta.deliveries += 1;
          meta.wallTotal += delivery.wall;
          meta.wallMax = Math.max(meta.wallMax, delivery.wall);
          deliveries.push(delivery);
        });
        measure('deliveryAfter', afterStart);
      }
    });
    const nativeDuration = now() - nativeStart;
    entry.handle = handle;
    entry.nativeScheduleDuration = nativeDuration;
    pending.set(handle, entry);
    maxPending = Math.max(maxPending, pending.size);
    meta.requests += 1;
    totals.requests += 1;
    requests.push({ ...entry, pending: pending.size });
    const duration = now() - bookkeepingStart - nativeDuration;
    const record = (overhead.request ??= { count: 0, total: 0, max: 0 });
    record.count += 1;
    record.total += duration;
    record.max = Math.max(record.max, duration);
    return handle;
  }

  function wrappedCancel(handle) {
    if (!running) return nativeCancel.call(window, handle);
    const entry = pending.get(handle);
    const called = now();
    const result = nativeCancel.call(window, handle);
    observe('cancel', () => {
      const pendingBefore = pending.size;
      pending.delete(handle);
      totals.cancels += 1;
      if (entry) {
        totals.knownCancels += 1;
        const meta = callbacks
          .snapshot()
          .values.find((candidate) => candidate.id === entry.callbackId);
        if (meta) meta.cancels += 1;
      }
      cancels.push({
        handle,
        called,
        requestId: entry?.id ?? null,
        callbackId: entry?.callbackId ?? null,
        callbackName: entry?.callbackName ?? null,
        pendingBefore,
        pendingAfter: pending.size,
      });
    });
    return result;
  }

  window.requestAnimationFrame = wrappedRequest;
  window.cancelAnimationFrame = wrappedCancel;

  let previousBeat = started;
  let previousBeatDate = startedDate;
  let due = now() + 100;
  function heartbeat() {
    if (!running) return;
    observe('heartbeat', () => {
      const perf = now();
      const date = dateNow();
      heartbeats.push({
        perf,
        date,
        deltaPerf: perf - previousBeat,
        deltaDate: date - previousBeatDate,
        lateness: perf - due,
        clockDrift: date - startedDate - (perf - started),
        pending: pending.size,
        ...focusState(),
      });
      previousBeat = perf;
      previousBeatDate = date;
      totals.heartbeats += 1;
    });
    due = now() + 100;
    heartbeatHandle = nativeTimeout.call(window, heartbeat, 100);
  }
  heartbeatHandle = nativeTimeout.call(window, heartbeat, 100);

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  for (const type of ['visibilitychange', 'freeze', 'resume']) {
    listen(document, type, () =>
      observe('lifecycle', () =>
        events.push({ type, ...clockState(), pending: pending.size }),
      ),
    );
  }
  for (const type of ['focus', 'blur', 'pageshow', 'pagehide']) {
    listen(window, type, (event) =>
      observe('lifecycle', () =>
        events.push({
          type,
          persisted: 'persisted' in event ? event.persisted : null,
          ...clockState(),
          pending: pending.size,
        }),
      ),
    );
  }
  listen(
    document,
    'click',
    (event) =>
      observe('action', () => {
        const target =
          event.target instanceof Element
            ? event.target.closest('button,a,[role="button"],[role="tab"]')
            : null;
        events.push({
          type: 'click',
          ...clockState(),
          detail: event.detail,
          trusted: event.isTrusted,
          target: target
            ? {
                tag: target.tagName,
                id: target.id,
                label: (
                  target.getAttribute('aria-label') ||
                  target.textContent ||
                  ''
                )
                  .trim()
                  .slice(0, 180),
              }
            : null,
        });
      }),
    true,
  );
  listen(
    document,
    'keydown',
    (event) => {
      if (
        ![
          'Enter',
          ' ',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'Escape',
        ].includes(event.key)
      )
        return;
      observe('action', () =>
        events.push({
          type: 'keydown',
          key: event.key,
          repeat: event.repeat,
          trusted: event.isTrusted,
          ...clockState(),
        }),
      );
    },
    true,
  );

  function recordStatus() {
    const status = document.querySelector('.flight-status');
    const controls = document.querySelector('.camera-tools');
    const state = {
      text:
        status?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 400) ?? null,
      buttons: controls
        ? Array.from(controls.querySelectorAll('button'), (button) => ({
            label:
              button.getAttribute('aria-label') || button.textContent?.trim(),
            disabled: button.disabled,
          }))
        : [],
    };
    const key = JSON.stringify(state);
    if (key !== statusState) {
      statusState = key;
      statuses.push({ perf: now(), date: dateNow(), ...state });
    }
  }
  statusObserver = new MutationObserver(() => observe('status', recordStatus));
  const statusNode = document.querySelector('.flight-status');
  const controlsNode = document.querySelector('.camera-tools');
  if (statusNode)
    statusObserver.observe(statusNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  if (controlsNode)
    statusObserver.observe(controlsNode, {
      attributes: true,
      attributeFilter: ['disabled'],
      subtree: true,
    });
  recordStatus();
  try {
    taskObserver = new PerformanceObserver((list) =>
      observe('longtask', () => {
        for (const entry of list.getEntries())
          tasks.push({
            start: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
      }),
    );
    taskObserver.observe({ type: 'longtask', buffered: false });
  } catch {
    taskObserver = null;
  }

  function snapshot() {
    const stop = now();
    const final = context();
    return {
      version: 1,
      started,
      startedDate,
      stop,
      duration: stop - started,
      running,
      initial,
      final,
      originals,
      restored,
      totals: { ...totals },
      maxPending,
      pendingCount: pending.size,
      pending: Array.from(pending.values())
        .slice(0, 512)
        .map((entry) => ({ ...entry })),
      pendingOmitted: Math.max(0, pending.size - 512),
      currentDelivery: currentDelivery ? { ...currentDelivery } : null,
      overhead: Object.fromEntries(
        Object.entries(overhead).map(([key, value]) => [key, { ...value }]),
      ),
      callbacks: {
        ...callbacks.snapshot(),
        values: callbacks.snapshot().values.map((meta) => ({ ...meta })),
      },
      requests: requests.snapshot(),
      deliveries: deliveries.snapshot(),
      cancels: cancels.snapshot(),
      heartbeats: heartbeats.snapshot(),
      events: events.snapshot(),
      statuses: statuses.snapshot(),
      tasks: tasks.snapshot(),
      observerTargets: {
        status: Boolean(statusNode),
        controls: Boolean(controlsNode),
        longTasks: Boolean(taskObserver),
      },
      notes: [
        'Snapshot does not stop observation; call restore after collecting it.',
        'Pending frames from before installation are not recorded until they request a wrapped successor.',
        'Callback wall includes any instrumentation invoked synchronously by that callback; bookkeeping is reported separately.',
        'Frame timestamp and actual delivery are recorded separately; this probe makes no rendering or display cadence claim.',
        'Timer heartbeat is diagnostic activity and may perturb scheduling.',
      ],
    };
  }

  function restore() {
    if (!running) return;
    running = false;
    restored = {
      perf: now(),
      date: dateNow(),
      pending: pending.size,
      requestOwned: window.requestAnimationFrame === wrappedRequest,
      cancelOwned: window.cancelAnimationFrame === wrappedCancel,
    };
    if (restored.requestOwned) window.requestAnimationFrame = nativeRequest;
    if (restored.cancelOwned) window.cancelAnimationFrame = nativeCancel;
    if (heartbeatHandle !== null)
      nativeClearTimeout.call(window, heartbeatHandle);
    heartbeatHandle = null;
    statusObserver?.disconnect();
    taskObserver?.disconnect();
    for (const remove of removers) remove();
    // Queued application callbacks remain scheduled and run without observation.
  }

  window.__orbitCadence = {
    snapshot,
    restore,
    mark(label) {
      if (running)
        observe('mark', () =>
          events.push({
            type: 'mark',
            label: String(label).slice(0, 180),
            ...clockState(),
            pending: pending.size,
          }),
        );
    },
  };
})();
