import type { MaterialParseStatus } from '../task-host/types.js';
export type OfficeTextExtractionResult = {
    ok: true;
    markdown: string;
    format: string;
    engine: 'anydoc';
    engineVersion: string;
    chars: number;
    truncated: boolean;
} | {
    ok: false;
    code: string;
    message: string;
    retryable: boolean;
};
export interface MaterialTextExtractionInput {
    workspacePath: string;
    mimeType: string;
    maxChars?: number;
    /**
     * PDF text extraction is a host capability, not a built-in: Desktop ships
     * pdfjs, the CLI does not. Hosts that omit it keep the unsupported contract.
     */
    pdfToText?: (bytes: Uint8Array) => Promise<string>;
    officeToMarkdown?: (input: {
        absolutePath: string;
        maxOutputChars: number;
        signal?: AbortSignal;
    }) => Promise<OfficeTextExtractionResult>;
    signal?: AbortSignal;
}
export interface MaterialTextExtractionResult {
    parseStatus: MaterialParseStatus;
    text?: string;
    parseSummary?: string;
    errorMessage?: string;
    errorCode?: string;
    engine?: 'anydoc' | 'lightweight-ooxml' | 'builtin-text' | 'pdf';
    engineVersion?: string;
    truncated?: boolean;
}
/**
 * Bump whenever extraction output changes. Callers that persist extracted text
 * compare this against the version their cache was written with; a mismatch
 * means the cache predates the current algorithm and must be discarded.
 *
 * 2: pptx paragraph grouping, xlsx sparse-column placement, boolean cells.
 */
export declare const MATERIAL_EXTRACTOR_VERSION = 3;
export declare function extractMaterialText(input: MaterialTextExtractionInput): Promise<MaterialTextExtractionResult>;
