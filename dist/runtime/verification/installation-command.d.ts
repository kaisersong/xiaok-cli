export declare function assertInstallationCommandIdle(scope: string): void;
export declare function runInstallationCommand(input: {
    scope: string;
    executable: string;
    argv: readonly string[];
    cwd: string;
    env: Readonly<Record<string, string>>;
    stdin?: string | Buffer;
    timeoutMs: number;
    signal?: AbortSignal;
    assertCurrent(): void;
}): Promise<Buffer>;
