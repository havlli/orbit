import {
  sceneBitmapOptions,
  type BitmapRequest,
  type BitmapResponse,
} from './image-bitmap-decoder';

const port = globalThis as unknown as Pick<Worker, 'onmessage' | 'postMessage'>;
const send = (message: BitmapResponse, transfer: Transferable[] = []) =>
  port.postMessage(message, transfer);

port.onmessage = (event: MessageEvent<BitmapRequest>) => {
  const { id, blob } = event.data;
  void createImageBitmap(blob, sceneBitmapOptions).then(
    (bitmap) => {
      try {
        send({ type: 'decoded', id, bitmap }, [bitmap]);
      } catch {
        bitmap.close();
        send({ type: 'unsupported' });
      }
    },
    (error: unknown) => {
      send({
        type: 'error',
        id,
        name: error instanceof Error ? error.name : 'Error',
        message:
          error instanceof Error ? error.message : 'Image decoding failed',
      });
    },
  );
};
send({
  type: typeof createImageBitmap === 'function' ? 'ready' : 'unsupported',
});
