import type { Message } from '../../types.js';
/** A live delegation call must never inherit its parent's unfinished tool batch. */
export declare function completedForkMessages(messages: readonly Message[]): readonly Message[];
