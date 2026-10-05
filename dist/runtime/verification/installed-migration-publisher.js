import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertInstalledControllerIdentity, assertRootProtectedFile } from './installed-identity.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { canonicalVerificationJson } from './protocol.js';
import { assertServiceProtectedMarkerPath } from './migration-markers.js';
import { createProfileIndexPublisher, parsePublicProfileIndex } from './profile-index-publication.js';
import { createMigrationMarkerJournal } from './migration-marker-journal.js';
/** Sole protected-controller composition. The caller supplies the real private
 * authorization/import receipt verifier; this method is never registered as RPC.
 * Paths, identity, executable, marker namespace and database location are fixed.
 */
function installedMarkerContext(database) {
    if (!['darwin', 'linux'].includes(process.platform))
        throw Error('migration_installed_platform');
    const base = process.platform === 'darwin' ? '/Library/Application Support/xiaok-verification' : '/var/lib/xiaok-verification';
    const manifestPath = join(base, 'deployment.json'), state = join(base, 'state'), root = join(base, 'migrations');
    function readManifest() { assertRootProtectedFile(manifestPath); if (lstatSync(manifestPath).size > 65536)
        throw Error('migration_installed_manifest'); return parseInstalledDeploymentManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))); }
    const manifest = readManifest(), frozenManifest = canonicalVerificationJson(manifest), executable = join(base, 'releases', manifest.packageHash, 'bin', 'node');
    function current() {
        if (canonicalVerificationJson(readManifest()) !== frozenManifest)
            throw Error('migration_installed_changed');
        assertInstalledControllerIdentity({ serviceUid: manifest.serviceUid, interactiveUids: manifest.allowedUserIds, executable, stateRoot: state });
        if (resolve(database.name) !== join(state, 'authority.sqlite') || !database.open)
            throw Error('migration_installed_database');
        assertServiceProtectedMarkerPath(root, { root, serviceUid: manifest.serviceUid, kind: 'directory' });
    }
    current();
    return { root, database, authorityId: manifest.authorityId, serviceUid: manifest.serviceUid, assertCurrent: current };
}
export function createInstalledMigrationMarkerPublisher(input) {
    const context = installedMarkerContext(input.database);
    return createMigrationMarkerJournal({ ...context, assertAuthorized: input.assertAuthorized });
}
export function createInstalledProfileIndexPublisher(input) {
    const lifetime = input.lifetime;
    assertInstalledControllerLifetime(lifetime);
    const { base, state, database, manifest } = lifetime, root = join(base, 'migrations'), manifestPath = join(base, 'deployment.json'), frozenManifest = canonicalVerificationJson(manifest), executable = join(base, 'releases', manifest.packageHash, 'bin', 'node');
    function current() {
        assertInstalledControllerLifetime(lifetime);
        assertRootProtectedFile(manifestPath);
        if (lstatSync(manifestPath).size > 65536 || canonicalVerificationJson(parseInstalledDeploymentManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))) !== frozenManifest)
            throw Error('migration_installed_changed');
        assertInstalledControllerIdentity({ serviceUid: manifest.serviceUid, interactiveUids: manifest.allowedUserIds, executable, stateRoot: state });
        if (resolve(state) !== join(base, 'state') || resolve(database.name) !== join(state, 'authority.sqlite') || !database.open)
            throw Error('migration_installed_database');
        assertServiceProtectedMarkerPath(root, { root, serviceUid: manifest.serviceUid, kind: 'directory' });
        assertInstalledControllerLifetime(lifetime);
    }
    current();
    const context = { root, database, authorityId: manifest.authorityId, serviceUid: manifest.serviceUid, assertCurrent: current }, publisher = createProfileIndexPublisher(context);
    function check(raw) {
        const index = parsePublicProfileIndex(raw);
        context.assertCurrent();
        const directory = join(context.root, 'principals'), path = join(directory, String(index.uid) + '.json');
        for (const [target, kind] of [[directory, 'directory'], [path, 'file']]) {
            try {
                lstatSync(target);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    continue;
                throw error;
            }
            assertServiceProtectedMarkerPath(target, { root: context.root, serviceUid: context.serviceUid, kind });
        }
        return index;
    }
    return Object.freeze({ publish(raw) { const index = check(raw); publisher.publish(index); check(index); }, assertPublished(raw) { const index = check(raw); publisher.assertPublished(index); check(index); } });
}
