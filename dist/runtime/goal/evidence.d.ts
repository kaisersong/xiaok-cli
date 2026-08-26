import type { RuntimeEvent } from '../events.js';
import type { GoalEvidenceEnvelope } from './types.js';
export declare class GoalEvidenceCollector {
    private readonly input;
    private readonly facts;
    private readonly finished;
    private readonly ready;
    constructor(input: {
        goalId: string;
        epoch: number;
        goalTurnId: string;
        now?: () => number;
    });
    accept(event: RuntimeEvent): void;
    settleTurn(): void;
    flush(): GoalEvidenceEnvelope[];
    private tryPair;
}
