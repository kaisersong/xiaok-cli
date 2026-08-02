export interface GitObjectEntry {
    /** Git file mode, e.g. 100644 / 100755 / 120000. */
    mode: string;
    /** POSIX relative path inside the plugin root. */
    path: string;
    /** SHA-256 of the raw blob bytes read from the Git object store. */
    contentSha256: string;
}
export declare const GIT_MODE_REGULAR = "100644";
export declare const GIT_MODE_EXECUTABLE = "100755";
export declare const GIT_MODE_SYMLINK = "120000";
export declare const GIT_MODE_GITLINK = "160000";
export declare function sha256Hex(input: Buffer | string): string;
export declare function isSupportedGitMode(mode: string): boolean;
export declare function computeGitTreeSha256(entries: GitObjectEntry[]): string;
/**
 * Case-insensitive filesystems and Unicode normalization both let two distinct
 * Git entries land on one file, so a verified digest could describe bytes that
 * were never written to disk.
 */
export declare function detectPathConflicts(paths: string[]): string[];
export declare function assertSafeRelativePath(value: string, label: string): string;
export declare function assertPluginRelativePath(root: string, value: string, label?: string): string;
