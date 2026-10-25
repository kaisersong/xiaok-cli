import type { RuntimeHooks } from '../hooks.js';
import { SessionIntentDelegationStore } from './store.js';
import { SessionSkillEvalStore } from './skill-eval-store.js';
import { FileSkillScoreStore } from './skill-score-store.js';
export interface SkillEvalRuntimeSyncOptions {
    hooks: RuntimeHooks;
    ledgerStore: SessionIntentDelegationStore;
    skillEvalStore: SessionSkillEvalStore;
    scoreStore: FileSkillScoreStore;
    sessionId: string;
    onError?: (error: unknown) => void;
}
export declare function wireSkillEvalToRuntimeSync(options: SkillEvalRuntimeSyncOptions): () => Promise<void>;
