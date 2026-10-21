/** Fixed ordinary namespace denial only. It issues no custody, completeness,
 * ownership, capacity, all-writer drain or post-seal capability. */
export declare function createKnownDirectoryWriterFence(rootDir: string, kind: 'task-root' | 'goal-file-root' | 'session-root' | 'session-alias-holder' | 'sqlite-db'): Readonly<{
    assertOpen(): void;
    persist(): void;
}>;
