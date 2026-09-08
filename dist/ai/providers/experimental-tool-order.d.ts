import type { OpenAIHarnessContext } from './model-harness-profile.js';
export interface ExperimentalToolOrder {
    readonly baseUrl: string;
    readonly model: string;
    readonly order: 'name';
}
/** Explicit experiment only. Invalid/off settings never affect normal startup. */
export declare function parseExperimentalToolOrder(raw: string | undefined): Readonly<ExperimentalToolOrder> | null;
/** Change only the newly constructed request array; never mutate a registry or input schema. */
export declare function applyExperimentalToolOrder<T extends {
    type: string;
    function?: {
        name: string;
    };
}>(tools: T[], config: Readonly<ExperimentalToolOrder> | null, context: OpenAIHarnessContext, actualClientBaseUrl: string): T[];
