/** A local resource lifetime; this contract conveys no SDK/native authority. */
export interface AttachmentClosable { close(): Promise<void> }
export interface AttachmentLifecycle<T extends AttachmentClosable> {
  readonly initial: Promise<T | undefined>;
  readonly settled: Promise<T | undefined>;
  close(): Promise<void>;
}

/** The caller creates its one actual pending attachment before entering here. */
export function ownAttachmentLifecycle<T extends AttachmentClosable>(
  settled: Promise<T | undefined>,
  budget: { waitMs: number; onDeferred?(): void },
): AttachmentLifecycle<T> {
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const timedOut = Symbol('activity_startup_timeout');
  const initial = (async (): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        settled,
        new Promise<typeof timedOut>(resolve => {
          timer = setTimeout(() => resolve(timedOut), budget.waitMs);
          timer.unref?.();
        }),
      ]);
      if (result === timedOut) { budget.onDeferred?.(); return undefined; }
      return closing ? undefined : result;
    } finally { clearTimeout(timer); }
  })();
  return {
    initial,
    settled,
    close() {
      closing = true;
      return closePromise ??= settled.then(async instance => {
        if (instance) await instance.close();
      });
    },
  };
}
