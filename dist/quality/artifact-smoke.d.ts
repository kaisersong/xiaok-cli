export type ArtifactSmokeKind = 'auto' | 'markdown' | 'html' | 'json' | 'pptx' | 'unknown';
export interface ArtifactSmokeCheckInput {
    artifactPath: string;
    sourcePaths?: string[];
    expectedKind?: ArtifactSmokeKind;
}
export interface ArtifactSmokeCheckResult {
    ok: boolean;
    artifactPath: string;
    resolvedArtifactPath: string;
    kind: Exclude<ArtifactSmokeKind, 'auto'>;
    sizeBytes: number;
    errors: string[];
}
export declare function checkArtifactSmoke(input: ArtifactSmokeCheckInput): ArtifactSmokeCheckResult;
export declare function resolveArtifactKind(artifactPath: string, expectedKind?: ArtifactSmokeKind): Exclude<ArtifactSmokeKind, 'auto'>;
