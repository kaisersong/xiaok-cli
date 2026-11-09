// Domain-local fixed containers only; no permission, pool, namespace or proof.
const NativeMap = Map, apply = Reflect.apply, freeze = Object.freeze, define = Object.defineProperty;
const get = Map.prototype.get, set = Map.prototype.set, has = Map.prototype.has, remove = Map.prototype.delete;
const values = Map.prototype.values, next = Object.getPrototypeOf(new Map().values()).next;
const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
export function decisionStockMap<K, V>() {
    const rows = new NativeMap<K, V>();
    return freeze({
        get: (key: K): V | undefined => apply(get, rows, [key]),
        set: (key: K, value: V): void => { apply(set, rows, [key, value]); },
        has: (key: K): boolean => apply(has, rows, [key]),
        delete: (key: K): boolean => apply(remove, rows, [key]),
        get size(): number { return apply(size, rows, []); },
        values: (): V[] => { const iterator = apply(values, rows, []), out: V[] = []; for (;;) {
            const row = apply(next, iterator, []) as IteratorResult<V>;
            if (row.done)
                return out;
            define(out, String(out.length), { value: row.value, enumerable: true, writable: true, configurable: true });
        } },
    });
}
