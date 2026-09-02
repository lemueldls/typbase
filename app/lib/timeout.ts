/**
 * Bounds boot-time async work. Some of it (OAuth client init, metadata
 * fetch) touches IndexedDB and the network and can stall in odd browser
 * contexts; a bounded init that degrades to guest mode beats an app that
 * never opens.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}
