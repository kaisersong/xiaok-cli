/**
 * CanonicalTreeMerkle (design v58 §4.4; R38-02).
 *
 * One production tree hasher shared by source snapshots, the slide Python
 * closure and every runtime generation. Hand-rolled walkers were the reason the
 * design kept discovering holes, so the rules are fixed here:
 *
 *  - traversal is `lstat`/no-follow, entries sorted by normalised POSIX path;
 *  - entries are a tagged union: directory{path,mode}, file{path,mode,size,sha256},
 *    symlink{path,mode,rawTargetBytesSha256,normalizedTarget};
 *  - a symlink hashes its raw `readlink` bytes plus the normalised target, and its
 *    resolved target must stay inside the tree root — so re-pointing an internal
 *    link at another file inside the root still changes the digest;
 *  - sockets/devices/FIFOs are rejected, and so is any `nlink > 1` hardlink,
 *    because their alias semantics are not frozen;
 *  - the root digest covers a schema tag and the entry count, so a truncated or
 *    re-encoded entry list cannot collide with a valid one.
 */
export declare const CANONICAL_TREE_MERKLE_SCHEMA = "xiaok-canonical-tree-merkle-v1";
export type CanonicalTreeEntry = {
    kind: 'directory';
    path: string;
    mode: string;
} | {
    kind: 'file';
    path: string;
    mode: string;
    size: number;
    sha256: string;
} | {
    kind: 'symlink';
    path: string;
    mode: string;
    rawTargetBytesSha256: string;
    normalizedTarget: string;
};
export interface CanonicalTree {
    readonly schema: typeof CANONICAL_TREE_MERKLE_SCHEMA;
    readonly root: string;
    readonly entryCount: number;
    readonly entries: readonly CanonicalTreeEntry[];
}
export declare class CanonicalTreeRejectedError extends Error {
    readonly code: string;
    constructor(code: string, detail: string);
}
export declare function walkCanonicalTree(rootDir: string): CanonicalTreeEntry[];
export declare function canonicalTreeRoot(entries: readonly CanonicalTreeEntry[]): string;
export declare function hashCanonicalTree(rootDir: string): CanonicalTree;
/**
 * Triple-hash materialisation check (design R38-01): the input must be identical
 * before and after the copy, and the snapshot must match it. Anything else means
 * the input changed while we copied and the candidate must be discarded.
 */
export declare function assertStableMaterialisation(input: {
    before: CanonicalTree;
    after: CanonicalTree;
    snapshot: CanonicalTree;
}): void;
