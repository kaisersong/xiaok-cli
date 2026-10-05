import { randomUUID } from 'node:crypto';
import type { Config, Message, ModelAdapter, StreamChunk } from '../../src/types.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
import { createAdapterFromBinding } from '../../src/ai/models.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { streamDesktopSummaryRecovery } from './desktop-summary-stream.js';

type Binding = ReturnType<typeof resolveRuntimeModelBinding>;
type Request = Omit<Parameters<typeof streamDesktopSummaryRecovery>[0], 'adapter'> & { adapter?: Pick<ModelAdapter, 'stream'> };
export type ProjectAgentModel = Awaited<ReturnType<typeof createProjectAgentModel>>;

export function validateProjectAgentModelSelection(modelId: unknown, runtimeType: unknown, config: Config, requestSource?: 'user'|'agent'|'scheduler'): void {
  if (requestSource !== 'user') throw new Error('project_agent_model_user_required');
  if (runtimeType !== 'xiaok') throw new Error('project_agent_model_xiaok_required');
  if (modelId !== null && (typeof modelId !== 'string' || !Object.hasOwn(config.models, modelId))) throw new Error('project_agent_model_not_configured');
}

function isBoundaryFailure(error: unknown): boolean {
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
    async *stream(input: Request): AsyncGenerator<StreamChunk> {
      for (;;) {
        input.options?.signal?.throwIfAborted();
        if (Date.now() >= input.deadline) throw new Error('project_agent_model_deadline');
        const messages: Message[] = switched ? input.messages.map(message => ({...message, content: message.content.filter(block => block.type !== 'thinking')})).filter(message => message.content.length > 0) : input.messages;
        const systemPrompt = switched ? input.systemPrompt.replace(`你当前运行的模型是: ${initialName}`, `你当前运行的模型是: ${adapter.getModelName()}`) : input.systemPrompt;
        if (messages.some(message => message.content.some(block => block.type === 'image')) && !binding.capabilities.includes('image_in')) throw new Error('project_agent_model_image_not_supported');
        if (!canFallback) {
          // The summary stream owns authority, preparation and invocation callbacks.
          yield* streamDesktopSummaryRecovery({...input, adapter, messages, systemPrompt});
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
        let providerFailed = false;
        let providerError: unknown;
        const iterator = streamDesktopTaskProviderConversation(prepared)[Symbol.asyncIterator]();
        try {
          // Only the selected request is buffered. Tools cannot run from a failed partial response.
          for (;;) {
            let next: IteratorResult<StreamChunk>;
            try { next = await iterator.next(); }
            catch (error) { providerFailed = true; providerError = error; break; }
            if (next.done) break;
            const chunk = next.value;
            // Usage belongs to this actual request even when its visible result fails.
            if (chunk.type === 'usage') { yield chunk; continue; }
            input.options?.signal?.throwIfAborted();
            chunks.push(chunk);
          }
        } finally { await iterator.return?.(); }
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
    },
  };
}
