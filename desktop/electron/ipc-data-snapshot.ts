import { types } from 'node:util';
const isProxy = types.isProxy;
const arrayIsArray = Array.isArray;
const getDescriptors = Object.getOwnPropertyDescriptors;
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const define = Object.defineProperty;
const hasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
/** Host-side IPC data capture. Never invokes accessors or custom serializers. */
export function captureIpcData<T>(value: T, errorCode = 'ipc_contract_violation', options?: { preserveDataPrototype?: boolean }): T {
  const memo = new WeakMap<object, object>(), active = new WeakSet<object>();
  const fail = (): never => { throw new Error(errorCode); };
  const visit = (raw: unknown): unknown => {
    if (raw === null || raw === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof raw)) return raw;
    if (typeof raw !== 'object' || isProxy(raw)) return fail();
    if (active.has(raw)) return fail();
    const prior = memo.get(raw); if (prior) return prior;
    const array = arrayIsArray(raw);
    const prototype = array ? undefined : getPrototype(raw);
    if (!array && prototype !== objectPrototype && prototype !== null) return fail();
    const descriptors = getDescriptors(raw);
    const length = array ? descriptors.length?.value : 0;
    // Room's canonical storage protocol distinguishes plain and null objects.
    // Only its fixed host adapter opts in; all existing callers keep the old ABI.
    const result: Record<string, unknown> | unknown[] = array ? new Array(length)
      : Object.create(options?.preserveDataPrototype === true ? prototype : null);
    active.add(raw); memo.set(raw, result);
    try {
      for (const key of ownKeys(descriptors)) {
        if (typeof key !== 'string') return fail();
        if (array && key === 'length') continue;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) return fail();
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) return fail();
        define(result, key, { __proto__: null, value: visit(descriptor.value), writable: true, configurable: true, enumerable: true } as PropertyDescriptor);
      }
    } finally { active.delete(raw); }
    return result;
  };
  return visit(value) as T;
}
