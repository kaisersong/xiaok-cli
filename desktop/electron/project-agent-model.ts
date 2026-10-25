import type { ModelStreamPhysicalRun } from '../../src/ai/runtime/model-stream-physical-owner.js';
import { ModelTextRepetitionGuard, MODEL_TEXT_REPETITION_CODE } from '../../src/ai/runtime/model-text-repetition.js';
import { randomUUID } from 'node:crypto';
import type { Config, Message, ModelAdapter, StreamChunk } from '../../src/types.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
import { createAdapterFromBinding } from '../../src/ai/models.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { streamDesktopTaskRecovery } from './desktop-task-stream.js';
import type { streamDesktopSummaryRecovery } from './desktop-summary-stream.js';

type Binding = ReturnType<typeof resolveRuntimeModelBinding>;
type Request = Omit<Parameters<typeof streamDesktopTaskRecovery>[0], 'adapter' | 'onRecovery'> & {
  adapter?: Pick<ModelAdapter, 'stream'>;
  beforeRequest?: () => Promise<void>;
  // Selected-model fallback keeps its original notification contract.
  onRecovery?: Parameters<typeof streamDesktopSummaryRecovery>[0]['onRecovery'];
};
export type ProjectAgentModel = Awaited<ReturnType<typeof createProjectAgentModel>>;

export function validateProjectAgentModelSelection(modelId: unknown, runtimeType: unknown, config: Config, requestSource?: 'user'|'agent'|'scheduler'): void {
  if (requestSource !== 'user') throw new Error('project_agent_model_user_required');
  if (runtimeType !== 'xiaok') throw new Error('project_agent_model_xiaok_required');
  if (modelId !== null && (typeof modelId !== 'string' || !Object.hasOwn(config.models, modelId))) throw new Error('project_agent_model_not_configured');
}

function isBoundaryFailure(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === MODEL_TEXT_REPETITION_CODE) return true;
  return error instanceof Error && (error.name === 'AbortError' || /KIMI_K3_|authorization|permission|task.cancelled|workspace_|deadline/i.test(error.message));
}

/** One task owns its selected binding and at most one fallback. No task/tool is replayed. */
export async function createProjectAgentModel(options: {
  modelId?: string|null;
  loadConfig(): Promise<Config>;
  createAdapter?: (binding: Binding) => ModelAdapter;
}) {
  const factory = options.createAdapter ?? createAdapterFromBinding;
  const config = await options.loadConfig();
  let binding: Binding;
  let canFallback = Boolean(options.modelId && Object.hasOwn(config.models, options.modelId));
  try { binding = resolveRuntimeModelBinding(config, canFallback ? options.modelId! : undefined); }
  catch (error) {
    if (!canFallback) throw error;
    binding = resolveRuntimeModelBinding(config); canFallback = false;
  }
  let adapter: ModelAdapter;
  try { adapter = factory(binding); }
  catch (error) {
    if (!canFallback || isBoundaryFailure(error)) throw error;
    binding = resolveRuntimeModelBinding(await options.loadConfig());
    adapter = factory(binding); canFallback = false;
  }
  let switched = false;
  const initialName = adapter.getModelName();
  return {
    get binding() { return binding; },
    get adapter() { return adapter; },
    stream(input: Request, physicalRun?: ModelStreamPhysicalRun): AsyncGenerator<StreamChunk> {
      let closingFailure: { error: unknown } | undefined, closingBusiness: { error: unknown } | undefined;
      const source = (async function* () {
      for (;;) {
        input.options?.signal?.throwIfAborted();
        if (Date.now() >= input.deadline) throw new Error('project_agent_model_deadline');
        const messages: Message[] = switched ? input.messages.map(message => ({...message, content: message.content.filter(block => block.type !== 'thinking')})).filter(message => message.content.length > 0) : input.messages;
        const systemPrompt = switched ? input.systemPrompt.replace(`你当前运行的模型是: ${initialName}`, `你当前运行的模型是: ${adapter.getModelName()}`) : input.systemPrompt;
        if (messages.some(message => message.content.some(block => block.type === 'image')) && !binding.capabilities.includes('image_in')) throw new Error('project_agent_model_image_not_supported');
        if (!canFallback) {
          // Task recovery owns authority, preparation and invocation callbacks.
          yield* streamDesktopTaskRecovery({...input, adapter, messages, systemPrompt}, physicalRun);
          return;
        }
        await input.beforeRequest?.();
        input.options?.signal?.throwIfAborted();
        if (Date.now() >= input.deadline) throw new Error('project_agent_model_deadline');
        const invocationId = randomUUID();
        const request = {...input, adapter, messages, systemPrompt, invocationId};
        const prepared = input.prepareRequest ? await input.prepareRequest(request) : request;
        input.options?.signal?.throwIfAborted();
        if (Date.now() >= input.deadline) throw new Error('project_agent_model_deadline');
        input.onInvocation?.(invocationId);
        const chunks: StreamChunk[] = [];
        const textGuard = new ModelTextRepetitionGuard();
        let providerFailed = false;
        let providerError: unknown;
        const iterator = streamDesktopTaskProviderConversation(prepared)[Symbol.asyncIterator]();
        try {
          // Only the selected request is buffered. Tools cannot run from a failed partial response.
          for (;;) {
            let next: IteratorResult<StreamChunk>;
            const raw = iterator.next();
            const receipt = physicalRun?.observeRead(raw, () => [input.options?.signal?.reason]);
            try { next = await raw; receipt?.consume(); }
            catch (error) { receipt?.classifyFailure(error); providerFailed = true; providerError = error; break; }
            if (next.done) break;
            const chunk = next.value;
            // Usage belongs to this actual request even when its visible result fails.
            if (chunk.type === 'usage') { yield chunk; continue; }
            if (chunk.type === 'text') textGuard.append(chunk.delta);
            input.options?.signal?.throwIfAborted();
            chunks.push(chunk);
          }
        } catch (error) { providerFailed = true; providerError = error; }
        finally {
          let observedReturn = false;
          try { const raw = iterator.return?.(); if (raw) { physicalRun?.observeReturn(raw); observedReturn = Boolean(physicalRun); await raw; } }
          catch (error) { if (!observedReturn) physicalRun?.noteReturnFailure(error); closingFailure = { error }; if (providerFailed) closingBusiness = { error: providerError }; }
        }
        if (closingFailure) return;
        input.options?.signal?.throwIfAborted();
        if (!providerFailed && (!chunks.some(chunk => chunk.type === 'done') || !chunks.some(chunk => chunk.type === 'tool_use' || (chunk.type === 'text' && chunk.delta.trim())))) {
          providerFailed = true;
          providerError = new Error('project_agent_model_incomplete_response');
        }
        if (providerFailed) {
          if (isBoundaryFailure(providerError)) throw providerError;
          const current = resolveRuntimeModelBinding(await options.loadConfig());
          if (current.modelId === binding.modelId && current.providerId === binding.providerId && current.wireModel === binding.wireModel) throw providerError;
          await input.onRecovery?.({summaryOnly: false});
          input.options?.signal?.throwIfAborted();
          if (Date.now() >= input.deadline) throw new Error('project_agent_model_deadline');
          canFallback = false;
          binding = current; adapter = factory(current); switched = true;
          continue;
        }
        // Consumer errors must escape without activating a provider retry.
        for (const chunk of chunks) yield chunk;
        return;
      }
    
      })();
      const checked = async (raw: Promise<IteratorResult<StreamChunk>>): Promise<IteratorResult<StreamChunk>> => {
        let result: IteratorResult<StreamChunk> | undefined, failure: { error: unknown } | undefined;
        try { result = await raw; } catch (error) { failure = { error }; }
        if (closingFailure) {
          const business = closingBusiness ?? failure;
          if (business && business.error !== closingFailure.error) throw new AggregateError([business.error, closingFailure.error], 'project_model_business_and_return_failed', { cause: business.error });
          throw closingFailure.error;
        }
        if (failure) throw failure.error;
        return result!;
      };
      return { [Symbol.asyncIterator]() { return this; }, next: () => checked(source.next()), return: value => checked(source.return(value)), throw: error => checked(source.throw(error)) } as AsyncGenerator<StreamChunk>;
    },
  };
}
