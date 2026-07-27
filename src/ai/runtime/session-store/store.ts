import type { Message, MessageBlock, UsageStats } from '../../../types.js';
import type { CompactionRecord } from '../session.js';
import type { SessionIntentLedger } from '../../../runtime/intent-delegation/types.js';
import type { SessionSkillEvalState } from '../../../runtime/intent-delegation/skill-eval.js';
import type { SessionSkillExecutionState } from '../../skills/execution-state.js';

export interface PersistedSessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  forkedFromSessionId?: string;
  lineage: string[];
  messages: Message[];
  usage: UsageStats;
  compactions: CompactionRecord[];
  promptSnapshotId?: string;
  memoryRefs: string[];
  approvalRefs: string[];
  backgroundJobRefs: string[];
  intentDelegation?: SessionIntentLedger;
  skillEval?: SessionSkillEvalState;
  skillExecution?: SessionSkillExecutionState;
}

export interface SessionListEntry {
  sessionId: string;
  cwd: string;
  updatedAt: number;
  preview: string;
}

export const KIMI_K3_DURABLE_RESUME_UNSUPPORTED =
  'KIMI_K3_DURABLE_RESUME_UNSUPPORTED';

export class KimiK3DurableResumeUnsupportedError extends Error {
  readonly code = KIMI_K3_DURABLE_RESUME_UNSUPPORTED;

  constructor() {
    super(KIMI_K3_DURABLE_RESUME_UNSUPPORTED);
    this.name = 'KimiK3DurableResumeUnsupportedError';
  }
}

export function isKimiK3DurableModel(
  model: string | undefined,
): model is 'k3' | 'k3-256k' {
  return model === 'k3' || model === 'k3-256k';
}

export function toDurableSessionSnapshot(
  snapshot: PersistedSessionSnapshot,
): PersistedSessionSnapshot {
  const messages = structuredClone(snapshot.messages);
  const strictKimiModel = isKimiK3DurableModel(snapshot.model);

  return {
    ...snapshot,
    messages: messages.map((message) => ({
      ...message,
      content: message.content.flatMap((block) => {
        const officialKimiReasoning = block.type === 'thinking'
          && block.reasoningProvenance?.captureVersion === 1
          && block.reasoningProvenance.source === 'reasoning_content';
        if (
          block.type === 'thinking'
          && (strictKimiModel || officialKimiReasoning)
        ) {
          return [];
        }
        if (!strictKimiModel) {
          return [block];
        }
        const durableBlock = block as MessageBlock & {
          reasoningProvenance?: unknown;
        };
        delete durableBlock.reasoningProvenance;
        return [durableBlock];
      }),
    })),
  };
}

export function assertKimiK3DurableResumeSupported(
  snapshot: PersistedSessionSnapshot,
): void {
  if (
    isKimiK3DurableModel(snapshot.model)
    && snapshot.messages.some((message) => message.role === 'assistant')
  ) {
    throw new KimiK3DurableResumeUnsupportedError();
  }
}

export function assertKimiK3TargetResumeSupported(
  strictKimiTarget: boolean,
  snapshot: PersistedSessionSnapshot,
): void {
  if (
    (strictKimiTarget || isKimiK3DurableModel(snapshot.model))
    && snapshot.messages.some((message) => message.role === 'assistant')
  ) {
    throw new KimiK3DurableResumeUnsupportedError();
  }
}

export interface SessionStore {
  save(snapshot: PersistedSessionSnapshot): Promise<void>;
  load(sessionId: string): Promise<PersistedSessionSnapshot | null>;
  loadLast(): Promise<PersistedSessionSnapshot | null>;
  list(): Promise<SessionListEntry[]>;
  fork(sessionId: string): Promise<PersistedSessionSnapshot>;
}
