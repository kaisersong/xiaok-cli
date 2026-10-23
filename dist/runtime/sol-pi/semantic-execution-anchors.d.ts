import type { Message } from '../../types.js';
/** Exact closed execution facts, never instructions or a grant. Unknown protocol
 * fields and mixed user turns retain their original representation. The caller
 * still validates the whole history and measures the actual provider request. */
export declare function packCompletedExecutionAnchors(messages: readonly Message[]): Message[];
