export type StructuralKind = 'pdf' | 'pptx';
export interface StructuralValidationResult {
    ok: boolean;
    error?: string;
}
export declare function resolveStructuralKind(filePath: string): StructuralKind | undefined;
export declare function validateArtifactStructure(filePath: string, kind: StructuralKind): StructuralValidationResult;
