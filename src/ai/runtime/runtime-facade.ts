import type { Agent } from '../agent.js';
import type { MessageBlock, StreamChunk } from '../../types.js';
import type { PromptBuilder, PromptBuilderInput } from '../prompts/builder.js';
import { normalizeRuntimeError } from './runtime-errors.js';

export interface RuntimeTurnRequest {
  sessionId: string;
  cwd: string;
  source: 'chat' | 'yzj';
  input: string | MessageBlock[];
}

export interface RuntimeFacadeOptions {
  promptBuilder: Pick<PromptBuilder, 'build'>;
  getPromptInput(cwd: string): Promise<Omit<PromptBuilderInput, 'cwd' | 'channel'>>;
  agent: Pick<Agent, 'getSessionState' | 'setPromptSnapshot' | 'setSystemPrompt' | 'runTurn'>;
}

export class RuntimeFacade {
  constructor(private readonly options: RuntimeFacadeOptions) {}

  async runTurn(
    request: RuntimeTurnRequest,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const promptSnapshot = await this.options.promptBuilder.build({
        ...(await this.options.getPromptInput(request.cwd)),
        cwd: request.cwd,
        channel: request.source,
      });
      this.options.agent.getSessionState().attachPromptSnapshot(promptSnapshot.id, promptSnapshot.memoryRefs);
      this.options.agent.setPromptSnapshot(promptSnapshot);
      this.options.agent.setSystemPrompt(promptSnapshot.rendered);
      await this.options.agent.runTurn(request.input, onChunk, signal);
    } catch (error) {
      const normalized = normalizeRuntimeError(error);
      throw new Error(`${normalized.code}: ${normalized.message}`);
    }
  }
}
