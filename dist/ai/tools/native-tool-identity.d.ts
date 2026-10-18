import type { Tool } from '../../types.js';
export type NativeToolKind = 'readonly' | 'file' | 'command';
/** Host builtin factory registration, never a model or plugin descriptor field. */
export declare function registerBuiltinToolIdentity(tool: Tool, kind: NativeToolKind): void;
export declare function getBuiltinToolIdentity(tool: Tool): NativeToolKind | undefined;
/** Called only by audited host sandbox/registry wrappers, not tool registration. */
export declare function isNativeReadonlyExecutionEligible(tool: Tool): boolean;
export declare function inheritBuiltinToolIdentity(source: Tool, target: Tool, auditedReadonlyGuard?: () => boolean): void;
