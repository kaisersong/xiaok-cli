import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertDockerRunnerDatabase } from '../isolated-execution/docker-runner.js';
import { ExecutionJournal } from '../isolated-execution/execution-journal.js';
// Resource bookkeeping only: no ticket issuance, component binding, activation,
// transport operation, deletion, callback or resource getter is exposed here.
const retained = new Set();
const unresolved = new WeakMap();
export function hasUnresolvedMaintenanceExecutionConstruction(error, construction) { return typeof error === 'object' && error !== null && unresolved.get(error)?.construction === construction; }
export class MaintenanceExecutionConstruction {
    lifetime;
    construction;
    raw;
    journal;
    primary;
    cleanupErrors = [];
    phase = 'constructing';
    constructor(lifetime, construction) {
        this.lifetime = lifetime;
        this.construction = construction;
        assertInstalledControllerLifetime(lifetime);
        retained.add(this);
    }
    holdRaw(raw) {
        if (this.phase !== 'constructing' || this.raw)
            throw Error('maintenance_execution_construction');
        // Store before a current/identity check can itself fail. The sole production
        // caller passes the actual fixed factory return, never a request-provided port.
        this.raw = raw;
        assertDockerRunnerDatabase(raw, this.lifetime.database);
    }
    openJournal() {
        if (this.phase !== 'constructing' || !this.raw || this.journal)
            throw Error('maintenance_execution_construction');
        const journal = new ExecutionJournal({ database: this.lifetime.database });
        this.journal = journal;
        return journal;
    }
    commit() { if (this.phase !== 'constructing' || !this.raw || !this.journal)
        throw Error('maintenance_execution_construction'); this.phase = 'committed'; retained.delete(this); }
    dispose() {
        if (this.phase === 'failed-unknown')
            throw this.failure('maintenance_execution_disposal_unknown');
        if (this.phase === 'disposed')
            return;
        const errors = [];
        for (const close of [() => this.journal?.close(), () => this.raw?.close()])
            try {
                close();
            }
            catch (error) {
                errors.push(error);
            }
        if (errors.length) {
            this.cleanupErrors = errors;
            this.phase = 'failed-unknown';
            retained.add(this);
            throw this.failure('maintenance_execution_disposal_unknown');
        }
        this.phase = 'disposed';
        retained.delete(this);
    }
    fail(primary) {
        this.primary = primary;
        try {
            this.dispose();
        }
        catch (cleanup) {
            const failure = new AggregateError([primary, cleanup], 'maintenance_execution_partial_construction_unknown', { cause: primary });
            unresolved.set(failure, { construction: this.construction, owner: this });
            retained.add(this);
            return failure;
        }
        return primary;
    }
    failure(message) { const error = new AggregateError([...this.cleanupErrors], message, { cause: this.primary }); unresolved.set(error, { construction: this.construction, owner: this }); return error; }
}
