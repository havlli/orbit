import { createImageBitmapDecoder } from './image-bitmap-decoder';
import workerUrl from './image-bitmap.worker?worker&url';

export const decodeBitmap = createImageBitmapDecoder(
  () =>
    new Worker(workerUrl, {
      type: 'module',
    }),
);
