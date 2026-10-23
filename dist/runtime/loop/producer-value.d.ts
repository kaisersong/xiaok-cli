/** Capture actual typed producer records. Optional undefined object properties
 * are omitted, but accessors and non-data objects are never executed. */
export declare function captureLoopProducerValue<T>(raw: T): T;
