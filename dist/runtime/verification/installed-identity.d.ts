/** Uses real filesystem ownership/ACL facts; this alone is not a whole deployment qualification. */
export declare function assertRootProtectedExecutable(input: string): void;
export declare function assertRootProtectedFile(input: string): void;
export declare function assertInstalledControllerIdentity(input: {
    serviceUid: number;
    interactiveUids: readonly number[];
    executable: string;
    stateRoot: string;
}): void;
