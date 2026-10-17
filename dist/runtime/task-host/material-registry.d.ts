import type { MaterialParseStatus, MaterialRecord, MaterialRole, MaterialRoleSource, MaterialView } from './types.js';
interface MaterialExtractionUpdate {
    extractedTextPath?: never;
    extractorVersion?: number;
    parseStatus: MaterialParseStatus;
    parseSummary?: string;
    errorMessage?: string;
    extractionEngine?: string;
    extractionEngineVersion?: string;
    extractionTruncated?: boolean;
    sourceFingerprint?: string;
    extractionErrorCode?: string;
}
interface MaterialRegistryOptions {
    workspaceRoot: string;
    maxBytes: number;
    now?: () => number;
}
interface ImportMaterialInput {
    taskId: string;
    sourcePath: string;
    role: MaterialRole;
    roleSource: MaterialRoleSource;
    parseStatus?: MaterialParseStatus;
    parseSummary?: string;
}
export declare class MaterialRegistry {
    private readonly options;
    private readonly records;
    private nextOrdinal;
    private indexEnvelope;
    private indexWritable;
    private indexFailure;
    private closing;
    constructor(options: MaterialRegistryOptions);
    importMaterial(input: ImportMaterialInput): Promise<MaterialRecord>;
    sealAndDrainInstanceMutations(): Promise<void>;
    get(materialId: string): MaterialRecord | undefined;
    list(taskId: string): MaterialRecord[];
    updateMaterialExtraction(materialId: string, extraction: MaterialExtractionUpdate): Promise<MaterialRecord>;
    updateMaterialExtraction(materialId: string, extraction: MaterialExtractionUpdate & {
        parseStatus: 'parsed';
    }, text: string): Promise<MaterialRecord>;
    toView(record: MaterialRecord): MaterialView;
    toViews(records: MaterialRecord[]): MaterialView[];
    private assertIndexWritable;
    private createMaterialId;
    private extractionTarget;
    private loadIndex;
    private saveIndex;
    private indexPath;
}
export {};
