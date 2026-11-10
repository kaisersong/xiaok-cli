import { types } from 'node:util';

export type MobileDisclosureRoute = 'snapshot' | 'artifact.preview' | 'chat.send' | 'approval.respond';

export interface MobileDisclosureOptions {
  requireDisclosurePolicy?: boolean;
  assertOutputCurrent?: (route: MobileDisclosureRoute, value: unknown) => void;
}

export class MobileDisclosureError extends Error {
  constructor() { super('mobile_content_unavailable'); }
}

/** Encode data descriptors only, without executing getters or toJSON. */
export function encodeStrictMobileJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(input: unknown, arrayElement = false): string | undefined {
    if (input === undefined) return arrayElement ? 'null' : undefined;
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== 'object' || types.isProxy(input) || ancestors.has(input)) throw new MobileDisclosureError();
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new MobileDisclosureError();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(input).some(key => typeof key !== 'string') || 'toJSON' in descriptors) throw new MobileDisclosureError();
    if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) throw new MobileDisclosureError();
    ancestors.add(input);
    try {
      if (array) {
        const length = descriptors.length.value as number;
        if (Object.keys(descriptors).some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new MobileDisclosureError();
        return `[${Array.from({ length }, (_, index) => encode(descriptors[index]?.value, true)).join(',')}]`;
      }
      const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable).flatMap(([key, descriptor]) => {
        const encoded = encode(descriptor.value);
        return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
      });
      return `{${entries.join(',')}}`;
    } finally { ancestors.delete(input); }
  }
  try {
    const encoded = encode(value);
    if (encoded === undefined) throw new MobileDisclosureError();
    return encoded;
  } catch { throw new MobileDisclosureError(); }
}

/** Main supplies provenance; a transport cannot infer it from response fields. */
export function createMobileDisclosureGate(options: MobileDisclosureOptions) {
  const required = options.requireDisclosurePolicy === true;
  const assertCurrent = options.assertOutputCurrent;
  if ((required || assertCurrent !== undefined) && typeof assertCurrent !== 'function') {
    throw new Error('mobile_disclosure_policy_unavailable');
  }
  return Object.freeze({
    protected: required || assertCurrent !== undefined,
    assert(route: MobileDisclosureRoute, value: unknown): void {
      if (!assertCurrent) return;
      try {
        const result: unknown = assertCurrent(route, value);
        if (result !== undefined) {
          // An async callback is never authority at the synchronous write fence.
          if (result instanceof Promise) void result.catch(() => undefined);
          throw new MobileDisclosureError();
        }
      } catch {
        throw new MobileDisclosureError();
      }
    },
  });
}

