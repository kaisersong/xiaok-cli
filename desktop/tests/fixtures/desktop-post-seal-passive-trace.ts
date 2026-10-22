// Diagnostic forwarding only. Importing this module starts no owner, Worker or IO.
export type TraceFields = Record<string, string | number | boolean | null>;
export interface TraceRecorder { record(stage: string, fields?: TraceFields): void }
export interface PassiveTraceSnapshot {
  entries: Array<TraceFields & { stage: string; sequence: number; monotonicMs: number }>;
  overflow: number;
  observerErrors: number;
}
const nativeAbortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
export function passiveVerifierOptionFields(options: unknown): TraceFields {
  if (!options || typeof options !== 'object') return { optionsObserved: false };
  const deadline = Object.getOwnPropertyDescriptor(options, 'deadline');
  const signal = Object.getOwnPropertyDescriptor(options, 'signal');
  if (!deadline || !('value' in deadline) || typeof deadline.value !== 'number'
    || !signal || !('value' in signal) || !nativeAbortedGetter) return { optionsObserved: false };
  return { optionsObserved: true, deadlineMonotonicMs: deadline.value,
    signalAborted: Reflect.apply(nativeAbortedGetter, signal.value, []) as boolean };
}
export function createPassiveTrace(maximumEntries = 256) {
  const entries: PassiveTraceSnapshot['entries'] = [];
  let sequence = 0; let overflow = 0; let observerErrors = 0;
  return {
    record(stage: string, fields: TraceFields = {}): void {
      try {
        if (stage === 'observer-error') observerErrors++;
        if (entries.length >= maximumEntries) { overflow++; return; }
        entries[entries.length] = { ...fields, stage, sequence: ++sequence, monotonicMs: performance.now() };
      } catch { observerErrors++; }
    },
    snapshot(): PassiveTraceSnapshot {
      return { entries: entries.map(entry => ({ ...entry })), overflow, observerErrors };
    },
  };
}
function record(trace: TraceRecorder, stage: string, fields?: TraceFields): void {
  try { trace.record(stage, fields); }
  catch { try { trace.record('observer-error'); } catch { /* observation never changes outcome */ } }
}
function sameDescriptor(a: PropertyDescriptor | undefined, b: PropertyDescriptor): boolean {
  return !!a && 'value' in a && a.value === b.value && a.writable === b.writable
    && a.enumerable === b.enumerable && a.configurable === b.configurable;
}
function observeSettlement(raw: unknown, success: (value: any) => void, failure: () => void, trace: TraceRecorder): void {
  try {
    void (raw as Promise<unknown>).then(value => {
      try { success(value); } catch { record(trace, 'observer-error'); }
    }, () => { try { failure(); } catch { record(trace, 'observer-error'); } });
  } catch { record(trace, 'observer-error'); }
}
export { observeSettlement as observePassiveSettlement };
export function installPassiveCloseObserver(handle: object, token: number, trace: TraceRecorder): () => void {
  try {
    const originalOwn = Object.getOwnPropertyDescriptor(handle, 'close');
    let originalClose: Function;
    if (originalOwn) {
      if (!originalOwn.configurable || !('value' in originalOwn) || typeof originalOwn.value !== 'function') {
        record(trace, 'fifo-close-observer-unavailable', { token }); return () => {};
      }
      originalClose = originalOwn.value;
    } else {
      if (!Object.isExtensible(handle)) { record(trace, 'fifo-close-observer-unavailable', { token }); return () => {}; }
      let prototype = Object.getPrototypeOf(handle); let found: PropertyDescriptor | undefined;
      while (prototype) {
        found = Object.getOwnPropertyDescriptor(prototype, 'close');
        if (found) break; // Never skip an accessor/non-function shadowing descriptor.
        prototype = Object.getPrototypeOf(prototype);
      }
      if (!found || !('value' in found) || typeof found.value !== 'function') {
        record(trace, 'fifo-close-observer-unavailable', { token }); return () => {};
      }
      originalClose = found.value;
    }
    const wrapper = function (this: unknown, ...args: unknown[]) {
      record(trace, 'fifo-close-call', { token });
      let raw: unknown;
      try { raw = Reflect.apply(originalClose, this, args); }
      catch (error) { record(trace, 'fifo-close-sync-throw', { token }); throw error; }
      observeSettlement(raw, () => record(trace, 'fifo-close-resolve', { token }),
        () => record(trace, 'fifo-close-reject', { token }), trace);
      return raw;
    };
    const installed: PropertyDescriptor = originalOwn ? { ...originalOwn, value: wrapper }
      : { value: wrapper, writable: true, configurable: true, enumerable: false };
    Object.defineProperty(handle, 'close', installed);
    return () => {
      try {
        if (!sameDescriptor(Object.getOwnPropertyDescriptor(handle, 'close'), installed)) {
          record(trace, 'restoration-conflict', { token }); return;
        }
        if (originalOwn) Object.defineProperty(handle, 'close', originalOwn);
        else Reflect.deleteProperty(handle, 'close');
      } catch { record(trace, 'observer-error'); }
    };
  } catch { record(trace, 'observer-error'); return () => {}; }
}
export function createPassiveOpenObserver<T extends (...args: any[]) => any>(
  originalOpen: T, exactPath: string, trace: TraceRecorder,
) {
  let nextToken = 0;
  const restores: Array<() => void> = [];
  const open = function (this: unknown, ...args: unknown[]) {
    if (args[0] !== exactPath || args[1] !== 'r') return Reflect.apply(originalOpen, this, args);
    const token = ++nextToken;
    record(trace, 'fifo-open-call', { token });
    let raw: unknown;
    try { raw = Reflect.apply(originalOpen, this, args); }
    catch (error) { record(trace, 'fifo-open-sync-throw', { token }); throw error; }
    // Submission is after the real native call returned its original Promise.
    // It is neither the call-before trace nor a claim that kernel open settled.
    record(trace, 'fifo-open-submitted', { token });
    observeSettlement(raw, handle => {
      record(trace, 'fifo-open-resolve', { token });
      if (!handle || typeof handle !== 'object') { record(trace, 'fifo-close-observer-unavailable', { token }); return; }
      restores[restores.length] = installPassiveCloseObserver(handle, token, trace);
    }, () => record(trace, 'fifo-open-reject', { token }), trace);
    return raw;
  } as T;
  return { open, restoreHandles() { for (const restore of restores) restore(); restores.length = 0; } };
}

/** Preserve the actual method's Promise, including an existing async fixture layer. */
export function installPassiveMethodObserver(target: object, key: string, trace: TraceRecorder,
  stage: string, callFields: (args: readonly unknown[]) => TraceFields = () => ({})): () => void {
  try {
    const originalOwn = Object.getOwnPropertyDescriptor(target, key);
    let descriptor = originalOwn;
    if (!descriptor) {
      let parent = Object.getPrototypeOf(target);
      while (parent) {
        descriptor = Object.getOwnPropertyDescriptor(parent, key);
        if (descriptor) break;
        parent = Object.getPrototypeOf(parent);
      }
    }
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function'
      || (originalOwn ? !originalOwn.configurable : !Object.isExtensible(target))) {
      record(trace, 'method-observer-unavailable', { method: key }); return () => {};
    }
    const originalMethod = descriptor.value;
    let nextToken = 0;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      const token = ++nextToken;
      try { record(trace, stage + '-call', { ...callFields(args), token }); }
      catch { record(trace, 'observer-error'); record(trace, stage + '-call', { token }); }
      let raw: unknown;
      try { raw = Reflect.apply(originalMethod, this, args); }
      catch (error) { record(trace, stage + '-sync-throw', { token }); throw error; }
      observeSettlement(raw, () => record(trace, stage + '-resolve', { token }),
        () => record(trace, stage + '-reject', { token }), trace);
      return raw;
    };
    const installed = originalOwn ? { ...originalOwn, value: wrapper }
      : { value: wrapper, writable: true, configurable: true, enumerable: false };
    Object.defineProperty(target, key, installed);
    return () => {
      try {
        if (!sameDescriptor(Object.getOwnPropertyDescriptor(target, key), installed)) {
          record(trace, 'restoration-conflict', { method: key }); return;
        }
        if (originalOwn) Object.defineProperty(target, key, originalOwn);
        else Reflect.deleteProperty(target, key);
      } catch { record(trace, 'observer-error'); }
    };
  } catch { record(trace, 'observer-error'); return () => {}; }
}
