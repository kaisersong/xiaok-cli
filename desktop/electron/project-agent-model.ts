import { randomUUID } from 'node:crypto';
import type { Config, Message, ModelAdapter, StreamChunk } from '../../src/types.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
import { createAdapterFromBinding } from '../../src/ai/models.js';
import { streamDesktopTaskProviderConversation } from '../../src/ai/runtime/provider-conversation-authorization.js';
import { streamDesktopSummaryRecovery } from './desktop-summary-stream.js';

type Binding = ReturnType<typeof resolveRuntimeModelBinding>;
type Request = Omit<Parameters<typeof streamDesktopSummaryRecovery>[0], 'adapter'> & { adapter?: Pick<ModelAdapter, 'stream'>; beforeRequest?: () => Promise<void> };
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
        await input.beforeRequest?.();
        input.options?.signal?.throwIfAborted();
        const messages: Message[] = switched ? input.messages.map(message => ({...message, content: message.content.filter(block => block.type !== 'thinking')})).filter(message => message.content.length > 0) : input.messages;
        const systemPrompt = switched ? input.systemPrompt.replace(`你当前运行的模型是: ${initialName}`, `你当前运行的模型是: ${adapter.getModelName()}`) : input.systemPrompt;
        const invocationId = randomUUID();
        input.onInvocation?.(invocationId);
        const chunks: StreamChunk[] = [];
        try {
          if (messages.some(message => message.content.some(block => block.type === 'image')) && !binding.capabilities.includes('image_in')) throw new Error('project_agent_model_image_not_supported');
          if (!canFallback) {
            yield* streamDesktopSummaryRecovery({...input, adapter, messages, systemPrompt, invocationId});
            return;
          }
          // Only the selected request is buffered. Tools cannot run from a failed partial response.
          for await (const chunk of streamDesktopTaskProviderConversation({...input, adapter, messages, systemPrompt, invocationId})) {
            input.options?.signal?.throwIfAborted();
            chunks.push(chunk);
          }
          if (!chunks.some(chunk => chunk.type === 'done') || !chunks.some(chunk => chunk.type === 'tool_use' || (chunk.type === 'text' && chunk.delta.trim()))) throw new Error('project_agent_model_incomplete_response');
        } catch (error) {
          input.options?.signal?.throwIfAborted();
          if (!canFallback || isBoundaryFailure(error)) throw error;
          canFallback = false;
          const current = resolveRuntimeModelBinding(await options.loadConfig());
          if (current.modelId === binding.modelId && current.providerId === binding.providerId && current.wireModel === binding.wireModel) throw error;
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
