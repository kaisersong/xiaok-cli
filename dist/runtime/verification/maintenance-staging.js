import { claimInstalledMaintenanceMaterialsConstruction, bindInstalledMaintenanceMaterialsConstruction, assertInstalledMaintenanceConstructionReady } from './installed-execution-stack.js';
import { join } from 'node:path';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertInstalledRootBrokerClient } from './root-broker-client.js';
import { assertInstalledSharedCapacity } from './installed-shared-capacity.js';
import { readMaintenanceEngineAttachment } from './maintenance-engine-attachment.js';
import { readMaintenanceExecution } from './maintenance-execution.js';
import { createControllerMaterialPipeline } from './material-pipeline.js';
import { createStagingFactualCleanup } from './staging-factual-cleanup.js';
/** Host-only recovery of the original staging copy. No material authorization,
 * stage/read input, normal quiescence, or execution port escapes this facade. */
const constructions = new WeakMap();
export function assertMaintenanceStagingConstruction(value, materials, construction, database) { const known = constructions.get(value); if (!known || known.construction !== construction || known.materials !== materials || known.database !== database)
    throw Error('maintenance_staging_identity'); }
export function activateInstalledMaintenanceStaging(value, construction) { const known = constructions.get(value); if (!known || known.construction !== construction)
    throw Error('maintenance_staging_identity'); assertInstalledMaintenanceConstructionReady(construction); known.activate(); }
export function createInstalledMaintenanceStaging(input) {
    const { lifetime, sharedCapacity, construction } = input;
    if (!construction)
        throw Error('installed_capacity_construction');
    claimInstalledMaintenanceMaterialsConstruction(construction, lifetime, sharedCapacity);
    const { broker, attachment, execution } = input;
    assertInstalledControllerLifetime(lifetime);
    assertInstalledRootBrokerClient(broker, lifetime);
    assertInstalledSharedCapacity(sharedCapacity, lifetime);
    const db = lifetime.database, facts = readMaintenanceEngineAttachment(attachment, lifetime);
    let closed = false, cleanup, closing;
    function current() { if (closed)
        throw Error('maintenance_staging_closed'); assertInstalledControllerLifetime(lifetime); assertInstalledSharedCapacity(sharedCapacity, lifetime); readMaintenanceEngineAttachment(attachment, lifetime); }
    function active() { current(); if (!cleanup)
        throw Error('maintenance_staging_inactive'); return cleanup; }
    const materials = createControllerMaterialPipeline({ root: join(lifetime.state, 'staging'), database: db, budget: sharedCapacity.budget, engineBinding: { engineId: facts.engineBinding.engineId, incarnation: facts.engineBinding.incarnation }, broker, assertCurrent: current, assertCleanup(id) { active().assertCleanup(id); }, resolveOwnerKey() { throw Error('maintenance_material_admission_disabled'); }, createCapacityOwnerBinding() { throw Error('maintenance_material_admission_disabled'); } });
    const result = Object.freeze({ cleanupResource(resourceId, signal) { return active().cleanupResource(resourceId, signal); }, sweepOnce() { return active().sweepOnce(); }, getStatus() { return active().getStatus(); }, close() { return closing ??= (async () => { if (cleanup)
            await cleanup.close(); closed = true; })(); } });
    constructions.set(result, { construction, database: db, materials, activate() { current(); if (cleanup)
            throw Error('maintenance_staging_active'); const binding = readMaintenanceExecution(execution, db); cleanup = createStagingFactualCleanup({ database: db, materials, raw: binding.raw, maintenance: execution, assertCurrent: current }); } });
    bindInstalledMaintenanceMaterialsConstruction(construction, result, materials);
    return result;
}
