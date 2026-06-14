import type { MaterialParseStatus } from '../task-host/types.js';
export interface MaterialTextExtractionInput {
    workspacePath: string;
    mimeType: string;
    maxChars?: number;
}
export interface MaterialTextExtractionResult {
    parseStatus: MaterialParseStatus;
    text?: string;
    parseSummary?: string;
    errorMessage?: string;
}
export declare function extractMaterialText(input: MaterialTextExtractionInput): Promise<MaterialTextExtractionResult>;
