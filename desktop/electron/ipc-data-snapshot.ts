import { types } from 'node:util';
const isProxy = types.isProxy;
const arrayIsArray = Array.isArray;
const getDescriptors = Object.getOwnPropertyDescriptors;
const getPrototype = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const define = Object.defineProperty;
const hasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const NativeWeakMap=WeakMap,NativeWeakSet=WeakSet,NativeArray=Array,NativeNumber=Number,create=Object.create,apply=Reflect.apply;
const memoGet=WeakMap.prototype.get,memoSet=WeakMap.prototype.set,activeHas=WeakSet.prototype.has,activeAdd=WeakSet.prototype.add,activeDelete=WeakSet.prototype.delete;
const exec=RegExp.prototype.exec;
/** Host-side IPC data capture. Never invokes accessors or custom serializers. */
export function captureIpcData<T>(value: T, errorCode = 'ipc_contract_violation', options?: { preserveDataPrototype?: boolean }): T {
  const memo = new NativeWeakMap<object, object>(), active = new NativeWeakSet<object>();
  const fail = (): never => { throw new Error(errorCode); };
  const visit = (raw: unknown): unknown => {
    const kind = typeof raw;
    if (raw === null || raw === undefined || kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'bigint') return raw;
    if (typeof raw !== 'object' || isProxy(raw)) return fail();
    if (apply(activeHas,active,[raw])) return fail();
    const prior = apply(memoGet,memo,[raw]); if (prior) return prior;
    const array = arrayIsArray(raw);
    const prototype = array ? undefined : getPrototype(raw);
    if (!array && prototype !== objectPrototype && prototype !== null) return fail();
    const descriptors = getDescriptors(raw);
    const length = array ? descriptors.length?.value : 0;
    // Room's canonical storage protocol distinguishes plain and null objects.
    // Only its fixed host adapter opts in; all existing callers keep the old ABI.
    const result: Record<string, unknown> | unknown[] = array ? new NativeArray(length)
      : create(options?.preserveDataPrototype === true ? prototype : null);
    apply(activeAdd,active,[raw]); apply(memoSet,memo,[raw,result]);
    try {
      const names=ownKeys(descriptors);
      for (let i=0;i<names.length;i++) {
        const key=names[i]!;
        if (typeof key !== 'string') return fail();
        if (array && key === 'length') continue;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !hasOwn(descriptor, 'value')) return fail();
        if (array && (apply(exec,/^(0|[1-9]\d*)$/,[key])===null || NativeNumber(key) >= length)) return fail();
        define(result, key, { __proto__: null, value: visit(descriptor.value), writable: true, configurable: true, enumerable: true } as PropertyDescriptor);
      }
    } finally { apply(activeDelete,active,[raw]); }
    return result;
  };
  return visit(value) as T;
}
