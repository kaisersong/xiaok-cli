import type {Message,ModelAdapter} from '../../src/types.js';
import type {TaskRunnerInput} from '../../src/runtime/task-host/task-runtime-host.js';
import type {DesktopAgentExecutionContext} from './desktop-multi-agent-service.js';
import type {resolveRuntimeModelBinding} from '../../src/ai/providers/control-plane.js';

/** Main-bound lifecycle only. This interface is never a Native admission proof. */
export interface DesktopModelInvocation {
  adapter: ModelAdapter;
  closeAndDrain(): Promise<void>;
  /** Explicit fresh-session projection; original active-turn results stay local. */
  prepareCheckpoint?(messages: readonly Message[]): Message[];
  openChildInvocation?: DesktopChildInvocationFactory;
}
export type DesktopChildInvocationFactory = (context: DesktopAgentExecutionContext,signal: AbortSignal) => Promise<DesktopModelInvocation>;
export type DesktopRootInvocationFactory = (input: TaskRunnerInput,binding: ReturnType<typeof resolveRuntimeModelBinding>) => Promise<DesktopModelInvocation>;

/** Capture the owner method before any later await or caller callback. */
export function captureInvocationDrain(invocation: DesktopModelInvocation): () => Promise<void> {
  if(!invocation||typeof invocation.closeAndDrain!=='function')throw new Error('model_invocation_close_unavailable');
  const close=invocation.closeAndDrain;let completion:Promise<void>|undefined;
  return ()=>completion??=Promise.resolve().then(()=>close.call(invocation));
}
