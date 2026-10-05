/** Pure checks on already captured source bytes. No filesystem or authority. */
export declare function assertCapturedJsonUniqueKeys(raw: string, errorCode: string): void;
export declare function parseCapturedSourceJson(raw: string): unknown;
export declare function capturedFields(value: unknown, required: readonly string[], optional?: readonly string[]): void;
export declare function capturedIdentity(value: unknown): asserts value is string;
export declare function capturedInteger(value: unknown, minimum?: number): asserts value is number;
export declare function freezeCapturedData<T>(value: T): Readonly<T>;
/** Classifies numeric literals in already syntax-validated JSON; strings do not
 * participate. Fractions/exponents remain uninterpreted even if Number is integral. */
export declare function capturedJsonHasOnlySafeIntegerLiterals(raw: string): boolean;
