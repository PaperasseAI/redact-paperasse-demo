let active = 0;
const queue = [];

/**
 * Run `fn` once fewer than `maxConcurrent` calls are already in flight,
 * queueing otherwise (FIFO). Protects the shared host from a burst of
 * uploads spiking CPU/memory all at once — OCR and PDF rendering are the
 * expensive part of redaction, not the HTTP handling.
 */
export function withConcurrencyLimit(maxConcurrent, fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active += 1;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active -= 1;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < maxConcurrent) {
      run();
    } else {
      queue.push(run);
    }
  });
}
