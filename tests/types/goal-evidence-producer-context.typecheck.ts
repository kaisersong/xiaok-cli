// Compile-only candidate: no values, SDK/module execution, fake session or authority.
import type { Tool, ToolExecutionContext, ToolExecutionFact } from '../../src/types.js';
import type { bashTool, BashToolExecutionContext } from '../../src/ai/tools/bash.js';
import type { createWriteTool, WriteToolExecutionContext } from '../../src/ai/tools/write.js';
import type { ToolRegistry } from '../../src/ai/tools/index.js';

type Check<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Equal<A, B> = Extends<A, B> extends true ? Extends<B, A> : false;
type And<A extends boolean, B extends boolean> = A extends true ? B : false;
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
type BashKeys = 'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink' | 'observationCollector' | 'executionProgress';
type WriteKeys = 'signal' | 'assertPermissionApproval' | 'compoundPhase' | 'toolInvocationId' | 'runtimeFactSink';
type HostKeys = 'taskId' | 'session' | 'messages' | 'systemPrompt' | 'toolDefinitions';
// Exact original sink returns Array.push's number. void consumption is intentional.
type OriginalFactContext = { toolInvocationId: string; runtimeFactSink: { emit(fact: ToolExecutionFact): number } };
type WrongSignal = { signal: string };
type WrongFactSink = { runtimeFactSink: { emit(fact: { factKind: 'forged' }): void } };

export type GoalEvidenceProducerContextTypeControls = [
  // C1: all actual Bash consumed fields, including physical phase and progress.
  Check<Equal<keyof BashToolExecutionContext, BashKeys>>,
  // C2: all actual write consumed fields, including permission and phase guards.
  Check<Equal<keyof WriteToolExecutionContext, WriteKeys>>,
  // C3: unchanged real full host context is accepted by both concrete tools.
  Check<And<Extends<ToolExecutionContext, BashToolExecutionContext>, Extends<ToolExecutionContext, WriteToolExecutionContext>>>,
  // C4: exact original local fact sink is accepted; no invented host data.
  Check<And<Extends<OriginalFactContext, BashToolExecutionContext>, Extends<OriginalFactContext, WriteToolExecutionContext>>>,
  // C5: both concrete tools retain the global Tool registration contract.
  Check<And<Extends<typeof bashTool, Tool>, Extends<ReturnType<typeof createWriteTool>, Tool>>>,
  // C6: original local context remains insufficient for global Tool and Registry.
  Check<And<Equal<Extends<OriginalFactContext, NonNullable<Parameters<Tool['execute']>[1]>>, false>, Equal<Extends<OriginalFactContext, NonNullable<Parameters<ToolRegistry['executeTool']>[2]>>, false>>>,
  // C7: all five global host properties remain mandatory.
  Check<Equal<RequiredKeys<ToolExecutionContext>, HostKeys>>,
  // C8: wrongly typed signal/fact sink remain rejected by the concrete contracts.
  Check<And<Equal<Extends<WrongSignal, BashToolExecutionContext | WriteToolExecutionContext>, false>, Equal<Extends<WrongFactSink, BashToolExecutionContext | WriteToolExecutionContext>, false>>>
];
