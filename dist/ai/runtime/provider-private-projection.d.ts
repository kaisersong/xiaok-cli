import type { Message, ToolExecutionContext } from '../../types.js';
export declare function isStrictKimiK3Adapter(adapter: object): boolean;
export declare function projectProviderPrivateMessages(messages: readonly Message[]): Message[];
export declare function buildSynthesizedProviderContext(kind: 'compaction' | 'subagent', messages: readonly Message[]): string;
export declare function projectStrictToolExecutionContext(context: ToolExecutionContext): ToolExecutionContext;
