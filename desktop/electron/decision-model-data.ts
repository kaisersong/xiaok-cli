import { types } from 'node:util';
const descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys, own = Object.hasOwn;
const nativeParse = JSON.parse, nativeStringify = JSON.stringify, proto = Object.getPrototypeOf;
const objectProto = Object.prototype, arrayProto = Array.prototype;
const apply = Reflect.apply, join = Array.prototype.join, push = Array.prototype.push, isArray = Array.isArray;
export function ownDecisionData(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || types.isProxy(value))
        throw Error('decision_data_contract');
    const row = descriptor(value, key);
    if (!row || !own(row, 'value'))
        throw Error('decision_data_contract');
    return row.value;
}
export function parseDecisionData(text: string): unknown { return nativeParse(text); }
/** No object/array toJSON or iterator hooks participate in metadata/argv. */
export function encodeDecisionData(value: unknown): string {
    let nodes = 0;
    const visit = (v: unknown, depth: number): string => {
        if (++nodes > 4096 || depth > 16)
            throw Error('decision_data_limit');
        if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))
            return nativeStringify(v);
        if (!v || typeof v !== 'object' || types.isProxy(v))
            throw Error('decision_data_contract');
        const array = isArray(v), p = proto(v);
        if (array ? p !== arrayProto && p !== null : p !== objectProto && p !== null)
            throw Error('decision_data_contract');
        const names = keys(v), fields: string[] = [];
        if (array) {
            const length = ownDecisionData(v, 'length');
            if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 4096)
                throw Error('decision_data_contract');
            for (let i = 0; i < length; i++)
                apply(push, fields, [visit(ownDecisionData(v, String(i)), depth + 1)]);
            if (names.length !== length + 1)
                throw Error('decision_data_contract');
            return '[' + apply(join, fields, [',']) + ']';
        }
        for (let i = 0; i < names.length; i++) {
            const key = names[i];
            if (typeof key !== 'string')
                throw Error('decision_data_contract');
            apply(push, fields, [nativeStringify(key) + ':' + visit(ownDecisionData(v, key), depth + 1)]);
        }
        return '{' + apply(join, fields, [',']) + '}';
    };
    return visit(value, 0);
}
