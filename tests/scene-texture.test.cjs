/* oxlint-disable typescript/no-require-imports -- Typed modules use the local compiler hook. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const THREE = require('three');
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
const {
  loadSceneTexture,
  uploadSceneTexture,
} = require('../app/scene-texture.ts');
const { createImageBitmapDecoder } = require('../app/image-bitmap-decoder.ts');
const settle = () => new Promise(setImmediate);

function uploads(t, width = 2053, height = 1001) {
  const previous = {
    ImageBitmap: global.ImageBitmap,
    createImageBitmap: global.createImageBitmap,
    requestAnimationFrame: global.requestAnimationFrame,
  };
  class Bitmap {
    constructor(width, height, x = 0, y = 0) {
      Object.assign(this, { width, height, x, y, closed: 0 });
    }
    close() {
      this.closed++;
    }
  }
  const image = new Bitmap(width, height),
    texture = new THREE.Texture(image),
    decoding = [],
    frames = [],
    strips = [],
    copies = [],
    initialized = [];
  let frame = 0,
    current = true,
    failCopy = false;
  global.ImageBitmap = Bitmap;
  global.createImageBitmap = (source, x, y, cropWidth, cropHeight, options) => {
    assert.equal(source, image);
    assert.deepEqual(options, {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    return new Promise((resolve, reject) => {
      decoding.push({
        finish() {
          const strip = new Bitmap(cropWidth, cropHeight, x, y);
          strips.push(strip);
          resolve(strip);
          return strip;
        },
        reject,
      });
    });
  };
  global.requestAnimationFrame = (callback) => frames.push(callback);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
    texture.dispose();
  });
  return {
    image,
    texture,
    decoding,
    frames,
    strips,
    copies,
    initialized,
    cancel() {
      current = false;
    },
    failTransfer() {
      failCopy = true;
    },
    start(options) {
      return uploadSceneTexture(
        {
          initTexture(map) {
            initialized.push({
              map,
              dataReady: map.source.dataReady,
              mipmaps: map.generateMipmaps,
            });
          },
          copyTextureToTexture(source, target, _region, offset) {
            if (failCopy) throw new Error('Transfer failed');
            assert.equal(source.image.closed, 0);
            assert.equal(source.flipY, false);
            const copy = {
              image: source.image,
              x: offset.x,
              y: offset.y,
              mipmaps: target.generateMipmaps,
              frame,
              disposed: 0,
            };
            source.addEventListener('dispose', () => copy.disposed++);
            copies.push(copy);
          },
        },
        texture,
        () => current,
        options,
      );
    },
    async tick() {
      frame++;
      for (const callback of frames.splice(0)) callback(frame * 16);
      await settle();
      return frame;
    },
    async finishCrop() {
      const strip = decoding.shift().finish();
      await settle();
      return strip;
    },
  };
}

test('one prepared strip enters its next frame slot and preserves the full image and mip gate', async (t) => {
  const state = uploads(t);
  let finished = false;
  const pending = state.start().then((ready) => {
    finished = true;
    return ready;
  });
  assert.equal(state.initialized.length, 1);
  assert.equal(state.initialized[0].dataReady, false);
  assert.equal(state.initialized[0].mipmaps, true);
  assert.equal(
    state.decoding.length,
    1,
    'cropping starts before reserving a frame',
  );
  assert.equal(state.frames.length, 0);
  await state.tick();
  await state.tick();
  assert.equal(
    state.copies.length,
    0,
    'slow cropping cannot use an earlier frame',
  );
  const covered = new Uint8Array(state.image.height);
  let pixels = 0;
  while (!finished) {
    assert.equal(state.decoding.length, 1);
    const strip = await state.finishCrop();
    assert.equal(state.frames.length, 1);
    assert.equal(
      state.decoding.length,
      0,
      'only one cropped strip is held ahead',
    );
    assert.equal(state.strips.filter((image) => image.closed === 0).length, 1);
    const before = state.copies.length;
    const frame = await state.tick();
    assert.equal(state.copies.length, before + 1);
    const copy = state.copies.at(-1);
    assert.equal(copy.frame, frame);
    assert.equal(copy.image, strip);
    assert.equal(copy.x, 0);
    assert.equal(copy.y, strip.y);
    assert.equal(strip.x, 0);
    assert.equal(strip.width, state.image.width);
    assert.ok(strip.width * strip.height <= 131_072);
    for (let y = strip.y; y < strip.y + strip.height; y++) {
      assert.equal(covered[y], 0, 'no source row is copied twice');
      covered[y]++;
    }
    pixels += strip.width * strip.height;
    assert.equal(copy.mipmaps, strip.y + strip.height === state.image.height);
    assert.equal(copy.disposed, 1);
    assert.equal(strip.closed, 1);
  }
  assert.equal(await pending, true);
  assert.ok(covered.every((count) => count === 1));
  assert.equal(pixels, state.image.width * state.image.height);
  assert.equal(state.texture.image, state.image);
  assert.equal(state.image.closed, 0);
  assert.equal(state.texture.source.dataReady, true);
  assert.equal(state.texture.generateMipmaps, true);
});

test('cancellation releases the prepared strip before decoding or a reserved frame can publish it', async (t) => {
  for (const boundary of ['decoding', 'frame']) {
    await t.test(boundary, async (t) => {
      const state = uploads(t);
      const pending = state.start();
      if (boundary === 'decoding') {
        state.cancel();
        await state.finishCrop();
        assert.equal(state.frames.length, 0);
      } else {
        await state.finishCrop();
        state.cancel();
        await state.tick();
      }
      assert.equal(await pending, false);
      assert.equal(state.copies.length, 0);
      assert.equal(state.decoding.length, 0);
      assert.equal(state.strips[0].closed, 1);
      assert.equal(state.image.closed, 0);
      assert.equal(state.texture.source.dataReady, true);
      assert.equal(state.texture.generateMipmaps, true);
    });
  }
});

test('crop and transfer errors restore source state and release any prepared bitmap', async (t) => {
  for (const failure of ['crop', 'transfer']) {
    await t.test(failure, async (t) => {
      const state = uploads(t);
      state.texture.generateMipmaps = false;
      const pending = state.start();
      const rejected = assert.rejects(pending, /failed/i);
      if (failure === 'crop')
        state.decoding.shift().reject(new Error('Crop failed'));
      else {
        await state.finishCrop();
        state.failTransfer();
        await state.tick();
      }
      await rejected;
      assert.equal(state.copies.length, 0);
      assert.equal(state.image.closed, 0);
      assert.ok(state.strips.every((strip) => strip.closed === 1));
      assert.equal(state.texture.source.dataReady, true);
      assert.equal(state.texture.generateMipmaps, false);
    });
  }
});

test('ordinary textures below the staging threshold and cancelled requests retain immediate preparation', async (t) => {
  const state = uploads(t, 1032, 1032);
  assert.equal(await state.start(), true);
  assert.equal(state.initialized.length, 1);
  assert.equal(state.decoding.length, 0);
  assert.equal(state.frames.length, 0);
  state.cancel();
  assert.equal(await state.start(), false);
  assert.equal(state.initialized.length, 1);
  assert.equal(state.texture.source.dataReady, true);
  assert.equal(state.texture.generateMipmaps, true);
});

test('explicit staging preserves every guttered sky pixel without changing the ordinary upload threshold', async (t) => {
  const state = uploads(t, 1032, 1032);
  let ready = false;
  const pending = state.start({ staged: true }).then((result) => {
    ready = result;
    return result;
  });
  assert.equal(state.initialized[0].dataReady, false);
  assert.equal(state.copies.length, 0);
  const rows = new Uint8Array(1032);
  while (!ready) {
    const strip = await state.finishCrop();
    assert.equal(state.copies.length, state.strips.length - 1);
    await state.tick();
    const copy = state.copies.at(-1);
    assert.equal(copy.image.width, 1032);
    assert.ok(copy.image.width * copy.image.height <= 131_072);
    assert.equal(copy.y, strip.y);
    for (let y = strip.y; y < strip.y + strip.height; y++) rows[y]++;
    assert.equal(copy.mipmaps, strip.y + strip.height === 1032);
  }
  assert.equal(await pending, true);
  assert.equal(state.copies.length, 9);
  assert.ok(rows.every((count) => count === 1));
  assert.equal(state.texture.generateMipmaps, true);
  assert.equal(state.texture.source.dataReady, true);
  assert.equal(state.image.closed, 0);
});

function transport() {
  return {
    messages: [],
    terminated: 0,
    postMessage(message) {
      this.messages.push(message);
    },
    terminate() {
      this.terminated++;
    },
    receive(message) {
      this.onmessage({ data: message });
    },
    crash(message) {
      this.onerror({ message, preventDefault() {} });
    },
  };
}
function decodedBitmap() {
  return {
    width: 4096,
    height: 2048,
    closed: 0,
    close() {
      this.closed++;
    },
  };
}

test('the shared image decoder bounds work, routes results and retains the worker after a bad image', async () => {
  const worker = transport(),
    blobs = [new Blob(['one']), new Blob(['two']), new Blob(['three'])];
  let fallbacks = 0;
  const decode = createImageBitmapDecoder(
    () => worker,
    async () => {
      fallbacks++;
      return decodedBitmap();
    },
  );
  const first = decode(blobs[0]),
    second = decode(blobs[1]),
    third = decode(blobs[2]);
  const failed = assert.rejects(second, {
    name: 'InvalidStateError',
    message: 'Bad image',
  });
  assert.equal(worker.messages.length, 0);
  worker.receive({ type: 'ready' });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].blob, blobs[0]);
  const bitmap = decodedBitmap();
  worker.receive({ type: 'decoded', id: worker.messages[0].id, bitmap });
  assert.equal(await first, bitmap);
  assert.equal(
    bitmap.closed,
    0,
    'the recipient owns a successfully transferred bitmap',
  );
  assert.equal(worker.messages.length, 2);
  worker.receive({
    type: 'error',
    id: worker.messages[1].id,
    name: 'InvalidStateError',
    message: 'Bad image',
  });
  await failed;
  assert.equal(worker.messages.length, 3);
  assert.equal(worker.messages[2].blob, blobs[2]);
  const orphan = decodedBitmap();
  worker.receive({ type: 'decoded', id: -1, bitmap: orphan });
  assert.equal(orphan.closed, 1);
  const last = decodedBitmap();
  worker.receive({ type: 'decoded', id: worker.messages[2].id, bitmap: last });
  assert.equal(await third, last);
  assert.equal(fallbacks, 0);
  assert.equal(worker.terminated, 0);
});

test('unsupported worker startup falls back once on the original blobs without serializing fallback work', async (t) => {
  for (const failure of [
    'construction',
    'startup',
    'unsupported',
    'transport',
  ]) {
    await t.test(failure, async () => {
      const worker = transport(),
        calls = [],
        completed = [];
      let constructed = 0;
      const decode = createImageBitmapDecoder(
        () => {
          constructed++;
          if (failure === 'construction')
            throw new Error('Workers unavailable');
          return worker;
        },
        (blob) =>
          new Promise((resolve) => {
            calls.push(blob);
            completed.push(resolve);
          }),
      );
      const blobs = [new Blob(['first']), new Blob(['second'])];
      const pending = blobs.map((blob) => decode(blob));
      if (failure === 'startup') worker.crash('Worker script unavailable');
      if (failure === 'unsupported') worker.receive({ type: 'unsupported' });
      if (failure === 'transport') {
        worker.postMessage = () => {
          throw new DOMException('Transfer unavailable', 'DataCloneError');
        };
        worker.receive({ type: 'ready' });
      }
      await settle();
      assert.deepEqual(
        calls,
        blobs,
        'fallback reuses both fetched blobs before either finishes',
      );
      completed.forEach((resolve) => resolve(decodedBitmap()));
      await Promise.all(pending);
      const next = decode(blobs[0]);
      await settle();
      assert.equal(
        constructed,
        1,
        'unsupported workers are not recreated for every texture',
      );
      completed.at(-1)(decodedBitmap());
      await next;
    });
  }
});

test('a running worker failure rejects in-flight jobs, closes late results and permits a fresh request', async () => {
  const workers = [];
  let fallbacks = 0;
  const decode = createImageBitmapDecoder(
    () => {
      const worker = transport();
      workers.push(worker);
      return worker;
    },
    async () => {
      fallbacks++;
      return decodedBitmap();
    },
  );
  const first = decode(new Blob(['first'])),
    second = decode(new Blob(['second']));
  const failures = [
    assert.rejects(first, /Worker stopped/),
    assert.rejects(second, /Worker stopped/),
  ];
  workers[0].receive({ type: 'ready' });
  const obsoleteId = workers[0].messages[0].id;
  workers[0].crash('Worker stopped');
  await Promise.all(failures);
  const next = decode(new Blob(['retry']));
  assert.equal(workers.length, 2);
  const orphan = decodedBitmap();
  workers[0].receive({ type: 'decoded', id: obsoleteId, bitmap: orphan });
  assert.equal(orphan.closed, 1);
  workers[1].receive({ type: 'ready' });
  const bitmap = decodedBitmap();
  workers[1].receive({
    type: 'decoded',
    id: workers[1].messages[0].id,
    bitmap,
  });
  assert.equal(await next, bitmap);
  assert.equal(
    fallbacks,
    0,
    'runtime decode failures are not retried through another decoder',
  );
});

test('the worker preserves full-image decode options and transfers ownership or closes failed transfers', async () => {
  const source = ts.transpileModule(
    fs.readFileSync('app/image-bitmap.worker.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const execute = require('node:vm').compileFunction(source, [
    'require',
    'exports',
    'globalThis',
    'createImageBitmap',
  ]);
  for (const failTransfer of [false, true]) {
    const messages = [],
      bitmap = decodedBitmap(),
      blob = new Blob(['full image']);
    const port = {
      postMessage(message, transferred) {
        if (failTransfer && message.type === 'decoded')
          throw new DOMException('Unsupported transfer', 'DataCloneError');
        messages.push({ message, transferred });
      },
    };
    execute(
      () => require('../app/image-bitmap-decoder.ts'),
      {},
      port,
      async (input, options) => {
        assert.equal(input, blob);
        assert.deepEqual(options, {
          imageOrientation: 'flipY',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        return bitmap;
      },
    );
    assert.equal(messages[0].message.type, 'ready');
    port.onmessage({ data: { id: 7, blob } });
    await settle();
    if (failTransfer) {
      assert.equal(bitmap.closed, 1);
      assert.equal(messages.at(-1).message.type, 'unsupported');
    } else {
      assert.equal(messages[1].message.bitmap, bitmap);
      assert.deepEqual(messages[1].transferred, [bitmap]);
      assert.equal(bitmap.closed, 0);
    }
  }
});

test('scene texture loading keeps its fetch, full bitmap and disposal contract for worker and fallback paths', async (t) => {
  const previous = {
    fetch: global.fetch,
    Worker: global.Worker,
    createImageBitmap: global.createImageBitmap,
  };
  const modulePath = require.resolve('../app/image-bitmap-worker-client.ts');
  const cached = require.cache[modulePath];
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  });
  for (const worker of [false, true]) {
    const blob = new Blob(['same fetched pixels']),
      bitmap = decodedBitmap(),
      requests = [];
    let decoded = 0;
    const decode = async (input) => {
      assert.equal(input, blob);
      decoded++;
      return bitmap;
    };
    global.fetch = async (...args) => {
      requests.push(args);
      return { ok: true, blob: async () => blob };
    };
    global.createImageBitmap = async (input, options) => {
      assert.deepEqual(options, {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      return decode(input);
    };
    global.Worker = worker ? function Worker() {} : undefined;
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: { decodeBitmap: decode },
    };
    const texture = await loadSceneTexture('/textures/solar/saturn-4k.jpg');
    assert.deepEqual(requests, [['/textures/solar/saturn-4k.jpg']]);
    assert.equal(decoded, 1);
    assert.equal(texture.image, bitmap);
    assert.equal(texture.flipY, false);
    assert.ok(texture.version > 0);
    assert.equal(bitmap.closed, 0);
    texture.dispose();
    assert.equal(bitmap.closed, 1);
  }
  let decoded = 0,
    requests = 0;
  global.Worker = function Worker() {};
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      decodeBitmap: async () => {
        decoded++;
        throw new Error('Invalid image');
      },
    },
  };
  global.fetch = async () => {
    requests++;
    return { ok: false, status: 404 };
  };
  await assert.rejects(
    loadSceneTexture('/missing.jpg'),
    /Texture request failed: 404/,
  );
  assert.equal(decoded, 0);
  global.fetch = async () => {
    requests++;
    return { ok: true, blob: async () => new Blob(['bad image']) };
  };
  await assert.rejects(loadSceneTexture('/bad.jpg'), /Invalid image/);
  assert.equal(decoded, 1);
  assert.equal(requests, 2, 'HTTP and decode errors are never refetched');
});
