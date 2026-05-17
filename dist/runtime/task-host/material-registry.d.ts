import type { MaterialParseStatus, MaterialRecord, MaterialRole, MaterialRoleSource, MaterialView } from './types.js';
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
    constructor(options: MaterialRegistryOptions);
    importMaterial(input: ImportMaterialInput): Promise<MaterialRecord>;
    get(materialId: string): MaterialRecord | undefined;
    list(taskId: string): MaterialRecord[];
    toView(record: MaterialRecord): MaterialView;
    toViews(records: MaterialRecord[]): MaterialView[];
    private createMaterialId;
    private loadIndex;
    private saveIndex;
    private indexPath;
}
export {};
