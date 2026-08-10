import type { MaterialParseStatus } from '../task-host/types.js';
export interface MaterialTextExtractionInput {
    workspacePath: string;
    mimeType: string;
    maxChars?: number;
    /**
     * PDF text extraction is a host capability, not a built-in: Desktop ships
     * pdfjs, the CLI does not. Hosts that omit it keep the unsupported contract.
     */
    pdfToText?: (bytes: Uint8Array) => Promise<string>;
}
export interface MaterialTextExtractionResult {
    parseStatus: MaterialParseStatus;
    text?: string;
    parseSummary?: string;
    errorMessage?: string;
}
/**
 * Bump whenever extraction output changes. Callers that persist extracted text
 * compare this against the version their cache was written with; a mismatch
 * means the cache predates the current algorithm and must be discarded.
 *
 * 2: pptx paragraph grouping, xlsx sparse-column placement, boolean cells.
 */
export declare const MATERIAL_EXTRACTOR_VERSION = 2;
export declare function extractMaterialText(input: MaterialTextExtractionInput): Promise<MaterialTextExtractionResult>;
