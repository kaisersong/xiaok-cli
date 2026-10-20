import type { TaskSnapshot } from '../task-host/types.js';
import type { WorkWatch } from './types.js';
/** Final disclosure reads current durable identity, including the journal.
 * Async observer/executor caches cannot certify this later send boundary. */
export declare function readCurrentActivityTask(dataRoot: string, watch: WorkWatch): TaskSnapshot;
