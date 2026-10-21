/** Explicit user-selected files only. This runs as the product's user, not the
 * privileged service. Controller must independently prove caller access; these
 * paths and sizes are a request, never an authorization or OS attestation. */
export declare function selectExplicitValidationFiles(paths: readonly string[], cwd: string): Array<{
    path: string;
    byteLimit: number;
}>;
