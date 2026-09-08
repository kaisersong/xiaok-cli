export type StructuralKind = 'pdf' | 'pptx';
export interface StructuralValidationResult {
    ok: boolean;
    error?: string;
}
export declare function resolveStructuralKind(filePath: string): StructuralKind | undefined;
export declare function validateArtifactStructure(filePath: string, kind: StructuralKind): StructuralValidationResult;
/** Shared byte rules; async delivery uses the same bounded reads and predicates. */
export declare function validateArtifactBytes(kind: StructuralKind, buf: Buffer, bytesRead: number): StructuralValidationResult;
