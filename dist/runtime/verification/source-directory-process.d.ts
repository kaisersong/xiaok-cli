export interface DirectoryCustodySource {
    readonly kind: 'session-root' | 'task-root' | 'goal-file-root' | 'profile-registry' | 'session-alias-holder';
    readonly directory: Readonly<{
        canonicalPath: string;
        device: string;
        inode: string;
    }>;
}
export interface DirectorySourceEntry {
    readonly sourceIndex: number;
    readonly path: string;
    readonly kind: 'file' | 'directory' | 'source-reference';
    readonly byteLength: number;
    readonly physicalSize: string;
    readonly device: string;
    readonly inode: string;
    readonly mode: number;
    readonly sha256?: string;
}
/** Private leaf driver. Captured facts are not native approval, all-source
 * custody, effect drain or a capacity permit. The installed caller pins the
 * helper and keeps every source child alive through the full-set commit. */
export declare function startDirectorySourceCustody(input: {
    executable: string;
    uid: number;
    sources: readonly DirectoryCustodySource[];
    references?: readonly {
        sourceIndex: number;
        path: string;
        device: string;
        inode: string;
    }[];
    signal: AbortSignal;
}): Promise<Readonly<{
    checkCurrent(): Promise<void>;
    capture(maximumBytes?: number, maximumMetadataBytes?: number): Promise<Readonly<{}>>;
    close: () => Promise<void>;
}>>;
export declare function readDirectorySourceCapture(owner: object, token: object): readonly Readonly<DirectorySourceEntry>[];
export declare function readDirectorySourceFile(owner: object, token: object, index: number): Buffer;
export declare function readDirectorySourceFileRange(owner: object, token: object, index: number, offset: number, length: number): Buffer;
export declare function readDirectorySourceMetadataBytes(owner: object, token: object): number;
