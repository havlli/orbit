import type {
  GLTFLoaderPlugin,
  GLTFParser,
} from 'three/addons/loaders/GLTFLoader.js';

type BufferViewParser = Pick<GLTFParser, 'loadBufferView'> & {
  json?: { bufferViews?: readonly { byteLength?: number }[] };
};

const FRAME_BUDGET_MS = 3;
const VIEWS_PER_FRAME = 4;
const BYTES_PER_FRAME = 256 * 1024;

/** Share a bounded frame budget across model loads. Small copies can share a
 * frame; unknown and oversized views keep a frame to themselves. */
export function createModelBufferQueue(
  nextFrame: () => Promise<void> = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve())),
  now: () => number = () => performance.now(),
) {
  let queue = Promise.resolve();
  let frameStart = 0;
  let views = 0;
  let bytes = 0;
  return (parser: BufferViewParser): GLTFLoaderPlugin => ({
    name: 'model-buffer-queue',
    loadBufferView(index) {
      const buffer = queue.then(async () => {
        const length = parser.json?.bufferViews?.[index]?.byteLength;
        const known =
          typeof length === 'number' &&
          Number.isSafeInteger(length) &&
          length >= 0;
        const size = known ? length : 0;
        const isolated = !known || size > BYTES_PER_FRAME;
        if (
          views === 0 ||
          isolated ||
          views >= VIEWS_PER_FRAME ||
          bytes + size > BYTES_PER_FRAME ||
          now() - frameStart >= FRAME_BUDGET_MS
        ) {
          await nextFrame();
          frameStart = now();
          views = 0;
          bytes = 0;
        }
        views++;
        bytes = isolated ? Infinity : bytes + size;
        return parser.loadBufferView(index);
      });
      queue = buffer.then(
        () => {},
        () => {},
      );
      return buffer;
    },
  });
}
