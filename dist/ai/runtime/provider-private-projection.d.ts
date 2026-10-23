import type { Message, ToolExecutionContext } from '../../types.js';
export declare function isStrictKimiK3Adapter(adapter: object): boolean;
export declare function projectProviderPrivateMessages(messages: readonly Message[]): Message[];
export declare function buildSynthesizedProviderContext(kind: 'compaction' | 'subagent' | 'model-switch', messages: readonly Message[]): string;
export declare function projectStrictToolExecutionContext(context: ToolExecutionContext): ToolExecutionContext;
/** Validate stored source data only; no projection, disclosure or authority. */
export declare function assertCapturedMessageSchema(messages: readonly Message[]): void;
