export type AheLiveFailureClass = 'pass' | 'product' | 'infra' | 'timeout' | 'skipped';
export interface AheLiveSmokeCommandResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut?: boolean;
}
export interface AheLiveSmokeCheck {
    id: 'tmux' | 'desktop-ipc' | 'kswarm-restart' | string;
    label: string;
    command: string[];
    timeoutMs?: number;
    run?: () => Promise<AheLiveSmokeCommandResult>;
}
export interface AheLiveSmokeResult {
    id: string;
    label: string;
    command: string[];
    ok: boolean;
    failureClass: AheLiveFailureClass;
    durationMs: number;
    exitCode: number | null;
    stdoutPreview: string;
    stderrPreview: string;
}
export interface AheLiveSmokeSummary {
    schemaVersion: 1;
    generatedAt: string;
    recommendation: 'ship' | 'revise' | 'inconclusive';
    skipReason?: string;
    results: AheLiveSmokeResult[];
}
export declare function createDefaultAheLiveSmokeChecks(): AheLiveSmokeCheck[];
export declare function runAheLiveSmokeGate(input: {
    outputPath: string;
    checks: AheLiveSmokeCheck[];
    now?: () => Date;
    skipReason?: string;
}): Promise<AheLiveSmokeSummary>;
