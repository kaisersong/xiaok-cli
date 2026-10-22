import { ModelStreamPhysicalOwner, type ModelStreamPhysicalRun } from '../../src/ai/runtime/model-stream-physical-owner.js';
import { randomUUID } from 'node:crypto';
import type { Message, StreamChunk } from '../../src/types.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { recoverModelStream, type ModelRecoveryNotice, type ModelRecoveryPolicy } from '../../src/ai/runtime/model-stream-recovery.js';

type Request = Parameters<typeof streamDesktopTaskProviderConversation>[0];
export type DesktopTaskRequestPreparer = (request: Request) => Promise<Request>;
type Input = Request & {
  deadline: number;
  beforeRequest?: () => Promise<void>;
  prepareRequest?: DesktopTaskRequestPreparer;
  onInvocation?: (id: string) => void;
  onUsage?: (chunk: Extract<StreamChunk, { type: 'usage' }>, invocationId: string) => void | Promise<void>;
  onRecovery?: (notice: ModelRecoveryNotice & { summaryOnly: boolean }) => void | Promise<void>;
  canRecover?: () => boolean;
  summaryOnly?: boolean;
  policy?: ModelRecoveryPolicy;
};


/** Main-only identity; model data and IPC never contain this scope. */
export interface DesktopModelPhysicalScope { readonly opaqueDesktopModelPhysicalScope: never }
const physicalClaimOwners = new WeakMap<ModelStreamPhysicalRun, ModelStreamPhysicalOwner>();
const physicalScopes = new WeakMap<object, { owner: ModelStreamPhysicalOwner; assertCurrent(): void }>();
export function createDesktopModelPhysicalScope(assertCurrent: () => void = () => {}): DesktopModelPhysicalScope {
  const scope = Object.freeze({}) as DesktopModelPhysicalScope;
  physicalScopes.set(scope, { owner: new ModelStreamPhysicalOwner(), assertCurrent }); return scope;
}
function physicalScope(scope: DesktopModelPhysicalScope) {
  const facts = physicalScopes.get(scope); if (!facts) throw Error('desktop_model_physical_scope_invalid'); return facts;
}
export function admitDesktopModelPhysicalRead(scope: DesktopModelPhysicalScope): ModelStreamPhysicalRun {
  const facts = physicalScope(scope); facts.assertCurrent(); const claim = facts.owner.admit(); physicalClaimOwners.set(claim, facts.owner); return claim;
}
export function closeDesktopModelPhysicalScope(scope: DesktopModelPhysicalScope, reason?: unknown): Promise<void> {
  const facts = physicalScope(scope); facts.owner.stop(reason); return facts.owner.waitForStopped();
}
export function waitDesktopModelPhysicalIdle(scope: DesktopModelPhysicalScope): Promise<void> { return physicalScope(scope).owner.waitForIdle(); }
export function assertDesktopModelPhysicalIdle(scope: DesktopModelPhysicalScope): void {
  const {owner} = physicalScope(scope); if (owner.hasPending() || owner.hasFailure()) throw Error('desktop_model_physical_resources_pending');
}

/** Keep the original usage commit inside the physical request's ownership. */
export async function captureDesktopTaskUsage(consumer: Input['onUsage'], chunk: Extract<StreamChunk, { type: 'usage' }>, invocationId: string, physicalRun?: ModelStreamPhysicalRun): Promise<void> {
  if (!consumer) return;
  let work: void | Promise<void>;
  try { work = consumer(chunk, invocationId); }
  catch (error) { physicalRun?.noteReturnFailure(error); throw error; }
  if (work) { physicalRun?.observeReturn(work); await work; }
}

/** Recover provider reads, never task/tool execution or authorization/persistence. */
export async function* streamDesktopTaskRecovery(input: Input, physicalRun?: ModelStreamPhysicalRun): AsyncGenerator<StreamChunk> {
  const deadline = new AbortController();
  const signal = input.options?.signal ? AbortSignal.any([input.options.signal, deadline.signal]) : deadline.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armDeadline = () => {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) deadline.abort(new Error('desktop_tool_loop_deadline_exceeded'));
    else if (Number.isFinite(remaining)) timer = setTimeout(armDeadline, Math.min(remaining, 2 ** 31 - 1));
  };
  armDeadline();
  let messages = input.messages;
  let invocationId = input.invocationId;
  let prepared = false, prefix = '', sawTool = false, usageConsumerFailed = false;
  let summaryOnly = Boolean(input.summaryOnly);
  try {
    yield* recoverModelStream({ signal, policy: input.policy, physicalRun,
      shouldRetry: () => prepared && !usageConsumerFailed,
      onRetry: async notice => {
        if (!summaryOnly && !sawTool && prefix.trim() && input.canRecover?.()) summaryOnly = true;
        // These fragments were visible, but no tool from this interrupted request ran.
        if (prefix.trim()) messages = [...input.messages, { role: 'user', content: [{ type: 'text', text:
          'The previous model response was interrupted. The following is partial visible output, not a completed answer or an executed tool call. Continue from the completed tool results already in history; do not repeat completed operations or the delivered text. '
          + (summaryOnly ? 'Tools are disabled; finish the summary using existing evidence. ' : '')
          + JSON.stringify({ partialOutput: prefix.slice(-12000) }) }] }];
        sawTool = false;
        invocationId = `inv_${randomUUID()}`;
        await input.onRecovery?.({ ...notice, summaryOnly });
      },
      open: requestSignal => {
        let closeFailure: { error: unknown } | undefined;
        let originalBodyFailure: { error: unknown } | undefined;
        const source = (async function*() {
        prepared = false;
        await input.beforeRequest?.();
        requestSignal.throwIfAborted();
        const request = { ...input, messages, tools: summaryOnly ? [] : input.tools, invocationId,
          options: { ...input.options, signal: requestSignal } };
        const current = input.prepareRequest ? await input.prepareRequest(request) : request;
        requestSignal.throwIfAborted();
        input.onInvocation?.(invocationId);
        prepared = true;
        const claimOwner = physicalRun && physicalClaimOwners.get(physicalRun);
        if (physicalRun && !claimOwner) throw Error('desktop_model_physical_claim_invalid');
        // This original provider operation remains admitted through its real
        // return, even when recovery's outward read has already cancelled.
        const providerRun = claimOwner?.admit();
        let iterator: AsyncIterator<StreamChunk> | undefined;
        let text = '';
        try {
          iterator = streamDesktopTaskProviderConversation(current)[Symbol.asyncIterator]();
          for (;;) {
            const raw = iterator.next();
            const receipt = providerRun?.observeRead(raw, () => [requestSignal.reason, signal.reason]);
            let next: IteratorResult<StreamChunk>;
            try { next = await raw; receipt?.consume(); }
            catch (error) { receipt?.classifyFailure(error); throw error; }
            if (next.done) break;
            const chunk = next.value;
            if (chunk.type === 'usage') {
              try { await captureDesktopTaskUsage(input.onUsage, chunk, current.invocationId, providerRun); }
              catch (error) { usageConsumerFailed = true; throw error; }
            }
            if (chunk.type !== 'usage') requestSignal.throwIfAborted();
            if (chunk.type === 'text') { prefix = (prefix + chunk.delta).slice(-12000); text += chunk.delta; }
            if (chunk.type === 'done' && summaryOnly && !text.trim()) throw new Error('summary_recovery_empty');
            if (chunk.type === 'tool_use') {
              if (summaryOnly) throw new Error('summary_recovery_tool_forbidden');
              sawTool = true;
            }
            yield chunk;
          }
          if (summaryOnly && !text.trim()) throw new Error('summary_recovery_empty');
        } catch (error) { originalBodyFailure = { error }; throw error; }
        finally {
          try {
            let observed = false;
            try { const raw = iterator?.return?.(); if (raw) { providerRun?.observeReturn(raw); observed = Boolean(providerRun); await raw; } }
            catch (physicalError) {
              if (!observed) providerRun?.noteReturnFailure(physicalError);
              closeFailure = { error: physicalError };
            }
          } finally { providerRun?.finish(); }
        }
        })();
        const checked = async (raw: Promise<IteratorResult<StreamChunk>>): Promise<IteratorResult<StreamChunk>> => {
          let result: IteratorResult<StreamChunk> | undefined, failure: { error: unknown } | undefined;
          try { result = await raw; } catch (error) { failure = { error }; }
          const business = originalBodyFailure ?? failure;
          if (closeFailure) {
            if (business && business.error !== closeFailure.error) throw new AggregateError([business.error, closeFailure.error], 'desktop_provider_business_and_return_failed', { cause: business.error });
            throw closeFailure.error;
          }
          if (failure) throw failure.error;
          return result!;
        };
        return { [Symbol.asyncIterator]() { return this; },
          next: () => checked(source.next()), return: () => checked(source.return(undefined)), throw: (error: unknown) => checked(source.throw(error)) } satisfies AsyncIterableIterator<StreamChunk>;
      },
    });
  } catch (error) {
    if (signal.aborted && (typeof signal.reason !== 'object' || signal.reason === null)) throw new Error('task cancelled');
    throw error;
  } finally { clearTimeout(timer); }
}
