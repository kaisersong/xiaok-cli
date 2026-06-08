import type { Agent } from '../agent.js';
import type { MessageBlock, StreamChunk } from '../../types.js';
import type { PromptBuilder, PromptBuilderInput } from '../prompts/builder.js';
import { isAbortError } from './abort-utils.js';
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
  getIntentReminderBlock?(): MessageBlock | undefined;
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
    const newSkillsThisTurn: string[] = [];
    let input: string | MessageBlock[];
    try {
      const promptSnapshot = await this.options.promptBuilder.build({
        ...(await this.options.getPromptInput(request.cwd)),
        cwd: request.cwd,
        channel: request.source,
      });
      this.options.agent.getSessionState().attachPromptSnapshot(promptSnapshot.id, promptSnapshot.memoryRefs, promptSnapshot.cwd);
      this.options.agent.setPromptSnapshot(promptSnapshot);
      this.options.agent.setSystemPrompt(promptSnapshot.rendered);

      input = this.buildInput(request.input, newSkillsThisTurn);
    } catch (buildError) {
      if (isAbortError(buildError)) {
        this.rollbackSkillNames(newSkillsThisTurn);
        throw buildError;
      }
      const normalized = normalizeRuntimeError(buildError);
      throw new Error(`${normalized.code}: ${normalized.message}`);
    }

    try {
      await this.options.agent.runTurn(input, onChunk, signal);
    } catch (runError) {
      if (isAbortError(runError)) {
        this.rollbackSkillNames(newSkillsThisTurn);
        throw runError;
      }
      const normalized = normalizeRuntimeError(runError);
      throw new Error(`${normalized.code}: ${normalized.message}`);
    }
  }

  /** Reset deduplication state (e.g. after skill install/uninstall). */
  resetSkillTracking(): void {
    this.sentSkillNames.clear();
  }

  private buildInput(input: string | MessageBlock[], newSkillsThisTurn: string[]): string | MessageBlock[] {
    const reminderBlock = this.options.getIntentReminderBlock?.();

    // Compute new skills not yet seen by the agent (CC dedup: only send new ones).
    const allEntries = this.options.getSkillEntries?.() ?? [];
    const newEntries = allEntries.filter((e) => !this.sentSkillNames.has(e.name));

    const prefixBlocks: MessageBlock[] = [];
    if (reminderBlock) {
      prefixBlocks.push(reminderBlock);
    }

    if (newEntries.length > 0) {
      // Mark as sent before running (mirrors CC's O.add loop).
      for (const e of newEntries) {
        this.sentSkillNames.add(e.name);
        newSkillsThisTurn.push(e.name);
      }

      const listing = newEntries.map((e) => e.listing).join('\n');
      prefixBlocks.push({
        type: 'text',
        text: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n${listing}\n</system-reminder>`,
      });
    }

    if (prefixBlocks.length === 0) {
      return input;
    }

    const inputBlocks: MessageBlock[] = typeof input === 'string'
      ? [{ type: 'text', text: input }]
      : input;

    return [...prefixBlocks, ...inputBlocks];
  }

  private rollbackSkillNames(names: string[]): void {
    for (const name of names) {
      this.sentSkillNames.delete(name);
    }
  }
}
