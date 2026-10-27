/* oxlint-disable typescript/no-require-imports -- Typed project modules use the local compiler hook. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};
const THREE = require('three');
const { SpacecraftLighting } = require('../app/spacecraft-lighting.ts');
const {
  cloneSpacecraftSurface,
  disposeSpacecraft,
} = require('../app/spacecraft.ts');
const { milestones } = require('../app/solar-data.ts');
const { MissionFlight } = require('../app/mission-flight.ts');
const { MissionPlayback } = require('../app/mission-cinematography.ts');
const {
  ExpeditionFlight,
  validateTimelapse,
} = require('../app/expedition-flight.ts');
const {
  sampleState,
  missionTime,
  validateEphemeris,
  missionRecords,
  KM_PER_UNIT,
} = require('../app/ephemeris.ts');
const bundles = missionRecords.map((r) =>
  validateEphemeris(
    JSON.parse(fs.readFileSync(`public/ephemeris/${r.id}.json`, 'utf8')),
  ),
);
const world = (s) =>
  new THREE.Vector3(s[1], s[3], -s[2]).divideScalar(KM_PER_UNIT);
const timelapse = validateTimelapse(
  JSON.parse(fs.readFileSync('public/ephemeris/timelapse.json', 'utf8')),
);

function exerciseSceneFunctions(setup, sections, exercise, state) {
  const source = fs.readFileSync('app/solar-scene.tsx', 'utf8');
  const functions = sections.map(([start, end]) =>
    source.slice(source.indexOf(start), source.indexOf(end)),
  );
  const compiled = ts.transpileModule(
    [setup, ...functions, exercise].join('\n'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return require('node:vm').compileFunction(compiled, ['THREE', 'state'])(
    THREE,
    state,
  );
}

test('a recorded pinch continues as a one-pixel drag after either finger ends or cancels', () => {
  const { PointerGesture } = require('../app/pointer-gesture.ts');
  for (const release of ['end', 'cancel'])
    for (const leaving of [4, 5]) {
      const gesture = new PointerGesture();
      gesture.start(4, 110, 330);
      gesture.start(5, 245, 330);
      const right = gesture.move(5, 270, 330);
      const left = gesture.move(4, 100, 330);
      assert.ok(
        Math.abs(right.pinchScale * left.pinchScale - 135 / 170) < 1e-12,
      );
      const surviving = leaving === 4 ? 5 : 4;
      const lastX = surviving === 5 ? 270 : 100;
      if (release === 'end')
        assert.equal(
          gesture.end(leaving, leaving === 4 ? 100 : 270, 330),
          false,
        );
      else gesture.cancel(leaving);
      assert.equal(gesture.active, true);
      const move = gesture.move(surviving, lastX + 1, 330);
      assert.equal(
        move.pinchScale,
        undefined,
        'the remaining finger rotates without stale pinch scaling',
      );
      assert.equal(
        move.dx,
        1,
        'finger separation must not become an orbital rotation',
      );
      assert.equal(move.dy, 0);
      assert.equal(
        move.interacting,
        false,
        'the handoff does not create a false drag threshold',
      );
      // A new second finger starts from the current pair, independent of the
      // distance or event order of the previous pinch.
      gesture.start(6, lastX + 131, 330);
      assert.ok(
        Math.abs(gesture.move(6, lastX + 141, 330).pinchScale - 130 / 140) <
          1e-12,
      );
      assert.equal(gesture.end(6, lastX + 141, 330), false);
      assert.equal(
        gesture.end(surviving, lastX + 1, 330),
        false,
        'ending a pinch must not select a world',
      );
      assert.equal(gesture.active, false);
      gesture.start(7, 30, 40);
      assert.equal(
        gesture.end(7, 31, 40),
        true,
        'the next independent single-pointer tap still selects',
      );
      gesture.start(8, 30, 40);
      assert.equal(gesture.move(8, 40, 45).interacting, true);
      assert.equal(
        gesture.end(8, 40, 45),
        false,
        'a normal drag remains distinct from a tap',
      );
    }
  const stationary = new PointerGesture();
  stationary.start(1, 100, 100);
  stationary.start(2, 200, 100);
  assert.equal(stationary.end(1, 100, 100), false);
  assert.equal(
    stationary.end(2, 200, 100),
    false,
    'a stationary two-finger gesture also suppresses selection',
  );
  stationary.start(3, 100, 100);
  stationary.cancel(3);
  assert.equal(stationary.end(3, 100, 100), false);
  assert.equal(stationary.move(3, 101, 100), undefined);
});

test('spacecraft surface treatment preserves source maps and independent flight ownership', () => {
  const map = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({
    color: '#cca355',
    map,
    normalMap: map,
    metalness: 1,
    roughness: 0.075,
    transparent: true,
    alphaTest: 0.2,
  });
  const first = cloneSpacecraftSurface(source);
  const second = cloneSpacecraftSurface(source);
  assert.notEqual(first, second);
  assert.equal(source.metalness, 1);
  assert.equal(source.roughness, 0.075);
  assert.ok(first.color.equals(source.color));
  assert.equal(first.map, map);
  assert.equal(first.normalMap, map);
  assert.equal(first.alphaTest, 0.2);
  assert.equal(first.transparent, true);
  const matte = cloneSpacecraftSurface(
    new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.7 }),
  );
  assert.ok(first.roughness < matte.roughness);
  first.color.set('#fff');
  assert.ok(second.color.equals(source.color));

  const craft = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  craft.add(new THREE.Mesh(geometry, second), new THREE.Mesh(geometry, second));
  let geometryDisposals = 0,
    materialDisposals = 0,
    textureDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  second.addEventListener('dispose', () => materialDisposals++);
  map.addEventListener('dispose', () => textureDisposals++);
  disposeSpacecraft(craft);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(textureDisposals, 0);
  first.dispose();
  matte.dispose();
  source.dispose();
  map.dispose();
});

test('model parsing waits for a mapped mission while prefetch and retries share templates', async () => {
  const { outputText } = ts.transpileModule(
    fs.readFileSync('app/spacecraft.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  );
  const requests = [],
    warnings = [],
    owned = [],
    registrations = [];
  let parserImports = 0;
  const api = {};
  require('node:vm').compileFunction(outputText, [
    'require',
    'exports',
    'console',
  ])(
    (id) => {
      if (id === 'three') return THREE;
      if (id === './model-dependencies')
        return require('../app/model-dependencies.ts');
      if (id === 'three/addons/loaders/GLTFLoader.js') {
        parserImports++;
        return {
          GLTFLoader: class {
            register(plugin) {
              registrations.push(plugin);
              return this;
            }
            loadAsync(url) {
              return new Promise((resolve, reject) =>
                requests.push({ url, resolve, reject }),
              );
            }
          },
        };
      }
      throw new Error(`Unexpected module: ${id}`);
    },
    api,
    { warn: (...args) => warnings.push(args) },
  );
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const template = new THREE.Group();
  template.add(new THREE.Mesh(geometry, material));
  try {
    api.preloadSpacecraftModel('LUNA 3');
    assert.equal(await api.loadSpacecraftModel('SPUTNIK 1'), undefined);
    assert.equal(
      parserImports,
      0,
      'dated-world openings do not load a model parser',
    );
    api.preloadSpacecraftModel('VOYAGER 2');
    const first = api.loadSpacecraftModel('VOYAGER 2');
    const second = api.loadSpacecraftModel('VOYAGER 1');
    await new Promise(setImmediate);
    assert.equal(parserImports, 1);
    assert.equal(
      requests.length,
      1,
      'prefetch and simultaneous flights share one template',
    );
    assert.equal(requests[0].url, '/models/voyager.glb');
    assert.equal(registrations.length, 1);
    requests[0].resolve({ scene: template });
    const models = await Promise.all([first, second]);
    owned.push(...models);
    const meshes = models.map((model) =>
      model.getObjectByProperty('isMesh', true),
    );
    assert.notEqual(models[0], models[1]);
    assert.notEqual(meshes[0].geometry, meshes[1].geometry);
    assert.notEqual(meshes[0].material, meshes[1].material);
    assert.equal(meshes[0].material.map, texture);
    assert.equal(meshes[1].material.map, texture);
    api.preloadSpacecraftModel('CASSINI');
    await new Promise(setImmediate);
    requests[1].reject(new Error('Interrupted prefetch'));
    await new Promise(setImmediate);
    const fallback = api.loadSpacecraftModel('CASSINI');
    await new Promise(setImmediate);
    assert.equal(
      requests.length,
      3,
      'a failed prefetch can be requested again',
    );
    requests[2].reject(new Error('Unavailable model'));
    assert.equal(
      await fallback,
      undefined,
      'a model failure retains the schematic fallback',
    );
    assert.equal(warnings.length, 1);
    const retry = api.loadSpacecraftModel('CASSINI');
    await new Promise(setImmediate);
    assert.equal(requests.length, 4, 'a failed flight model remains retryable');
    requests[3].resolve({ scene: template });
    const recovered = await retry;
    owned.push(recovered);
    assert.equal(recovered.userData.model, 'cassini');
    assert.equal(registrations.length, 4);
    assert.equal(
      new Set(registrations).size,
      1,
      'different models and retries share the same dependency scheduler',
    );
  } finally {
    for (const request of requests) request.resolve({ scene: template });
    owned.forEach(disposeSpacecraft);
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }
});

test('spacecraft preparation shares uploads and compiles the final fading surfaces', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const uploaded = [],
    compiled = [];
  const renderer = {
    initTexture(texture) {
      uploaded.push(texture);
    },
    async compileAsync(craft) {
      compiled.push(craft);
    },
  };
  let active = true;
  const prepare = createSpacecraftPreparation(
    renderer,
    new THREE.Camera(),
    new THREE.Scene(),
    () => active,
    { nextFrame: () => Promise.resolve() },
  );
  const texture = new THREE.Texture();
  const first = new THREE.Group(),
    second = new THREE.Group();
  for (const craft of [first, second]) {
    const material = new THREE.MeshStandardMaterial({ map: texture });
    craft.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  }
  await Promise.all([prepare(first), prepare(second)]);
  assert.deepEqual(
    uploaded,
    [texture],
    'Flights sharing a template transfer its map only once',
  );
  assert.equal(compiled.length, 2);
  for (const craft of compiled) {
    assert.equal(craft.children[0].receiveShadow, true);
    assert.equal(craft.children[0].material.transparent, true);
    assert.equal(craft.children[0].material.userData.baseTransparent, false);
  }
  active = false;
  await prepare(first);
  assert.equal(
    compiled.length,
    2,
    'A disposed scene must not compile another flight',
  );
  disposeSpacecraft(first);
  disposeSpacecraft(second);
  texture.dispose();
});

test('the opening record starts beside scene assets, shares pending work and retries a failed warmup', async () => {
  const modulePath = require.resolve('../app/ephemeris.ts');
  const previousModule = require.cache[modulePath];
  delete require.cache[modulePath];
  const { loadEphemeris } = require(modulePath);
  const previousFetch = global.fetch;
  const requests = [],
    order = [];
  let releaseAssets;
  const texture = new THREE.Texture();
  const assets = new Promise((resolve) => {
    releaseAssets = () => resolve(texture);
  });
  const state = {
    bodies: require('../app/solar-data.ts').bodies,
    loadEphemeris(index) {
      state.opening = loadEphemeris(index);
      return state.opening;
    },
    loadTexture(url) {
      order.push(url);
      return assets;
    },
  };
  global.fetch = (url) => {
    order.push(url);
    return new Promise((resolve) => requests.push({ url, resolve }));
  };
  try {
    const loading = exerciseSceneFunctions(
      `const live = { current: { request: { missionIndex: 0 } } };
       const loadEphemeris = state.loadEphemeris;
       const bodies = state.bodies, tex = state.loadTexture;
       const disposed = false;`,
      [
        ['    const openingMissionIndex =', '    renderer.setPixelRatio('],
        ['    const textureCache =', '    const seeded ='],
      ],
      'return load;',
      state,
    );
    assert.equal(order[0], '/ephemeris/sputnik.json');
    assert.ok(order.some((url) => url.startsWith('/textures/')));
    assert.equal(loadEphemeris(0), state.opening);
    assert.equal(requests.length, 1, 'entry shares the pending opening fetch');
    requests[0].resolve({ ok: false });
    await assert.rejects(state.opening, /trajectory record/i);
    const retry = loadEphemeris(0);
    assert.equal(requests.length, 2, 'a failed warmup remains retryable');
    requests[1].resolve({ ok: true, json: async () => bundles[0] });
    const record = await retry;
    assert.equal(record.id, 'sputnik');
    assert.equal(record.tracks.craft, undefined);
    assert.equal(loadEphemeris(0), retry);
    releaseAssets();
    await loading;
  } finally {
    releaseAssets();
    for (const request of requests)
      request.resolve({ ok: true, json: async () => bundles[0] });
    global.fetch = previousFetch;
    require.cache[modulePath] = previousModule;
    texture.dispose();
  }
});

test('chapter preparation compiles every covered craft and no withheld snapshot hardware', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const compiled = [];
  const prepare = createSpacecraftPreparation(
    {
      async compileAsync(craft) {
        compiled.push(craft);
      },
    },
    new THREE.Camera(),
    new THREE.Scene(),
    () => true,
  );
  for (let index = 0; index < milestones.length; index++) {
    const before = compiled.length;
    const incoming = await exerciseSceneFunctions(
      `return (async () => {
       const { milestone, data, index, MissionFlight, prepareSpacecraft } = state;
       const spacecraft = undefined, req = { missionIndex: index };
       const milestones = state.milestones;
       const disposed = false, ticket = 1, loadSerial = 1;
       const departingMission = undefined;`,
      [
        [
          '            const incoming = new MissionFlight(',
          '            departingMission = mission;',
        ],
      ],
      'return incoming; })();',
      {
        milestone: milestones[index],
        data: bundles[index],
        index,
        MissionFlight,
        prepareSpacecraft: prepare,
        milestones,
      },
    );
    try {
      const covered = !!bundles[index].tracks.craft;
      assert.equal(
        compiled.length - before,
        covered ? 1 : 0,
        bundles[index].id,
      );
      assert.equal(incoming.craft.visible, covered);
      const frame = incoming.update(0, true, false, true);
      assert.equal(
        frame.et,
        covered ? bundles[index].start : bundles[index].end,
      );
      if (covered) assert.equal(compiled.at(-1), incoming.craft);
    } finally {
      incoming.dispose();
    }
  }
});

test('spacecraft shadows fit enlarged and rebased hardware along the sourced Sun direction', () => {
  const scene = new THREE.Scene();
  const lighting = new SpacecraftLighting(scene);
  lighting.update(undefined, new THREE.Vector3());
  assert.equal(
    lighting.light.shadow.needsUpdate,
    true,
    'Initialize a depth texture before any shadow sampler draws',
  );
  lighting.light.shadow.map = new THREE.WebGLRenderTarget(1024, 1024);
  const craft = new THREE.Group();
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1, 2),
    new THREE.MeshStandardMaterial(),
  );
  part.material.userData.baseTransparent = false;
  part.material.transparent = true; // A chapter crossfade must not redefine the source surface.
  part.position.set(0.3, 0.2, -0.1);
  part.rotation.set(0.2, 0.4, -0.3);
  const blended = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshStandardMaterial({ transparent: true }),
  );
  const cutout = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5 }),
  );
  craft.add(blended, cutout);
  craft.add(part);
  scene.add(craft);
  const corners = [];
  for (const x of [-2, 2])
    for (const y of [-0.5, 0.5])
      for (const z of [-1, 1]) corners.push(new THREE.Vector3(x, y, z));
  for (const scale of [1e-5, 1, 1000]) {
    craft.scale.setScalar(scale);
    craft.rotation.set(-0.1, 0.5, 0.7);
    craft.position.set(700 * scale, -400 * scale, 900 * scale);
    const sun = craft.position
      .clone()
      .add(new THREE.Vector3(3000, 800, -1200).multiplyScalar(scale));
    assert.equal(lighting.update(craft, sun), true);
    const light = lighting.light;
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    for (const corner of corners) {
      const projected = corner
        .clone()
        .applyMatrix4(part.matrixWorld)
        .project(light.shadow.camera);
      assert.ok(
        Math.max(
          Math.abs(projected.x),
          Math.abs(projected.y),
          Math.abs(projected.z),
        ) < 1,
      );
    }
    const expected = sun.clone().sub(light.target.position).normalize();
    const actual = light.position
      .clone()
      .sub(light.target.position)
      .normalize();
    assert.ok(expected.distanceTo(actual) < 1e-10);
    assert.equal(part.castShadow, true);
    assert.equal(part.receiveShadow, true);
    assert.equal(blended.castShadow, false);
    assert.equal(blended.receiveShadow, true);
    assert.equal(cutout.castShadow, true);
    light.shadow.needsUpdate = false; // Simulate a completed GPU shadow pass.
    lighting.update(craft, sun);
    assert.equal(
      light.shadow.needsUpdate,
      false,
      'a stationary probe reuses its shadow map',
    );
    sun.x += scale * 5;
    lighting.update(craft, sun);
    assert.equal(light.shadow.needsUpdate, true);
  }
  craft.visible = false;
  assert.equal(lighting.update(craft, new THREE.Vector3(100, 0, 0)), false);
  assert.equal(lighting.light.intensity, 0);
  assert.equal(lighting.light.shadow.needsUpdate, false);
  let disposed = 0;
  lighting.light.shadow.map.addEventListener('dispose', () => disposed++);
  lighting.dispose();
  assert.equal(disposed, 1);
  assert.equal(lighting.light.parent, null);
  assert.equal(lighting.light.target.parent, null);
  disposeSpacecraft(craft);
});

function expeditionView(index, progress, mobile = false) {
  const mission = new MissionFlight(milestones[index], bundles[index]);
  mission.seek(progress);
  const frame = mission.update(0, true, false, mobile);
  return absoluteExpeditionView(mission, frame);
}

function completedExpeditionView(index, mobile) {
  const mission = new MissionFlight(milestones[index], bundles[index]);
  return absoluteExpeditionView(
    mission,
    mission.update(1000, false, false, mobile),
  );
}

function absoluteExpeditionView(mission, frame) {
  const view = {
    ...frame,
    position: frame.position.clone().add(mission.origin),
    look: frame.look.clone().add(mission.origin),
    bodies: new Map(
      [...mission.bodyPositions].map(([id, position]) => [
        id,
        position.clone().add(mission.origin),
      ]),
    ),
    radiiKm: mission.data.radiiKm,
    poles: mission.data.poles,
  };
  mission.dispose();
  return view;
}

test('all chronological transfers use bounded editorial durations without changing their sampled history', () => {
  const seconds = [7, 9, 9, 9, 9, 9, 11, 11, 11, 11, 11, 7, 11, 11, 11];
  for (const mobile of [false, true])
    for (let index = 0; index < 15; index++) {
      const from = completedExpeditionView(index, mobile),
        to = expeditionView(index + 1, 0, mobile);
      const flight = new ExpeditionFlight(from, to, timelapse, mobile);
      assert.equal(flight.duration, seconds[index], `chapter ${index}`);
      assert.ok(
        Math.abs(
          flight.departureSeconds +
            flight.timelapseSeconds +
            flight.arrivalSeconds -
            flight.duration,
        ) < 1e-12,
      );
      const unclassified = new ExpeditionFlight(
        { ...from, focus: undefined },
        { ...to, focus: undefined },
        timelapse,
        mobile,
      );
      assert.equal(unclassified.duration, 14);
      for (const progress of [0, 0.22, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78, 0.8, 1]) {
        const frame = new ExpeditionFlight(from, to, timelapse, mobile).update(
          progress * flight.duration,
        );
        const reference = new ExpeditionFlight(
          unclassified.from,
          unclassified.to,
          timelapse,
          mobile,
        ).update(progress * 14);
        assert.ok(Math.abs(frame.et - reference.et) < 1e-5);
        assert.ok(
          Math.abs(Date.parse(frame.utc) - Date.parse(reference.utc)) <= 1,
        );
        assert.deepEqual(
          [...frame.bodies.keys()],
          [...reference.bodies.keys()],
        );
        for (const [id, position] of frame.bodies)
          assert.ok(position.distanceTo(reference.bodies.get(id)) < 1e-8);
        assert.deepEqual(frame.radiiKm, reference.radiiKm);
        if (progress === 0 || progress === 1) {
          const endpoint = progress === 0 ? from : to;
          assert.ok(frame.position.equals(endpoint.position));
          assert.ok(frame.look.equals(endpoint.look));
          assert.equal(frame.et, endpoint.et);
          for (const [id, position] of frame.bodies)
            assert.ok(position.equals(endpoint.bodies.get(id)));
        }
      }
    }
  const from = expeditionView(0, 1),
    to = expeditionView(1, 0);
  for (const [start, end, data] of [
    [from, to, null],
    [{ ...from, atlasBlend: 1 }, to, timelapse],
    [from, { ...to, atlasBlend: 0.4 }, timelapse],
    [{ ...from, focus: undefined }, to, timelapse],
  ])
    assert.equal(new ExpeditionFlight(start, end, data, false).duration, 14);

  const absent = { ...timelapse, tracks: { ...timelapse.tracks } };
  delete absent.tracks.earth;
  const short = {
    ...timelapse,
    tracks: {
      ...timelapse.tracks,
      earth: timelapse.tracks.earth.filter((row) => row[0] > from.et),
    },
  };
  const interrupted = {
    ...timelapse,
    seams: { earth: [{ start: from.et + 1, end: to.et - 1 }] },
  };
  for (const data of [absent, short, interrupted])
    assert.notEqual(
      new ExpeditionFlight(from, to, data, false).profile,
      'local',
      'parent following requires a covered source state throughout the transfer',
    );
});

test('local historical handoffs keep a resolved parent silhouette in the central context without adding missing moons', () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [375, 700],
  ]) {
    const mobile = width <= 760;
    for (const initialMobile of [false, true]) {
      for (const [a, b, parent, moon] of [
        [0, 1, 'earth', 'moon'],
        [11, 12, 'saturn', 'titan'],
      ]) {
        const from = completedExpeditionView(a, initialMobile),
          to = expeditionView(b, 0, initialMobile);
        for (const view of [from, to])
          view.framing = {
            horizontal: 0.12,
            vertical:
              0.2 + (initialMobile ? (view.discovery?.amount ?? 0) * 0.2 : 0),
          };
        const flight = new ExpeditionFlight(from, to, timelapse, initialMobile);
        const geometries = [
          new THREE.SphereGeometry(from.radiiKm[parent] / KM_PER_UNIT, 128, 96),
        ];
        if (parent === 'saturn') {
          geometries[0].scale(1, 0.92, 1);
          const ring = new THREE.RingGeometry(
            (from.radiiKm[parent] / KM_PER_UNIT) * 1.14,
            (from.radiiKm[parent] / KM_PER_UNIT) * 2.31,
            512,
          );
          ring.rotateX(-Math.PI / 2);
          geometries.push(ring);
        }
        let previous = 0;
        for (const progress of [0.3, 0.4, 0.5, 0.55]) {
          const frame = flight.update((progress - previous) * flight.duration);
          previous = progress;
          assert.equal(
            frame.bodies.has(moon),
            false,
            'uncovered moons stay absent',
          );
          const camera = new THREE.PerspectiveCamera(
            (mobile ? 49 : 42) + frame.fovOffset,
            width / height,
            1e-9,
            30000,
          );
          camera.position.copy(frame.position);
          const forward = frame.look.clone().sub(frame.position).normalize();
          const right = new THREE.Vector3()
            .crossVectors(forward, camera.up)
            .normalize();
          const up = new THREE.Vector3()
            .crossVectors(right, forward)
            .normalize();
          const half =
            frame.position.distanceTo(frame.look) *
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          camera.lookAt(
            frame.look
              .clone()
              .addScaledVector(
                right,
                -half *
                  camera.aspect *
                  (mobile
                    ? (frame.framing.portraitHorizontal ?? 0) *
                      (height <= 760 ? 1.1 : 1)
                    : frame.framing.horizontal),
              )
              .addScaledVector(
                up,
                -half *
                  ((mobile
                    ? (frame.framing.portraitVertical ?? frame.framing.vertical)
                    : frame.framing.vertical) +
                    (mobile && height <= 760 ? 0.055 : 0)),
              ),
          );
          camera.rotateZ(frame.bank);
          camera.updateMatrixWorld();
          const pole = frame.poles[parent];
          const rotation = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(pole[0], pole[2], -pole[1]).normalize(),
          );
          const bounds = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
          };
          const screenPoints = [];
          const point = new THREE.Vector3();
          for (const geometry of geometries) {
            const vertices = geometry.getAttribute('position');
            for (let i = 0; i < vertices.count; i++) {
              point
                .fromBufferAttribute(vertices, i)
                .applyQuaternion(rotation)
                .add(frame.bodies.get(parent))
                .project(camera);
              assert.ok(point.z > -1 && point.z < 1);
              const x = (point.x * 0.5 + 0.5) * width,
                y = (-point.y * 0.5 + 0.5) * height;
              screenPoints.push([x, y]);
              bounds.minX = Math.min(bounds.minX, x);
              bounds.maxX = Math.max(bounds.maxX, x);
              bounds.minY = Math.min(bounds.minY, y);
              bounds.maxY = Math.max(bounds.maxY, y);
            }
          }
          assert.ok(
            bounds.minX >= 0 && bounds.maxX <= width,
            `${parent} clips horizontally at ${width}×${height}, ${progress}: ${JSON.stringify(bounds)}`,
          );
          assert.ok(
            bounds.minY >= 0 && bounds.maxY <= height,
            `${parent} clips vertically`,
          );
          assert.ok(
            Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) >
              (parent === 'earth' ? (mobile ? 90 : 120) : 40),
            `${parent} should remain resolved rather than an invisible dot`,
          );
          if (mobile) {
            assert.ok(
              bounds.minY >= 110 && bounds.maxX <= width - 4,
              `parent clears the date and right edge: ${JSON.stringify(bounds)}`,
            );
            const { transferCue } = require('../app/scene-story-motion.ts');
            const captionLeft =
              width * 0.05 + transferCue(progress, false).drift;
            const captionTop = height - 292 - 222;
            for (const glyph of [
              { x: captionLeft, y: captionTop, width: 200, height: 14 },
              { x: captionLeft, y: captionTop + 25, width: 145, height: 55 },
              { x: captionLeft, y: captionTop + 100, width: 140, height: 16 },
            ])
              assert.ok(
                !screenPoints.some(
                  ([x, y]) =>
                    x >= glyph.x - 2 &&
                    x <= glyph.x + glyph.width + 2 &&
                    y >= glyph.y - 2 &&
                    y <= glyph.y + glyph.height + 2,
                ),
                `${parent} overlaps a transfer caption at ${width}×${height}, ${progress}: ${JSON.stringify(bounds)}`,
              );
          }
          assert.ok(
            frame.bodies
              .get(parent)
              .distanceTo(
                world(sampleState(timelapse.tracks[parent], frame.et)),
              ) < 1e-9,
          );
        }
        geometries.forEach((geometry) => geometry.dispose());
      }
    }
  }
});

test('every transfer profile retains smooth joins, pause, interruption, resize and moving acquisition', () => {
  for (const mobile of [false, true])
    for (const { a, b, data, profile } of [
      { a: 0, b: 1, data: timelapse, profile: 'local' },
      { a: 1, b: 2, data: timelapse, profile: 'nearby' },
      { a: 9, b: 10, data: timelapse, profile: 'wide' },
      { a: 11, b: 12, data: null, profile: 'unclassified' },
    ]) {
      const from = completedExpeditionView(a, mobile),
        to = expeditionView(b, 0, mobile);
      const flight = new ExpeditionFlight(from, to, data, mobile);
      assert.equal(flight.profile, profile);
      const at = (elapsed) =>
        new ExpeditionFlight(from, to, data, mobile).update(elapsed);
      for (const progress of [
        0.18, 0.22, 0.3, 0.5, 0.55, 0.63, 0.7, 0.78, 0.8, 0.82,
      ]) {
        const time = flight.duration * progress,
          step = 1e-4;
        const earlier = at(time - step),
          center = at(time),
          later = at(time + step),
          broaderBefore = at(time - 0.01),
          broaderAfter = at(time + 0.01);
        for (const key of ['position', 'look']) {
          const fineCurvature = earlier[key]
            .clone()
            .add(later[key])
            .addScaledVector(center[key], -2)
            .length();
          const broadCurvature = broaderBefore[key]
            .clone()
            .add(broaderAfter[key])
            .addScaledVector(center[key], -2)
            .length();
          assert.ok(
            fineCurvature < broadCurvature * 0.001 + 1e-8,
            `${profile} ${key} velocity jumps at ${progress}`,
          );
        }
        for (const axis of [
          'horizontal',
          'vertical',
          'portraitHorizontal',
          'portraitVertical',
        ]) {
          const value = (view) =>
            view.framing[axis] ??
            (axis === 'portraitVertical' ? view.framing.vertical : 0);
          const fine = Math.abs(
              value(earlier) - 2 * value(center) + value(later),
            ),
            broad = Math.abs(
              value(broaderBefore) - 2 * value(center) + value(broaderAfter),
            );
          assert.ok(
            fine < broad * 0.001 + 1e-8,
            `${profile} ${axis} framing velocity jumps at ${progress}`,
          );
        }
        const clockBefore = (center.et - earlier.et) / step,
          clockAfter = (later.et - center.et) / step;
        assert.ok(
          Math.abs(clockBefore - clockAfter) * step <
            Math.abs(broaderAfter.et - 2 * center.et + broaderBefore.et) *
              0.001 +
              1e-6,
          `${profile} clock velocity jumps at ${progress}`,
        );
      }

      const current = flight.update(flight.duration * 0.63);
      const paused = flight.update(20, true);
      assert.ok(paused.position.equals(current.position));
      assert.ok(paused.look.equals(current.look));
      assert.equal(paused.et, current.et);
      const replacement = new ExpeditionFlight(current, to, data, mobile);
      const first = replacement.update(0);
      assert.ok(first.position.equals(current.position));
      assert.ok(first.look.equals(current.look));
      assert.equal(first.et, current.et);
      assert.deepEqual(first.framing, current.framing);
      const reduced = replacement.update(0, true, true);
      assert.ok(reduced.position.equals(to.position));
      assert.ok(reduced.look.equals(to.look));
      assert.equal(reduced.et, to.et);

      const resized = {
        position: to.position
          .clone()
          .sub(to.look)
          .multiplyScalar(1.2)
          .add(to.look),
        look: to.look,
        framing: { horizontal: 0.28, vertical: 0.12 },
      };
      flight.resizeArrival(resized);
      const held = flight.update(0, true);
      assert.ok(held.position.distanceTo(current.position) < 1e-10);
      assert.ok(held.look.distanceTo(current.look) < 1e-10);
      assert.equal(held.et, current.et);
      for (const axis of [
        'horizontal',
        'vertical',
        'portraitHorizontal',
        'portraitVertical',
      ])
        assert.ok(
          Math.abs((held.framing[axis] ?? 0) - (current.framing[axis] ?? 0)) <
            1e-12,
          `${profile} ${axis} changes at resize`,
        );
      for (const [id, position] of held.bodies)
        assert.ok(position.equals(current.bodies.get(id)));
      const fitted = flight.update(flight.duration);
      assert.ok(fitted.position.equals(resized.position));
      assert.ok(fitted.look.equals(resized.look));
      assert.equal(fitted.et, to.et);

      const acquiring = new ExpeditionFlight(from, to, data, mobile);
      acquiring.update(acquiring.duration * 0.8);
      assert.equal(acquiring.acquiring, true);
      const incoming = new MissionFlight(milestones[b], bundles[b]);
      const moving = absoluteExpeditionView(
        incoming,
        incoming.update(2, false, false, mobile),
      );
      acquiring.setArrival(moving);
      const joined = acquiring.update(acquiring.duration);
      assert.ok(joined.position.equals(moving.position));
      assert.ok(joined.look.equals(moving.look));
      assert.equal(joined.et, moving.et);
      for (const [id, position] of joined.bodies)
        assert.ok(position.equals(moving.bodies.get(id)));
    }
});

test('chapter flights preserve both endpoints, camera clearance and the shared time-lapse clock', () => {
  for (const mobile of [false, true]) {
    for (const [a, b] of [
      ...Array.from({ length: 15 }, (_, i) => [i, i + 1]),
      [15, 0],
      [13, 0],
      [8, 8],
    ]) {
      const from = completedExpeditionView(a, mobile),
        to = expeditionView(b, 0, mobile);
      const flight = new ExpeditionFlight(from, to, timelapse, mobile);
      let frame = flight.update(0);
      assert.ok(frame.position.equals(from.position));
      assert.ok(frame.look.equals(from.look));
      for (let i = 0; i < 500; i++) {
        const previous = frame;
        frame = flight.update(flight.duration / 500);
        assert.ok(frame.position.toArray().every(Number.isFinite));
        assert.ok(frame.position.distanceTo(frame.look) > 1e-10);
        assert.ok(
          (frame.et - previous.et) * Math.sign(to.et - from.et) >= -1e-6,
          `${a} → ${b} clock reversed at ${frame.progress}: ${previous.et} → ${frame.et}`,
        );
        for (const [id, position] of frame.bodies) {
          assert.ok(
            frame.position.distanceTo(position) >
              (frame.radiiKm[id] ?? 1) / KM_PER_UNIT,
            `${a} → ${b}, ${frame.phase}, ${id}: camera inside body`,
          );
          if (frame.phase === 'timelapse')
            assert.ok(
              position.distanceTo(
                world(sampleState(timelapse.tracks[id], frame.et)),
              ) < 1e-9,
            );
        }
      }
      frame = flight.update(1);
      assert.equal(frame.done, true);
      assert.ok(frame.position.equals(to.position));
      assert.ok(frame.look.equals(to.look));
      for (const [id, position] of frame.bodies)
        assert.ok(position.equals(to.bodies.get(id)));
    }
  }
});

test('chapter transfers pause, respect reduced motion and can be interrupted without a cut', () => {
  const from = expeditionView(0, 1),
    to = expeditionView(9, 0);
  for (const elapsed of [0.5, 3.2, 6.1]) {
    const flight = new ExpeditionFlight(from, to, timelapse, false);
    const frame = flight.update(elapsed);
    const paused = flight.update(10, true);
    assert.ok(paused.position.equals(frame.position));
    assert.equal(paused.et, frame.et);
    const replacement = new ExpeditionFlight(
      frame,
      expeditionView(14, 0),
      timelapse,
      false,
    );
    const first = replacement.update(0);
    assert.ok(first.position.equals(frame.position));
    assert.ok(first.look.equals(frame.look));
    assert.equal(first.fovOffset, frame.fovOffset);
    assert.equal(first.bank, frame.bank);
    assert.deepEqual(first.framing, frame.framing);
    for (const [id, position] of first.bodies)
      assert.ok(position.equals(frame.bodies.get(id)));
    const reduced = replacement.update(0, true, true);
    assert.equal(reduced.done, true);
    assert.ok(reduced.position.equals(replacement.to.position));
  }
});

test('resizing an atlas return preserves its current pose and acquires the new camera without changing geometry or time', () => {
  const {
    fitAtlasPortrait,
    atlasPortraitFraming,
  } = require('../app/atlas-camera.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const from = expeditionView(11, 1);
  const atlasBodies = new Map();
  for (const body of bodies) {
    const position = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      position
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(atlasBodies.get(body.parent));
    atlasBodies.set(body.id, position);
  }
  function atlas(width, height) {
    const center = atlasBodies.get('saturn').clone();
    const sunlight = center.clone().negate().normalize();
    const tangent = new THREE.Vector3(-sunlight.z, 0, sunlight.x);
    const direction = sunlight
      .clone()
      .multiplyScalar(0.85)
      .addScaledVector(tangent, 0.75);
    direction.y = 0.38;
    direction.normalize();
    const offset = fitAtlasPortrait(
      direction.multiplyScalar(
        bodyById.saturn.radius * 7.4 * (width <= 760 ? 1.9 : 1),
      ),
      bodyById.saturn,
      width,
      height,
    );
    return {
      position: center.clone().add(offset),
      look: center,
      bodies: atlasBodies,
      radiiKm: Object.fromEntries(
        bodies.map((body) => [body.id, body.radius * KM_PER_UNIT]),
      ),
      et: from.et,
      utc: from.utc,
      atlasBlend: 1,
      framing: atlasPortraitFraming(width, height),
    };
  }
  const original = atlas(1440, 900),
    resized = atlas(375, 700);
  for (const viewport of [
    [375, 700],
    [700, 375],
    [740, 360],
    [844, 390],
  ]) {
    const rotated = atlas(...viewport);
    for (const progress of [0.2, 0.5, 0.8, 0.98]) {
      const flight = new ExpeditionFlight(from, original, null, false);
      const previous = flight.update(flight.duration * progress);
      flight.resizeArrival(rotated);
      const first = flight.update(0, true);
      assert.ok(first.position.distanceTo(previous.position) < 1e-9);
      assert.ok(first.look.distanceTo(previous.look) < 1e-9);
      assert.deepEqual(first.framing, previous.framing);
      assert.equal(first.et, previous.et);
      assert.deepEqual(first.radiiKm, previous.radiiKm);
      for (const [id, position] of first.bodies)
        assert.ok(position.equals(previous.bodies.get(id)));
      const continuing = flight.update(1e-5);
      assert.ok(continuing.position.distanceTo(first.position) < 0.01);
      flight.resizeArrival(atlas(800, 1000));
      const interrupted = flight.update(0, true);
      assert.ok(interrupted.position.distanceTo(continuing.position) < 1e-9);
      const destination = atlas(800, 1000);
      const last = flight.update(flight.duration);
      assert.ok(last.position.equals(destination.position));
      assert.ok(last.look.equals(destination.look));
      assert.deepEqual(last.framing, destination.framing);
      assert.equal(last.et, destination.et);
      for (const [id, position] of last.bodies)
        assert.ok(position.equals(original.bodies.get(id)));
    }
  }
  const reduced = new ExpeditionFlight(from, original, null, false);
  reduced.update(5);
  reduced.resizeArrival(resized);
  assert.ok(reduced.update(0, true, true).position.equals(resized.position));
});

test('cancelling a pending journey preserves the displayed atlas camera', () => {
  const { bodies } = require('../app/solar-data.ts');
  const atlasPositions = new Map(
    bodies.map((body) => [body.id, new THREE.Vector3(body.orbit, 0, 0)]),
  );
  const camera = new THREE.PerspectiveCamera(49, 375 / 700, 0.025, 4000);
  camera.position.set(64, 3, 80);
  const look = new THREE.Vector3(50, 0, 75);
  camera.lookAt(look);
  camera.updateMatrixWorld();
  const before = camera.position.clone(),
    beforeLook = look.clone();
  const points = [new THREE.Vector3(50, 0, 75), new THREE.Vector3(51, 1, 76)];
  const image = points.map((point) => point.clone().project(camera));
  const result = exerciseSceneFunctions(
    `
    let historical = false, missionLoading = true, distance = state.camera.position.distanceTo(state.look);
    const { camera, look, bodies, atlasPositions } = state;
    const positions = new Map(atlasPositions), bodyGroups = new Map();
    const sunPosition = new THREE.Vector3(), pointLight = new THREE.PointLight();
    const currentDestination = 'earth';
    const viewFor = () => ({ target: new THREE.Vector3(22, 0, 0), offset: new THREE.Vector3(3, 1, 2) });
  `,
    [['    function restoreAtlas()', '    function applyHistoricalFrame(']],
    `
    restoreAtlas();
    camera.lookAt(look); camera.updateMatrixWorld();
    return { missionLoading, historical, distance };
  `,
    { camera, look, bodies, atlasPositions },
  );
  assert.equal(result.missionLoading, false);
  assert.equal(result.historical, false);
  assert.ok(camera.position.equals(before));
  assert.ok(look.equals(beforeLook));
  assert.equal(result.distance, before.distanceTo(beforeLook));
  for (let i = 0; i < points.length; i++)
    assert.ok(points[i].clone().project(camera).distanceTo(image[i]) < 1e-12);
});

test('transfer controls discard queued zoom while retaining the next live touch movement', () => {
  const { PointerGesture } = require('../app/pointer-gesture.ts');
  const from = expeditionView(11, 1),
    to = { ...from, atlasBlend: 1 };
  for (const blocked of ['expedition', 'loading']) {
    const result = exerciseSceneFunctions(
      `
      const { PointerGesture } = state;
      let expedition = state.blocked === 'expedition' ? new state.ExpeditionFlight(state.from, state.to, null, true) : null;
      let missionLoading = state.blocked === 'loading';
      const mission = null, flight = null;
      let yaw = .2, pitch = .32, userZoom = 1, interactions = 0;
      const live = { current: { onInteract: () => interactions++ } };
    `,
      [['    let dragging = false;', '    const wheel =']],
      `
      dragging = true;
      gesture.start(4, 110, 330); gesture.start(5, 245, 330);
      move({ pointerId: 5, clientX: 270, clientY: 330 });
      move({ pointerId: 4, clientX: 100, clientY: 330 });
      for (let second = 0; second < 14; second++) {
        zoomBy(1);
        if (expedition?.update(1).done) expedition = null;
      }
      const held = { yaw, pitch, userZoom, interactions };
      up({ pointerId: 4, clientX: 100, clientY: 330 });
      expedition = null; missionLoading = false;
      move({ pointerId: 5, clientX: 271, clientY: 330 });
      const arrived = { yaw, pitch, userZoom };
      zoomBy(1);
      return { held, arrived, zoom: userZoom, interactions };
    `,
      { blocked, PointerGesture, ExpeditionFlight, from, to },
    );
    assert.deepEqual(result.held, {
      yaw: 0.2,
      pitch: 0.32,
      userZoom: 1,
      interactions: 0,
    });
    assert.deepEqual(result.arrived, { yaw: 0.196, pitch: 0.32, userZoom: 1 });
    assert.equal(result.zoom, Math.exp(-0.18));
    assert.equal(result.interactions, 1);
  }
});

test('resizing a mode return refits overview and field compositions without changing the current frame or epoch', () => {
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const helpers = require('../app/atlas-camera.ts');
  const atlasPositions = new Map([['overview', new THREE.Vector3()]]);
  for (const body of bodies) {
    const position = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      position
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(atlasPositions.get(body.parent));
    atlasPositions.set(body.id, position);
  }
  for (const [destination, feature] of [
    ['overview', undefined],
    ['belt', 'belt'],
    ['kuiper', 'belt'],
  ])
    for (const [oldSize, nextSize] of [
      [
        [1440, 900],
        [375, 700],
      ],
      [
        [375, 700],
        [1440, 900],
      ],
      [
        [390, 844],
        [844, 390],
      ],
    ])
      for (const progress of [0.2, 0.5, 0.8, 0.98]) {
        const result = exerciseSceneFunctions(
          `
          const { bodyById, atlasPositions, from, helpers, ExpeditionFlight } = state;
          const { fitAtlasPortrait, fitAtlasFeature, fitAtlasRegion, atlasRegionFraming, atlasPortraitFraming, atlasRingViewDirection, isCompactLandscape } = helpers;
          const positions = atlasPositions, currentDestination = state.destination;
          let width = state.oldSize[0], height = state.oldSize[1], mobile = width <= 760;
          const req = { destination: currentDestination, feature: state.feature, serial: 3 };
          const live = { current: { request: req } }, lastSerial = 3;
          const historical = true, missionLoading = false, expeditionToAtlas = true, flight = null;
           let automaticView;
          const element = { clientWidth: state.nextSize[0], clientHeight: state.nextSize[1] };
          const renderer = { setPixelRatio() {}, setSize() {} }, composer = { setSize() {} };
          const window = { devicePixelRatio: 1 }, scenePixelRatio = () => 1;
          const camera = new THREE.PerspectiveCamera(49, width / height);
        `,
          [['    function viewFor(', '    function restoreAtlas()']],
          `
          const view = viewFor(currentDestination, req.feature);
          const to = { ...from, position: view.target.clone().add(view.offset), look: view.target,
            bodies: atlasPositions, atlasBlend: 1, framing: atlasFraming(currentDestination, req.feature) };
          const expedition = new ExpeditionFlight(from, to, null, mobile);
          const before = expedition.update(expedition.duration * state.progress);
          let cameraFraming = before.framing, distance = before.position.distanceTo(before.look);
          const look = before.look.clone(); camera.position.copy(before.position);
          ${fs.readFileSync('app/solar-scene.tsx', 'utf8').split('    const resize = () => {')[1].split('    resize();')[0].replace(/^/, 'const resize = () => {')}
          resize();
          const current = expedition.update(0, true), expected = viewFor(currentDestination, req.feature, atlasPositions);
          return { before, current, end: expedition.update(expedition.duration),
            target: expected.target, position: expected.target.clone().add(expected.offset), framing: atlasFraming(currentDestination, req.feature) };
        `,
          {
            bodyById,
            atlasPositions,
            from: expeditionView(11, 1),
            helpers,
            ExpeditionFlight,
            destination,
            feature,
            oldSize,
            nextSize,
            progress,
          },
        );
        assert.ok(
          result.current.position.distanceTo(result.before.position) < 1e-9,
        );
        assert.ok(result.current.look.distanceTo(result.before.look) < 1e-9);
        for (const axis of ['horizontal', 'vertical'])
          assert.ok(
            Math.abs(
              result.current.framing[axis] - result.before.framing[axis],
            ) < 1e-12,
          );
        assert.equal(result.current.et, result.before.et);
        assert.ok(result.end.position.equals(result.position));
        assert.ok(result.end.look.equals(result.target));
        assert.deepEqual(result.end.framing, result.framing);
        assert.equal(result.end.et, result.before.et);
      }
});

test('interrupting a discovery or banked flight preserves the projected image', () => {
  for (const mobile of [false, true]) {
    const start = expeditionView(9, 0.7, mobile);
    start.fovOffset = 6.5;
    start.bank = -0.025;
    start.framing = { horizontal: 0.12, vertical: 0.48 };
    const finish = expeditionView(14, 0, mobile);
    const flight = new ExpeditionFlight(start, finish, timelapse, mobile);
    const first = flight.update(0);
    function project(view) {
      const camera = new THREE.PerspectiveCamera(
        (mobile ? 49 : 42) + (view.fovOffset ?? 0),
        mobile ? 390 / 844 : 1440 / 900,
        1e-9,
        30000,
      );
      camera.position.copy(view.position);
      const direction = view.look.clone().sub(view.position).normalize();
      const right = new THREE.Vector3()
        .crossVectors(direction, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, direction).normalize();
      const half =
        camera.position.distanceTo(view.look) *
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const target = view.look
        .clone()
        .addScaledVector(
          right,
          -half *
            camera.aspect *
            (mobile
              ? (view.framing.portraitHorizontal ?? 0)
              : view.framing.horizontal),
        );
      target.addScaledVector(
        up,
        -half *
          (mobile
            ? (view.framing.portraitVertical ?? view.framing.vertical)
            : view.framing.vertical),
      );
      camera.lookAt(target);
      camera.rotateZ(view.bank ?? 0);
      camera.updateMatrixWorld();
      return view.bodies.get('uranus').clone().project(camera);
    }
    assert.ok(project(start).distanceTo(project(first)) < 1e-12);
    const after = flight.update(1 / 120);
    assert.ok(Math.abs(after.fovOffset - start.fovOffset) < 1e-4);
    assert.ok(Math.abs(after.bank - start.bank) < 1e-4);
    const last = flight.update(flight.duration);
    assert.equal(last.fovOffset, 0);
    assert.equal(last.bank, 0);
    assert.deepEqual(last.framing, { horizontal: 0.12, vertical: 0.2 });
  }
});

test('sweeping travel stays continuous and the camera moves while historical time advances', () => {
  const from = expeditionView(4, 1),
    to = expeditionView(14, 0);
  const flight = new ExpeditionFlight(from, to, timelapse, false);
  for (const progress of [0.18, 0.22, 0.3, 0.42, 0.5, 0.58, 0.7, 0.78, 0.86]) {
    const time = flight.duration * progress;
    const before = new ExpeditionFlight(from, to, timelapse, false).update(
      time - 1e-5,
    );
    const after = new ExpeditionFlight(from, to, timelapse, false).update(
      time + 1e-5,
    );
    const earlier = new ExpeditionFlight(from, to, timelapse, false).update(
      time - 1e-3,
    );
    const later = new ExpeditionFlight(from, to, timelapse, false).update(
      time + 1e-3,
    );
    assert.ok(
      before.position.distanceTo(after.position) <
        earlier.position.distanceTo(later.position) * 0.03 + 1e-8,
    );
    assert.ok(
      before.look.distanceTo(after.look) <
        earlier.look.distanceTo(later.look) * 0.03 + 1e-8,
    );
    for (const [id, position] of before.bodies) {
      if (after.bodies.has(id))
        assert.ok(
          position.distanceTo(after.bodies.get(id)) <
            earlier.bodies.get(id).distanceTo(later.bodies.get(id)) * 0.03 +
              1e-8,
        );
    }
  }
  for (const progress of [0.31, 0.45, 0.6, 0.68]) {
    const a = new ExpeditionFlight(from, to, timelapse, false).update(
      flight.duration * progress,
    );
    const b = new ExpeditionFlight(from, to, timelapse, false).update(
      flight.duration * progress + 0.1,
    );
    assert.ok(
      a.position.distanceTo(b.position) > 0.1,
      'no stationary time-lapse shot',
    );
    assert.ok(b.et > a.et);
  }
});

test('atlas layout changes happen at distance and retain exact radii and framing at handoff', () => {
  const historical = expeditionView(11, 1);
  const atlas = {
    ...historical,
    position: new THREE.Vector3(45, 180, 240),
    look: new THREE.Vector3(),
    bodies: new Map(
      [...historical.bodies].map(([id, p]) => [
        id,
        p.clone().multiplyScalar(0.1),
      ]),
    ),
    radiiKm: Object.fromEntries(
      Object.entries(historical.radiiKm).map(([id, radius]) => [
        id,
        radius * 30,
      ]),
    ),
    atlasBlend: 1,
  };
  for (const [from, to] of [
    [historical, atlas],
    [atlas, historical],
  ]) {
    const flight = new ExpeditionFlight(from, to, null, false);
    const first = flight.update(0);
    assert.ok(first.position.equals(from.position));
    assert.deepEqual(first.radiiKm, from.radiiKm);
    const wide = flight.update(
      flight.departureSeconds + flight.timelapseSeconds / 2,
    );
    assert.equal(wide.phase, 'timelapse');
    assert.equal(wide.overview, 1);
    assert.equal(wide.et, from.et);
    const last = flight.update(10);
    assert.ok(last.position.equals(to.position));
    assert.deepEqual(last.radiiKm, to.radiiKm);
    assert.equal(last.atlasBlend, to.atlasBlend ?? 0);
  }
});

test('real mission subsets withhold atlas-only bodies and morph their rendered size continuously across mode switches', () => {
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const historical = { ...expeditionView(0, 0.4, true), atlasBlend: 0 };
  const atlasBodies = new Map();
  for (const body of bodies) {
    const position = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      position
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(atlasBodies.get(body.parent));
    atlasBodies.set(body.id, position);
  }
  const atlas = {
    ...historical,
    position: new THREE.Vector3(45, 180, 240),
    look: new THREE.Vector3(),
    bodies: atlasBodies,
    radiiKm: Object.fromEntries(
      bodies.map((body) => [body.id, body.radius * KM_PER_UNIT]),
    ),
    poles: undefined,
    atlasBlend: 1,
    framing: { horizontal: 0.28, vertical: -0.16 },
  };
  const exclusive = bodies
    .filter((body) => !historical.bodies.has(body.id))
    .map((body) => body.id);
  assert.ok(
    exclusive.length > 10,
    'the fixture uses the full illustrated layout and a real recorded subset',
  );
  const immutable = JSON.stringify(bundles[0]);
  const visibleRadius = (frame, id) =>
    frame.bodies.has(id) ? (frame.radiiKm[id] ?? 0) : 0;
  function sameEndpoint(frame, endpoint) {
    assert.deepEqual(frame.radiiKm, endpoint.radiiKm);
    assert.deepEqual([...frame.bodies.keys()], [...endpoint.bodies.keys()]);
    for (const [id, position] of frame.bodies)
      assert.ok(position.equals(endpoint.bodies.get(id)));
    assert.equal(frame.et, endpoint.et);
    assert.equal(frame.utc, endpoint.utc);
  }
  for (const [from, to] of [
    [historical, atlas],
    [atlas, historical],
  ]) {
    const flight = new ExpeditionFlight(from, to, null, true);
    let previous = flight.update(0);
    sameEndpoint(previous, from);
    for (let tick = 1; tick <= 240; tick++) {
      const frame = flight.update(flight.duration / 240);
      assert.ok(Math.abs(frame.et - historical.et) < 1e-6);
      for (const id of exclusive) {
        const radius = visibleRadius(frame, id),
          full = atlas.radiiKm[id];
        assert.ok(radius >= 0 && radius <= full);
        assert.ok(
          Math.abs(radius - visibleRadius(previous, id)) / full < 0.021,
          `${id} must not appear or disappear at full illustrated size`,
        );
        if (frame.atlasBlend === 0)
          assert.equal(
            radius,
            0,
            `${id} remains withheld in the recorded layout`,
          );
      }
      previous = frame;
    }
    sameEndpoint(flight.update(flight.duration), to);
    for (const progress of [0.1, 0.27, 0.47, 0.82, 0.95]) {
      const outgoing = new ExpeditionFlight(from, to, null, true);
      const interrupted = outgoing.update(outgoing.duration * progress);
      const reverse = new ExpeditionFlight(interrupted, from, null, true);
      sameEndpoint(reverse.update(0), interrupted);
      const paused = reverse.update(2, true);
      sameEndpoint(paused, interrupted);
      const reduced = reverse.update(0, true, true);
      sameEndpoint(reduced, from);
    }
  }
  assert.equal(JSON.stringify(bundles[0]), immutable);
});

test('illustrated belts fade with the camera and stay absent while dated layouts change', () => {
  const historical = { ...expeditionView(11, 1), atlasBlend: 0 };
  const atlas = { ...historical, atlasBlend: 1 };
  for (const [from, to] of [
    [atlas, historical],
    [historical, atlas],
  ]) {
    const flight = new ExpeditionFlight(from, to, null, false);
    let previous = flight.update(0);
    assert.equal(previous.atlasParticles, from.atlasBlend);
    let fadingFrames = 0;
    while (!previous.done) {
      const frame = flight.update(1 / 60);
      assert.ok(
        Math.abs(frame.atlasParticles - previous.atlasParticles) < 0.008,
      );
      if (frame.atlasBlend > 0 && frame.atlasBlend < 1)
        assert.equal(
          frame.atlasParticles,
          0,
          'No invented particles during historical layout changes',
        );
      if (frame.atlasParticles > 0.05 && frame.atlasParticles < 0.95)
        fadingFrames++;
      previous = frame;
    }
    assert.equal(previous.atlasParticles, to.atlasBlend);
    assert.ok(
      fadingFrames > 150,
      'Fade spans the pullback/arrival, not a single frame',
    );
  }
});

test('interrupted mode flights retain belt opacity, including pause and reduced motion', () => {
  const historical = { ...expeditionView(11, 1), atlasBlend: 0 };
  const atlas = { ...historical, atlasBlend: 1 };
  for (const [from, to] of [
    [atlas, historical],
    [historical, atlas],
  ]) {
    for (const progress of [0.1, 0.27, 0.47, 0.82, 0.95]) {
      const first = new ExpeditionFlight(from, to, null, false);
      const interrupted = first.update(first.duration * progress);
      const reverse = new ExpeditionFlight(interrupted, from, null, false);
      assert.equal(
        reverse.update(0).atlasParticles,
        interrupted.atlasParticles,
      );
      assert.equal(
        reverse.update(1, true).atlasParticles,
        interrupted.atlasParticles,
      );
      assert.equal(
        reverse.update(0, false, true).atlasParticles,
        from.atlasBlend,
      );
    }
  }
});

test('belt extent remains present across atlas, dated layouts and floating origins', () => {
  const { createBeltRegion } = require('../app/belt-region.ts');
  const region = createBeltRegion();
  const [band, inner, outer] = region.group.children;
  const sun = new THREE.Vector3(8000, -5000, 12000);
  const au = 149_597_870.7 / KM_PER_UNIT;
  for (const blend of [1, 0.8, 0.5, 0.2, 0]) {
    region.update(sun, blend, 1);
    assert.equal(
      region.group.visible,
      true,
      'A destination must not switch off the belt',
    );
    assert.ok(region.group.position.equals(sun));
    const radii = band.material.uniforms;
    assert.equal(
      radii.innerRadius.value,
      THREE.MathUtils.lerp(2.2 * au, 47, blend),
    );
    assert.equal(
      radii.outerRadius.value,
      THREE.MathUtils.lerp(3.2 * au, 56, blend),
    );
    assert.ok(
      Math.abs(inner.scale.x * 2.2 * au - radii.innerRadius.value) < 1e-10,
    );
    assert.ok(
      Math.abs(outer.scale.x * 3.2 * au - radii.outerRadius.value) < 1e-10,
    );
    assert.equal(band.material.depthWrite, false);
  }
  region.update(sun, 0, 0);
  assert.equal(
    region.group.visible,
    true,
    'Turning off paths retains geographic context',
  );
  assert.equal(band.visible, true);
  assert.equal(inner.visible, false);
  assert.equal(outer.visible, false);
  region.dispose();
});

test('orbit paths finish fading before travel and return softly after arrival at any refresh rate', () => {
  const { PathVisibility } = require('../app/path-visibility.ts');
  for (const fps of [15, 60, 144]) {
    const visibility = new PathVisibility();
    let previous = 1;
    for (let frame = 1; frame <= Math.ceil(fps * 0.45) + 1; frame++) {
      const opacity = visibility.update(false, 1 / fps, false);
      assert.ok(opacity <= previous && opacity >= 0);
      assert.ok(previous - opacity < 0.28, 'No single-frame path cut');
      previous = opacity;
    }
    assert.equal(previous, 0, 'Travel can begin with fully hidden paths');
    for (let frame = 0; frame < fps * 14; frame++)
      assert.equal(
        visibility.update(false, 1 / fps, false),
        0,
        'No paths during travel',
      );
    assert.equal(
      visibility.update(true, 0.1, false),
      0,
      'Leave a brief settling beat',
    );
    for (let frame = 0; frame <= Math.ceil(fps * 1.32); frame++) {
      const opacity = visibility.update(true, 1 / fps, false);
      assert.ok(opacity >= previous && opacity <= 1);
      assert.ok(opacity - previous < 0.11, 'Arrival guides must fade gently');
      previous = opacity;
    }
    assert.equal(previous, 1);
  }
});

test('path fades preserve opacity through pauses, interrupted arrivals and reduced-motion changes', () => {
  const { PathVisibility } = require('../app/path-visibility.ts');
  const visibility = new PathVisibility();
  const departure = visibility.update(false, 0.2, false);
  assert.ok(departure > 0 && departure < 1);
  assert.equal(visibility.update(false, 0, false), departure);
  assert.equal(visibility.update(true, 0, false), departure);
  const returnOpacity = visibility.update(true, 0.45, false);
  assert.ok(returnOpacity > departure);
  assert.equal(visibility.update(false, 0, false), returnOpacity);
  assert.equal(visibility.update(false, 1, false), 0);
  assert.equal(visibility.update(true, 0, true), 1);
  assert.equal(visibility.update(true, 1 / 60, false), 1);
  assert.equal(visibility.update(false, 0, true), 0);
  assert.equal(visibility.update(false, 1 / 60, false), 0);
});

test('discovery pacing holds an encounter, returns, and resumes without skipping elapsed time', () => {
  const stops = [
    { progress: 0.3, body: 'venus', label: 'Flyby' },
    { progress: 0.6, body: 'sun', label: 'Discovery' },
  ];
  const playback = new MissionPlayback(
    10,
    stops,
    { body: 'sun', label: 'Discovery' },
    false,
  );
  playback.advance(5, false, false);
  assert.equal(playback.progress, 0.3);
  assert.equal(playback.beat.stage, 'reveal');
  assert.equal(playback.complete, false);
  const held = playback.beat.progress;
  playback.advance(20, true, false);
  assert.equal(playback.beat.progress, held);
  playback.advance(MissionPlayback.revealSeconds - 1.9, false, false);
  assert.ok(Math.abs(playback.progress - 0.31) < 1e-10);
  assert.equal(playback.beat, undefined);
  for (const fps of [15, 60, 144]) {
    const score = new MissionPlayback(
      10,
      stops,
      { body: 'sun', label: 'Discovery' },
      false,
    );
    const seconds = 7 + 2 * MissionPlayback.revealSeconds;
    for (let i = 0; i < fps * seconds; i++)
      score.advance(1 / fps, false, false);
    assert.ok(Math.abs(score.progress - 0.7) < 1e-9);
    assert.equal(score.complete, false);
    score.advance(10, false, true);
    assert.equal(score.complete, true);
    assert.equal(score.beat, undefined);
  }
});

test('every discovery gets a clear close-up at a fixed ephemeris time and returns to flight', () => {
  for (const mobile of [false, true]) {
    for (let i = 0; i < bundles.length; i++) {
      const mission = new MissionFlight(milestones[i], bundles[i]);
      let previous,
        sawCloseup = false,
        complete = false;
      for (let tick = 0; tick < 1800 && !complete; tick++) {
        const frame = mission.update(1 / 24, false, false, mobile);
        if (frame.discovery) {
          if (frame.discovery.kind !== 'tableau')
            assert.equal(frame.chapterComplete, false);
          if (previous?.discovery?.label === frame.discovery.label)
            assert.equal(frame.et, previous.et);
          for (const [id, center] of mission.bodyPositions) {
            assert.ok(
              frame.position.distanceTo(center) >
                bundles[i].radiiKm[id] / KM_PER_UNIT,
              `${bundles[i].id}: close-up camera inside ${id}`,
            );
          }
          if (frame.discovery.amount > 0.99) {
            sawCloseup = true;
            const center =
              frame.discovery.subject === 'probe'
                ? new THREE.Vector3()
                : mission.bodyPositions.get(frame.discovery.body);
            const radius =
              frame.discovery.subject === 'probe'
                ? mission.craft.scale.x * 1.8
                : bundles[i].radiiKm[frame.discovery.body] / KM_PER_UNIT;
            assert.ok(frame.position.distanceTo(center) / radius < 18);
            const camera = new THREE.PerspectiveCamera(
              mobile ? 49 : 42,
              mobile ? 390 / 844 : 1440 / 900,
              1e-10,
              30000,
            );
            camera.position.copy(frame.position);
            const direction = frame.look
              .clone()
              .sub(frame.position)
              .normalize();
            const right = new THREE.Vector3()
              .crossVectors(direction, camera.up)
              .normalize();
            const up = new THREE.Vector3()
              .crossVectors(right, direction)
              .normalize();
            const half =
              frame.position.distanceTo(frame.look) *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const target = frame.look
              .clone()
              .addScaledVector(
                right,
                -half * camera.aspect * (mobile ? 0 : 0.12),
              );
            target.addScaledVector(
              up,
              -half * (0.2 + (mobile ? frame.discovery.amount * 0.2 : 0)),
            );
            camera.lookAt(target);
            camera.updateMatrixWorld();
            const projected = center.clone().project(camera);
            assert.ok(
              Math.abs(projected.x) < 0.8 &&
                projected.y > -0.2 &&
                projected.y < 0.8,
              `${bundles[i].id} close-up outside usable viewport: ${projected.toArray().join(', ')} mobile=${String(mobile)}`,
            );
          }
        }
        complete = frame.chapterComplete;
        previous = frame;
      }
      assert.ok(sawCloseup, `${bundles[i].id} missing discovery`);
      assert.ok(complete, `${bundles[i].id} did not continue after discovery`);
      mission.dispose();
    }
  }
});

test('a moving arrival hands off the exact incoming probe pose and epoch', () => {
  const from = expeditionView(8, 1),
    to = expeditionView(9, 0);
  const flight = new ExpeditionFlight(from, to, timelapse, false);
  flight.update(flight.duration * 0.9);
  assert.equal(flight.acquiring, true);
  const moving = expeditionView(9, 0.045);
  flight.setArrival(moving);
  const end = flight.update(10);
  assert.ok(end.position.equals(moving.position));
  assert.ok(end.look.equals(moving.look));
  assert.equal(end.et, moving.et);
  for (const [id, position] of end.bodies)
    assert.ok(position.equals(moving.bodies.get(id)));
});

function missionProjection(frame, width, height) {
  const mobile = width <= 760;
  const camera = new THREE.PerspectiveCamera(
    mobile ? 49 : 42,
    width / height,
    1e-10,
    30000,
  );
  camera.position.copy(frame.position);
  const forward = frame.look.clone().sub(frame.position).normalize();
  const right = new THREE.Vector3()
    .crossVectors(forward, camera.up)
    .normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const half =
    frame.position.distanceTo(frame.look) *
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.lookAt(
    frame.look
      .clone()
      .addScaledVector(right, -half * camera.aspect * (mobile ? 0 : 0.12))
      .addScaledVector(
        up,
        -half *
          (0.2 +
            (mobile ? (frame.discovery?.amount ?? 0) * 0.2 : 0) +
            (mobile && height <= 760 ? 0.055 : 0)),
      ),
  );
  camera.updateMatrixWorld();
  return camera;
}

function missionSilhouette(
  geometries,
  center,
  rotation,
  camera,
  width,
  height,
) {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  const point = new THREE.Vector3();
  for (const geometry of geometries) {
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      point
        .fromBufferAttribute(vertices, i)
        .applyQuaternion(rotation)
        .add(center)
        .project(camera);
      assert.ok(
        point.z > -1 && point.z < 1,
        'the entire silhouette is in front of the camera',
      );
      const x = (point.x * 0.5 + 0.5) * width,
        y = (-point.y * 0.5 + 0.5) * height;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
}

test('the terminal chapter returns to a Sun portrait without changing the final source interval or replay state', () => {
  const index = milestones.length - 1,
    data = bundles[index];
  for (const [width, height, bottom] of [
    [1440, 900, 900],
    [375, 700, 316],
    [390, 844, 395],
  ]) {
    const mobile = width <= 760;
    const terminal = new MissionFlight(milestones[index], data, undefined, {
      terminal: true,
    });
    const ordinary = new MissionFlight(milestones[index], data);
    const globe = new THREE.SphereGeometry(
      (data.radiiKm.sun / KM_PER_UNIT) * 1.045,
      128,
      96,
    );
    let frame,
      sawReturn = false,
      pausedOutro = false;
    for (let tick = 0; tick < 6000; tick++) {
      frame = terminal.update(1 / 60, false, false, mobile);
      const reference = ordinary.update(1 / 60, false, false, mobile);
      assert.equal(frame.et, reference.et);
      assert.equal(frame.utc, reference.utc);
      assert.equal(frame.progress, reference.progress);
      assert.equal(frame.chapterComplete, reference.chapterComplete);
      assert.ok(terminal.origin.equals(ordinary.origin));
      for (const [id, position] of terminal.bodyPositions)
        assert.ok(position.equals(ordinary.bodyPositions.get(id)));
      if (frame.progress <= 0.87 || frame.discovery) {
        assert.ok(frame.position.equals(reference.position));
        assert.ok(frame.look.equals(reference.look));
      }
      if (
        frame.discovery?.body === 'sun' &&
        frame.discovery.stage === 'return' &&
        frame.discovery.amount < 0.001
      )
        sawReturn = true;
      assert.ok(frame.position.toArray().every(Number.isFinite));
      assert.ok(
        frame.position.distanceTo(terminal.bodyPositions.get('sun')) >
          data.radiiKm.sun / KM_PER_UNIT,
      );
      if (mobile && frame.progress > 0.87) {
        const portrait = missionSilhouette(
          [globe],
          terminal.bodyPositions.get('sun'),
          new THREE.Quaternion(),
          missionProjection(frame, width, height),
          width,
          height,
        );
        if (portrait.maxY - portrait.minY > 60)
          assert.ok(
            portrait.minX >= 18 &&
              portrait.maxX <= width - 18 &&
              portrait.minY >= 110 &&
              portrait.maxY <= (height <= 760 ? 324 : 430),
            `the resolved closing portrait overlaps the interface: ${JSON.stringify(portrait)}`,
          );
      }
      if (!pausedOutro && frame.progress > 0.93 && frame.progress < 1) {
        const held = terminal.update(20, true, false, mobile);
        assert.ok(held.position.equals(frame.position));
        assert.ok(held.look.equals(frame.look));
        assert.equal(held.et, frame.et);
        pausedOutro = true;
      }
      if (frame.chapterComplete) break;
    }
    assert.ok(sawReturn, 'the final probe-return shot is retained');
    assert.ok(pausedOutro);
    assert.equal(frame.chapterComplete, true);
    assert.equal(frame.et, data.end);
    assert.equal(frame.utc.slice(11, 16), '14:42');
    assert.ok(
      terminal.origin.distanceTo(
        world(sampleState(data.tracks.craft, data.end)),
      ) < 1e-10,
    );
    const final = frame;
    const heldEnd = terminal.update(100, false, false, mobile);
    assert.ok(heldEnd.position.equals(final.position));
    assert.ok(heldEnd.look.equals(final.look));
    assert.equal(heldEnd.et, data.end);
    const bounds = missionSilhouette(
      [globe],
      terminal.bodyPositions.get('sun'),
      new THREE.Quaternion(),
      missionProjection(final, width, height),
      width,
      height,
    );
    assert.ok(bounds.minX >= 18 && bounds.maxX <= width - 18);
    assert.ok(
      bounds.minY >= (mobile ? 110 : 0),
      `the closing Sun clears the date at ${width}×${height}: ${JSON.stringify(bounds)}`,
    );
    assert.ok(
      bounds.maxY <= bottom,
      `the closing Sun clears the narrative at ${width}×${height}: ${JSON.stringify(bounds)}`,
    );
    assert.ok(
      bounds.maxY - bounds.minY > (mobile ? 170 : 300),
      'the ending resolves a clear solar disk',
    );
    globe.dispose();

    terminal.seek(0.8);
    ordinary.seek(0.8);
    const earlier = terminal.update(0, true, false, mobile),
      pursuit = ordinary.update(0, true, false, mobile);
    assert.ok(earlier.position.equals(pursuit.position));
    assert.ok(earlier.look.equals(pursuit.look));
    terminal.seek(0);
    const fresh = new MissionFlight(milestones[index], data, undefined, {
      terminal: true,
    });
    const replay = terminal.update(0, true, false, mobile),
      opening = fresh.update(0, true, false, mobile);
    assert.ok(replay.position.equals(opening.position));
    assert.ok(replay.look.equals(opening.look));
    assert.equal(replay.et, data.start);
    const reduced = fresh.update(0, false, true, mobile);
    assert.ok(reduced.position.equals(final.position));
    assert.ok(reduced.look.equals(final.look));
    assert.equal(reduced.et, data.end);
    assert.equal(reduced.chapterComplete, true);
    terminal.dispose();
    ordinary.dispose();
    fresh.dispose();
  }
});

test('the terminal portrait joins smoothly at the source interval and its stationary ending', () => {
  const index = milestones.length - 1;
  for (const mobile of [false, true]) {
    const at = (progress) => {
      const mission = new MissionFlight(
        milestones[index],
        bundles[index],
        undefined,
        { terminal: true },
      );
      mission.seek(progress);
      const frame = mission.update(0, true, false, mobile);
      frame.position.add(mission.origin);
      frame.look.add(mission.origin);
      mission.dispose();
      return frame;
    };
    for (const progress of [0.87, 0.94, 1]) {
      const center = at(progress),
        before = at(progress - 1e-5),
        after = at(progress + 1e-5),
        widerBefore = at(progress - 0.001),
        widerAfter = at(progress + 0.001);
      for (const key of ['position', 'look']) {
        const fine = before[key]
            .clone()
            .add(after[key])
            .addScaledVector(center[key], -2)
            .length(),
          broad = widerBefore[key]
            .clone()
            .add(widerAfter[key])
            .addScaledVector(center[key], -2)
            .length();
        assert.ok(fine < broad * 0.001 + 1e-9, `${key} snaps at ${progress}`);
      }
    }
  }
});

test('mobile Uranus discovery keeps its full tilted ring silhouette inside the viewport throughout observation', () => {
  const index = milestones.findIndex(
      (milestone) => milestone.body === 'uranus',
    ),
    data = bundles[index],
    radius = data.radiiKm.uranus / KM_PER_UNIT;
  const globe = new THREE.SphereGeometry(radius, 128, 96),
    ring = new THREE.RingGeometry(radius * 1.65, radius * 2.05, 512);
  ring.rotateX(-Math.PI / 2);
  const sourcePole = data.poles.uranus,
    pole = new THREE.Vector3(
      sourcePole[0],
      sourcePole[2],
      -sourcePole[1],
    ).normalize(),
    rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      pole,
    );
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [320, 568],
  ]) {
    const mission = new MissionFlight(milestones[index], data);
    let samples = 0;
    for (let tick = 0; tick < 1600; tick++) {
      const frame = mission.update(1 / 30, false, false, true);
      if (frame.discovery?.amount > 0.99) {
        const bounds = missionSilhouette(
          [globe, ring],
          mission.bodyPositions.get('uranus'),
          rotation,
          missionProjection(frame, width, height),
          width,
          height,
        );
        assert.ok(
          bounds.minX >= 16 && bounds.maxX <= width - 16,
          `rings clip at ${width}×${height}: ${JSON.stringify(bounds)}`,
        );
        assert.ok(
          bounds.minY >= 72 && bounds.maxY <= height - 312,
          `rings leave the scene band: ${JSON.stringify(bounds)}`,
        );
        assert.ok(
          Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) > 160,
          'the complete rings remain legible',
        );
        samples++;
      }
      if (frame.chapterComplete) break;
    }
    assert.ok(samples > 100);
    mission.dispose();
  }
  globe.dispose();
  ring.dispose();
});

test('Hermite sampling reproduces a known accelerated trajectory and its velocity', () => {
  // x=t^3, y=2t^2, z=4t; derivatives are independent analytic expectations.
  const track = [
    [0, 0, 0, 0, 0, 0, 4],
    [10, 1000, 200, 40, 300, 40, 4],
  ];
  for (const t of [0, 1, 3.5, 7.2, 10]) {
    const actual = sampleState(track, t);
    const expected = [t, t ** 3, 2 * t * t, 4 * t, 3 * t * t, 4 * t, 4];
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
  }
  assert.throws(() => sampleState(track, -1), RangeError);
  assert.throws(() => sampleState(track, 11), RangeError);
});

test('catalogue identities, reference frames, coverage and source checks are complete', () => {
  assert.equal(bundles.length, 16);
  for (let i = 0; i < bundles.length; i++) {
    const d = bundles[i],
      r = missionRecords[i];
    assert.equal(d.id, r.id);
    assert.equal(!!d.tracks.craft, r.quality !== 'unavailable');
    for (const id of [
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
    ])
      assert.ok(d.tracks[id], `${r.id} missing ${id}`);
    const raw = JSON.parse(
      fs.readFileSync(`public/ephemeris/${r.id}.json`, 'utf8'),
    );
    for (const [id, error] of Object.entries(raw.validation.maxPositionErrorKm))
      assert.ok(
        error <= (id === 'craft' ? (r.quality === 'archival' ? 10 : 1) : 5),
        `${r.id} ${id}: ${error}`,
      );
    for (const entry of Object.values(raw.provenance))
      assert.ok(entry.provider && entry.target !== -399110);
    for (let j = 1; j < d.clock.length; j++) {
      assert.ok(d.clock[j].progress > d.clock[j - 1].progress);
      assert.ok(d.clock[j].et >= d.clock[j - 1].et);
    }
  }
});

test('pause, seek, forward and reverse scrubbing use the same instant for every object', () => {
  for (let i = 0; i < bundles.length; i++) {
    const d = bundles[i],
      flight = new MissionFlight(milestones[i], d);
    for (const p of [0, 0.37, 0.95, 0.12, 1]) {
      flight.seek(p);
      const frame = flight.update(0, true, false, false);
      const clock = missionTime(d, d.tracks.craft ? p : 1);
      assert.equal(frame.et, clock.et);
      const first = frame.position.clone();
      assert.ok(first.equals(flight.update(10, true, false, false).position));
      for (const [id, position] of flight.bodyPositions) {
        const expected = world(sampleState(d.tracks[id], frame.et)).sub(
          flight.origin,
        );
        assert.ok(position.distanceTo(expected) < 1e-9, `${d.id} ${id}`);
      }
    }
    flight.dispose();
  }
});

test('close-encounter ranges agree with independent mission records at their stated precision', () => {
  // Centre distances: NASA mission summaries / JPL target datasheets. Broad
  // archive tolerances represent source uncertainty, not interpolation accuracy.
  const expected = {
    mariner2: [40948, 250],
    pioneer10: [200000, 5000],
    mariner10: [3143, 100],
    uranus: [107000, 3000],
    neptune: [29700, 1000],
    horizons: [13674, 5],
    parker: [8440, 200],
  };
  for (const [id, [range, tolerance]] of Object.entries(expected)) {
    const d = bundles.find((d) => d.id === id),
      e = d.events[0];
    const actual =
      world(sampleState(d.tracks.craft, e.et)).distanceTo(
        world(sampleState(d.tracks[e.body], e.et)),
      ) * KM_PER_UNIT;
    assert.ok(
      Math.abs(actual - range) < tolerance,
      `${id}: ${actual} vs ${range}`,
    );
  }
});

test('gravity-assist flybys bend the relative velocity and planets move during the encounter', () => {
  for (const id of ['uranus', 'neptune', 'parker']) {
    const d = bundles.find((d) => d.id === id),
      e = d.events[0];
    const relativeVelocity = (t) => {
      const craft = sampleState(d.tracks.craft, t),
        body = sampleState(d.tracks[e.body], t);
      return new THREE.Vector3(
        craft[4] - body[4],
        craft[5] - body[5],
        craft[6] - body[6],
      );
    };
    const a = e.et - 10800,
      b = e.et + 10800;
    assert.ok(
      relativeVelocity(a).angleTo(relativeVelocity(b)) > 0.05,
      `${id}: no flyby bend`,
    );
    assert.ok(
      world(sampleState(d.tracks[e.body], a)).distanceTo(
        world(sampleState(d.tracks[e.body], b)),
      ) > 0.01,
    );
  }
});

test('camera framing stays finite and outside worlds through real-size encounters and mobile views', () => {
  for (let i = 0; i < bundles.length; i++)
    for (const mobile of [false, true]) {
      const d = bundles[i],
        flight = new MissionFlight(milestones[i], d);
      const camera = new THREE.PerspectiveCamera(
        mobile ? 49 : 42,
        mobile ? 390 / 844 : 1440 / 900,
        1e-9,
        30000,
      );
      for (let j = 0; j <= 100; j++) {
        flight.seek(j / 100);
        const frame = flight.update(0, true, false, mobile);
        assert.ok(
          [...frame.position.toArray(), ...frame.look.toArray()].every(
            Number.isFinite,
          ),
        );
        for (const [id, center] of flight.bodyPositions) {
          const radius = (d.radiiKm[id] ?? 1) / KM_PER_UNIT;
          assert.ok(
            frame.position.distanceTo(center) > radius,
            `${d.id} camera inside ${id} at ${j}`,
          );
        }
        camera.position.copy(frame.position);
        // Match the scene's editorial off-centre composition.
        const h =
          camera.position.distanceTo(frame.look) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const direction = frame.look.clone().sub(camera.position).normalize();
        const right = new THREE.Vector3()
          .crossVectors(direction, camera.up)
          .normalize();
        const look = frame.look
          .clone()
          .addScaledVector(right, -h * camera.aspect * (mobile ? 0 : 0.12));
        look.addScaledVector(
          new THREE.Vector3().crossVectors(right, direction).normalize(),
          -h * 0.2,
        );
        camera.lookAt(look);
        camera.updateMatrixWorld();
        if (d.tracks.craft) {
          const projected = new THREE.Vector3().project(camera);
          assert.ok(
            Math.abs(projected.x) < 0.9 &&
              projected.y > -0.36 &&
              projected.y < 0.8,
            `${d.id} craft out of frame ${j} mobile=${String(mobile)}: ${projected.toArray().join(', ')}`,
          );
        }
      }
      flight.dispose();
    }
});

test('playback speed and reduced motion do not change the recorded path', () => {
  const index = 2,
    d = bundles[index];
  for (const fps of [15, 30, 60, 144]) {
    const flight = new MissionFlight(milestones[index], d);
    let frame;
    for (let i = 0; i < fps * 10; i++)
      frame = flight.update(1 / fps, false, false, false);
    assert.ok(
      Math.abs(frame.progress - 10 / milestones[index].journey.seconds) < 1e-10,
    );
    assert.equal(flight.update(0, false, true, false).phase, 'discovery');
    flight.dispose();
  }
});

test('loader rejects mismatched units, backwards clocks and missing interval coverage', () => {
  const original = bundles[2];
  const badUnits = structuredClone(original);
  badUnits.units = 'AU, day';
  assert.throws(() => validateEphemeris(badUnits));
  const badClock = structuredClone(original);
  badClock.clock[1].et = original.start - 1;
  assert.throws(() => validateEphemeris(badClock));
  const truncated = structuredClone(original);
  truncated.tracks.craft.pop();
  assert.throws(() => validateEphemeris(truncated));
});

// Post-flight NH reference: pdssbn.astro.umd.edu/holdings/pds4-nh_documents-v4.2/mission/documents/nh_mission_overview.pdf
test('matched encounter ephemerides reproduce the published encounter clock', () => {
  for (const [id, utc, toleranceSeconds] of [
    ['uranus', '1986-01-24T17:59:00Z', 60],
    ['neptune', '1989-08-25T03:56:00Z', 60],
    ['horizons', '2015-07-14T11:48:28.771Z', 2],
  ]) {
    const event = bundles.find((d) => d.id === id).events[0];
    assert.ok(
      Math.abs(Date.parse(event.utc) - Date.parse(utc)) <
        toleranceSeconds * 1000,
      `${id}: ${event.utc}`,
    );
  }
});

test('source-model boundaries cannot be interpolated into fictitious manoeuvres', () => {
  const d = bundles.find((d) => d.id === 'parker');
  assert.ok(d.seams.craft.length > 0);
  for (const seam of d.seams.craft) {
    assert.ok(seam.jumpKm <= 5);
    const middle = (seam.start + seam.end) / 2;
    const i = d.clock.findIndex((anchor) => anchor.et >= middle);
    const a = d.clock[i - 1],
      b = d.clock[i];
    let low = a.progress,
      high = b.progress;
    for (let j = 0; j < 60; j++) {
      const mid = (low + high) / 2;
      if (missionTime({ ...d, seams: {} }, mid).et < middle) low = mid;
      else high = mid;
    }
    const progress = (low + high) / 2;
    assert.equal(missionTime(d, progress).et, seam.end);
    assert.throws(
      () =>
        sampleState(d.tracks.craft, (seam.start + seam.end) / 2, d.seams.craft),
      RangeError,
    );
    assert.doesNotThrow(() =>
      sampleState(d.tracks.craft, seam.start, d.seams.craft),
    );
    assert.doesNotThrow(() =>
      sampleState(d.tracks.craft, seam.end, d.seams.craft),
    );
  }
});

test('opening milestones orbit continuously without rewinding the zoom or the historical clock', () => {
  for (const index of [0, 1]) {
    const flight = new MissionFlight(milestones[index], bundles[index]);
    const first = flight.update(0, true, false, false);
    const directions = [];
    let lastDistance = Infinity;
    for (let tick = 0; tick < 160; tick++) {
      const frame = flight.update(0.1, false, false, false);
      assert.equal(frame.et, first.et);
      assert.equal(frame.discovery.kind, 'tableau');
      assert.notEqual(frame.discovery.stage, 'return');
      const offset = frame.position.clone().sub(frame.look);
      assert.ok(offset.length() <= lastDistance + 1e-9);
      lastDistance = offset.length();
      directions.push(offset.normalize());
    }
    assert.ok(
      directions[40].angleTo(directions[120]) > 0.6,
      `${bundles[index].id}: the opening is only a static zoom`,
    );
    for (let tick = 1; tick < directions.length; tick++)
      assert.ok(
        directions[tick].angleTo(directions[tick - 1]) < 0.025,
        `${bundles[index].id}: abrupt orbital camera turn`,
      );
    flight.dispose();
  }
});

test('the welcome Earth portrait frames a lit limb without changing recorded geometry', () => {
  const {
    welcomePortrait,
    welcomeFraming,
  } = require('../app/welcome-camera.ts');
  for (const [width, height] of [
    [1920, 889],
    [390, 844],
    [375, 700],
    [320, 568],
    [700, 375],
    [760, 390],
    [761, 390],
    [844, 390],
  ]) {
    const mobile = width <= 760;
    const landscape = width > height && width <= 1000;
    const flight = new MissionFlight(milestones[0], bundles[0]);
    const canonical = flight.update(0, true, false, mobile);
    const center = flight.bodyPositions.get('earth').clone();
    const sun = flight.bodyPositions.get('sun').clone();
    const radius = bundles[0].radiiKm.earth / KM_PER_UNIT;
    const sourcePole = bundles[0].poles.earth;
    const pole = new THREE.Vector3(
      sourcePole[0],
      sourcePole[2],
      -sourcePole[1],
    );
    const position = canonical.position.clone(),
      look = canonical.look.clone();
    welcomePortrait(
      position,
      look,
      center,
      sun,
      radius,
      pole,
      1,
      width,
      height,
    );
    const lightAngle = position
      .clone()
      .sub(center)
      .angleTo(sun.clone().sub(center));
    assert.ok(lightAngle > THREE.MathUtils.degToRad(50));
    assert.ok(lightAngle < THREE.MathUtils.degToRad(65));
    const heightFraction =
      Math.tan(Math.asin(radius / position.distanceTo(center))) /
      Math.tan(THREE.MathUtils.degToRad((mobile ? 49 : 42) / 2));
    assert.ok(
      landscape
        ? Math.abs(heightFraction - 0.66) < 1e-12
        : mobile
          ? heightFraction > 0.38 && heightFraction < 0.43
          : heightFraction > 0.65 && heightFraction < 0.72,
      'the desktop portrait fills the right composition; the phone preserves room below',
    );
    const framing = welcomeFraming(
      { horizontal: 0.12, vertical: 0.2 },
      1,
      width,
      height,
    );
    const camera = new THREE.PerspectiveCamera(
      mobile ? 49 : 42,
      width / height,
      1e-10,
      30000,
    );
    camera.position.copy(position);
    const forward = look.clone().sub(position).normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, camera.up)
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const halfHeight =
      position.distanceTo(look) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.lookAt(
      look
        .clone()
        .addScaledVector(
          right,
          -halfHeight * camera.aspect * framing.horizontal,
        )
        .addScaledVector(
          up,
          -halfHeight *
            (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
        ),
    );
    camera.updateMatrixWorld();
    const projected = center.clone().project(camera);
    assert.ok(
      mobile && !landscape
        ? Math.abs(projected.x) < 1e-12
        : projected.x > 0.4 && projected.x < 0.5,
    );
    assert.ok(
      mobile && !landscape
        ? projected.y > 0.4 && projected.y < 0.6
        : Math.abs(projected.y) < 0.15,
    );
    if (landscape) {
      const towardCamera = position.clone().sub(center).normalize();
      const limbCenter = center
        .clone()
        .addScaledVector(
          towardCamera,
          (radius * radius) / position.distanceTo(center),
        );
      const limbRadius =
        radius * Math.sqrt(1 - (radius / position.distanceTo(center)) ** 2);
      const limbRight = new THREE.Vector3()
        .crossVectors(towardCamera, pole)
        .normalize();
      const limbUp = new THREE.Vector3()
        .crossVectors(towardCamera, limbRight)
        .normalize();
      const bounds = {
        left: Infinity,
        right: -Infinity,
        top: Infinity,
        bottom: -Infinity,
      };
      for (let sample = 0; sample < 180; sample++) {
        const angle = (sample * Math.PI * 2) / 180;
        const point = limbCenter
          .clone()
          .addScaledVector(limbRight, Math.cos(angle) * limbRadius)
          .addScaledVector(limbUp, Math.sin(angle) * limbRadius)
          .project(camera);
        const x = ((point.x + 1) * width) / 2;
        const y = ((1 - point.y) * height) / 2;
        bounds.left = Math.min(bounds.left, x);
        bounds.right = Math.max(bounds.right, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.bottom = Math.max(bounds.bottom, y);
      }
      assert.ok(
        bounds.left > width * 0.52,
        `${width}×${height}: Earth covers the left typography`,
      );
      assert.ok(
        bounds.right < width - 12,
        `${width}×${height}: Earth clips at the right edge ${JSON.stringify(bounds)}`,
      );
      assert.ok(
        bounds.top > 30 && bounds.bottom < height - 30,
        `${width}×${height}: Earth leaves the landscape scene`,
      );
    }
    assert.ok(flight.bodyPositions.get('earth').equals(center));
    assert.ok(flight.bodyPositions.get('sun').equals(sun));
    assert.equal(flight.update(0, true, false, mobile).et, canonical.et);
    flight.dispose();
  }
});

test('the welcome handoff holds the opening epoch and joins its exact camera at every refresh rate', () => {
  const {
    WelcomeCamera,
    welcomePortrait,
  } = require('../app/welcome-camera.ts');
  for (const fps of [30, 60, 144]) {
    const entrance = new WelcomeCamera();
    const flight = new MissionFlight(milestones[0], bundles[0]);
    const first = flight.update(0, true, false, false);
    assert.equal(entrance.update(100, true, false, false), 1);
    let previous;
    for (
      let tick = 0;
      tick <= Math.ceil(fps * WelcomeCamera.handoffSeconds);
      tick++
    ) {
      const amount = entrance.update(tick ? 1 / fps : 0, true, true, false);
      const frame = flight.update(1 / fps, true, false, false);
      const sourcePole = bundles[0].poles.earth;
      const pole = new THREE.Vector3(
        sourcePole[0],
        sourcePole[2],
        -sourcePole[1],
      );
      welcomePortrait(
        frame.position,
        frame.look,
        flight.bodyPositions.get('earth'),
        flight.bodyPositions.get('sun'),
        bundles[0].radiiKm.earth / KM_PER_UNIT,
        pole,
        amount,
        1920,
        889,
        entrance.drift,
      );
      assert.equal(frame.et, first.et);
      if (previous)
        assert.ok(
          frame.position.distanceTo(previous) < first.position.length() * 0.05,
        );
      previous = frame.position.clone();
    }
    assert.ok(previous.distanceTo(first.position) < 1e-12);
    assert.equal(entrance.update(0, false, false, true), 0);
    flight.dispose();
  }
});

test('welcome drift waits for Earth, freezes on reduced motion and leaves from the displayed pose', () => {
  const {
    WelcomeCamera,
    welcomePortrait,
    welcomeFraming,
  } = require('../app/welcome-camera.ts');
  for (const fps of [30, 144]) {
    const entrance = new WelcomeCamera();
    assert.equal(entrance.update(40, true, false, false, false), 1);
    assert.equal(
      entrance.drift,
      0,
      'loading time does not consume the welcome motion',
    );
    const flight = new MissionFlight(milestones[0], bundles[0]);
    const source = flight.update(0, true, false, true);
    const earth = flight.bodyPositions.get('earth').clone();
    const sun = flight.bodyPositions.get('sun').clone();
    const sourcePole = bundles[0].poles.earth;
    const pole = new THREE.Vector3(
      sourcePole[0],
      sourcePole[2],
      -sourcePole[1],
    );
    const radius = bundles[0].radiiKm.earth / KM_PER_UNIT;
    let minimum = Infinity,
      maximum = -Infinity;
    for (let tick = 0; tick < fps * 75; tick++) {
      entrance.update(1 / fps, true, false, false, true);
      minimum = Math.min(minimum, entrance.drift);
      maximum = Math.max(maximum, entrance.drift);
    }
    assert.ok(minimum < -0.069 && maximum > 0.069);
    assert.ok(minimum >= -0.07 && maximum <= 0.07);
    entrance.update(9, true, false, false, true);
    const drift = entrance.drift;
    entrance.update(10, true, false, true, true);
    assert.equal(
      entrance.drift,
      drift,
      'reduced motion holds the current portrait without a jump',
    );
    const display = (amount, width, height) => {
      const frame = flight.update(0, true, false, width <= 760);
      welcomePortrait(
        frame.position,
        frame.look,
        earth,
        sun,
        radius,
        pole,
        amount,
        width,
        height,
        entrance.drift,
      );
      return {
        ...frame,
        framing: welcomeFraming(
          { horizontal: 0.12, vertical: 0.2 },
          amount,
          width,
          height,
        ),
      };
    };
    const before = display(1, 390, 844);
    const joining = display(
      entrance.update(0, true, true, false, true),
      390,
      844,
    );
    assert.ok(joining.position.equals(before.position));
    assert.ok(joining.look.equals(before.look));
    assert.deepEqual(joining.framing, before.framing);
    let previous = joining;
    for (
      let tick = 1;
      tick <= Math.ceil(fps * WelcomeCamera.handoffSeconds);
      tick++
    ) {
      const amount = entrance.update(
        1 / fps,
        tick < fps * 1.2,
        true,
        false,
        true,
      );
      const frame = display(
        amount,
        tick < fps ? 390 : 844,
        tick < fps ? 844 : 390,
      );
      assert.equal(frame.et, source.et);
      assert.ok(frame.position.distanceTo(earth) > radius * 1.3);
      assert.ok(frame.position.toArray().every(Number.isFinite));
      if (tick !== fps)
        assert.ok(
          frame.position.distanceTo(previous.position) < radius * 0.25,
          'the welcome join makes an abrupt camera step',
        );
      previous = frame;
      assert.equal(
        entrance.drift,
        drift,
        'the idle phase stays fixed during the join',
      );
    }
    const canonical = flight.update(0, true, false, false);
    assert.ok(previous.position.distanceTo(canonical.position) < 1e-12);
    assert.ok(previous.look.distanceTo(canonical.look) < 1e-12);
    assert.deepEqual(previous.framing, { horizontal: 0.12, vertical: 0.2 });
    assert.equal(entrance.update(0, false, false, true, true), 0);
    assert.ok(flight.bodyPositions.get('earth').equals(earth));
    assert.ok(flight.bodyPositions.get('sun').equals(sun));
    flight.dispose();
  }
});

test('enabling reduced motion settles a paused atlas transfer at its fitted endpoint', () => {
  const {
    AtlasFramingTransition,
    atlasPortraitFraming,
  } = require('../app/atlas-camera.ts');
  function step(state, paused, reduced) {
    return exerciseSceneFunctions(
      `
      const { camera, look, offset, currentDestination, travelDelta } = state;
      const p = { flightPaused: state.paused, speed: 1 }, reduced = { matches: state.reduced };
      const smooth = x => THREE.MathUtils.smootherstep(x, 0, 1);
      const easeFlight = smooth;
      let { flight, cameraFraming, distance, yaw, pitch, telemetry } = state;
      let cameraBank = 0;
      if (false) {
      `,
      [
        [
          '      } else if (flight) {',
          '      } else if (!missionLoading && !telemetry.ephemerisError) {',
        ],
      ],
      `
      }
      return { ...state, flight, cameraFraming, distance, yaw, pitch, telemetry };
      `,
      { ...state, paused, reduced },
    );
  }
  for (const progress of [0.04, 0.4, 0.93]) {
    const target = new THREE.Vector3(53, 0, 74);
    const endOffset = new THREE.Vector3(-12, 8, 24);
    const end = target.clone().add(endOffset);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(45, 180, 240),
      new THREE.Vector3(50, 195, 265),
      end.clone().add(new THREE.Vector3(-3, 10, 5)),
      end,
    ]);
    const framing = new AtlasFramingTransition(
      { horizontal: 0.28, vertical: -0.16 },
      atlasPortraitFraming(390, 844),
    );
    const fitted = atlasPortraitFraming(844, 390);
    framing.retarget(fitted, progress);
    const resizedOffset = endOffset.clone().multiplyScalar(0.82);
    let state = {
      currentDestination: 'saturn',
      travelDelta: 1 / 60,
      camera: new THREE.PerspectiveCamera(),
      look: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      cameraFraming: framing.at(progress),
      distance: 100,
      yaw: 0,
      pitch: 0,
      telemetry: {},
      flight: {
        t: progress,
        duration: 8,
        curve,
        fromLook: new THREE.Vector3(),
        toLook: target,
        endOffset: resizedOffset,
        framing,
        resizeCorrection: {
          progress,
          from: new THREE.Vector3(),
          to: resizedOffset.clone().sub(endOffset),
        },
      },
    };
    state = step(state, true, false);
    const before = state.camera.position.clone();
    for (let tick = 0; tick < 3; tick++) state = step(state, true, false);
    assert.equal(state.flight.t, progress);
    assert.ok(state.camera.position.equals(before));
    state = step(state, false, false);
    assert.ok(state.flight.t > progress && state.flight.t < 1);
    state = step(state, true, true);
    assert.equal(state.flight, null);
    assert.equal(state.telemetry.phase, 'orbit');
    assert.equal(state.telemetry.progress, 1);
    assert.ok(
      state.camera.position.distanceTo(target.clone().add(resizedOffset)) <
        1e-12,
    );
    assert.ok(state.look.equals(target));
    assert.ok(state.offset.equals(resizedOffset));
    assert.deepEqual(state.cameraFraming, fitted);
  }
  const mission = new MissionFlight(milestones[11], bundles[11]);
  mission.seek(0.38);
  const before = mission.update(0, true, false, true);
  const paused = mission.update(10, true, true, true);
  assert.equal(paused.et, before.et);
  assert.ok(paused.position.equals(before.position));
  assert.ok(paused.look.equals(before.look));
  mission.dispose();

  const from = expeditionView(11, 0.38);
  const to = {
    ...from,
    atlasBlend: 1,
    framing: atlasPortraitFraming(390, 844),
  };
  const bridge = new ExpeditionFlight(from, to, null, true);
  bridge.update(bridge.duration * 0.4);
  const settled = bridge.update(0, true, true);
  assert.equal(settled.done, true);
  assert.equal(settled.atlasBlend, 1);
  assert.ok(settled.position.equals(to.position));
  assert.ok(settled.look.equals(to.look));
  assert.deepEqual(settled.framing, to.framing);
});

test('nearby outer-moon arrivals acquire their subject smoothly without changing the camera route', () => {
  const helpers = require('../app/atlas-camera.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const lead = helpers.atlasArrivalLookProgress;
  assert.equal(lead(-0.1), 0);
  assert.equal(lead(0), 0);
  assert.equal(lead(0.5), 1);
  assert.equal(lead(1), 1);
  assert.equal(lead(1.1), 1);
  let previous = 0;
  for (let tick = 0; tick <= 100; tick++) {
    const progress = lead(tick / 100);
    assert.ok(progress >= previous && progress <= 1);
    previous = progress;
  }
  const epsilon = 1e-4;
  for (const join of [0, 0.5]) {
    assert.ok(
      Math.abs((lead(join + epsilon) - lead(join - epsilon)) / (2 * epsilon)) <
        1e-5,
    );
    assert.ok(
      Math.abs(
        (lead(join + epsilon) - 2 * lead(join) + lead(join - epsilon)) /
          epsilon ** 2,
      ) < 0.02,
    );
  }
  const positions = new Map();
  for (const body of bodies) {
    const center = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      center
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(positions.get(body.parent));
    positions.set(body.id, center);
  }
  const source = fs.readFileSync('app/solar-scene.tsx', 'utf8');
  const routeSource = source.slice(
    source.indexOf('      const start = camera.position.clone();'),
    source.indexOf('      const duration ='),
  );
  function route(width, height, from, to, feature) {
    return exerciseSceneFunctions(
      `
      const { helpers, positions, bodyById, width, height } = state;
      const { fitAtlasPortrait, fitAtlasFeature, fitAtlasRegion, atlasRingViewDirection, isCompactLandscape } = helpers;
      const mobile = width <= 760, currentDestination = state.from;
      const selected = bodyById[state.to], req = { feature: state.feature };
      const camera = new THREE.Camera();
      `,
      [['    function viewFor(', '    function atlasFraming(']],
      `
      const from = viewFor(state.from), dest = viewFor(state.to, state.feature), look = from.target;
      camera.position.copy(from.target).add(from.offset);
      ${routeSource}
      return { curve, fromLook, toLook: dest.target, end, leadArrival };
      `,
      { helpers, positions, bodyById, width, height, from, to, feature },
    );
  }
  for (const [from, to, feature, expected] of [
    ['uranus', 'miranda', undefined, true],
    ['umbriel', 'miranda', undefined, true],
    ['miranda', 'oberon', undefined, true],
    ['neptune', 'triton', undefined, true],
    ['miranda', 'oberon', 'parent', false],
    ['uranus', 'oberon', 'parent', false],
    ['jupiter', 'miranda', undefined, false],
    ['miranda', 'triton', undefined, false],
    ['saturn', 'titan', undefined, false],
    ['earth', 'moon', undefined, false],
  ])
    assert.equal(route(390, 844, from, to, feature).leadArrival, expected);

  let missedByFormerGaze = 0;
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [844, 390],
  ]) {
    const mobile = width <= 760,
      area = atlasViewingFixture(width, height);
    const framing = helpers.atlasPortraitFraming(width, height);
    const camera = new THREE.PerspectiveCamera(
      mobile ? 49 : 42,
      width / height,
      0.01,
      4000,
    );
    for (const [from, to] of [
      ['umbriel', 'miranda'],
      ['miranda', 'oberon'],
      ['neptune', 'triton'],
    ]) {
      const path = route(width, height, from, to);
      const target = positions.get(to);
      function image(progress, led) {
        const travel = THREE.MathUtils.smootherstep(progress, 0, 1);
        camera.position.copy(path.curve.getPoint(travel));
        const look = path.fromLook
          .clone()
          .lerp(path.toLook, led ? lead(progress) : travel);
        const forward = look.clone().sub(camera.position).normalize();
        const right = new THREE.Vector3()
          .crossVectors(forward, camera.up)
          .normalize();
        const up = new THREE.Vector3().crossVectors(right, forward);
        const half =
          camera.position.distanceTo(look) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.lookAt(
          look
            .addScaledVector(
              right,
              -half *
                camera.aspect *
                (mobile && !area.landscape ? 0 : framing.horizontal),
            )
            .addScaledVector(
              up,
              -half *
                (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
            ),
        );
        camera.updateMatrixWorld();
        const point = target.clone().project(camera);
        return {
          position: camera.position.clone(),
          x: (point.x * 0.5 + 0.5) * width,
          y: (0.5 - point.y * 0.5) * height,
          z: point.z,
        };
      }
      for (const progress of [0.5, 0.55, 0.65, 0.75, 0.9, 1]) {
        const acquired = image(progress, true),
          former = image(progress, false);
        assert.ok(
          acquired.position.equals(former.position),
          'the authored camera route is unchanged',
        );
        assert.ok(acquired.z > -1 && acquired.z < 1);
        assert.ok(
          acquired.x > area.left &&
            acquired.x < area.right &&
            acquired.y > area.top &&
            acquired.y < area.bottom,
          `${from}→${to} loses its selected moon after acquisition at ${width}×${height}`,
        );
        assert.ok(
          acquired.position.distanceTo(target) > bodyById[to].radius * 1.3,
          'the camera remains outside the selected moon',
        );
        if (
          former.x < area.left ||
          former.x > area.right ||
          former.y < area.top ||
          former.y > area.bottom
        )
          missedByFormerGaze++;
      }
      assert.ok(path.curve.getPoint(1).distanceTo(path.end) < 1e-12);
    }
  }
  assert.ok(
    missedByFormerGaze > 0,
    'the comparison must exercise the observed empty-centre failure',
  );
});

test('atlas composition joins retain the projected image through travel, interruption and repeated viewport changes', () => {
  const {
    AtlasFramingTransition,
    atlasPortraitFraming,
    atlasRegionFraming,
    isCompactLandscape,
  } = require('../app/atlas-camera.ts');
  const points = new THREE.SphereGeometry(1, 24, 16).getAttribute('position');
  function project(framing, width, height) {
    const mobile = width <= 760;
    const portrait = mobile && !isCompactLandscape(width, height);
    const camera = new THREE.PerspectiveCamera(
      mobile ? 49 : 42,
      width / height,
      0.01,
      4000,
    );
    camera.position.set(4, 2, 8);
    const forward = camera.position.clone().negate().normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, camera.up)
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const half =
      camera.position.length() *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.lookAt(
      right
        .multiplyScalar(
          -half * camera.aspect * (portrait ? 0 : framing.horizontal),
        )
        .addScaledVector(
          up,
          -half * (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
        ),
    );
    camera.updateMatrixWorld();
    return Array.from({ length: points.count }, (_, i) => {
      const point = new THREE.Vector3()
        .fromBufferAttribute(points, i)
        .project(camera);
      return new THREE.Vector2(
        (point.x * 0.5 + 0.5) * width,
        (-point.y * 0.5 + 0.5) * height,
      );
    });
  }
  function sameImage(a, b, width, height, reason) {
    const before = project(a, width, height),
      after = project(b, width, height);
    for (let i = 0; i < before.length; i++)
      assert.ok(before[i].distanceTo(after[i]) < 1e-9, reason);
  }
  const viewports = [
    [375, 700],
    [390, 844],
    [700, 375],
    [844, 390],
    [1440, 900],
  ];
  for (const [width, height] of viewports) {
    const portrait = atlasPortraitFraming(width, height),
      region = atlasRegionFraming(width, height),
      field = { horizontal: 0.28, vertical: width <= 760 ? -0.16 : 0.12 };
    for (const [from, to] of [
      [portrait, field],
      [field, portrait],
      [region, field],
      [field, region],
    ]) {
      const flight = new AtlasFramingTransition(from, to);
      sameImage(
        from,
        flight.at(0),
        width,
        height,
        'selection keeps the outgoing image',
      );
      sameImage(
        to,
        flight.at(1),
        width,
        height,
        'arrival reaches the fitted composition',
      );
      for (const progress of [0.17, 0.5, 0.83, 0.98]) {
        const current = flight.at(progress);
        sameImage(
          current,
          flight.at(progress),
          width,
          height,
          'pausing holds the image',
        );
        const interrupted = new AtlasFramingTransition(current, from);
        sameImage(
          current,
          interrupted.at(0),
          width,
          height,
          'reselecting during travel starts at the current image',
        );
        for (const [nextWidth, nextHeight] of viewports) {
          const resized = new AtlasFramingTransition(from, to);
          const previous = resized.at(progress);
          const target = atlasPortraitFraming(nextWidth, nextHeight);
          resized.retarget(target, progress);
          sameImage(
            previous,
            resized.at(progress),
            nextWidth,
            nextHeight,
            'rotation changes the viewport without adding a composition jump',
          );
          const continuing = resized.at(progress + 1e-6);
          const before = project(previous, nextWidth, nextHeight),
            after = project(continuing, nextWidth, nextHeight);
          for (let i = 0; i < before.length; i++)
            assert.ok(before[i].distanceTo(after[i]) < 0.01);
          const secondProgress = (1 + progress) / 2;
          const second = resized.at(secondProgress);
          const secondTarget = atlasRegionFraming(width, height);
          resized.retarget(secondTarget, secondProgress);
          sameImage(
            second,
            resized.at(secondProgress),
            width,
            height,
            'a second rotation retains the joined image',
          );
          sameImage(
            secondTarget,
            resized.at(1),
            width,
            height,
            'resized travel reaches the latest destination composition',
          );
        }
      }
    }
  }
});

test('illustrated moon solids clear their parent ring annuli throughout their orbits', () => {
  const { bodies, bodyById } = require('../app/solar-data.ts');
  for (const moon of bodies.filter((body) =>
    ['saturn', 'uranus'].includes(body.parent),
  )) {
    const parent = bodyById[moon.parent];
    const outer = parent.radius * (parent.id === 'saturn' ? 2.31 : 2.05);
    const limb = moon.radius * Math.max(1, ...(moon.shape ?? []));
    assert.ok(
      moon.orbit - limb > outer,
      `${moon.id}'s complete solid must clear its parent's outer ring`,
    );
  }
  assert.ok(bodyById.mimas.orbit < bodyById.enceladus.orbit);
  assert.ok(bodyById.miranda.orbit < bodyById.ariel.orbit);
});

test('the dedicated Uranus ring view retains aperture, full silhouettes and calm automatic motion', () => {
  const {
    atlasRingViewDirection,
    atlasPortraitFraming,
    fitAtlasFeature,
    AtlasAutoOrbit,
  } = require('../app/atlas-camera.ts');
  const { bodyById } = require('../app/solar-data.ts');
  const body = bodyById.uranus;
  const sunlight = new THREE.Vector3(
    -Math.cos(body.angle),
    0,
    -Math.sin(body.angle),
  );
  const preservedSunlight = sunlight.clone();
  const direction = atlasRingViewDirection(body, sunlight);
  const axis = new THREE.Vector3(0, 0, 1);
  const pole = new THREE.Vector3(0, 1, 0).applyAxisAngle(axis, body.tilt);
  assert.ok(sunlight.equals(preservedSunlight));
  assert.ok(Math.abs(direction.length() - 1) < 1e-12);
  assert.ok(Math.abs(direction.dot(pole)) > 0.64);
  assert.ok(
    direction.dot(sunlight) > 0.8,
    'the authored view faces the illuminated side',
  );
  const legacy = new THREE.Vector3(0.1, 0.9, 1).normalize();
  assert.ok(atlasRingViewDirection(bodyById.saturn, sunlight).equals(legacy));
  assert.ok(
    Math.abs(legacy.dot(pole)) < 0.2,
    'the former Uranus view was nearly edge-on',
  );
  for (const light of [pole.clone(), pole.clone().negate()]) {
    const view = atlasRingViewDirection(body, light);
    assert.ok(Number.isFinite(view.length()));
    assert.ok(Math.abs(view.length() - 1) < 1e-12);
    assert.ok(Math.abs(view.dot(pole)) > 0.64);
  }
  const globe = new THREE.SphereGeometry(body.radius, 32, 24);
  const ring = new THREE.RingGeometry(
    body.radius * 1.65,
    body.radius * 2.05,
    512,
  );
  ring.rotateX(-Math.PI / 2);
  const points = [];
  for (const geometry of [globe, ring]) {
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++)
      points.push(
        new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyAxisAngle(axis, body.tilt),
      );
    geometry.dispose();
  }
  function fitted(width, height) {
    return fitAtlasFeature(
      direction
        .clone()
        .multiplyScalar(body.radius * 5.8 * (width <= 760 ? 1.9 : 1)),
      [{ body, center: new THREE.Vector3() }],
      width,
      height,
    );
  }
  for (const [width, height] of [
    [390, 844],
    [375, 700],
    [844, 390],
  ]) {
    const offset = fitted(width, height);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const viewport = {
      width,
      height,
      subject: body,
      minimumRingAperture: 0.55,
    };
    const context = {
      radius: offset.length(),
      pitch: Math.PI / 2 - spherical.phi,
      target: new THREE.Vector3(),
      subject: new THREE.Vector3(),
      parent: new THREE.Vector3(),
      parentRadius: 0,
      viewport,
    };
    const camera = new THREE.PerspectiveCamera();
    function project(
      observer,
      currentWidth = width,
      currentHeight = height,
      rotated = false,
    ) {
      const area = atlasViewingFixture(currentWidth, currentHeight);
      const mobile = currentWidth <= 760;
      if (rotated && mobile && !area.landscape) {
        area.left = 0;
        area.right = currentWidth;
      }
      camera.aspect = currentWidth / currentHeight;
      camera.fov = mobile ? 49 : 42;
      camera.updateProjectionMatrix();
      camera.position.copy(observer);
      const forward = observer.clone().normalize().negate();
      const right = new THREE.Vector3()
        .crossVectors(forward, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward);
      const half =
        observer.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const framing = atlasPortraitFraming(currentWidth, currentHeight);
      camera.lookAt(
        right
          .multiplyScalar(
            -half *
              camera.aspect *
              (mobile && !area.landscape ? 0 : framing.horizontal),
          )
          .addScaledVector(
            up,
            -half *
              (framing.vertical + (mobile && currentHeight <= 760 ? 0.055 : 0)),
          ),
      );
      camera.updateMatrixWorld();
      for (const vertex of points) {
        const point = vertex.clone().project(camera);
        const x = (point.x * 0.5 + 0.5) * currentWidth,
          y = (0.5 - point.y * 0.5) * currentHeight;
        assert.ok(
          x >= area.left &&
            x <= area.right &&
            y >= area.top &&
            y <= area.bottom,
          `Uranus ring view crosses UI at ${currentWidth}×${currentHeight}: ${x},${y}`,
        );
      }
    }
    const orbit = new AtlasAutoOrbit();
    let angle = spherical.theta,
      minimum = angle,
      maximum = angle;
    assert.equal(orbit.advance(0, angle, context), angle);
    const observer = offset.clone(),
      desired = new THREE.Vector3();
    for (let tick = 0; tick < 3600; tick++) {
      const before = angle;
      angle = orbit.advance(1 / 30, angle, context);
      assert.ok(Math.abs(angle - before) <= 0.027 / 30 + 1e-12);
      minimum = Math.min(minimum, angle);
      maximum = Math.max(maximum, angle);
      desired.setFromSphericalCoords(context.radius, spherical.phi, angle);
      assert.ok(Math.abs(desired.clone().normalize().dot(pole)) >= 0.55);
      observer.lerp(desired, 1 - Math.exp(-6 / 30));
      if (tick % 15 === 0) project(observer);
    }
    assert.ok(
      maximum - minimum > 0.01,
      'the authored ring view has a visible automatic arc',
    );
    const held = angle;
    assert.equal(orbit.advance(0, angle, context), held);
    const resized = fitted(height, width);
    const rotatedObserver = observer
      .clone()
      .multiplyScalar(resized.length() / offset.length());
    project(rotatedObserver, height, width, true);
    viewport.width = height;
    viewport.height = width;
    assert.equal(
      orbit.advance(0, angle, { ...context, radius: resized.length() }),
      held,
    );
    assert.equal(orbit.advance(0, 0, context), 0);
    assert.equal(
      orbit.advance(1, 0, context),
      0,
      'an edge-on manual pose stays where the user placed it',
    );
    assert.ok(fitted(width, height).equals(offset));
  }
});

test('automatic moon arcs retain close arrivals and clear the parent throughout complete cycles and viewport changes', () => {
  const { AtlasAutoOrbit, ...helpers } = require('../app/atlas-camera.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const moons = bodies.filter((body) => body.parent);
  assert.equal(moons.length, 21);
  const immutable = JSON.stringify(bodies);
  const positions = new Map([['overview', new THREE.Vector3()]]);
  for (const body of bodies) {
    const position = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      position
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(positions.get(body.parent));
    positions.set(body.id, position);
  }
  const source = fs.readFileSync('app/solar-scene.tsx', 'utf8');
  const authored = source.slice(
    source.indexOf('    function viewFor('),
    source.indexOf('    function atlasFraming('),
  );
  const compiled = ts.transpileModule(`${authored}\nexport { viewFor };`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const createView = require('node:vm').compileFunction(compiled, [
    'exports',
    'THREE',
    'bodyById',
    'positions',
    'fitAtlasPortrait',
    'fitAtlasFeature',
    'fitAtlasRegion',
    'atlasRingViewDirection',
    'isCompactLandscape',
    'width',
    'height',
    'mobile',
  ]);
  function view(width, height, id, feature) {
    const output = {};
    createView(
      output,
      THREE,
      bodyById,
      positions,
      helpers.fitAtlasPortrait,
      helpers.fitAtlasFeature,
      helpers.fitAtlasRegion,
      helpers.atlasRingViewDirection,
      helpers.isCompactLandscape,
      width,
      height,
      width <= 760,
    );
    return output.viewFor(id, feature);
  }
  const axis = new THREE.Vector3(0, 0, 1);
  function parentClearance(observer, subject, parentId) {
    const body = bodyById[parentId],
      parent = positions.get(parentId);
    const dimensions = new THREE.Vector3(
      body.radius,
      body.radius *
        (parentId === 'jupiter' || parentId === 'saturn' ? 0.92 : 1),
      body.radius,
    );
    const start = subject
      .clone()
      .sub(parent)
      .applyAxisAngle(axis, -(body.tilt ?? 0.05))
      .divide(dimensions);
    const end = observer
      .clone()
      .sub(parent)
      .applyAxisAngle(axis, -(body.tilt ?? 0.05))
      .divide(dimensions);
    const segment = end.sub(start);
    const along = THREE.MathUtils.clamp(
      -start.dot(segment) / segment.lengthSq(),
      0,
      1,
    );
    return start.addScaledVector(segment, along).length();
  }
  const viewports = [
    [375, 700],
    [390, 844],
    [320, 568],
    [1440, 900],
    [1920, 889],
    [700, 375],
    [844, 390],
  ];
  const dt = 1 / 30;
  for (const [width, height] of viewports)
    for (const moon of moons) {
      const selected = view(width, height, moon.id);
      const spherical = new THREE.Spherical().setFromVector3(selected.offset);
      const context = {
        radius: selected.offset.length(),
        pitch: Math.PI / 2 - spherical.phi,
        target: selected.target,
        subject: positions.get(moon.id),
        parent: positions.get(moon.parent),
        parentRadius: bodyById[moon.parent].radius,
      };
      const initial = selected.target.clone().add(selected.offset);
      if (moon.id === 'mimas' && width === 375 && height === 700) {
        const parent = bodyById.saturn,
          parentCenter = positions.get('saturn'),
          parentTilt = parent.tilt ?? 0.05;
        const planeNormal = new THREE.Vector3(0, 1, 0).applyAxisAngle(
          axis,
          parentTilt,
        );
        const surface = new THREE.SphereGeometry(moon.radius, 96, 64);
        surface.scale(...moon.shape);
        const vertices = surface.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          const local = new THREE.Vector3().fromBufferAttribute(vertices, i);
          const normal = local
            .clone()
            .divide(
              new THREE.Vector3(...moon.shape).multiply(
                new THREE.Vector3(...moon.shape),
              ),
            )
            .applyAxisAngle(axis, moon.tilt ?? 0.05);
          const point = local
            .applyAxisAngle(axis, moon.tilt ?? 0.05)
            .add(context.subject);
          if (normal.dot(initial.clone().sub(point)) <= 0) continue;
          const ray = point.clone().sub(initial);
          const intersection =
            -initial.clone().sub(parentCenter).dot(planeNormal) /
            ray.dot(planeNormal);
          if (intersection <= 0 || intersection >= 1) continue;
          const crossing = initial
            .clone()
            .addScaledVector(ray, intersection)
            .sub(parentCenter)
            .applyAxisAngle(axis, -parentTilt);
          const radius = Math.hypot(crossing.x, crossing.z);
          assert.ok(
            radius < parent.radius * 1.14 || radius > parent.radius * 2.31,
            'Saturn’s ring plane must not cut across the visible Mimas silhouette at the default phone arrival',
          );
        }
        surface.dispose();
      }
      assert.ok(
        parentClearance(initial, context.subject, moon.parent) > 1,
        `${moon.id} authored arrival or sightline enters its parent at ${width}×${height}`,
      );
      const orbit = new AtlasAutoOrbit();
      let angle = spherical.theta;
      assert.equal(
        orbit.advance(0, angle, context),
        angle,
        'arrival pose is exact',
      );
      const observer = initial.clone(),
        desired = new THREE.Vector3();
      const previous = observer.clone();
      for (let tick = 0; tick < 7200; tick++) {
        const lastAngle = angle;
        angle = orbit.advance(dt, angle, context);
        assert.ok(
          Math.abs(angle - lastAngle) <= dt * 0.027 + 1e-10,
          'automatic turns never jump or exceed the existing angular speed',
        );
        desired
          .setFromSphericalCoords(
            context.radius,
            Math.PI / 2 - context.pitch,
            angle,
          )
          .add(context.target);
        observer.lerp(desired, 1 - Math.exp(-dt * 6));
        if (tick % 10 === 0) {
          assert.ok(
            parentClearance(observer, context.subject, moon.parent) > 1,
            `${moon.id} observer or sightline crosses its parent at ${width}×${height}, ${tick * dt}s`,
          );
          assert.ok(
            Math.abs(
              observer.distanceTo(context.subject) / context.radius - 1,
            ) < 0.001,
            'automatic inspection keeps the close-up radius instead of pulling the moon away',
          );
        }
        assert.ok(
          observer.distanceTo(previous) <= context.radius * dt * 0.0271,
        );
        previous.copy(observer);
      }
      const held = angle;
      for (let i = 0; i < 20; i++)
        assert.equal(orbit.advance(0, angle, context), held);
      angle = orbit.advance(dt, angle, context);
      assert.ok(Math.abs(angle - held) <= dt * 0.027 + 1e-10);
      for (const [nextWidth, nextHeight] of viewports) {
        const resized = view(nextWidth, nextHeight, moon.id);
        const changed = { ...context, radius: resized.offset.length() };
        const rejoin = orbit.advance(0, angle, changed);
        assert.ok(
          Math.abs(rejoin - angle) < 1e-10,
          'resize retains the current camera direction',
        );
        angle = orbit.advance(dt, rejoin, changed);
        assert.ok(Math.abs(angle - rejoin) <= dt * 0.027 + 1e-10);
        const resizedObserver = new THREE.Vector3()
          .setFromSphericalCoords(
            changed.radius,
            Math.PI / 2 - changed.pitch,
            angle,
          )
          .add(changed.target);
        assert.ok(
          parentClearance(resizedObserver, changed.subject, moon.parent) > 1,
          `${moon.id} rotated viewport retains parent clearance`,
        );
      }
      const manual = angle + 0.3;
      const zoomed = {
        ...context,
        radius: context.radius * 1.5,
        pitch: context.pitch + 0.1,
      };
      assert.equal(
        orbit.advance(0, manual, zoomed),
        manual,
        'manual orbit and zoom are accepted without a corrective recenter',
      );
      if (
        width <= 390 &&
        height >= 700 &&
        ['europa', 'enceladus', 'iapetus'].includes(moon.id)
      ) {
        for (const zoom of [2, 4, 8]) {
          const inspected = { ...context, radius: context.radius * zoom };
          const inspection = new AtlasAutoOrbit();
          let inspectionAngle = spherical.theta;
          const eye = new THREE.Vector3()
            .setFromSphericalCoords(
              inspected.radius,
              Math.PI / 2 - inspected.pitch,
              inspectionAngle,
            )
            .add(inspected.target);
          const clearManualPose =
            parentClearance(eye, inspected.subject, moon.parent) > 1.05;
          assert.equal(
            inspection.advance(0, inspectionAngle, inspected),
            inspectionAngle,
          );
          for (let tick = 0; tick < 7200; tick++) {
            const next = inspection.advance(dt, inspectionAngle, inspected);
            if (clearManualPose) {
              eye
                .setFromSphericalCoords(
                  inspected.radius,
                  Math.PI / 2 - inspected.pitch,
                  next,
                )
                .add(inspected.target);
              if (tick % 10 === 0)
                assert.ok(
                  parentClearance(eye, inspected.subject, moon.parent) > 1,
                  `${moon.id} zoom ${zoom} automatic arc retains parent clearance`,
                );
            } else
              assert.equal(
                next,
                inspectionAngle,
                'an obstructed manual pose is held without an automatic correction',
              );
            inspectionAngle = next;
          }
        }
      }
      orbit.reset();
      assert.equal(
        orbit.advance(0, spherical.theta, context),
        spherical.theta,
        'resetting or interrupting a destination leaves the new arrival unchanged',
      );
    }
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [320, 568],
    [844, 390],
  ])
    for (const id of [
      'titan',
      'mimas',
      'miranda',
      'ariel',
      'umbriel',
      'titania',
      'oberon',
      'triton',
      'moon',
    ]) {
      const moon = bodyById[id],
        parent = bodyById[moon.parent];
      const selected = view(width, height, id, moon.featureView);
      const spherical = new THREE.Spherical().setFromVector3(selected.offset);
      const viewport = { width, height, subject: moon, parent };
      const context = {
        radius: selected.offset.length(),
        pitch: Math.PI / 2 - spherical.phi,
        target: selected.target,
        subject: positions.get(id),
        parent: positions.get(moon.parent),
        parentRadius: parent.radius,
        viewport,
      };
      const vertices = [];
      for (const body of [moon, parent]) {
        const globe = new THREE.SphereGeometry(body.radius, 24, 16);
        if (body.shape) globe.scale(...body.shape);
        if (body.id === 'saturn') globe.scale(1, 0.92, 1);
        const geometries = [globe];
        if (body.id === 'saturn' || body.id === 'uranus') {
          const ring = new THREE.RingGeometry(
            body.radius * 1.1,
            body.radius * (body.id === 'saturn' ? 2.31 : 2.05),
            512,
          );
          ring.rotateX(-Math.PI / 2);
          geometries.push(ring);
        }
        for (const geometry of geometries) {
          const points = geometry.getAttribute('position');
          for (let i = 0; i < points.count; i++)
            vertices.push(
              new THREE.Vector3()
                .fromBufferAttribute(points, i)
                .applyAxisAngle(axis, body.tilt ?? 0.05)
                .add(positions.get(body.id)),
            );
          geometry.dispose();
        }
      }
      const camera = new THREE.PerspectiveCamera(
        width <= 760 ? 49 : 42,
        width / height,
        0.01,
        4000,
      );
      function visible(
        observer,
        currentWidth = width,
        currentHeight = height,
        rotated = false,
      ) {
        const area = atlasViewingFixture(currentWidth, currentHeight);
        const framing = helpers.atlasPortraitFraming(
          currentWidth,
          currentHeight,
        );
        const mobile = currentWidth <= 760;
        // A retained direction may consume the portrait's side margin after
        // rotation, while the real canvas and vertical interface remain clear.
        if (rotated && mobile && !area.landscape) {
          area.left = 0;
          area.right = currentWidth;
        }
        // The conservative landscape band may lose up to one pixel when a
        // retained direction is resized; authored poses and cycles stay strict.
        const tolerance = rotated && area.landscape ? 1 : 0;
        camera.aspect = currentWidth / currentHeight;
        camera.fov = mobile ? 49 : 42;
        camera.updateProjectionMatrix();
        camera.position.copy(observer);
        const forward = selected.target.clone().sub(observer).normalize();
        const right = new THREE.Vector3()
          .crossVectors(forward, camera.up)
          .normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        const half =
          observer.distanceTo(selected.target) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.lookAt(
          selected.target
            .clone()
            .addScaledVector(
              right,
              -half * camera.aspect * (mobile && !area.landscape ? 0 : 0.28),
            )
            .addScaledVector(
              up,
              -half *
                (framing.vertical +
                  (mobile && currentHeight <= 760 ? 0.055 : 0)),
            ),
        );
        camera.updateMatrixWorld();
        const bounds = {
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
        };
        for (const vertex of vertices) {
          const point = vertex.clone().project(camera);
          const x = (point.x * 0.5 + 0.5) * currentWidth,
            y = (0.5 - point.y * 0.5) * currentHeight;
          bounds.minX = Math.min(bounds.minX, x);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.minY = Math.min(bounds.minY, y);
          bounds.maxY = Math.max(bounds.maxY, y);
        }
        assert.ok(
          bounds.minX >= area.left - tolerance &&
            bounds.maxX <= area.right + tolerance &&
            bounds.minY >= area.top - tolerance &&
            bounds.maxY <= area.bottom + tolerance,
          `${id} parent system crosses the interface at ${currentWidth}×${currentHeight}: ${JSON.stringify(bounds)}`,
        );
      }
      const orbit = new AtlasAutoOrbit();
      let angle = spherical.theta;
      const observer = selected.target.clone().add(selected.offset);
      const original = observer.clone();
      assert.equal(orbit.advance(0, angle, context), angle);
      assert.ok(observer.equals(original));
      visible(observer);
      const desired = new THREE.Vector3();
      let minimum = angle,
        maximum = angle;
      let direction = 0;
      const turns = [];
      for (let tick = 0; tick < 3600; tick++) {
        const previous = angle;
        angle = orbit.advance(dt, angle, context);
        minimum = Math.min(minimum, angle);
        maximum = Math.max(maximum, angle);
        const nextDirection = Math.sign(angle - previous);
        if (nextDirection && direction && nextDirection !== direction)
          turns.push(tick * dt);
        if (nextDirection) direction = nextDirection;
        assert.ok(Math.abs(angle - previous) <= dt * 0.027 + 1e-10);
        desired
          .setFromSphericalCoords(
            context.radius,
            Math.PI / 2 - context.pitch,
            angle,
          )
          .add(context.target);
        observer.lerp(desired, 1 - Math.exp(-dt * 6));
        if (tick % 15 === 0) visible(observer);
      }
      if (id === 'titan')
        assert.ok(
          maximum - minimum > 0.001,
          'the clear Titan pair still moves',
        );
      for (let i = 1; i < turns.length; i++)
        assert.ok(
          turns[i] - turns[i - 1] > 50,
          'constrained pair arcs reverse calmly instead of rocking rapidly',
        );
      const held = angle;
      for (let i = 0; i < 10; i++)
        assert.equal(orbit.advance(0, angle, context), held);
      viewport.width = height;
      viewport.height = width;
      const resized = view(height, width, id, moon.featureView);
      const changed = { ...context, radius: resized.offset.length() };
      const resizedObserver = observer
        .clone()
        .sub(selected.target)
        .multiplyScalar(changed.radius / context.radius)
        .add(selected.target);
      visible(resizedObserver, height, width, true);
      assert.equal(orbit.advance(0, angle, changed), held);
      assert.ok(
        Math.abs(orbit.advance(dt, angle, changed) - held) <=
          dt * 0.027 + 1e-10,
      );
      const manual = angle + 0.3;
      assert.equal(
        orbit.advance(0, manual, { ...context, radius: context.radius * 0.7 }),
        manual,
      );
      orbit.reset();
      assert.equal(orbit.advance(0, spherical.theta, context), spherical.theta);
      assert.ok(
        view(width, height, id, moon.featureView).offset.equals(
          selected.offset,
        ),
      );
    }
  const unconstrained = {
    radius: 100,
    pitch: 0.25,
    target: new THREE.Vector3(),
    subject: new THREE.Vector3(),
    parent: new THREE.Vector3(0, 0, -10),
    parentRadius: 2.8,
  };
  const pair = new AtlasAutoOrbit(),
    plain = new AtlasAutoOrbit();
  let pairAngle = 0.5,
    plainAngle = 0.5;
  const viewport = {
    width: 1920,
    height: 1080,
    subject: bodyById.titan,
    parent: bodyById.saturn,
  };
  for (let tick = 0; tick < 3600; tick++) {
    pairAngle = pair.advance(dt, pairAngle, { ...unconstrained, viewport });
    plainAngle = plain.advance(dt, plainAngle, unconstrained);
    assert.ok(
      Math.abs(pairAngle - plainAngle) < 1e-12,
      'an unconstrained pair retains the original automatic trajectory',
    );
  }
  assert.equal(JSON.stringify(bodies), immutable);
});

function atlasViewingFixture(width, height) {
  // Measured layout contract: left account, right toolbar and bottom navigation.
  const landscape = {
    '568x320': { left: 265.04, right: 502.96, top: 80, bottom: 220 },
    '700x375': { left: 269, right: 631, top: 80, bottom: 275 },
    '740x360': { left: 277, right: 669.8, top: 80, bottom: 260 },
    '844x390': { left: 313.4, right: 770.68, top: 80, bottom: 290 },
  }[`${width}x${height}`];
  if (landscape) return { ...landscape, landscape: true };
  const mobile = width <= 760;
  return {
    left: mobile
      ? width * 0.05
      : width * 0.041 + (width <= 1100 ? 255 : 285) + 32,
    right: mobile ? width * 0.95 : width * 0.959 - 54,
    top: mobile ? (height <= 650 ? 205 : Math.max(280, height * 0.34)) : 116,
    bottom: height - (mobile ? (height <= 650 ? 232 : 275) : 212),
    landscape: false,
  };
}

test('atlas labels clear phone controls, notes and landscape status', () => {
  const { atlasLabelFits } = require('../app/atlas-camera.ts');
  assert.equal(
    atlasLabelFits(187.5, 432.2, 375, 700),
    false,
    'the observed Ceres label must not sit under the camera toolbar',
  );
  for (const [width, height, clearY, obscuredY] of [
    [375, 700, 370, 405],
    [390, 844, 510, 550],
    [320, 568, 280, 315],
    [844, 390, 210, 265],
  ]) {
    const x = width === 844 ? 550 : width / 2;
    assert.equal(atlasLabelFits(x, clearY, width, height), true);
    assert.equal(atlasLabelFits(x, obscuredY, width, height), false);
    assert.equal(atlasLabelFits(x, 140, width, height), width === 844);
    assert.equal(atlasLabelFits(35, clearY, width, height), false);
    assert.equal(atlasLabelFits(width - 35, clearY, width, height), false);
  }
});

test('default atlas portraits keep globes and tilted rings clear of notes and navigation', () => {
  const {
    fitAtlasPortrait,
    atlasPortraitFraming,
  } = require('../app/atlas-camera.ts');
  const { bodyById } = require('../app/solar-data.ts');
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [923, 615],
    [1440, 900],
    [800, 1000],
    [761, 900],
    [760, 900],
    [320, 568],
    [375, 600],
    [700, 375],
    [740, 360],
    [844, 390],
  ]) {
    const mobile = width <= 760;
    const area = atlasViewingFixture(width, height);
    assert.ok(area.bottom > area.top && area.right > area.left);
    for (const id of [
      'sun',
      'mercury',
      'earth',
      'moon',
      'jupiter',
      'saturn',
      'uranus',
    ]) {
      const body = bodyById[id];
      const sunlight = new THREE.Vector3(
        -Math.cos(body.angle),
        0,
        -Math.sin(body.angle),
      );
      const tangent = new THREE.Vector3(-sunlight.z, 0, sunlight.x);
      const direction = sunlight
        .clone()
        .multiplyScalar(0.85)
        .addScaledVector(tangent, 0.75);
      direction.y = 0.38;
      direction.normalize();
      const initial = direction
        .clone()
        .multiplyScalar(
          body.radius * (id === 'saturn' ? 7.4 : 4.4) * (mobile ? 1.9 : 1),
        );
      const offset = fitAtlasPortrait(initial.clone(), body, width, height);
      assert.ok(
        offset.clone().normalize().distanceTo(direction) < 1e-12,
        'the camera preserves its lit viewing direction',
      );
      assert.ok(offset.length() >= initial.length());
      const camera = new THREE.PerspectiveCamera(
        mobile ? 49 : 42,
        width / height,
        0.01,
        4000,
      );
      camera.position.copy(offset);
      const forward = offset.clone().negate().normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const half =
        offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const framing = atlasPortraitFraming(width, height);
      camera.lookAt(
        right
          .multiplyScalar(
            -half * camera.aspect * (mobile && !area.landscape ? 0 : 0.28),
          )
          .addScaledVector(
            up,
            -half * (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
          ),
      );
      camera.updateMatrixWorld();
      const globe = new THREE.SphereGeometry(body.radius, 192, 128);
      if (id === 'jupiter' || id === 'saturn') globe.scale(1, 0.92, 1);
      const geometries = [globe];
      if (id === 'saturn' || id === 'uranus') {
        const rings = new THREE.RingGeometry(
          body.radius * (id === 'saturn' ? 1.14 : 1.65),
          body.radius * (id === 'saturn' ? 2.31 : 2.05),
          512,
          1,
        );
        rings.rotateX(-Math.PI / 2);
        geometries.push(rings);
      }
      const bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      const point = new THREE.Vector3();
      for (const geometry of geometries) {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyAxisAngle(new THREE.Vector3(0, 0, 1), body.tilt ?? 0.05)
            .project(camera);
          const x = (point.x * 0.5 + 0.5) * width,
            y = (-point.y * 0.5 + 0.5) * height;
          bounds.minX = Math.min(bounds.minX, x);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.minY = Math.min(bounds.minY, y);
          bounds.maxY = Math.max(bounds.maxY, y);
        }
        geometry.dispose();
      }
      assert.ok(
        bounds.minX >= area.left,
        `${id} overlaps field notes at ${width}×${height}`,
      );
      assert.ok(
        bounds.maxX <= area.right,
        `${id} overlaps camera controls at ${width}×${height}`,
      );
      assert.ok(
        bounds.minY >= area.top,
        `${id} overlaps masthead or summary at ${width}×${height}`,
      );
      assert.ok(
        bounds.maxY <= area.bottom,
        `${id} overlaps navigation at ${width}×${height}`,
      );
      if (mobile && !area.landscape) {
        const gaze = new THREE.Vector3().project(camera);
        assert.ok(
          Math.abs(
            (0.5 - gaze.y * 0.5) * height - (area.top + area.bottom) / 2,
          ) < 0.1,
        );
        if (
          width === 375 &&
          height === 700 &&
          ['sun', 'mercury', 'earth', 'jupiter'].includes(id)
        )
          assert.ok(
            bounds.maxY - bounds.minY > 110,
            `${id} should fill the available phone portrait band`,
          );
        if (id === 'mercury' && width === 375 && height === 700) {
          const sun = new THREE.Vector3(
            -Math.cos(body.angle) * body.orbit,
            0,
            -Math.sin(body.angle) * body.orbit,
          ).applyMatrix4(camera.matrixWorldInverse);
          assert.ok(
            sun.z > 0,
            'the off-screen solar billboard stays behind the camera at Mercury',
          );
        }
      }
      if (area.landscape)
        assert.ok(
          bounds.maxY - bounds.minY > 50,
          `${id} portrait remains readable in landscape`,
        );
    }
  }
});

test('default atlas regions show their complete illustrated annuli inside the cleared viewing area', () => {
  const {
    fitAtlasRegion,
    atlasRegionFraming,
  } = require('../app/atlas-camera.ts');
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [320, 568],
    [375, 600],
    [1440, 900],
    [923, 615],
    [800, 1000],
    [761, 900],
    [760, 900],
    [700, 375],
    [740, 360],
    [844, 390],
  ]) {
    const mobile = width <= 760;
    const area = atlasViewingFixture(width, height);
    for (const region of ['belt', 'kuiper']) {
      const original =
        region === 'belt'
          ? new THREE.Vector3(14, 65, 78)
          : new THREE.Vector3(5, 44.8, 89.6);
      const offset = fitAtlasRegion(
        original.clone(),
        region === 'belt' ? 57 : 217,
        width,
        height,
      );
      assert.ok(
        offset.clone().normalize().distanceTo(original.clone().normalize()) <
          1e-12,
      );
      const framing = atlasRegionFraming(width, height);
      const camera = new THREE.PerspectiveCamera(
        mobile ? 49 : 42,
        width / height,
        0.01,
        4000,
      );
      camera.position.copy(offset);
      const forward = offset.clone().negate().normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const half =
        offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.lookAt(
        right
          .multiplyScalar(
            -half *
              camera.aspect *
              (mobile && !area.landscape ? 0 : framing.horizontal),
          )
          .addScaledVector(
            up,
            -half * (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
          ),
      );
      camera.updateMatrixWorld();
      // Independent dense geometry includes the outer particle/rock margin
      // and both vertical faces of the actual illustrated fields.
      const geometry = new THREE.RingGeometry(
        region === 'belt' ? 47 : 171,
        region === 'belt' ? 56.3 : 216.6,
        512,
        1,
      );
      geometry.rotateX(-Math.PI / 2);
      const source = Array.from(geometry.getAttribute('position').array);
      const bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      const point = new THREE.Vector3();
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++)
        for (const thickness of [-1.1, 1.1]) {
          point.fromBufferAttribute(positions, i);
          point.y += thickness;
          point.project(camera);
          const x = (point.x * 0.5 + 0.5) * width,
            y = (-point.y * 0.5 + 0.5) * height;
          bounds.minX = Math.min(bounds.minX, x);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.minY = Math.min(bounds.minY, y);
          bounds.maxY = Math.max(bounds.maxY, y);
        }
      assert.ok(
        bounds.minX >= area.left,
        `${region} overlaps notes at ${width}×${height}`,
      );
      assert.ok(bounds.maxX <= area.right);
      assert.ok(bounds.minY >= area.top);
      assert.ok(bounds.maxY <= area.bottom);
      assert.ok(
        bounds.maxX - bounds.minX > 100,
        `${region} is too distant to read`,
      );
      assert.deepEqual(
        Array.from(positions.array),
        source,
        'fitting never edits the annulus geometry',
      );
      const sun = new THREE.Vector3().project(camera);
      const sunY = (-sun.y * 0.5 + 0.5) * height;
      if (mobile) assert.ok(sunY > area.top && sunY < area.bottom);
      geometry.dispose();
    }
  }
});

test('compact atlas surface details enlarge the view while their focal cap clears the interface', () => {
  const helpers = require('../app/atlas-camera.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const positions = new Map();
  for (const body of bodies) {
    const center = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      center
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(positions.get(body.parent));
    positions.set(body.id, center);
  }
  const source = fs.readFileSync('app/solar-scene.tsx', 'utf8');
  const authored = source.slice(
    source.indexOf('    function viewFor('),
    source.indexOf('    function atlasFraming('),
  );
  const createView = require('node:vm').compileFunction(
    ts.transpileModule(`${authored}\nreturn viewFor;`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    [
      'THREE',
      'positions',
      'bodyById',
      'width',
      'height',
      'mobile',
      'fitAtlasPortrait',
      'fitAtlasFeature',
      'fitAtlasRegion',
      'atlasRingViewDirection',
      'isCompactLandscape',
    ],
  );
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [320, 568],
    [700, 375],
    [740, 360],
    [844, 390],
    [1920, 889],
  ]) {
    const mobile = width <= 760;
    const area = atlasViewingFixture(width, height);
    const view = createView(
      THREE,
      positions,
      bodyById,
      width,
      height,
      mobile,
      helpers.fitAtlasPortrait,
      helpers.fitAtlasFeature,
      helpers.fitAtlasRegion,
      helpers.atlasRingViewDirection,
      helpers.isCompactLandscape,
    );
    function projector(offset) {
      const camera = new THREE.PerspectiveCamera(
        mobile ? 49 : 42,
        width / height,
        0.01,
        4000,
      );
      camera.position.copy(offset);
      const forward = offset.clone().negate().normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const half =
        offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const framing = helpers.atlasPortraitFraming(width, height);
      camera.lookAt(
        right
          .multiplyScalar(
            -half * camera.aspect * (mobile && !area.landscape ? 0 : 0.28),
          )
          .addScaledVector(
            up,
            -half * (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
          ),
      );
      camera.updateMatrixWorld();
      return (vertex) => {
        const point = vertex.clone().project(camera);
        return {
          x: (point.x * 0.5 + 0.5) * width,
          y: (0.5 - point.y * 0.5) * height,
        };
      };
    }
    for (const id of [
      'mercury',
      'venus',
      'mars',
      'jupiter',
      'neptune',
      'pluto',
      'ceres',
      'vesta',
    ]) {
      const body = bodyById[id];
      const full = view(id);
      const detail = view(id, body.featureView);
      const direction = full.offset.clone().normalize();
      assert.ok(detail.target.distanceTo(full.target) < 1e-12);
      assert.ok(
        detail.offset.clone().normalize().distanceTo(direction) < 1e-12,
      );
      const extent = body.radius * Math.max(1, ...(body.shape ?? []));
      assert.ok(detail.offset.length() >= extent * 2.6 - 1e-12);
      if (!mobile && !area.landscape) {
        assert.ok(Math.abs(detail.offset.length() - body.radius * 2.6) < 1e-12);
        continue;
      }
      const geometry = new THREE.SphereGeometry(body.radius, 64, 48);
      if (body.shape) geometry.scale(...body.shape);
      if (id === 'jupiter') geometry.scale(1, 0.92, 1);
      geometry.rotateZ(body.tilt ?? 0.05);
      const vertices = geometry.getAttribute('position');
      const projectFull = projector(full.offset);
      const projectDetail = projector(detail.offset);
      let fullTop = Infinity,
        fullBottom = -Infinity,
        detailTop = Infinity,
        detailBottom = -Infinity,
        focalCount = 0;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < vertices.count; i++) {
        vertex.fromBufferAttribute(vertices, i);
        const regular = projectFull(vertex);
        const close = projectDetail(vertex);
        fullTop = Math.min(fullTop, regular.y);
        fullBottom = Math.max(fullBottom, regular.y);
        detailTop = Math.min(detailTop, close.y);
        detailBottom = Math.max(detailBottom, close.y);
        assert.ok(regular.x >= area.left && regular.x <= area.right);
        assert.ok(regular.y >= area.top && regular.y <= area.bottom);
        if (vertex.dot(direction) < extent * 0.8) continue;
        focalCount++;
        assert.ok(close.x >= area.left && close.x <= area.right);
        assert.ok(
          close.y >= area.top && close.y <= area.bottom,
          `${id} detail focal surface overlaps controls at ${width}×${height}`,
        );
      }
      assert.ok(focalCount > 30);
      assert.ok(
        (detailBottom - detailTop) / (fullBottom - fullTop) >= 1.3,
        `${id} detail does not visibly enlarge at ${width}×${height}`,
      );
      assert.ok(view(id).offset.distanceTo(full.offset) < 1e-12);
      geometry.dispose();
    }
  }
});

test('atlas body features and selected moon systems keep their actual silhouettes inside the reading area', () => {
  const {
    fitAtlasFeature,
    atlasPortraitFraming,
    atlasRingViewDirection,
  } = require('../app/atlas-camera.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const positions = new Map();
  for (const body of bodies) {
    const center = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      center
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(positions.get(body.parent));
    positions.set(body.id, center);
  }
  for (const [width, height] of [
    [375, 700],
    [390, 844],
    [320, 568],
    [1440, 900],
    [1920, 889],
    [800, 1000],
    [700, 375],
    [740, 360],
    [844, 390],
  ]) {
    const mobile = width <= 760;
    const area = atlasViewingFixture(width, height);
    for (const [id, feature] of [
      ['earth', 'night'],
      ['sun', 'corona'],
      ['mercury', 'surface'],
      ['ceres', 'surface'],
      ['saturn', 'rings'],
      ['uranus', 'rings'],
      ['phobos', 'parent'],
      ['mimas', 'parent'],
      ['miranda', 'parent'],
      ['charon', 'parent'],
      ['moon', 'earthrise'],
    ]) {
      const body = bodyById[id],
        world = positions.get(id).clone(),
        target = world.clone();
      const sunlight = world.clone().negate().normalize();
      if (id === 'sun') sunlight.set(0.2, 0.1, 1).normalize();
      const tangent = new THREE.Vector3(-sunlight.z, 0, sunlight.x);
      let direction = sunlight
        .clone()
        .multiplyScalar(0.85)
        .addScaledVector(tangent, 0.75);
      direction.y = 0.38;
      direction.normalize();
      let multiplier =
        feature === 'corona' ? 3.5 : feature === 'surface' ? 2.6 : 4.4;
      if (feature === 'rings') {
        direction.copy(atlasRingViewDirection(body, sunlight));
        multiplier = id === 'saturn' ? 6.8 : 5.8;
      }
      if (feature === 'night') {
        direction = sunlight.clone().negate().addScaledVector(tangent, 0.25);
        direction.y = 0.18;
        direction.normalize();
      }
      const pair = feature === 'parent' || feature === 'earthrise';
      if (!mobile && !pair && feature !== 'rings' && !area.landscape) continue;
      if (pair) {
        const parent = positions.get(body.parent);
        target.lerp(parent, 0.22);
        direction
          .copy(target)
          .sub(parent)
          .normalize()
          .add(new THREE.Vector3(0.6, 0.3, 0.7))
          .normalize();
        multiplier = (body.orbit / body.radius) * 2.5;
      }
      const original = direction
        .clone()
        .multiplyScalar(body.radius * multiplier * (mobile ? 1.9 : 1));
      const subjects = [{ body, center: world.sub(target) }];
      if (pair)
        subjects.push({
          body: bodyById[body.parent],
          center: positions.get(body.parent).clone().sub(target),
        });
      const immutable = subjects.map((subject) => subject.center.toArray());
      const offset = fitAtlasFeature(original.clone(), subjects, width, height);
      assert.ok(offset.clone().normalize().distanceTo(direction) < 1e-12);
      assert.deepEqual(
        subjects.map((subject) => subject.center.toArray()),
        immutable,
      );
      const camera = new THREE.PerspectiveCamera(
        mobile ? 49 : 42,
        width / height,
        0.01,
        4000,
      );
      camera.position.copy(offset);
      const forward = offset.clone().negate().normalize();
      const right = new THREE.Vector3()
        .crossVectors(forward, camera.up)
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const half =
        offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const framing = atlasPortraitFraming(width, height);
      camera.lookAt(
        right
          .multiplyScalar(
            -half * camera.aspect * (mobile && !area.landscape ? 0 : 0.28),
          )
          .addScaledVector(
            up,
            -half * (framing.vertical + (mobile && height <= 760 ? 0.055 : 0)),
          ),
      );
      camera.updateMatrixWorld();
      const bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      };
      for (const subject of subjects) {
        const globe = new THREE.SphereGeometry(
          subject.body.radius * (subject.body.id === 'sun' ? 1.045 : 1),
          192,
          128,
        );
        if (subject.body.shape) globe.scale(...subject.body.shape);
        if (subject.body.id === 'saturn' || subject.body.id === 'jupiter')
          globe.scale(1, 0.92, 1);
        const geometries = [globe];
        if (subject.body.id === 'saturn' || subject.body.id === 'uranus') {
          const rings = new THREE.RingGeometry(
            subject.body.radius * (subject.body.id === 'saturn' ? 1.14 : 1.65),
            subject.body.radius * (subject.body.id === 'saturn' ? 2.31 : 2.05),
            512,
            1,
          );
          rings.rotateX(-Math.PI / 2);
          geometries.push(rings);
        }
        const point = new THREE.Vector3();
        for (const geometry of geometries) {
          const vertices = geometry.getAttribute('position');
          for (let i = 0; i < vertices.count; i++) {
            point
              .fromBufferAttribute(vertices, i)
              .applyAxisAngle(
                new THREE.Vector3(0, 0, 1),
                subject.body.tilt ?? 0.05,
              )
              .add(subject.center)
              .project(camera);
            const x = (point.x * 0.5 + 0.5) * width,
              y = (-point.y * 0.5 + 0.5) * height;
            bounds.minX = Math.min(bounds.minX, x);
            bounds.maxX = Math.max(bounds.maxX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxY = Math.max(bounds.maxY, y);
          }
          geometry.dispose();
        }
      }
      assert.ok(
        bounds.minX >= area.left,
        `${id}/${feature} overlaps notes at ${width}×${height}`,
      );
      assert.ok(bounds.maxX <= area.right);
      assert.ok(bounds.minY >= area.top);
      assert.ok(
        bounds.maxY <= area.bottom,
        `${id}/${feature} overlaps navigation at ${width}×${height}`,
      );
    }
  }
});

test('single-encounter pursuit keeps its viewing direction through the gravity-assist bend', () => {
  for (const index of [2, 6, 7, 8, 9, 10, 11, 14]) {
    const flight = new MissionFlight(milestones[index], bundles[index]);
    let previous;
    for (let tick = 0; tick <= 200; tick++) {
      flight.seek(tick / 200);
      const frame = flight.update(0, true, false, false);
      const direction = frame.position.clone().sub(frame.look).normalize();
      if (previous)
        assert.ok(
          previous.angleTo(direction) < 1e-6,
          `${bundles[index].id}: pursuit camera turns with the spacecraft's radial vector`,
        );
      previous = direction;
    }
    flight.dispose();
  }
});

test('giant-planet pursuit frames cloud bands and Saturn rings against their recorded poles', () => {
  for (const index of [6, 8, 9, 10, 11]) {
    const flight = new MissionFlight(milestones[index], bundles[index]);
    flight.seek(0.5);
    const frame = flight.update(0, true, false, false);
    const sourcePole = bundles[index].poles[frame.focus];
    const pole = new THREE.Vector3(
      sourcePole[0],
      sourcePole[2],
      -sourcePole[1],
    ).normalize();
    const view = frame.position.clone().sub(frame.look).normalize();
    const latitude = THREE.MathUtils.radToDeg(
      Math.asin(Math.abs(view.dot(pole))),
    );
    assert.ok(
      latitude <= (frame.focus === 'saturn' ? 24 : 30) + 1e-6,
      `${bundles[index].id}: looking down the pole instead of across the bands (${latitude})`,
    );
    if (frame.focus === 'saturn') {
      assert.ok(latitude > 12, 'rings need a legible opening');
      const epoch =
        bundles[index].events.find((event) => event.body === 'saturn')?.et ??
        bundles[index].start;
      const sunlight = world(sampleState(bundles[index].tracks.sun, epoch))
        .sub(world(sampleState(bundles[index].tracks.saturn, epoch)))
        .normalize();
      assert.equal(
        Math.sign(view.dot(pole)),
        Math.sign(sunlight.dot(pole)),
        'the Saturn camera shows the illuminated face of its rings',
      );
    }
    flight.dispose();
  }
});

test('discovery portraits keep moving sideways through the reading interval at one epoch', () => {
  for (const index of [2, 3, 6, 8, 9, 10, 11, 14]) {
    const flight = new MissionFlight(milestones[index], bundles[index]);
    const views = [];
    let epoch;
    for (let tick = 0; tick < 1800; tick++) {
      const frame = flight.update(1 / 24, false, false, false);
      const beat = frame.discovery;
      if (beat && beat.progress >= 0.3 && beat.progress <= 0.64) {
        const center = flight.bodyPositions.get(beat.body);
        views.push(frame.position.clone().sub(center).normalize());
        if (epoch !== undefined) assert.equal(frame.et, epoch);
        epoch = frame.et;
      }
      if (views.length && (!beat || beat.progress > 0.64)) break;
    }
    assert.ok(
      views.length > 40,
      `${bundles[index].id}: missing reading interval`,
    );
    assert.ok(
      views[0].angleTo(views.at(-1)) > 0.07,
      `${bundles[index].id}: static portrait`,
    );
    for (let tick = 1; tick < views.length; tick++)
      assert.ok(
        views[tick - 1].angleTo(views[tick]) < 0.005,
        'portrait must not whip around',
      );
    flight.dispose();
  }
});

test('editorial time stays monotone, joins smoothly, and slows into exact encounter epochs', () => {
  for (const original of bundles) {
    // Source seams deliberately skip a missing interval; assess the smooth
    // editorial clock separately from that required coverage discontinuity.
    const data = { ...original, seams: {} };
    let previous = missionTime(data, 0).et;
    for (let tick = 1; tick <= 2000; tick++) {
      const et = missionTime(data, tick / 2000).et;
      assert.ok(et >= previous, `${data.id}: historical clock reverses`);
      previous = et;
    }
    const epsilon = 0.00001;
    for (const anchor of data.clock.slice(1, -1)) {
      const p = anchor.progress;
      const before = (anchor.et - missionTime(data, p - epsilon).et) / epsilon;
      const after = (missionTime(data, p + epsilon).et - anchor.et) / epsilon;
      const scale = Math.max(
        1,
        (missionTime(data, p + 0.001).et - missionTime(data, p - 0.001).et) /
          0.002,
      );
      assert.ok(
        Math.abs(before - after) / scale < 0.05,
        `${data.id}: clock speed jumps at ${p}`,
      );
      if (data.events.some((event) => Math.abs(event.progress - p) < 1e-8))
        assert.ok(
          Math.max(before, after) / scale < 0.05,
          `${data.id}: clock does not settle into the encounter`,
        );
    }
  }
});

test('a paused opening retains its readable discovery caption without advancing the shot', () => {
  const flight = new MissionFlight(milestones[0], bundles[0]);
  const first = flight.update(0, true, true, false);
  const held = flight.update(10, true, true, false);
  assert.equal(held.discovery.amount, 1);
  assert.equal(held.discovery.progress, 0);
  assert.ok(held.position.equals(first.position));
  assert.equal(held.et, first.et);
  flight.dispose();
});

test('the illuminated trail reaches the live probe between stored samples and preserves route boundaries', () => {
  const { createRouteCoverage } = require('../app/route-coverage.ts');
  for (const index of [2, 5, 6, 8, 11, 14, 15]) {
    const flight = new MissionFlight(milestones[index], bundles[index]);
    for (const progress of [0.00317, 0.21371, 0.61432, 0.89123, 0.997]) {
      flight.seek(progress);
      const frame = flight.update(0, true, false, false);
      assert.equal(
        flight.trail.geometry.drawRange.count % 2,
        0,
        'never leave a partial line-segment pair',
      );
      assert.equal(flight.trailHead.geometry.drawRange.count, 2);
      const positions = flight.trailHead.geometry.getAttribute('position');
      assert.deepEqual(
        [positions.getX(1), positions.getY(1), positions.getZ(1)],
        [0, 0, 0],
      );
      assert.ok(flight.trailHead.position.equals(flight.craft.position));
      const coverage = createRouteCoverage(
        bundles[index].start,
        bundles[index].end,
        [
          ...(bundles[index].seams?.craft ?? []),
          ...(bundles[index].seams?.[frame.focus] ?? []),
        ],
      );
      assert.ok(
        Math.abs(
          flight.trailHead.geometry.getAttribute('color').getW(1) -
            coverage(frame.et),
        ) < 1e-6,
        'the live segment uses historical time, including a nonlinear playback clock',
      );
    }
    const colors = flight.planned.geometry.getAttribute('color');
    assert.equal(colors.itemSize, 4);
    assert.equal(colors.getW(0), 0);
    assert.equal(colors.getW(colors.count - 1), 0);
    flight.dispose();
  }
});

test('route fades respect combined source gaps and fade only covered endpoints', () => {
  const { createRouteCoverage } = require('../app/route-coverage.ts');
  const coverage = createRouteCoverage(100, 200, [
    { start: 150, end: 160 },
    { start: 140, end: 155 },
    { start: 142, end: 146 },
  ]);
  for (const epoch of [99, 100, 140, 145, 159, 160, 200, 201])
    assert.equal(coverage(epoch), 0);
  for (const epoch of [120, 180]) assert.equal(coverage(epoch), 1);
  assert.ok(coverage(100.1) > 0 && coverage(100.1) < coverage(101));
  assert.ok(coverage(139.9) > 0 && coverage(139.9) < coverage(139));
  assert.ok(coverage(160.1) > 0 && coverage(160.1) < coverage(161));
});

test('added worlds have covered, plausible system positions at the shared mission clock', () => {
  const { smallBodies } = require('../app/small-bodies.ts');
  const { bodyById } = require('../app/solar-data.ts');
  const limits = {
    phobos: [8000, 11000],
    deimos: [22000, 25000],
    io: [400000, 440000],
    ganymede: [1050000, 1100000],
    callisto: [1800000, 1950000],
    mimas: [170000, 205000],
    enceladus: [230000, 245000],
    tethys: [280000, 310000],
    dione: [360000, 390000],
    rhea: [510000, 550000],
    iapetus: [3300000, 3800000],
    miranda: [120000, 140000],
    ariel: [180000, 205000],
    umbriel: [250000, 280000],
    titania: [420000, 450000],
    oberon: [565000, 605000],
    triton: [340000, 370000],
    charon: [18500, 20500],
    ceres: [350000000, 450000000],
    vesta: [300000000, 390000000],
  };
  assert.equal(smallBodies.length, 20);
  for (const body of smallBodies) {
    assert.ok(bodyById[body.id]);
    const covered = bundles.filter((bundle) => bundle.tracks[body.id]);
    assert.ok(covered.length, `${body.id} has a covered chapter`);
    for (const bundle of covered) {
      assert.ok(bundle.validation.maxPositionErrorKm[body.id] <= 5);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const et = missionTime(bundle, progress).et;
        const child = world(sampleState(bundle.tracks[body.id], et));
        const parent = world(
          sampleState(bundle.tracks[body.parent ?? 'sun'], et),
        );
        const range = child.distanceTo(parent) * KM_PER_UNIT;
        const [min, max] = limits[body.id];
        assert.ok(range > min && range < max, `${body.id}: ${range} km`);
      }
    }
  }
});

test('natural-body markers clear unavailable worlds and yield to resolved physical disks', () => {
  const { createBodyMarkers } = require('../app/body-markers.ts');
  const { bodies } = require('../app/solar-data.ts');
  const marker = createBodyMarkers(1);
  const worlds = bodies.filter((body) => body.parent || body.region);
  const index = worlds.findIndex((body) => body.id === 'charon');
  const group = new THREE.Group();
  group.position.set(3, 4, -20);
  group.scale.setScalar(0.0001);
  const groups = new Map([['charon', group]]);
  const camera = new THREE.PerspectiveCamera(42, 1.5, 0.00001, 1000);
  marker.update(groups, camera, 800, true);
  const presence = marker.points.geometry.attributes.presence;
  const positions = marker.points.geometry.attributes.position;
  assert.equal(presence.getX(index), 1);
  assert.deepEqual(
    [positions.getX(index), positions.getY(index), positions.getZ(index)],
    [3, 4, -20],
  );
  assert.equal(presence.getX(worlds.findIndex((body) => body.id === 'io')), 0);
  group.visible = false;
  marker.update(groups, camera, 800, true);
  assert.equal(presence.getX(index), 0);
  group.visible = true;
  group.scale.setScalar(1);
  marker.update(groups, camera, 800, true);
  assert.equal(presence.getX(index), 0);
  marker.update(groups, camera, 800, false);
  assert.equal(marker.points.visible, false);
  marker.dispose();
});

test('story captions allow a sustained reading interval and pause without moving the handoff', () => {
  const { storyCue, transferCue } = require('../app/scene-story-motion.ts');
  let readableSeconds = 0;
  const playback = new MissionPlayback(
    10,
    [{ progress: 0.3, body: 'venus', label: 'Flyby' }],
    { body: 'venus', label: 'Flyby' },
    false,
  );
  playback.advance(3, false, false);
  for (let i = 0; i < MissionPlayback.revealSeconds * 60; i++) {
    playback.advance(1 / 60, false, false);
    const beat = playback.beat;
    if (!beat) continue;
    const cue = storyCue(playback.progress, beat, false);
    if (cue.presence > 0.98 && cue.heading === 1 && cue.detail === 1)
      readableSeconds += 1 / 60;
    const before = beat.progress;
    playback.advance(2, true, false);
    assert.equal(playback.beat.progress, before);
    assert.deepEqual(storyCue(playback.progress, beat, true), {
      presence: 1,
      heading: 1,
      detail: 1,
    });
  }
  assert.ok(readableSeconds >= 7, `Only ${readableSeconds}s available to read`);
  const returning = {
    body: 'pluto',
    label: 'Flyby',
    primary: true,
    amount: 0.8,
    stage: 'return',
    kind: 'encounter',
    progress: 0.76,
  };
  assert.equal(storyCue(0.9, returning, false).detail, 0);
  assert.equal(
    storyCue(0.9, { ...returning, progress: 0.85 }, false).presence,
    0,
  );
  assert.equal(
    storyCue(0.9, { ...returning, kind: 'tableau' }, false).detail,
    1,
  );
  assert.equal(storyCue(0.9, returning, true).detail, 1);
  assert.equal(storyCue(0.6, undefined, false).detail, 0);
  assert.equal(storyCue(0.6, undefined, true).detail, 1);
  for (const p of [0.1, 0.5, 0.9])
    assert.equal(transferCue(p, false).drift, transferCue(p, true).drift);
});

test('scene notes stay in their safe region and leaders stop outside the visible subject', () => {
  const {
    storyPlacement,
    StoryProjector,
  } = require('../app/scene-story-motion.ts');
  for (const [width, height, cardWidth, cardHeight] of [
    [1470, 802, 338, 310],
    [1024, 768, 270, 310],
    [390, 844, 351, 220],
    [375, 700, 337, 190],
  ]) {
    for (const subject of [
      { x: width * 0.56, y: height * 0.3, radius: 120 },
      { x: width * 0.8, y: height * 0.8, radius: 20 },
    ]) {
      const place = storyPlacement(
        { ...subject, visible: true },
        width,
        height,
        cardWidth,
        cardHeight,
      );
      assert.ok(place.x >= width * 0.04);
      assert.ok(place.x + cardWidth < width - 10);
      assert.ok(place.y >= 138);
      assert.ok(place.y + cardHeight <= height - 212);
    }
  }
  const styles = {},
    path = {},
    dot = {};
  const binding = {
    root: {
      style: {
        setProperty: (key, value) => {
          styles[key] = value;
        },
      },
    },
    path: {
      setAttribute: (key, value) => {
        path[key] = value;
      },
    },
    dot: {
      setAttribute: (key, value) => {
        dot[key] = value;
      },
    },
    width: 300,
    height: 260,
  };
  const camera = new THREE.PerspectiveCamera(42, 1470 / 802, 0.01, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const projector = new StoryProjector();
  projector.update(
    binding,
    camera,
    new THREE.Vector3(1, 0, 0),
    1,
    1470,
    802,
    1 / 60,
    true,
  );
  assert.equal(styles['--story-link'], '1.000');
  const center = new THREE.Vector3(1, 0, 0).project(camera);
  const px = (center.x * 0.5 + 0.5) * 1470,
    py = (-center.y * 0.5 + 0.5) * 802;
  const projectedRadius =
    (1 / 10 / Math.tan(THREE.MathUtils.degToRad(21))) * 401;
  assert.ok(
    Math.hypot(Number(dot.cx) - px, Number(dot.cy) - py) > projectedRadius + 11,
  );
  projector.update(
    binding,
    camera,
    new THREE.Vector3(1, 0, 20),
    1,
    1470,
    802,
    1 / 60,
    true,
  );
  assert.equal(styles['--story-link'], '0.000');
  assert.ok(!path.d.includes('NaN') && !path.d.includes('Infinity'));
  projector.update(
    binding,
    camera,
    new THREE.Vector3(1, 0, 0),
    1,
    390,
    844,
    1 / 60,
    true,
  );
  assert.equal(styles['--story-link'], '0.000');
});

test('compact landscape captions and route masks share the cleared viewing band through rotation', () => {
  const {
    StoryProjector,
    storyPlacement,
  } = require('../app/scene-story-motion.ts');
  const { PathPresentation } = require('../app/path-presentation.ts');
  const { isCompactLandscape } = require('../app/atlas-camera.ts');
  for (const [width, height, expected] of [
    [500, 400, true],
    [1000, 500, true],
    [499, 300, false],
    [1001, 500, false],
    [844, 501, false],
    [500, 500, false],
    [375, 700, false],
    [1440, 900, false],
  ])
    assert.equal(isCompactLandscape(width, height), expected);
  for (const [width, height, cardWidth] of [
    [700, 375, 230],
    [740, 360, 236.8],
    [844, 390, 270.08],
  ]) {
    const styles = {};
    const binding = {
      width: 351,
      height: 200,
      root: {
        style: {
          setProperty(key, value) {
            styles[key] = value;
          },
        },
      },
      path: { setAttribute() {} },
      dot: { setAttribute() {} },
    };
    const projector = new StoryProjector();
    const camera = new THREE.PerspectiveCamera(49, 390 / 844, 0.01, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    projector.update(
      binding,
      camera,
      new THREE.Vector3(),
      1,
      390,
      844,
      1 / 60,
      false,
    );
    binding.width = cardWidth;
    const paths = new PathPresentation();
    const material = new THREE.LineBasicMaterial();
    paths.attach(material);
    const shader = {
      uniforms: {},
      fragmentShader: '#include <opaque_fragment>',
    };
    material.onBeforeCompile(shader, null);
    paths.setPresence(0.37);
    for (let cardHeight = 80; cardHeight <= height - 180; cardHeight += 5) {
      binding.height = cardHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      projector.update(
        binding,
        camera,
        new THREE.Vector3(),
        1,
        width,
        height,
        1 / 60,
        false,
      );
      const placement = storyPlacement(
        { x: width * 0.75, y: height * 0.7, radius: 20, visible: true },
        width,
        height,
        cardWidth,
        cardHeight,
      );
      assert.equal(placement.x, width * 0.03);
      assert.equal(placement.y, 80);
      assert.equal(projector.bounds.x, placement.x);
      assert.equal(projector.bounds.y, placement.y);
      assert.ok(projector.bounds.y + projector.bounds.height <= height - 100);
      assert.equal(parseFloat(styles['--story-y']), 80);
      paths.update(width, height, 2, true, {
        ...projector.bounds,
        presence: 1,
      });
      assert.equal(shader.uniforms.pathFrame.value.y, height - 100);
      assert.equal(
        shader.uniforms.pathPresence.value,
        0.37,
        'layout never restarts a path fade',
      );
      assert.equal(shader.uniforms.pathCaption.value[0].y, 72);
      assert.equal(shader.uniforms.pathCaption.value[0].w, cardHeight + 16);
    }
    binding.width = 351;
    binding.height = 200;
    projector.update(
      binding,
      camera,
      new THREE.Vector3(),
      1,
      390,
      844,
      1 / 60,
      false,
    );
    assert.ok(
      projector.bounds.y >= 138 && projector.bounds.y + binding.height <= 592,
    );
    paths.update(390, 844, 2, true, { ...projector.bounds, presence: 1 });
    assert.equal(shader.uniforms.pathFrame.value.y, 592);
    assert.equal(shader.uniforms.pathPresence.value, 0.37);
    material.dispose();
  }
});

test('chapter pullbacks inherit bounded orbital momentum and keep a single wide crest', () => {
  const { viewMotion } = require('../app/expedition-flight.ts');
  for (const [a, b] of [
    [0, 1],
    [11, 12],
    [9, 14],
    [15, 0],
  ]) {
    const from = expeditionView(a, 1),
      to = expeditionView(b, 0);
    const axis = new THREE.Vector3()
      .crossVectors(
        from.position.clone().sub(from.look),
        new THREE.Vector3(0, 1, 0),
      )
      .normalize();
    from.motion = { angular: axis.multiplyScalar(0.04), radial: 0.02 };
    const flight = new ExpeditionFlight(from, to, timelapse, false);
    const initial = flight.update(0);
    assert.ok(initial.position.equals(from.position));
    const first = flight.update(0.001);
    const inherited = viewMotion(initial, first, 0.001);
    assert.ok(
      inherited.angular.distanceTo(from.motion.angular) < 0.002,
      `${a}: angular stop at departure`,
    );
    assert.ok(Math.abs(inherited.radial - from.motion.radial) < 0.002);
    let frame;
    for (let tick = 0; tick < 600; tick++) {
      frame = flight.update(flight.duration / 600);
      for (const [id, center] of frame.bodies)
        assert.ok(
          frame.position.distanceTo(center) >
            (frame.radiiKm[id] ?? 1) / KM_PER_UNIT,
          `${a} → ${b}: momentum entered ${id}`,
        );
    }
    assert.ok(frame.position.equals(to.position));
    assert.ok(frame.look.equals(to.look));
    const crest = new ExpeditionFlight(from, to, timelapse, false);
    const before = crest.update(crest.duration * 0.45);
    const peak = crest.update(crest.duration * 0.05);
    const after = crest.update(crest.duration * 0.05);
    assert.ok(
      peak.position.distanceTo(peak.look) >
        before.position.distanceTo(before.look) * 1.001,
    );
    assert.ok(
      peak.position.distanceTo(peak.look) >
        after.position.distanceTo(after.look) * 1.001,
    );
    assert.equal(crest.acquiring, false);
    crest.update(crest.duration * 0.26);
    assert.equal(crest.acquiring, true);
  }
});

test('closing cues overlap the outgoing shot without skipping discovery or its recorded tail', () => {
  const { closingCue, transferCue } = require('../app/scene-story-motion.ts');
  const snapshot = new MissionPlayback(
    10,
    [],
    { body: 'earth', label: 'Opening' },
    true,
  );
  snapshot.advance(13.7, false, false);
  assert.equal(snapshot.closingProgress, 0);
  snapshot.advance(1, false, false);
  assert.ok(snapshot.closingProgress > 0 && snapshot.closingProgress < 1);
  assert.equal(snapshot.complete, false);
  const held = snapshot.closingProgress;
  snapshot.advance(2, true, false);
  assert.equal(snapshot.closingProgress, held);
  snapshot.advance(2, false, false);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.closingProgress, 1);
  const flight = new MissionPlayback(
    10,
    [{ body: 'venus', label: 'Flyby', progress: 0.7 }],
    { body: 'venus', label: 'Flyby' },
    false,
  );
  flight.advance(7 + MissionPlayback.revealSeconds - 0.1, false, false);
  assert.equal(flight.closingProgress, 0);
  assert.equal(flight.progress, 0.7);
  flight.advance(2.6, false, false);
  assert.ok(flight.progress > 0.94 && flight.progress < 1);
  assert.ok(flight.closingProgress > 0);
  assert.equal(flight.complete, false);
  assert.equal(transferCue(0, false, true).presence, 1);
  assert.equal(transferCue(0, false, true).arrival, 1);
  assert.deepEqual(closingCue(0), { outgoing: 1, bridge: 0 });
  assert.deepEqual(closingCue(1), { outgoing: 0, bridge: 1 });
  const closingOverlap = closingCue(0.48);
  assert.ok(closingOverlap.outgoing > 0 && closingOverlap.bridge > 0);
  assert.ok(
    closingOverlap.outgoing + closingOverlap.bridge < 0.5,
    'crossfade keeps the two text layers from competing',
  );
  const overlap = transferCue(0.92, false, true);
  assert.ok(overlap.presence > 0 && overlap.incoming > 0);
  const read = transferCue(0.92, true, true);
  assert.equal(read.presence, 0);
  assert.equal(read.incoming, 1);
});

test('cached context curves preserve every source point through time and origin changes', () => {
  const {
    OrbitalContext,
    contextBodies,
  } = require('../app/orbital-context.ts');
  const context = new OrbitalContext();
  const periods = [0, 88, 225, 365.25, 687, 4333, 10759, 30687, 60190, 90560];
  for (const fraction of [0, 0.4, 0.9, 1, 0.1]) {
    const et = timelapse.start + (timelapse.end - timelapse.start) * fraction;
    const origin = new THREE.Vector3(140, -38, -21).multiplyScalar(
      fraction + 1,
    );
    context.update(timelapse, et, origin);
    for (let i = 1; i < contextBodies.length; i++) {
      const span = Math.min(
        periods[i] * 86400,
        timelapse.end - timelapse.start,
      );
      const start = THREE.MathUtils.clamp(
        et - span / 2,
        timelapse.start,
        timelapse.end - span,
      );
      for (let j = 0; j < context.segments; j++) {
        for (let end = 0; end < 2; end++) {
          const expected = world(
            sampleState(
              timelapse.tracks[contextBodies[i]],
              start + (span * (j + end)) / context.segments,
            ),
          ).sub(origin);
          const offset = ((i - 1) * context.segments + j) * 6 + end * 3;
          assert.deepEqual(
            Array.from(context.positions.slice(offset, offset + 3)),
            expected.toArray().map(Math.fround),
          );
        }
      }
    }
    assert.equal(
      context.update(timelapse, et, origin.clone().addScalar(10)),
      0,
      'camera movement and paused epochs never resample unchanged source curves',
    );
  }
  const fresh = new OrbitalContext();
  assert.equal(
    fresh.update(timelapse, timelapse.start, new THREE.Vector3()),
    9 * 161,
  );
  assert.ok(
    fresh.update(timelapse, timelapse.start + 1, new THREE.Vector3()) < 9 * 161,
    'coverage-clamped windows remain cached while the clock changes',
  );
  assert.equal(
    fresh.update({ ...timelapse }, timelapse.start, new THREE.Vector3()),
    9 * 161,
    'changing the source bundle invalidates every cached curve',
  );
});

test('expanding reading captions stay above playback controls while their position settles', () => {
  const { StoryProjector } = require('../app/scene-story-motion.ts');
  for (const [width, height, clearance] of [
    [390, 844, 252],
    [375, 700, 216],
    [1470, 746, 212],
  ]) {
    const styles = {};
    const binding = {
      width: width < 760 ? width * 0.9 : 340,
      height: 75,
      root: {
        style: {
          setProperty: (key, value) => {
            styles[key] = value;
          },
        },
      },
      path: { setAttribute() {} },
      dot: { setAttribute() {} },
    };
    const projector = new StoryProjector();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (let h = 75; h <= 225; h += 5) {
      binding.height = h;
      projector.update(
        binding,
        camera,
        new THREE.Vector3(1, 0, 0),
        1,
        width,
        height,
        1 / 60,
        false,
      );
      assert.ok(
        parseFloat(styles['--story-y']) + h <= height - clearance + 0.01,
      );
    }
  }
});

test('detail loading stays bounded through rapid navigation, eviction and scene disposal', async (t) => {
  const { PlanetDetail } = require('../app/planet-detail.ts');
  const original = Object.getOwnPropertyDescriptor(
    THREE.TextureLoader.prototype,
    'loadAsync',
  );
  const requests = [];
  THREE.TextureLoader.prototype.loadAsync = function (url) {
    return new Promise((resolve) => requests.push({ url, resolve }));
  };
  t.after(() => {
    if (original)
      Object.defineProperty(
        THREE.TextureLoader.prototype,
        'loadAsync',
        original,
      );
    else delete THREE.TextureLoader.prototype.loadAsync;
  });
  const details = new PlanetDetail({
    capabilities: { getMaxAnisotropy: () => 8 },
    initTexture() {},
  });
  const materials = {};
  for (const id of ['jupiter', 'mars', 'saturn', 'moon']) {
    const base = new THREE.Texture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: base },
        detailMap: { value: base },
        detailMix: { value: 0 },
      },
    });
    materials[id] = material;
    details.register(id, material);
    t.after(() => {
      base.dispose();
      material.dispose();
    });
  }
  const texture = () => {
    const map = new THREE.Texture();
    map.userData.disposals = 0;
    map.addEventListener('dispose', () => map.userData.disposals++);
    return map;
  };
  const finish = async (map) => {
    requests.at(-1).resolve(map);
    await new Promise(setImmediate);
  };
  details.update('jupiter', 0.1, false);
  details.update('mars', 0.1, false);
  assert.equal(
    requests.length,
    1,
    'rapid navigation must not start parallel uploads',
  );
  const obsolete = texture();
  await finish(obsolete);
  assert.equal(
    obsolete.userData.disposals,
    1,
    'discard a load for a world already left',
  );
  const loaded = {};
  for (const id of ['mars', 'jupiter', 'saturn', 'moon']) {
    details.update(id, 0.1, false);
    assert.ok(requests.at(-1).url.includes(id));
    loaded[id] = texture();
    await finish(loaded[id]);
    details.update(id, 2, false);
    assert.equal(materials[id].uniforms.detailMap.value, loaded[id]);
    assert.equal(materials[id].uniforms.detailMix.value, 1);
  }
  assert.equal(
    loaded.mars.userData.disposals,
    1,
    'the fourth map evicts the oldest unused detail',
  );
  assert.equal(materials.mars.uniforms.detailMix.value, 0);
  assert.equal(
    materials.mars.uniforms.detailMap.value,
    materials.mars.uniforms.map.value,
  );
  assert.equal(
    loaded.jupiter.userData.disposals +
      loaded.saturn.userData.disposals +
      loaded.moon.userData.disposals,
    0,
  );
  details.update('mars', 0.1, false);
  details.dispose();
  const late = texture();
  await finish(late);
  for (const map of [loaded.jupiter, loaded.saturn, loaded.moon, late])
    assert.equal(
      map.userData.disposals,
      1,
      'all detail resources retire exactly once',
    );
});

test('probe captions reserve the nearby planet limb during an approaching flyby', () => {
  const { storyPlacement } = require('../app/scene-story-motion.ts');
  const probe = { x: 940, y: 300, radius: 20, visible: true };
  const neptune = { x: 650, y: 292, radius: 150, visible: true };
  const free = storyPlacement(probe, 1470, 745, 320, 140);
  const protectedView = storyPlacement(probe, 1470, 745, 320, 140, neptune);
  assert.ok(
    free.x + 320 > neptune.x - neptune.radius,
    'fixture reproduces the observed overlap',
  );
  assert.ok(protectedView.x + 320 + 32 < neptune.x - neptune.radius);
  assert.ok(protectedView.x >= 1470 * 0.041);
  assert.equal(
    protectedView.y,
    free.y,
    'preserve reading height while reserving the limb',
  );
  assert.deepEqual(
    storyPlacement(probe, 1470, 745, 320, 140, { ...neptune, visible: false }),
    free,
  );
  assert.deepEqual(
    storyPlacement(probe, 390, 844, 350, 180, neptune),
    storyPlacement(probe, 390, 844, 350, 180),
    'mobile keeps its reading area below the subject',
  );
});

test('catalog stars align with the fixed J2000 sky and preserve magnitude order', () => {
  const {
    catalogDirection,
    createCatalogGeometry,
  } = require('../app/celestial-stars.ts');
  const catalog = JSON.parse(
    fs.readFileSync('public/sky/bright-stars.json', 'utf8'),
  );
  assert.equal(catalog.stars.length, 9096);
  const identifiers = new Set();
  for (const [id, ra, dec, magnitude, bv] of catalog.stars) {
    assert.ok(!identifiers.has(id));
    identifiers.add(id);
    assert.ok(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90);
    assert.ok(
      Number.isFinite(magnitude) && (bv === null || Number.isFinite(bv)),
    );
    assert.ok(Math.abs(catalogDirection(ra, dec).length() - 1) < 1e-12);
  }
  // Vernal equinox and north ecliptic pole independently constrain the axes
  // and sign of the equatorial-to-scene rotation (including the RA seam).
  assert.ok(
    catalogDirection(0, 0).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-12,
  );
  assert.ok(
    catalogDirection(360, 0).distanceTo(catalogDirection(0, 0)) < 1e-12,
  );
  assert.ok(
    catalogDirection(270, 66.560708333).distanceTo(new THREE.Vector3(0, 1, 0)) <
      1e-8,
  );
  const sirius = catalog.stars.find(([id]) => id === 2491);
  assert.deepEqual(sirius.slice(1, 4), [101.287083, -16.716111, -1.46]);
  const geometry = createCatalogGeometry([sirius, [0, 0, 0, 6, null]]);
  const size = geometry.getAttribute('starSize');
  const color = geometry.getAttribute('color');
  assert.ok(size.getX(0) > size.getX(1));
  assert.ok(color.getX(0) > color.getX(1));
  assert.ok(size.getX(0) < 3, 'even Sirius remains a small screen-space point');
  geometry.dispose();
});

test('moon markers resolve by projected depth and follow display pixel density', () => {
  const { createBodyMarkers } = require('../app/body-markers.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const marker = createBodyMarkers(1);
  const index = bodies
    .filter((body) => body.parent || body.region)
    .findIndex((body) => body.id === 'charon');
  const group = new THREE.Group();
  group.position.set(0, 0, -20);
  group.scale.setScalar(0.08 / bodyById.charon.radius);
  const groups = new Map([['charon', group]]);
  const camera = new THREE.PerspectiveCamera(90, 1.5, 0.1, 100);
  camera.updateMatrixWorld();
  marker.update(groups, camera, 1000, true, 1);
  const presence = marker.points.geometry.attributes.presence;
  const centered = presence.getX(index);
  assert.ok(
    centered > 0 && centered < 1,
    'a partly resolved disk shares its marker',
  );
  group.position.x = 12;
  marker.update(groups, camera, 1000, true, 2);
  assert.equal(
    presence.getX(index),
    centered,
    'off-axis placement does not delay the transition to the moon surface',
  );
  assert.equal(marker.points.material.uniforms.pointSize.value, 6.8);
  group.position.z = 20;
  marker.update(groups, camera, 1000, true, 2);
  assert.equal(presence.getX(index), 0, 'clear markers behind the near plane');
  marker.dispose();
});

test('sky tile edges and native directions match the base celestial frame', () => {
  const {
    createSkyTile,
    SKY_OBLIQUITY,
    SKY_ROW_COLUMNS,
  } = require('../app/sky-tiles.ts');
  const { catalogDirection } = require('../app/celestial-stars.ts');
  const transform = new THREE.Matrix4()
    .makeRotationX(-SKY_OBLIQUITY)
    .multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  for (const row of [0, 3, 7]) {
    const columns = SKY_ROW_COLUMNS[row];
    const stride = (16 * 16) / columns + 1;
    for (const column of [0, columns / 2, columns - 1]) {
      const tile = createSkyTile(row, column);
      const adjacent = createSkyTile(row, (column + 1) % columns);
      const p = tile.geometry.getAttribute('position');
      const q = adjacent.geometry.getAttribute('position');
      for (let y = 0; y <= 16; y++) {
        assert.ok(
          new THREE.Vector3()
            .fromBufferAttribute(p, y * stride + stride - 1)
            .distanceTo(
              new THREE.Vector3().fromBufferAttribute(q, y * stride),
            ) < 1e-7,
        );
      }
      const direction = new THREE.Vector3()
        .fromBufferAttribute(p, 8 * stride + (stride - 1) / 2)
        .applyMatrix4(transform);
      const expected = catalogDirection(
        180 - ((column + 0.5) * 360) / columns,
        90 - ((row + 0.5) * 180) / 8,
      );
      assert.ok(direction.distanceTo(expected) < 1e-7);
      tile.geometry.dispose();
      adjacent.geometry.dispose();
    }
  }
});

test('sky detail selection ignores astronomical translations and local clipping planes', () => {
  const { createSkyTiles, visibleSkyTiles } = require('../app/sky-tiles.ts');
  const tiles = createSkyTiles();
  const camera = new THREE.PerspectiveCamera(42, 1.8, 0.01, 4000);
  for (const direction of [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0.01),
    new THREE.Vector3(-1, -0.4, 1),
  ]) {
    camera.position.set(0, 0, 0);
    camera.lookAt(direction);
    camera.updateMatrixWorld();
    const original = visibleSkyTiles(tiles, camera).map((t) => t.id);
    assert.ok(original.length > 0 && original.length < 64);
    camera.position.set(4e9, -8e9, 1e9);
    camera.lookAt(camera.position.clone().add(direction));
    camera.near = 1e5;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    assert.deepEqual(
      visibleSkyTiles(tiles, camera)
        .map((t) => t.id)
        .sort((a, b) => a - b),
      original.sort((a, b) => a - b),
    );
  }
  tiles.forEach((tile) => tile.geometry.dispose());
});

test('cached sky directions preserve the previous ordered selection across camera configurations', () => {
  const { createSkyTiles, visibleSkyTiles } = require('../app/sky-tiles.ts');
  const { catalogDirection } = require('../app/celestial-stars.ts');
  const tiles = createSkyTiles();
  const previousSelection = (camera) => {
    const rotation = camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
    const projection = camera.projectionMatrix.clone();
    projection.elements[0] *= 0.88;
    projection.elements[5] *= 0.88;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      projection.multiply(rotation),
    );
    const forward = camera.getWorldDirection(new THREE.Vector3());
    return tiles
      .filter((tile) =>
        frustum.planes
          .slice(0, 4)
          .every(
            (plane) =>
              plane.distanceToPoint(tile.bounds.center) >= -tile.bounds.radius,
          ),
      )
      .sort(
        (a, b) =>
          forward.dot(b.bounds.center.clone().normalize()) -
          forward.dot(a.bounds.center.clone().normalize()),
      )
      .map(({ id }) => id);
  };
  let configurations = 0;
  for (const fov of [42, 49, 70]) {
    for (const aspect of [320 / 568, 390 / 844, 1, 844 / 390, 1920 / 889, 3]) {
      for (const [ra, dec] of [
        [0, -90],
        [0, 90],
        [0, 0],
        [180, 0],
        [45, 75],
        [315, -75],
        [123, 27],
        [271, -43],
      ]) {
        for (const { position, near, far, roll } of [
          { position: [0, 0, 0], near: 0.01, far: 4000, roll: 0 },
          { position: [4e9, -8e9, 1e9], near: 1e5, far: 1e12, roll: 0.37 },
          { position: [-2e-9, 5e-9, 1e-9], near: 1e-12, far: 1e-5, roll: -1.2 },
        ]) {
          const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
          camera.position.fromArray(position);
          camera.lookAt(camera.position.clone().add(catalogDirection(ra, dec)));
          camera.rotateZ(roll);
          camera.updateMatrixWorld();
          assert.deepEqual(
            visibleSkyTiles(tiles, camera).map(({ id }) => id),
            previousSelection(camera),
            `Ordered tiles at ${fov}°, ${aspect}, ${ra}/${dec}, roll ${roll}`,
          );
          configurations++;
        }
      }
    }
  }
  assert.equal(configurations, 432);
  tiles.forEach((tile) => tile.geometry.dispose());
});

test('sky streaming bounds requests and residency and disposes obsolete completions', async () => {
  const { SkyTileCache } = require('../app/sky-tiles.ts');
  const pending = new Map(),
    entered = [],
    left = [],
    disposed = [];
  const texture = (id) => {
    const t = new THREE.Texture();
    t.addEventListener('dispose', () => disposed.push(id));
    return t;
  };
  const cache = new SkyTileCache(
    (id) => new Promise((resolve) => pending.set(id, resolve)),
    (id) => entered.push(id),
    (id) => left.push(id),
  );
  const finish = async (id) => {
    pending.get(id)(texture(id));
    pending.delete(id);
    await Promise.resolve();
  };
  cache.request([0, 1, 2, 3], 2);
  cache.update();
  assert.deepEqual([...pending.keys()], [0, 1]);
  await finish(0);
  await finish(1);
  cache.update();
  assert.equal(
    cache.resident.size,
    1,
    'Only one new texture is admitted per frame',
  );
  cache.update();
  assert.equal(cache.resident.size, 2);
  cache.request([2, 3], 2);
  cache.update();
  assert.equal(
    cache.resident.size,
    2,
    'Retain current detail while its replacement loads',
  );
  await finish(2);
  cache.request([4, 5], 2);
  cache.update();
  assert.ok(disposed.includes(2));
  assert.deepEqual(entered, [0, 1]);
  await finish(3);
  cache.update();
  await finish(4);
  await finish(5);
  cache.update();
  cache.update();
  assert.deepEqual([...cache.resident.keys()], [4, 5]);
  assert.deepEqual(left, [0, 1]);
  cache.request([5, 4], 1);
  cache.update();
  assert.deepEqual(
    [...cache.resident.keys()],
    [5],
    'Shrinking the viewport applies its smaller memory budget immediately',
  );
  cache.request([6, 7], 2);
  cache.update();
  cache.dispose();
  await finish(6);
  await finish(7);
  assert.equal(cache.resident.size, 0);
  assert.equal(new Set(disposed).size, 8);
  assert.equal(disposed.length, 8, 'Every resource is disposed exactly once');
});

function stagedSkyCache() {
  const { SkyTileCache } = require('../app/sky-tiles.ts');
  const downloads = [],
    preparations = [],
    entered = [],
    left = [],
    textures = [],
    allocated = new Set();
  let peakAllocation = 0;
  const cache = new SkyTileCache(
    (id) =>
      new Promise((resolve) => {
        downloads.push({
          id,
          finish() {
            const texture = new THREE.Texture();
            const record = { id, texture, disposed: 0 };
            texture.addEventListener('dispose', () => {
              record.disposed++;
              allocated.delete(texture);
            });
            textures.push(record);
            resolve(texture);
          },
        });
      }),
    (id) => entered.push(id),
    (id) => left.push(id),
    (texture, current) =>
      new Promise((resolve, reject) => {
        allocated.add(texture);
        peakAllocation = Math.max(peakAllocation, allocated.size);
        preparations.push({ texture, current, resolve, reject });
      }),
  );
  return {
    cache,
    downloads,
    preparations,
    entered,
    left,
    textures,
    allocated,
    get peakAllocation() {
      return peakAllocation;
    },
    async finishDownload(index) {
      downloads[index].finish();
      await new Promise(setImmediate);
    },
    async finishPreparation(index, complete = true) {
      preparations[index].resolve(complete);
      await new Promise(setImmediate);
    },
  };
}

test('sky preparation retains full resident detail and bounds pending replacements', async () => {
  const state = stagedSkyCache();
  const { cache } = state;
  cache.request([0, 1, 2], 3);
  cache.update();
  assert.deepEqual(
    state.downloads.map(({ id }) => id),
    [0, 1],
  );
  await state.finishDownload(0);
  await state.finishDownload(1);
  cache.update();
  cache.update();
  assert.equal(state.preparations.length, 1);
  assert.equal(state.downloads.length, 2);
  assert.equal(cache.resident.size, 0);
  await state.finishPreparation(0);
  assert.equal(cache.resident.size, 0, 'A completed tile waits for admission');
  cache.update();
  assert.deepEqual(state.entered, [0]);
  assert.equal(state.preparations.length, 2);
  assert.deepEqual(
    state.downloads.map(({ id }) => id),
    [0, 1, 2],
  );
  await state.finishDownload(2);
  cache.update();
  assert.equal(state.preparations.length, 2, 'Only one GPU tile is prepared');
  await state.finishPreparation(1);
  cache.update();
  await state.finishPreparation(2);
  cache.update();
  assert.deepEqual([...cache.resident.keys()], [0, 1, 2]);
  cache.request([3, 4], 3);
  cache.update();
  await state.finishDownload(3);
  await state.finishDownload(4);
  cache.update();
  assert.deepEqual([...cache.resident.keys()], [0, 1, 2]);
  assert.deepEqual(state.left, []);
  await state.finishPreparation(3);
  assert.deepEqual(state.left, [], 'Old detail survives until admission');
  cache.update();
  assert.deepEqual(state.left, [0]);
  assert.equal(state.peakAllocation, 4, 'Only one extra GPU tile is allocated');
  await state.finishPreparation(4);
  cache.update();
  assert.deepEqual([...cache.resident.keys()], [2, 3, 4]);
  cache.dispose();
  assert.equal(state.allocated.size, 0);
  assert.ok(state.textures.every(({ disposed }) => disposed === 1));
});

test('obsolete sky preparation and completed replacements can be requested again', async () => {
  const state = stagedSkyCache();
  const { cache } = state;
  cache.request([5], 1);
  cache.update();
  await state.finishDownload(0);
  cache.update();
  cache.request([6], 1);
  cache.update();
  assert.equal(state.preparations[0].current(), false);
  await state.finishPreparation(0, false);
  assert.equal(state.textures[0].disposed, 1);
  cache.request([5], 1);
  cache.update();
  assert.deepEqual(
    state.downloads.map(({ id }) => id),
    [5, 6, 5],
  );
  await state.finishDownload(2);
  cache.update();
  await state.finishPreparation(1);
  cache.request([6], 1);
  cache.update();
  assert.equal(state.textures[1].disposed, 1);
  assert.deepEqual(state.entered, []);
  cache.request([5], 1);
  cache.update();
  assert.deepEqual(
    state.downloads.map(({ id }) => id),
    [5, 6, 5, 5],
  );
  cache.dispose();
  await state.finishDownload(1);
  await state.finishDownload(3);
  assert.ok(state.textures.every(({ disposed }) => disposed === 1));
});

test('failed sky preparation releases ownership and disposal cancels active and late work', async () => {
  const state = stagedSkyCache();
  const { cache } = state;
  cache.request([0, 1, 2], 3);
  cache.update();
  await state.finishDownload(0);
  await state.finishDownload(1);
  cache.update();
  state.preparations[0].reject(new Error('Upload failed'));
  await new Promise(setImmediate);
  cache.update();
  assert.deepEqual(
    state.downloads.map(({ id }) => id),
    [0, 1, 2],
  );
  assert.equal(state.textures[0].disposed, 1);
  assert.equal(state.preparations.length, 2);
  cache.dispose();
  assert.equal(state.preparations[1].current(), false);
  assert.equal(
    state.textures[1].disposed,
    0,
    'Active upload retains ownership',
  );
  await state.finishPreparation(1);
  await state.finishDownload(2);
  assert.equal(cache.resident.size, 0);
  assert.deepEqual(state.entered, []);
  assert.equal(state.allocated.size, 0);
  assert.ok(state.textures.every(({ disposed }) => disposed === 1));
});

test('polar sky detail covers the viewport within the existing texture budget', () => {
  const {
    createSkyTiles,
    visibleSkyTiles,
    SKY_ROW_COLUMNS,
    SKY_OBLIQUITY,
  } = require('../app/sky-tiles.ts');
  const { catalogDirection } = require('../app/celestial-stars.ts');
  const tiles = createSkyTiles();
  for (const [fov, aspect, budget] of [
    [42, 1470 / 801, 24],
    [45, 1470 / 801, 24],
    [49, 390 / 844, 16],
    [52, 390 / 844, 16],
  ]) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    for (const dec of [-90, -75, -55, 0, 55, 75, 90]) {
      for (let ra = 0; ra < 360; ra += 45) {
        camera.lookAt(catalogDirection(ra, dec));
        camera.updateMatrixWorld();
        const selected = new Set(
          visibleSkyTiles(tiles, camera)
            .slice(0, budget)
            .map((t) => t.id),
        );
        for (let y = -1; y <= 1; y += 0.2)
          for (let x = -1; x <= 1; x += 0.125) {
            const ray = new THREE.Vector3(x, y, 0.5)
              .unproject(camera)
              .normalize();
            const ey =
              -ray.y * Math.sin(SKY_OBLIQUITY) -
              ray.z * Math.cos(SKY_OBLIQUITY);
            const ez =
              ray.y * Math.cos(SKY_OBLIQUITY) - ray.z * Math.sin(SKY_OBLIQUITY);
            const longitude =
              (0.5 - Math.atan2(ey, ray.x) / (2 * Math.PI) + 1) % 1;
            const row = Math.min(
              7,
              Math.floor(
                (0.5 - Math.asin(Math.max(-1, Math.min(1, ez))) / Math.PI) * 8,
              ),
            );
            const column = Math.min(
              SKY_ROW_COLUMNS[row] - 1,
              Math.floor(longitude * SKY_ROW_COLUMNS[row]),
            );
            assert.ok(
              selected.has(row * 16 + column),
              `Missing ${row}-${column} at RA ${ra}, dec ${dec}; ${aspect}, ${x}, ${y}`,
            );
          }
      }
    }
  }
  tiles.forEach((t) => t.geometry.dispose());
});

test('planet detail follows flybys, preloads the destination and disposes obsolete downloads', async () => {
  const { PlanetDetail } = require('../app/planet-detail.ts');
  const requests = [],
    pending = [],
    disposed = [];
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    initTexture() {},
  };
  const detail = new PlanetDetail(renderer, (url) => {
    requests.push(url);
    return new Promise((resolve) => pending.push(resolve));
  });
  const materials = Object.fromEntries(
    ['jupiter', 'saturn', 'mars', 'moon'].map((id) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: new THREE.Texture() },
          detailMap: { value: null },
          detailMix: { value: 0 },
        },
      });
      detail.register(id, material);
      return [id, material];
    }),
  );
  const finish = async (name) => {
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed.push(name));
    pending.shift()(texture);
    await new Promise(setImmediate);
    return texture;
  };
  detail.update('jupiter', 0.1, false, 'saturn');
  detail.update('jupiter', 0.1, false, 'saturn');
  assert.equal(requests.length, 1, 'Only one download may be pending');
  assert.match(requests[0], /jupiter-4k/);
  const jupiter = await finish('jupiter');
  assert.equal(materials.jupiter.uniforms.detailMap.value, jupiter);
  detail.update('jupiter', 0.7, false, 'saturn');
  assert.equal(materials.jupiter.uniforms.detailMix.value, 0.5);
  assert.match(requests[1], /saturn-4k/);
  await finish('saturn');
  detail.update('mars', 0.1, false, 'saturn');
  await finish('mars');
  assert.deepEqual(
    disposed,
    [],
    'Keep the outgoing map through a three-world handoff',
  );
  assert.ok(materials.jupiter.uniforms.detailMix.value > 0);
  assert.equal(materials.jupiter.uniforms.detailMap.value, jupiter);
  detail.update('moon', 0.1, false);
  detail.dispose();
  await finish('late-moon');
  assert.deepEqual(
    disposed.sort((a, b) => a.localeCompare(b)),
    ['jupiter', 'late-moon', 'mars', 'saturn'],
  );
  Object.values(materials).forEach((material) => {
    material.uniforms.map.value.dispose();
    material.dispose();
  });
});

test('Earth retains surface and cloud detail while preparing the Moon', async () => {
  const {
    PlanetDetail,
    cloudDetailSurface,
  } = require('../app/planet-detail.ts');
  const requests = [],
    textures = [],
    disposed = [];
  const detail = new PlanetDetail(
    { capabilities: { getMaxAnisotropy: () => 8 }, initTexture() {} },
    async (url) => {
      requests.push(url);
      const texture = new THREE.Texture();
      texture.addEventListener('dispose', () => disposed.push(texture));
      textures.push(texture);
      return texture;
    },
  );
  const earth = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: new THREE.Texture() },
      detailMap: { value: null },
      detailMix: { value: 0 },
    },
  });
  const moon = earth.clone();
  const clouds = new THREE.MeshPhongMaterial({ alphaMap: new THREE.Texture() });
  const cloudSurface = cloudDetailSurface(clouds);
  detail.register('earth', earth);
  detail.register('earth-clouds', cloudSurface);
  detail.register('moon', moon);
  for (let i = 0; i < 10; i++) {
    detail.update('earth', 0.2, false, 'moon');
    await new Promise(setImmediate);
  }
  assert.deepEqual(
    requests.map((url) => url.split('/').pop()),
    ['earth-day-4k.jpg', 'earth-clouds-4k.jpg', 'moon-4k.jpg'],
    'Prepare the next destination without evicting either visible Earth layer',
  );
  assert.equal(
    cloudSurface.uniforms.detailMap.value.colorSpace,
    THREE.NoColorSpace,
  );
  assert.equal(earth.uniforms.detailMap.value.colorSpace, THREE.SRGBColorSpace);
  assert.equal(cloudSurface.uniforms.detailMix.value, 1);
  detail.update('moon', 0.1, false);
  await new Promise(setImmediate);
  assert.equal(textures.length - disposed.length, 3);
  detail.dispose();
  assert.equal(disposed.length, textures.length);
  earth.uniforms.map.value.dispose();
  moon.uniforms.map.value.dispose();
  clouds.alphaMap.dispose();
  earth.dispose();
  moon.dispose();
  clouds.dispose();
});

test('detail retention protects a departing planet by its visible footprint', async () => {
  const { PlanetDetail } = require('../app/planet-detail.ts');
  const disposed = [];
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    initTexture() {},
  };
  const detail = new PlanetDetail(renderer, async (url) => {
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed.push(url));
    return texture;
  });
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.01, 1000);
  camera.updateMatrixWorld();
  const bodies = {},
    materials = {};
  for (const id of ['jupiter', 'saturn', 'mars', 'moon']) {
    const object = new THREE.Group();
    object.position.set(30, 0, -6);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: new THREE.Texture() },
        detailMap: { value: null },
        detailMix: { value: 0 },
      },
    });
    bodies[id] = object;
    materials[id] = material;
    detail.register(id, material, object, 1);
  }
  for (const id of ['jupiter', 'saturn', 'mars']) {
    detail.update(id, 2, false);
    await new Promise(setImmediate);
  }
  bodies.jupiter.position.x = 0;
  const jupiter = materials.jupiter.uniforms.detailMap.value;
  detail.update('moon', 2, false, 'saturn', { camera, height: 708 });
  await new Promise(setImmediate);
  assert.match(disposed[0], /mars-4k/);
  assert.equal(materials.jupiter.uniforms.detailMap.value, jupiter);
  assert.equal(materials.jupiter.uniforms.detailMix.value, 1);
  // Rebase every world and the camera uniformly. The departing disk still
  // has the same footprint, even though the destination request changed.
  bodies.jupiter.scale.setScalar(0.0001);
  bodies.jupiter.position.multiplyScalar(0.0001);
  detail.update('mars', 2, false, 'moon', { camera, height: 708 });
  await new Promise(setImmediate);
  assert.equal(materials.jupiter.uniforms.detailMap.value, jupiter);
  assert.match(disposed[1], /saturn-4k/);
  detail.dispose();
  Object.values(materials).forEach((material) => {
    material.uniforms.map.value.dispose();
    material.dispose();
  });
});

test('sky exposure follows visible illuminated coverage in any rebased scale', () => {
  const { SkyExposure } = require('../app/sky-exposure.ts');
  const meter = new SkyExposure();
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.01, 1000);
  camera.updateMatrixWorld();
  const object = new THREE.Group();
  object.position.set(0, 0, -10);
  const body = { object, radius: 2, emissive: false };
  const sun = new THREE.Vector3(0, 0, 20);
  const lit = meter.target(camera, [body], sun);
  assert.ok(lit > 0.42 && lit < 0.9);
  assert.equal(meter.target(camera, [], sun), 1);
  object.visible = false;
  assert.equal(meter.target(camera, [body], sun), 1);
  object.visible = true;
  assert.equal(meter.target(camera, [body], new THREE.Vector3(0, 0, -20)), 1);
  object.position.z = 10;
  assert.equal(
    meter.target(camera, [body], sun),
    1,
    'Ignore bodies behind the camera',
  );
  object.position.z = -10;
  let previous = lit;
  for (let x = 0; x <= 20; x += 0.02) {
    object.position.x = x;
    const next = meter.target(camera, [body], sun);
    assert.ok(
      Math.abs(next - previous) < 0.01,
      'No jump as the limb leaves the frame',
    );
    previous = next;
  }
  assert.equal(previous, 1);
  const offset = new THREE.Vector3(17, -8, 4);
  for (const scale of [0.0001, 1, 10000]) {
    camera.position.copy(offset);
    camera.lookAt(offset.clone().add(new THREE.Vector3(0, 0, -1)));
    camera.updateMatrixWorld();
    object.position.set(0, 0, -10).multiplyScalar(scale).add(offset);
    object.scale.setScalar(scale);
    sun.set(0, 0, 20).multiplyScalar(scale).add(offset);
    assert.ok(Math.abs(meter.target(camera, [body], sun) - lit) < 1e-11);
  }
});

test('sky adaptation is smooth and independent of refresh rate', () => {
  const { SkyExposure } = require('../app/sky-exposure.ts');
  const final = [];
  for (const fps of [30, 60, 144]) {
    const meter = new SkyExposure();
    for (let i = 0; i < fps * 3; i++) {
      const previous = meter.value;
      meter.update(0.42, 1 / fps, false);
      assert.ok(meter.value <= previous && previous - meter.value < 0.02);
    }
    const closeup = meter.value;
    for (let i = 0; i < fps * 3; i++) meter.update(1, 1 / fps, false);
    final.push([closeup, meter.value]);
    assert.equal(meter.update(0.42, 0, true), 0.42);
  }
  assert.ok(
    final.every(
      ([a, b]) =>
        Math.abs(a - final[0][0]) < 1e-12 && Math.abs(b - final[0][1]) < 1e-12,
    ),
  );
});

test('shared full-resolution body spheres preserve every layer position, normal and texture coordinate through atlas and historical scaling', () => {
  const { SharedBodySpheres } = require('../app/body-spheres.ts');
  const { bodies, bodyById } = require('../app/solar-data.ts');
  const spheres = new SharedBodySpheres();
  const material = new THREE.ShaderMaterial();
  const immutable = JSON.stringify(bodies);
  const original = {};
  for (const name of ['position', 'normal', 'uv'])
    original[name] = spheres.geometry.getAttribute(name).array.slice();
  const indices = spheres.geometry.index.array.slice();
  const geometries = new Set();
  const atlasPositions = new Map();
  let layers = 0;
  for (const body of bodies) {
    const center = new THREE.Vector3(
      Math.cos(body.angle) * body.orbit,
      0,
      Math.sin(body.angle) * body.orbit,
    );
    if (body.parent)
      center
        .applyAxisAngle(
          new THREE.Vector3(0, 0, 1),
          bodyById[body.parent].tilt ?? 0.05,
        )
        .add(atlasPositions.get(body.parent));
    atlasPositions.set(body.id, center);
    if (['belt', 'kuiper', 'comet'].includes(body.id)) continue;
    const supported = ['surface'];
    if (
      [
        'earth',
        'venus',
        'mars',
        'jupiter',
        'saturn',
        'titan',
        'neptune',
        'uranus',
      ].includes(body.id)
    )
      supported.push('atmosphere');
    if (body.id === 'earth') supported.push('clouds');
    for (const layer of supported) {
      layers++;
      const shell =
        layer === 'clouds'
          ? 1.012
          : layer === 'atmosphere'
            ? body.id === 'mars'
              ? 1.009
              : 1.022
            : 1;
      const legacy = new THREE.SphereGeometry(body.radius * shell, 192, 128);
      if (layer === 'surface' && body.shape) legacy.scale(...body.shape);
      if (body.id === 'saturn' || body.id === 'jupiter')
        legacy.scale(1, 0.92, 1);
      const reference = new THREE.Mesh(legacy, material);
      const shared = spheres.create(body, material, layer);
      geometries.add(shared.geometry);
      assert.equal(shared.material, material);
      assert.equal(shared.castShadow, reference.castShadow);
      assert.equal(shared.receiveShadow, reference.receiveShadow);
      assert.deepEqual(shared.geometry.index.array, legacy.index.array);
      assert.deepEqual(
        shared.geometry.getAttribute('uv').array,
        legacy.getAttribute('uv').array,
      );
      const root = new THREE.Group();
      root.position.copy(center);
      root.add(reference, shared);
      reference.rotation.y = shared.rotation.y =
        layer === 'atmosphere' ? 0 : 0.47;
      for (const historical of [false, true]) {
        const scale = historical ? 0.00003 : 1;
        root.scale.setScalar(scale);
        if (historical)
          root.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0.3, 0.85, 0.1).normalize(),
          );
        else root.rotation.set(0, 0, body.tilt ?? 0.05);
        root.updateMatrixWorld(true);
        const oldNormal = new THREE.Matrix3().getNormalMatrix(
          reference.matrixWorld,
        );
        const newNormal = new THREE.Matrix3().getNormalMatrix(
          shared.matrixWorld,
        );
        const oldPoint = new THREE.Vector3(),
          newPoint = new THREE.Vector3();
        const oldDirection = new THREE.Vector3(),
          newDirection = new THREE.Vector3();
        let positionError = 0,
          normalError = 0;
        const oldBounds = new THREE.Box3(),
          newBounds = new THREE.Box3();
        const vertices = legacy.getAttribute('position');
        for (let i = 0; i < vertices.count; i++) {
          oldPoint
            .fromBufferAttribute(vertices, i)
            .applyMatrix4(reference.matrixWorld);
          newPoint
            .fromBufferAttribute(shared.geometry.getAttribute('position'), i)
            .applyMatrix4(shared.matrixWorld);
          positionError = Math.max(
            positionError,
            oldPoint.distanceTo(newPoint),
          );
          oldBounds.expandByPoint(oldPoint);
          newBounds.expandByPoint(newPoint);
          oldDirection
            .fromBufferAttribute(legacy.getAttribute('normal'), i)
            .applyNormalMatrix(oldNormal);
          newDirection
            .fromBufferAttribute(shared.geometry.getAttribute('normal'), i)
            .applyNormalMatrix(newNormal);
          normalError = Math.max(
            normalError,
            oldDirection.distanceTo(newDirection),
          );
        }
        const tolerance = Math.max(
          1e-9,
          body.radius * shell * scale * 0.000002,
        );
        assert.ok(
          positionError < tolerance,
          `${body.id}/${layer}: world positions differ by ${positionError}`,
        );
        assert.ok(
          normalError < 0.000002,
          `${body.id}/${layer}: world normals differ by ${normalError}`,
        );
        assert.ok(oldBounds.min.distanceTo(newBounds.min) < tolerance);
        assert.ok(oldBounds.max.distanceTo(newBounds.max) < tolerance);
      }
      legacy.dispose();
    }
  }
  assert.equal(layers, 42);
  assert.equal(
    geometries.size,
    1,
    'all compatible layers share one vertex/index allocation',
  );
  assert.equal(spheres.geometry.getAttribute('position').count, 193 * 129);
  for (const name of ['position', 'normal', 'uv'])
    assert.deepEqual(
      spheres.geometry.getAttribute(name).array,
      original[name],
      'creating ellipsoids never mutates the shared sphere',
    );
  assert.deepEqual(spheres.geometry.index.array, indices);
  assert.equal(JSON.stringify(bodies), immutable);
  let geometryDisposals = 0,
    materialDisposals = 0;
  spheres.geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  spheres.dispose();
  assert.equal(
    geometryDisposals,
    1,
    'the scene owns and releases the shared allocation once',
  );
  assert.equal(
    materialDisposals,
    0,
    'sphere cleanup does not release independently owned surfaces',
  );
  material.dispose();
});

function preparationFrames() {
  const pending = [];
  let frame = 0;
  return {
    get frame() {
      return frame;
    },
    get pending() {
      return pending.length;
    },
    nextFrame: () => new Promise((resolve) => pending.push(resolve)),
    async advance() {
      frame++;
      for (const resolve of pending.splice(0)) resolve();
      await new Promise(setImmediate);
    },
  };
}

test('concurrent spacecraft preparations spread seven shared maps across frames and await complete shaders', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const frames = preparationFrames(),
    uploads = [],
    compiled = [],
    shaders = [];
  const textures = Array.from(
    { length: 7 },
    (_, index) =>
      new THREE.Texture({
        width: index === 0 ? 128 : index < 3 ? 512 : 1024,
        height: index === 0 ? 128 : index < 3 ? 512 : 1024,
      }),
  );
  const images = textures.map((texture) => texture.image);
  const renderer = {
    initTexture(texture) {
      uploads.push({ texture, frame: frames.frame });
    },
    compileAsync(craft) {
      compiled.push(craft);
      return new Promise((resolve) => shaders.push(resolve));
    },
  };
  const prepare = createSpacecraftPreparation(
    renderer,
    new THREE.Camera(),
    new THREE.Scene(),
    () => true,
    { nextFrame: frames.nextFrame },
  );
  const craft = [new THREE.Group(), new THREE.Group()];
  for (const group of craft) {
    const material = new THREE.MeshStandardMaterial(
      Object.fromEntries(
        [
          'map',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'emissiveMap',
          'alphaMap',
          'aoMap',
        ].map((key, index) => [key, textures[index]]),
      ),
    );
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  }
  let ready = false;
  const preparation = Promise.all(craft.map((group) => prepare(group))).then(
    () => {
      ready = true;
    },
  );
  await new Promise(setImmediate);
  assert.equal(
    uploads.length,
    0,
    'a first upload always yields before GPU submission',
  );
  for (let frame = 1; frame <= 7; frame++) {
    assert.equal(
      frames.pending,
      1,
      'concurrent preparations share one frame queue',
    );
    await frames.advance();
    assert.equal(uploads.length, frame);
    assert.equal(uploads.at(-1).frame, frame);
    assert.equal(ready, false);
    if (frame < 7) assert.equal(compiled.length, 0);
  }
  assert.equal(new Set(uploads.map(({ texture }) => texture)).size, 7);
  assert.equal(compiled.length, 2);
  shaders.splice(0).forEach((resolve) => resolve());
  await preparation;
  assert.equal(ready, true);
  for (let i = 0; i < textures.length; i++) {
    assert.equal(textures[i].image, images[i]);
    assert.equal(textures[i].generateMipmaps, true);
  }
  const warmed = prepare(craft[0]);
  await new Promise(setImmediate);
  assert.equal(frames.pending, 0);
  assert.equal(
    uploads.length,
    7,
    'resident shared maps are not uploaded again',
  );
  shaders.splice(0).forEach((resolve) => resolve());
  await warmed;
  craft.forEach(disposeSpacecraft);
  textures.forEach((texture) => texture.dispose());
});

test('failed and cancelled spacecraft uploads leave the frame queue available for retries', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const frames = preparationFrames(),
    uploads = [],
    compiled = [];
  const failedTexture = new THREE.Texture(),
    otherTexture = new THREE.Texture(),
    cancelledTexture = new THREE.Texture();
  let active = true,
    fail = true;
  const renderer = {
    initTexture(texture) {
      if (texture === failedTexture && fail) {
        fail = false;
        throw new Error('Interrupted upload');
      }
      uploads.push(texture);
    },
    async compileAsync(craft) {
      compiled.push(craft);
    },
  };
  const prepare = createSpacecraftPreparation(
    renderer,
    new THREE.Camera(),
    new THREE.Scene(),
    () => active,
    { nextFrame: frames.nextFrame },
  );
  const craft = [
    failedTexture,
    failedTexture,
    otherTexture,
    cancelledTexture,
  ].map((map) => {
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ map }),
      ),
    );
    return group;
  });
  const failed = assert.rejects(
    Promise.all([prepare(craft[0]), prepare(craft[1])]),
    /Interrupted upload/,
  );
  const succeeding = prepare(craft[2]);
  await new Promise(setImmediate);
  await frames.advance();
  await failed;
  assert.equal(uploads.length, 0);
  await frames.advance();
  await succeeding;
  assert.deepEqual(uploads, [otherTexture]);
  assert.deepEqual(compiled, [craft[2]]);
  const retried = prepare(craft[0]);
  await new Promise(setImmediate);
  await frames.advance();
  await retried;
  assert.deepEqual(uploads, [otherTexture, failedTexture]);
  const cancelled = prepare(craft[3]);
  await new Promise(setImmediate);
  active = false;
  await frames.advance();
  await cancelled;
  assert.equal(uploads.length, 2);
  assert.equal(compiled.includes(craft[3]), false);
  active = true;
  const restored = prepare(craft[3]);
  await new Promise(setImmediate);
  await frames.advance();
  await restored;
  assert.equal(uploads.at(-1), cancelledTexture);
  assert.equal(compiled.at(-1), craft[3]);
  active = false;
  await prepare(craft[2]);
  assert.equal(
    frames.pending,
    0,
    'a disposed scene never schedules more GPU work',
  );
  craft.forEach(disposeSpacecraft);
  [failedTexture, otherTexture, cancelledTexture].forEach((texture) =>
    texture.dispose(),
  );
});

test('queued spacecraft uploads retain every large-map strip and generate the complete mip chain before reveal', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const frames = preparationFrames(),
    transfers = [],
    initialized = [];
  const previous = {
    ImageBitmap: global.ImageBitmap,
    createImageBitmap: global.createImageBitmap,
    requestAnimationFrame: global.requestAnimationFrame,
  };
  class Bitmap {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    close() {}
  }
  const image = new Bitmap(2048, 1024),
    texture = new THREE.Texture(image);
  const craft = new THREE.Group();
  craft.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ map: texture }),
    ),
  );
  let compiled = false;
  global.ImageBitmap = Bitmap;
  global.createImageBitmap = async (_image, _x, _y, width, height) =>
    new Bitmap(width, height);
  global.requestAnimationFrame = (callback) => {
    void frames.nextFrame().then(() => callback(frames.frame));
    return frames.pending;
  };
  try {
    const prepare = createSpacecraftPreparation(
      {
        initTexture(map) {
          initialized.push({ map, frame: frames.frame });
        },
        copyTextureToTexture(source, target, _rectangle, offset) {
          transfers.push({
            width: source.image.width,
            height: source.image.height,
            y: offset.y,
            mipmaps: target.generateMipmaps,
            frame: frames.frame,
          });
        },
        async compileAsync() {
          compiled = true;
        },
      },
      new THREE.Camera(),
      new THREE.Scene(),
      () => true,
      { nextFrame: frames.nextFrame },
    );
    const ready = prepare(craft);
    await new Promise(setImmediate);
    await frames.advance();
    assert.equal(initialized.length, 1);
    assert.equal(transfers.length, 0);
    for (let strip = 0; strip < 16; strip++) {
      await frames.advance();
      assert.equal(transfers.length, strip + 1);
      assert.equal(transfers[strip].y, strip * 64);
      assert.equal(transfers[strip].width, 2048);
      assert.equal(transfers[strip].height, 64);
      assert.equal(transfers[strip].mipmaps, strip === 15);
      if (strip < 15) assert.equal(compiled, false);
    }
    await ready;
    assert.equal(compiled, true);
    assert.equal(texture.image, image);
    assert.equal(texture.source.dataReady, true);
    assert.equal(texture.generateMipmaps, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
    disposeSpacecraft(craft);
    texture.dispose();
  }
});

test('arrival preparation selects the same lighting and shader program as the visible mission', async () => {
  const { WebGLLights } =
    await import('three/src/renderers/webgl/WebGLLights.js');
  const { WebGLPrograms } =
    await import('three/src/renderers/webgl/WebGLPrograms.js');
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  for (const outgoingVisibility of [[], [true], [false], [true, false]]) {
    const scene = new THREE.Scene(),
      camera = new THREE.Camera();
    scene.environment = new THREE.Texture();
    scene.environmentIntensity = 0.7;
    scene.environmentRotation.set(0.2, 0.4, 0.1);
    scene.fog = new THREE.Fog('#102030', 1, 100);
    const sunlight = new THREE.DirectionalLight();
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.autoUpdate = false;
    const hidden = new THREE.PointLight();
    hidden.visible = false;
    const masked = new THREE.SpotLight();
    masked.layers.set(1);
    const baseLights = [
      new THREE.PointLight(),
      sunlight,
      new THREE.AmbientLight(),
      hidden,
      masked,
    ];
    scene.add(...baseLights);
    const outgoing = outgoingVisibility.map((visible) => {
      const group = new THREE.Group();
      group.visible = visible;
      group.add(new THREE.HemisphereLight());
      scene.add(group);
      return group;
    });
    const incoming = new THREE.Group(),
      craft = new THREE.Group(),
      surface = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial(),
      );
    const concealed = new THREE.Group();
    concealed.visible = false;
    concealed.add(new THREE.HemisphereLight());
    craft.add(surface, new THREE.PointLight());
    incoming.add(craft, new THREE.HemisphereLight(), concealed);
    const sceneChildren = [...scene.children],
      incomingChildren = [...incoming.children];
    let prepared, finishCompile;
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      shadowMap: { enabled: true, type: THREE.PCFShadowMap },
      state: { buffers: { depth: { getReversed: () => false } } },
      getRenderTarget: () => null,
      compileAsync(object, view, target) {
        prepared = { object, view, target };
        return new Promise((resolve) => {
          finishCompile = resolve;
        });
      },
    };
    const programs = WebGLPrograms(
      renderer,
      { get: (texture) => texture },
      { has: () => false },
      { precision: 'highp', logarithmicDepthBuffer: false },
      {},
      { numPlanes: 0, numIntersection: 0 },
    );
    const signature = (target, object) => {
      const lights = [];
      for (const root of object ? [target, object] : [target])
        root.traverseVisible((entry) => {
          if (entry.isLight && entry.layers.test(camera.layers))
            lights.push(entry);
        });
      const lighting = WebGLLights();
      lighting.setup(lights);
      const parameters = programs.getParameters(
        surface.material,
        lighting.state,
        lights.filter((light) => light.castShadow),
        target,
        surface,
        [],
      );
      return { parameters, key: programs.getProgramCacheKey(parameters) };
    };
    const prepare = createSpacecraftPreparation(
      renderer,
      camera,
      scene,
      () => true,
      { lights: baseLights },
    );
    const pending = prepare(craft, { group: incoming });
    assert.equal(prepared.object, craft);
    assert.equal(prepared.view, camera);
    assert.notEqual(prepared.target, scene);
    assert.equal(prepared.target.environment, scene.environment);
    assert.equal(prepared.target.environmentIntensity, 0.7);
    assert.ok(
      prepared.target.environmentRotation.equals(scene.environmentRotation),
    );
    assert.equal(prepared.target.fog, scene.fog);
    assert.deepEqual(scene.children, sceneChildren);
    assert.deepEqual(incoming.children, incomingChildren);
    assert.deepEqual(
      outgoing.map((group) => group.visible),
      outgoingVisibility,
      'the displayed outgoing view stays intact while shaders are pending',
    );
    const compiled = signature(prepared.target, craft);
    assert.equal(compiled.parameters.numHemiLights, 1);
    assert.equal(compiled.parameters.numPointLights, 2);
    assert.equal(compiled.parameters.numSpotLights, 0);
    assert.equal(compiled.parameters.numDirLights, 1);
    assert.equal(compiled.parameters.numDirLightShadows, 1);
    assert.equal(compiled.parameters.shadowMapEnabled, true);
    assert.equal(compiled.parameters.shadowMapType, THREE.PCFShadowMap);
    for (const light of prepared.target.children) {
      assert.equal(baseLights.includes(light), false);
      assert.notEqual(light, incoming.children[1]);
    }
    const shadowLight = prepared.target.children.find(
      (light) => light.isDirectionalLight,
    );
    assert.deepEqual(shadowLight.shadow.mapSize.toArray(), [1024, 1024]);
    assert.equal(shadowLight.shadow.autoUpdate, false);
    finishCompile();
    await pending;
    scene.remove(...outgoing);
    scene.add(incoming);
    const arrival = signature(scene);
    assert.equal(
      compiled.key,
      arrival.key,
      `prepared and arriving programs match after outgoing visibility ${outgoingVisibility.join(',')}`,
    );
    programs.dispose();
    disposeSpacecraft(craft);
    scene.environment.dispose();
  }
});

test('superseded chapter preparation retains shared uploads without compiling obsolete hardware', async () => {
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const frames = preparationFrames(),
    compiled = [],
    uploads = [];
  const scene = new THREE.Scene(),
    visible = new THREE.Group(),
    texture = new THREE.Texture();
  scene.add(visible);
  const craft = [new THREE.Group(), new THREE.Group()];
  for (const group of craft)
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ map: texture }),
      ),
    );
  let serial = 1;
  const prepare = createSpacecraftPreparation(
    {
      initTexture(map) {
        uploads.push(map);
      },
      async compileAsync(group) {
        compiled.push(group);
      },
    },
    new THREE.Camera(),
    scene,
    () => true,
    { nextFrame: frames.nextFrame },
  );
  const obsolete = prepare(craft[0], { current: () => serial === 1 });
  await new Promise(setImmediate);
  assert.equal(frames.pending, 1);
  serial = 2;
  const incoming = prepare(craft[1], { current: () => serial === 2 });
  await frames.advance();
  await Promise.all([obsolete, incoming]);
  assert.deepEqual(uploads, [texture]);
  assert.deepEqual(compiled, [craft[1]]);
  assert.deepEqual(scene.children, [visible]);
  assert.equal(visible.visible, true);
  craft.forEach(disposeSpacecraft);
  texture.dispose();
});

test('scene and spacecraft preparation compile the same linear HDR program used by the full-quality draw', async () => {
  const { createSceneRendering } = require('../app/scene-rendering.ts');
  const {
    createSpacecraftPreparation,
  } = require('../app/spacecraft-preparation.ts');
  const { WebGLLights } =
    await import('three/src/renderers/webgl/WebGLLights.js');
  const { WebGLPrograms } =
    await import('three/src/renderers/webgl/WebGLPrograms.js');
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(),
    craft = new THREE.Group(),
    group = new THREE.Group(),
    surface = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true }),
    );
  const sunlight = new THREE.DirectionalLight();
  sunlight.castShadow = true;
  const lights = [sunlight, new THREE.PointLight(), new THREE.AmbientLight()];
  craft.add(surface);
  group.add(craft, new THREE.HemisphereLight());
  scene.add(...lights, group);
  const previous = new THREE.WebGLCubeRenderTarget(16);
  let active = previous,
    face = 3,
    level = 1;
  const compiled = [],
    complete = [],
    draws = [];
  const renderer = {
    capabilities: { maxSamples: 8 },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.25,
    shadowMap: { enabled: true, type: THREE.PCFShadowMap },
    state: { buffers: { depth: { getReversed: () => false } } },
    getDrawingBufferSize: (size) => size.set(750, 1400),
    getRenderTarget: () => active,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => level,
    setRenderTarget(target, nextFace = 0, nextLevel = 0) {
      active = target;
      face = nextFace;
      level = nextLevel;
    },
    compileAsync(object, view, target) {
      compiled.push({ target: active, view, ...signature(target, object) });
      return new Promise((resolve) => complete.push(() => resolve(object)));
    },
    render(object) {
      if (object === scene) draws.push({ target: active, ...signature(scene) });
    },
  };
  const programs = WebGLPrograms(
    renderer,
    { get: (texture) => texture },
    { has: () => false },
    { precision: 'highp', logarithmicDepthBuffer: false },
    {},
    { numPlanes: 0, numIntersection: 0 },
  );
  function signature(target, object = target) {
    const visibleLights = [];
    for (const root of object === target ? [target] : [target, object])
      root.traverseVisible((entry) => {
        if (entry.isLight && entry.layers.test(camera.layers))
          visibleLights.push(entry);
      });
    const lighting = WebGLLights();
    lighting.setup(visibleLights);
    const parameters = programs.getParameters(
      surface.material,
      lighting.state,
      visibleLights.filter((light) => light.castShadow),
      target,
      surface,
      [],
    );
    return { parameters, key: programs.getProgramCacheKey(parameters) };
  }
  const rendering = createSceneRendering(renderer, scene, camera);
  rendering.setSize();
  renderer.setRenderTarget(null);
  const screen = signature(scene);
  assert.equal(screen.parameters.outputColorSpace, THREE.SRGBColorSpace);
  assert.equal(screen.parameters.toneMapping, THREE.ACESFilmicToneMapping);
  renderer.setRenderTarget(previous, 3, 1);
  const startup = rendering.compile(scene);
  assert.equal(active, previous);
  assert.equal(face, 3);
  assert.equal(level, 1);
  const prepare = createSpacecraftPreparation(
    renderer,
    camera,
    scene,
    () => true,
    { lights, compile: rendering.compile },
  );
  const incoming = prepare(craft, { group });
  assert.equal(active, previous);
  assert.equal(face, 3);
  assert.equal(level, 1);
  assert.equal(draws.length, 0, 'preparation never draws the live scene');
  assert.equal(compiled.length, 2);
  assert.equal(compiled[0].target, compiled[1].target);
  for (const entry of compiled) {
    assert.equal(entry.parameters.outputColorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(entry.parameters.toneMapping, THREE.NoToneMapping);
    assert.equal(entry.parameters.numHemiLights, 1);
    assert.equal(entry.parameters.numDirLightShadows, 1);
    assert.equal(entry.view, camera);
    assert.equal(entry.target.texture.type, THREE.HalfFloatType);
    assert.equal(entry.target.samples, 4);
    assert.equal(entry.target.resolveDepthBuffer, false);
    assert.equal(entry.target.width, 750);
    assert.equal(entry.target.height, 1400);
    assert.notEqual(entry.key, screen.key);
  }
  complete.splice(0).forEach((resolve) => resolve());
  await Promise.all([startup, incoming]);
  rendering.render();
  assert.equal(draws.length, 1);
  assert.equal(draws[0].target, compiled[0].target);
  for (const entry of compiled) assert.equal(entry.key, draws[0].key);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
  assert.equal(renderer.shadowMap.type, THREE.PCFShadowMap);
  rendering.dispose();
  previous.dispose();
  programs.dispose();
  disposeSpacecraft(craft);
});

test('HDR preparation restores the active target before waiting, throwing or rejecting', async () => {
  const { createSceneRendering } = require('../app/scene-rendering.ts');
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(),
    previous = new THREE.WebGLCubeRenderTarget(16),
    next = new THREE.WebGLRenderTarget(4, 4);
  let active = previous,
    face = 4,
    level = 2,
    mode = 'pending',
    finish;
  const renderer = {
    capabilities: { maxSamples: 4 },
    getRenderTarget: () => active,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => level,
    setRenderTarget(target, nextFace = 0, nextLevel = 0) {
      active = target;
      face = nextFace;
      level = nextLevel;
    },
    compileAsync(object) {
      assert.notEqual(active, previous);
      assert.equal(active.texture.type, THREE.HalfFloatType);
      if (mode === 'throw') throw new Error('Compile setup failed');
      if (mode === 'reject')
        return Promise.reject(new Error('Program readiness failed'));
      return new Promise((resolve) => {
        finish = () => resolve(object);
      });
    },
  };
  const rendering = createSceneRendering(renderer, scene, camera);
  const pending = rendering.compile(scene);
  assert.equal(active, previous);
  assert.equal(face, 4);
  assert.equal(level, 2);
  renderer.setRenderTarget(next);
  finish();
  await pending;
  assert.equal(
    active,
    next,
    'asynchronous readiness never restores stale state',
  );
  for (mode of ['throw', 'reject']) {
    renderer.setRenderTarget(previous, 4, 2);
    if (mode === 'throw')
      assert.throws(() => rendering.compile(scene), /Compile setup failed/);
    else {
      const rejected = rendering.compile(scene);
      assert.equal(active, previous);
      await assert.rejects(rejected, /Program readiness failed/);
    }
    assert.equal(active, previous);
    assert.equal(face, 4);
    assert.equal(level, 2);
  }
  rendering.dispose();
  previous.dispose();
  next.dispose();
});

function modelBufferFixture(compressed = false) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const binary = Buffer.alloc(80);
  Buffer.from(positions.buffer).copy(binary, 0);
  Buffer.from(normals.buffer).copy(binary, 36);
  Buffer.from(indices.buffer).copy(binary, 72);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'first', mesh: 0, translation: [1, 2, 3] },
      { name: 'second', mesh: 0, translation: [-3, 1, 0] },
    ],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name: 'foil',
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.75, 0.55, 0.25, 1],
          metallicFactor: 0.7,
          roughnessFactor: 0.35,
        },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  if (compressed) {
    json.extensionsUsed = ['EXT_meshopt_compression'];
    json.extensionsRequired = ['EXT_meshopt_compression'];
    json.bufferViews[0].extensions = {
      EXT_meshopt_compression: {
        buffer: 0,
        byteOffset: 0,
        byteLength: 36,
        byteStride: 12,
        count: 3,
        mode: 'ATTRIBUTES',
        filter: 'NONE',
      },
    };
  }
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  glb.writeUInt32LE(binary.length, 20 + padded.length);
  glb.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(glb, 28 + padded.length);
  return {
    data: glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
    views: [
      binary.subarray(0, 36),
      binary.subarray(36, 72),
      binary.subarray(72, 78),
    ],
    positions,
    normals,
    indices,
  };
}

async function completeModelFrames(pending, frames, advance) {
  let outcome;
  const observed = pending.then(
    (value) => {
      outcome = { value };
    },
    (error) => {
      outcome = { error };
    },
  );
  for (let attempt = 0; attempt < 100 && !outcome; attempt++) {
    await new Promise(setImmediate);
    const resolve = frames.shift();
    if (resolve) {
      advance();
      resolve();
    }
  }
  assert.ok(outcome, 'model loading must finish without a dependency deadlock');
  await observed;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

test('concurrent model dependencies retain source bytes and cache identity across bounded shared frames', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { createModelBufferQueue } = require('../app/model-dependencies.ts');
  const fixture = modelBufferFixture();
  const frames = [];
  const schedule = createModelBufferQueue(
    () => new Promise((resolve) => frames.push(resolve)),
    () => 0,
  );
  const defaults = [];
  const caches = [];
  let frame = 0;
  const load = (model) =>
    new GLTFLoader()
      .register((parser) => {
        const original = parser.loadBufferView.bind(parser);
        parser.loadBufferView = (index) => {
          defaults.push({ model, index, frame });
          return original(index);
        };
        return {
          name: 'dependency-order-probe',
          beforeRoot() {
            const views = [2, 0, 1, 2, 0].map((index) =>
              parser.getDependency('bufferView', index),
            );
            assert.equal(views[0], views[3]);
            assert.equal(views[1], views[4]);
            caches.push(views);
            return null;
          },
        };
      })
      .register(schedule)
      .parseAsync(fixture.data, '');
  const pending = Promise.all([load('first'), load('second')]);
  await new Promise(setImmediate);
  assert.equal(
    defaults.length,
    0,
    'no default buffer copy runs before its frame',
  );
  const results = await completeModelFrames(pending, frames, () => frame++);
  assert.equal(frame, 2);
  assert.deepEqual(
    defaults.map((entry) => entry.frame),
    [1, 1, 1, 1, 2, 2],
    'concurrent parsers share one four-view limit',
  );
  for (const name of ['first', 'second'])
    assert.deepEqual(
      defaults
        .filter((entry) => entry.model === name)
        .map((entry) => entry.index),
      [2, 0, 1],
    );
  for (const views of caches) {
    const values = await Promise.all(views);
    for (const [entry, index] of [2, 0, 1, 2, 0].entries())
      assert.deepEqual(Buffer.from(values[entry]), fixture.views[index]);
  }
  for (const result of results) {
    const meshes = [];
    result.scene.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    assert.equal(meshes.length, 2);
    assert.equal(meshes[0].geometry, meshes[1].geometry);
    assert.equal(meshes[0].material, meshes[1].material);
    for (const mesh of meshes) {
      assert.deepEqual(
        mesh.geometry.getAttribute('position').array,
        fixture.positions,
      );
      assert.deepEqual(
        mesh.geometry.getAttribute('normal').array,
        fixture.normals,
      );
      assert.deepEqual(mesh.geometry.getIndex().array, fixture.indices);
      assert.equal(mesh.material.metalness, 0.7);
      assert.equal(mesh.material.roughness, 0.35);
      assert.equal(mesh.material.side, THREE.DoubleSide);
      assert.deepEqual(mesh.material.color.toArray(), [0.75, 0.55, 0.25]);
    }
    assert.deepEqual(
      meshes.map((mesh) => mesh.position.toArray()),
      [
        [1, 2, 3],
        [-3, 1, 0],
      ],
    );
  }
});

test('built-in model decompression keeps first refusal over queued default buffer loading', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { createModelBufferQueue } = require('../app/model-dependencies.ts');
  const fixture = modelBufferFixture(true);
  const frames = [];
  const defaults = [];
  let frame = 0;
  let decoded = 0;
  const loader = new GLTFLoader().setMeshoptDecoder({
    supported: true,
    ready: Promise.resolve(),
    decodeGltfBuffer(target, count, stride, source, mode, filter) {
      decoded++;
      assert.equal(count, 3);
      assert.equal(stride, 12);
      assert.equal(mode, 'ATTRIBUTES');
      assert.equal(filter, 'NONE');
      target.set(source);
    },
  });
  loader.register((parser) => {
    const original = parser.loadBufferView.bind(parser);
    parser.loadBufferView = (index) => {
      defaults.push({ index, frame });
      return original(index);
    };
    return { name: 'default-buffer-probe' };
  });
  loader.register(
    createModelBufferQueue(
      () => new Promise((resolve) => frames.push(resolve)),
      () => 0,
    ),
  );
  const result = await completeModelFrames(
    loader.parseAsync(fixture.data, ''),
    frames,
    () => frame++,
  );
  assert.equal(
    decoded,
    1,
    'the built-in extension must handle its own encoded view',
  );
  assert.equal(frame, 1);
  assert.deepEqual(
    defaults.map((entry) => entry.index).sort((a, b) => a - b),
    [1, 2],
  );
  const meshes = [];
  result.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  assert.deepEqual(
    meshes[0].geometry.getAttribute('position').array,
    fixture.positions,
  );
  assert.deepEqual(meshes[0].geometry.getIndex().array, fixture.indices);
});

test('a rejected model buffer does not block a fresh parser retry on the shared queue', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { createModelBufferQueue } = require('../app/model-dependencies.ts');
  const fixture = modelBufferFixture();
  const frames = [];
  const schedule = createModelBufferQueue(
    () => new Promise((resolve) => frames.push(resolve)),
    () => 0,
  );
  let rejected = false;
  const first = new GLTFLoader()
    .register((parser) => {
      const original = parser.loadBufferView.bind(parser);
      parser.loadBufferView = (index) => {
        if (index === 0) {
          rejected = true;
          throw new Error('model buffer unavailable');
        }
        return original(index);
      };
      return { name: 'buffer-failure-probe' };
    })
    .register(schedule);
  await assert.rejects(
    completeModelFrames(first.parseAsync(fixture.data, ''), frames, () => {}),
    /model buffer unavailable/,
  );
  assert.equal(rejected, true);
  const retry = new GLTFLoader().register(schedule);
  const result = await completeModelFrames(
    retry.parseAsync(fixture.data, ''),
    frames,
    () => {},
  );
  const meshes = [];
  result.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  assert.deepEqual(
    meshes[0].geometry.getAttribute('position').array,
    fixture.positions,
  );
  assert.deepEqual(meshes[0].geometry.getIndex().array, fixture.indices);
});

async function exerciseModelBufferBudget(
  byteLengths,
  costs = [],
  coarseClock = false,
) {
  const { createModelBufferQueue } = require('../app/model-dependencies.ts');
  const frames = [];
  const calls = [];
  let frame = 0;
  let elapsed = 0;
  const schedule = createModelBufferQueue(
    () => new Promise((resolve) => frames.push(resolve)),
    () => (coarseClock ? 0 : elapsed),
  );
  const plugin = schedule({
    json: {
      bufferViews: byteLengths.map((byteLength) => ({ byteLength })),
    },
    loadBufferView(index) {
      calls.push({ index, frame });
      elapsed += costs[index] ?? 0;
      return Promise.resolve(new Uint8Array([index]).buffer);
    },
  });
  const results = await completeModelFrames(
    Promise.all(byteLengths.map((_, index) => plugin.loadBufferView(index))),
    frames,
    () => {
      frame++;
      elapsed += 16;
    },
  );
  assert.deepEqual(
    results.map((value) => [...new Uint8Array(value)]),
    byteLengths.map((_, index) => [index]),
    'frame budgeting does not change dependency results or order',
  );
  return calls.map((call) => call.frame);
}

test('model buffer scheduling keeps a hard view limit when the clock cannot measure short work', async () => {
  assert.deepEqual(
    await exerciseModelBufferBudget(Array(11).fill(8), [], true),
    [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3],
  );
});

test('model buffer scheduling yields when elapsed work exhausts the frame budget', async () => {
  assert.deepEqual(
    await exerciseModelBufferBudget(Array(6).fill(8), Array(6).fill(1.5)),
    [1, 1, 2, 2, 3, 3],
  );
});

test('model buffer scheduling shares the byte allowance without crossing it', async () => {
  assert.deepEqual(
    await exerciseModelBufferBudget([128 * 1024, 128 * 1024, 0, 1]),
    [1, 1, 1, 2],
  );
});

test('oversized and unknown model buffer views remain isolated from their neighbors', async () => {
  assert.deepEqual(
    await exerciseModelBufferBudget([
      8,
      undefined,
      8,
      256 * 1024 + 1,
      8,
      NaN,
      8,
      -1,
      8,
      Infinity,
      8,
    ]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});
