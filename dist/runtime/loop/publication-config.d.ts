import { type GoalVerificationDefinition } from '../goal/verification-definition.js';
import type { LoopStageKind } from './producer-types.js';
export type LoopPublicationContractDefinition = {
    kind: 'builtin-diagnostic';
    scanner: 'artifact-evidence-regression' | 'kswarm-service-health';
    objective: string;
    completionCriterion: string;
} | {
    kind: 'assistant';
    assistantKind: 'evening' | 'morning';
    objective: string;
    completionCriterion: string;
} | {
    kind: 'user-template';
};
export interface LoopPublicationConfiguration {
    version: 1;
    contract: LoopPublicationContractDefinition;
    verificationDefinitions: {
        run: Readonly<GoalVerificationDefinition>;
        stages: Partial<Record<LoopStageKind, Readonly<GoalVerificationDefinition>>>;
    };
}
export interface StoredLoopPublicationConfiguration {
    loopId: string;
    revision: number;
    configuration: Readonly<LoopPublicationConfiguration>;
    createdAt: number;
    updatedAt: number;
}
export declare function freezeLoopPublicationValue<T>(value: T): Readonly<T>;
/** Explicit configuration only; recipes use the existing independent-definition
 * parser. No default criteria or completion proof is created here. */
export declare function parseLoopPublicationConfiguration(raw: unknown): Readonly<LoopPublicationConfiguration>;
