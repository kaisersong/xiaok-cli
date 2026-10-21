/** Iterate an array through the iterator factory and next method captured at module load. */
export declare function capturedArrayIterator<T>(values: readonly T[]): IterableIterator<T>;
/** Iterate Map values through separately captured factory and iterator next methods. */
export declare function capturedMapValuesIterator<K, V>(values: Map<K, V>): IterableIterator<V>;
export declare function capturedArrayFind<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T | undefined;
export declare function capturedArraySome<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean;
export declare function capturedArrayMap<T, U>(values: readonly T[], project: (value: T, index: number) => U): U[];
export declare function capturedArrayFilter<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T[];
/** Set(array) semantics without consulting the caller-replaceable Array iterator. */
export declare function setFromDenseArray<T>(values: readonly T[]): Set<T>;
/** Collection constructors captured before caller-controlled code can replace globals. */
export declare function createCapturedSet<T>(): Set<T>;
export declare function createCapturedMap<K, V>(): Map<K, V>;
export declare function createCapturedWeakMap<K extends object, V>(): WeakMap<K, V>;
export declare function createCapturedWeakSet<T extends object>(): WeakSet<T>;
export declare function capturedSetHas<T>(set: Set<T>, value: T): boolean;
export declare function capturedSetAdd<T>(set: Set<T>, value: T): void;
export declare function capturedSetDelete<T>(set: Set<T>, value: T): void;
export declare function capturedWeakSetHas<T extends object>(set: WeakSet<T>, value: T): boolean;
export declare function capturedWeakSetAdd<T extends object>(set: WeakSet<T>, value: T): void;
export declare function capturedWeakSetDelete<T extends object>(set: WeakSet<T>, value: T): void;
