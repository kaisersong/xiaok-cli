import type { InstalledControllerLifetime } from './installed-controller-lifetime.js';
import { type createDockerRunner } from '../isolated-execution/docker-runner.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';
export declare function hasUnresolvedMaintenanceExecutionConstruction(error: unknown, construction: object): boolean;
export declare class MaintenanceExecutionConstruction {
    private readonly lifetime;
    private readonly construction;
    private raw;
    private journal;
    private primary;
    private cleanupErrors;
    private phase;
    constructor(lifetime: InstalledControllerLifetime, construction: object | undefined);
    holdRaw(raw: ReturnType<typeof createDockerRunner>): void;
    openJournal(): ExecutionJournal;
    commit(): void;
    dispose(): void;
    fail(primary: unknown): unknown;
    private failure;
}
