import { assertKSwarmSqlIntegrity } from './kswarm-sql-integrity.js';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertStorageOwnerSchema } from './storage-owner-schema.js';
const capabilities = new WeakMap();
/** Only the actual fixed installed lifetime can issue this private capability. */
export function createInstalledKSwarmEnrollmentCapability(lifetime) {
    assertInstalledControllerLifetime(lifetime);
    assertStorageOwnerSchema(lifetime.database, lifetime.manifest);
    if (lifetime.manifest.version !== 3)
        return undefined;
    if (lifetime.manifest.completionOwnerSchema !== 2)
        throw Error('kswarm_enrollment_schema');
    const database = lifetime.database, epoch = lifetime.serviceEpoch, manifest = lifetime.manifest, token = Object.freeze({});
    capabilities.set(token, () => { assertInstalledControllerLifetime(lifetime); if (lifetime.database !== database || lifetime.serviceEpoch !== epoch || lifetime.manifest !== manifest)
        throw Error('kswarm_enrollment_capability'); assertStorageOwnerSchema(database, manifest); assertKSwarmSqlIntegrity(database); });
    capabilityDatabases.set(token, database);
    return token;
}
const capabilityDatabases = new WeakMap();
export function assertKSwarmEnrollmentCapability(token, database) {
    const check = token && capabilities.get(token);
    if (!check || !token || capabilityDatabases.get(token) !== database)
        throw Error('kswarm_enrollment_capability');
    check();
}
