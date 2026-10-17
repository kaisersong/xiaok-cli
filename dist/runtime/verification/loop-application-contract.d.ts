import { type LoopContractV1 } from '../loop/contract.js';
/** Exact business description for native review. It grants no command, material
 * access or verification proof; legacy weak criteria stay weak. The ordinary
 * Desktop path continues to use the same underlying parser without this gate. */
export declare function parseStrictLoopContractV1(raw: unknown): Readonly<LoopContractV1>;
export declare const LOOP_DIAGNOSTIC_SCANNERS: readonly ["artifact-evidence-regression", "kswarm-service-health"];
export declare const LOOP_ASSISTANT_DATA_SCOPES: readonly ["threads", "projects", "tasks", "artifacts", "automations", "meetings"];
export type LoopBusinessContract = {
    version: 1;
    kind: 'builtin-diagnostic';
    scanner: typeof LOOP_DIAGNOSTIC_SCANNERS[number];
    objective: string;
    completionCriterion: string;
} | {
    version: 1;
    kind: 'user-template';
    templateKind: 'markdown_file' | 'task_completion';
    prompt: string;
    outputDirectory: string;
    outputFileName: string;
    loopContract: Readonly<LoopContractV1>;
} | {
    version: 1;
    kind: 'assistant';
    assistantKind: 'evening' | 'morning';
    profileId: 'default-personal-assistant';
    locale: 'zh' | 'en';
    timeZone: string;
    dataScopes: readonly (typeof LOOP_ASSISTANT_DATA_SCOPES[number])[];
    objective: string;
    completionCriterion: string;
};
/** Complete producer business description only. Explicit recipes, OS permissions
 * and native approval are separate authorities. This parser never invents them.
 * The final native review also checks its whole ASCII-safe envelope size. */
export declare function parseLoopBusinessContract(raw: unknown): Readonly<LoopBusinessContract>;
export declare function loopBusinessContractHash(raw: unknown): string;
