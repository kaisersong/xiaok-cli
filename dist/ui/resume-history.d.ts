import type { Message } from '../types.js';
import type { CompactionRecord } from '../ai/runtime/session-graph.js';
/** Replay projection only; runtime and persisted messages remain authoritative. */
export declare function getResumeHistoryMessages(messages: Message[], compactions?: readonly CompactionRecord[]): Message[];
