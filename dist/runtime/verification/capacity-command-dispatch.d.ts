import type { Database } from 'better-sqlite3';
import type { CapacityWriteContext, PreparedCapacityCommandFacts } from './capacity-command.js';
/** Closed, compiled dispatch. Adding a producer requires its original private
 * issuer and a fixed handler; callers cannot register handlers or SQL. */
export declare function inspectPreparedCapacityCommand(command: object, budget: object, database: Database): Readonly<PreparedCapacityCommandFacts & {
    issuerFamily: 'transcript' | 'run' | 'material' | 'raw' | 'qualification-probe' | 'artifact-batch';
}>;
export declare function executePreparedCapacityCommand(command: object, context: CapacityWriteContext): void;
