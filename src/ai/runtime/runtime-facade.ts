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

export interface SkillEntry {
  name: string;
  listing: string; // formatted line for this skill
}

export interface RuntimeFacadeOptions {
  promptBuilder: Pick<PromptBuilder, 'build'>;
  getPromptInput(cwd: string): Promise<Omit<PromptBuilderInput, 'cwd' | 'channel'>>;
  agent: Pick<Agent, 'getSessionState' | 'setPromptSnapshot' | 'setSystemPrompt' | 'runTurn'>;
  getSkillEntries?(): SkillEntry[];
}

export class RuntimeFacade {
  // Tracks skill names already sent to the agent this session (mirrors CC's o17 Map).
  private readonly sentSkillNames = new Set<string>();

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
      this.options.agent.getSessionState().attachPromptSnapshot(promptSnapshot.id, promptSnapshot.memoryRefs, promptSnapshot.cwd);
      this.options.agent.setPromptSnapshot(promptSnapshot);
      this.options.agent.setSystemPrompt(promptSnapshot.rendered);

      const input = this.buildInput(request.input);
      await this.options.agent.runTurn(input, onChunk, signal);
    } catch (error) {
      const normalized = normalizeRuntimeError(error);
      throw new Error(`${normalized.code}: ${normalized.message}`);
    }
  }

  /** Reset deduplication state (e.g. after skill install/uninstall). */
  resetSkillTracking(): void {
    this.sentSkillNames.clear();
  }

  private buildInput(input: string | MessageBlock[]): string | MessageBlock[] {
    // Compute new skills not yet seen by the agent (CC dedup: only send new ones).
    const allEntries = this.options.getSkillEntries?.() ?? [];
    const newEntries = allEntries.filter((e) => !this.sentSkillNames.has(e.name));

    if (newEntries.length === 0) return input;

    // Mark as sent before running (mirrors CC's O.add loop).
    for (const e of newEntries) this.sentSkillNames.add(e.name);

    const listing = newEntries.map((e) => e.listing).join('\n');
    const listingBlock: MessageBlock = {
      type: 'text',
      text: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n${listing}\n</system-reminder>`,
    };

    const inputBlocks: MessageBlock[] = typeof input === 'string'
      ? [{ type: 'text', text: input }]
      : input;

    return [listingBlock, ...inputBlocks];
  }
}
