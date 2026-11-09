import type {SpawnOptions} from 'node:child_process';
import type {WorkerOptions} from 'node:worker_threads';

interface OriginalProcessSourceIdentity {
    readonly kind: 'original_process_source_request_v1';
    readonly sourceKind: 'office_document_process' | 'pdf_text_worker' | 'codex_transport' | 'workflow_tool_process' | 'workflow_vm';
    readonly context: object;
    readonly invocationId: string;
    readonly specHash: string;
    readonly domain: 'component_only' | 'sealed_worker';
    readonly signal?: AbortSignal;
    readonly initialFrameBase64?: string;
    assertCurrent(): void;
    assertLocal(): void;
}

/** Data returned only by the original pinned Owner's fixed private readers.
 * This TypeScript shape, a context, or a path is never an authority itself. */
export type OriginalProcessSourceRequest = OriginalProcessSourceIdentity & (
    | {readonly operation: 'spawn'; readonly command: string; readonly argv: readonly string[]; readonly options: Readonly<SpawnOptions>}
    | {readonly operation: 'worker'; readonly entry: string; readonly options: Readonly<WorkerOptions>}
);
