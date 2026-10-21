import { join } from 'node:path';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertInstalledRootBrokerClient } from './root-broker-client.js';
import { assertInstalledSharedCapacity, registerInstalledCapacityIssuer } from './installed-shared-capacity.js';
import { readMaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { readMaintenanceExecution } from './maintenance-execution.js';
import { createControllerMaterialPipeline } from './material-pipeline.js';
import { createStagingFactualCleanup } from './staging-factual-cleanup.js';
/** Host-only recovery of the original staging copy. No material authorization,
 * stage/read input, normal quiescence, or execution port escapes this facade. */
export function createInstalledMaintenanceStaging(input) {
    const { lifetime, broker, sharedCapacity, attachment, execution } = input;
    assertInstalledControllerLifetime(lifetime);
    assertInstalledRootBrokerClient(broker, lifetime);
    assertInstalledSharedCapacity(sharedCapacity, lifetime);
    const db = lifetime.database, facts = readMaintenanceEngineAttachment(attachment, lifetime), binding = readMaintenanceExecution(execution, db);
    let closed = false, cleanup;
    function current() { if (closed)
        throw Error('maintenance_staging_closed'); assertInstalledControllerLifetime(lifetime); assertInstalledSharedCapacity(sharedCapacity, lifetime); readMaintenanceEngineAttachment(attachment, lifetime); readMaintenanceExecution(execution, db); }
    const materials = createControllerMaterialPipeline({ root: join(lifetime.state, 'staging'), database: db, budget: sharedCapacity.budget, engineBinding: { engineId: facts.engineBinding.engineId, incarnation: facts.engineBinding.incarnation }, broker, assertCurrent: current, assertCleanup(id) { if (!cleanup)
            throw Error('maintenance_staging_not_ready'); cleanup.assertCleanup(id); }, resolveOwnerKey() { throw Error('maintenance_material_admission_disabled'); }, createCapacityOwnerBinding() { throw Error('maintenance_material_admission_disabled'); } });
    registerInstalledCapacityIssuer(sharedCapacity, 'materials', materials);
    cleanup = createStagingFactualCleanup({ database: db, materials, raw: binding.raw, maintenance: execution, assertCurrent: current });
    const actual = cleanup;
    return Object.freeze({ cleanupResource: actual.cleanupResource, sweepOnce: actual.sweepOnce, getStatus: actual.getStatus, async close() { await actual.close(); closed = true; } });
}
