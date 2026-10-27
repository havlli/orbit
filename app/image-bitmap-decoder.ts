export const sceneBitmapOptions = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
} as const;

export type BitmapRequest = { id: number; blob: Blob };
export type BitmapResponse =
  | { type: 'ready' }
  | { type: 'unsupported' }
  | { type: 'decoded'; id: number; bitmap: ImageBitmap }
  | { type: 'error'; id: number; name: string; message: string };

export const decodeBitmapOnMain = (blob: Blob) =>
  createImageBitmap(blob, sceneBitmapOptions);

/** One decoder owns one active bitmap; queued requests retain their original
 * blobs so unsupported worker transport never needs another fetch. */
export function createImageBitmapDecoder(
  createWorker: () => Worker,
  fallback = decodeBitmapOnMain,
) {
  type Job = BitmapRequest & {
    resolve: (bitmap: ImageBitmap) => void;
    reject: (error: unknown) => void;
  };
  const pending: Job[] = [];
  let worker: Worker | undefined;
  let active: Job | undefined;
  let ready = false;
  let unsupported = false;
  let serial = 0;

  const takeJobs = () => {
    const jobs = active ? [active, ...pending] : [...pending];
    active = undefined;
    pending.length = 0;
    return jobs;
  };
  const fallbackPending = () => {
    unsupported = true;
    worker?.terminate();
    worker = undefined;
    for (const job of takeJobs())
      void Promise.resolve()
        .then(() => fallback(job.blob))
        .then(job.resolve, job.reject);
  };
  const fail = (error: unknown) => {
    worker?.terminate();
    worker = undefined;
    ready = false;
    for (const job of takeJobs()) job.reject(error);
  };
  const pump = () => {
    if (!worker || !ready || active || !pending.length) return;
    active = pending.shift()!;
    try {
      worker.postMessage({
        id: active.id,
        blob: active.blob,
      } satisfies BitmapRequest);
    } catch (error) {
      if (error instanceof Error && error.name === 'DataCloneError')
        fallbackPending();
      else fail(error);
    }
  };
  const start = () => {
    try {
      const transport = createWorker();
      worker = transport;
      ready = false;
      transport.onmessage = (event: MessageEvent<BitmapResponse>) => {
        const message = event.data;
        if (worker !== transport) {
          if (message.type === 'decoded') message.bitmap.close();
          return;
        }
        if (message.type === 'unsupported') {
          fallbackPending();
        } else if (message.type === 'ready') {
          ready = true;
          pump();
        } else if (!active || active.id !== message.id) {
          if (message.type === 'decoded') message.bitmap.close();
        } else {
          const job = active;
          active = undefined;
          if (message.type === 'decoded') job.resolve(message.bitmap);
          else {
            const error = new Error(message.message);
            error.name = message.name;
            job.reject(error);
          }
          pump();
        }
      };
      transport.onerror = (event) => {
        event.preventDefault();
        if (worker !== transport) return;
        if (!ready) fallbackPending();
        else fail(new Error(event.message || 'Image decoder stopped'));
      };
      transport.onmessageerror = () => {
        if (worker !== transport) return;
        if (!ready) fallbackPending();
        else fail(new Error('Image decoder response could not be received'));
      };
    } catch {
      fallbackPending();
    }
  };
  start();
  return (blob: Blob): Promise<ImageBitmap> => {
    if (unsupported) return Promise.resolve().then(() => fallback(blob));
    if (!worker) start();
    if (unsupported) return Promise.resolve().then(() => fallback(blob));
    return new Promise((resolve, reject) => {
      pending.push({ id: ++serial, blob, resolve, reject });
      pump();
    });
  };
}
