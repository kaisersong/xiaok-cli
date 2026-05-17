import type { MaterialRecord, TaskUnderstanding } from './types.js';
interface BuildTaskUnderstandingInput {
    prompt: string;
    materials: MaterialRecord[];
}
export declare function buildTaskUnderstanding(input: BuildTaskUnderstandingInput): TaskUnderstanding;
export {};
