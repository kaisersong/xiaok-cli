/** Capture plain own data without running caller getters, iterators or mutable Array methods. */
export declare function captureIntentData<T>(raw: T): T;
/** Ordinary nullable-array length DATA only; not native admission or a journal validator. */
export declare function nativeJournalLengthData(value: unknown): number | undefined;
