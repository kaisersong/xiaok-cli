import type { MultiAgentEvent } from '../ai/agents/multi-agent-coordinator.js';
import { type SubAgentProgressEvent } from '../ai/agents/subagent-presentation.js';
import { type UiLocale } from './locale.js';
/** Preserve notice order without interleaving a question frame or streamed text. */
export declare class SubAgentNoticeQueue {
    private pending;
    get hasPending(): boolean;
    push(block: string): void;
    flush(canWrite: boolean, write: (block: string) => void): void;
}
/** A projection of coordinator events, not a second execution/status owner. */
export declare class MultiAgentProgressView {
    private readonly agents;
    private readonly aliases;
    private readonly runs;
    private alias;
    updateRun(event: SubAgentProgressEvent, columns?: number, locale?: UiLocale): string;
    update(event: MultiAgentEvent): void;
    summary(now?: number, columns?: number, locale?: UiLocale): string;
}
