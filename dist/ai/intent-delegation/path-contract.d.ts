export interface StagePathHintInput {
    stageId?: string;
    order: number;
    deliverable: string;
}
export interface SuggestedOutputPath {
    stageId?: string;
    deliverable: string;
    path: string;
}
export declare function extractProvidedSourcePaths(rawIntent: string): string[];
export declare function stripProvidedSourcePaths(rawIntent: string, sourcePaths: string[]): string;
export declare function buildSuggestedOutputPaths(input: {
    sourcePaths: string[] | undefined;
    stages: StagePathHintInput[] | undefined;
}): SuggestedOutputPath[];
