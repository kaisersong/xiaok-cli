import { assertStorageOwnerSchema } from './storage-owner-schema.js';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { assertRootProtectedFile, assertRootProtectedExecutable, assertInstalledControllerIdentity } from './installed-identity.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { acquireControllerLifetimeLock } from './controller-lifetime-lock.js';
import { openPrivateVerificationDatabase } from './private-database.js';
const failedConstructionLocks = new Set();
const installedLifetimes = new WeakMap();
export function assertInstalledControllerLifetime(value) { const current = installedLifetimes.get(value); if (!current)
    throw Error('controller_lifetime_identity'); current(); }
export function createInstalledControllerLifetime() {
    if (arguments.length)
        throw Error('controller_lifetime_arguments');
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
        throw Error('controller_lifetime_platform');
    const base = '/Library/Application Support/xiaok-verification', state = join(base, 'state'), manifestPath = join(base, 'deployment.json');
    assertRootProtectedFile(manifestPath);
    if (lstatSync(manifestPath).size > 65536)
        throw Error('controller_lifetime_manifest');
    const manifestBytes = readFileSync(manifestPath), manifest = parseInstalledDeploymentManifest(JSON.parse(manifestBytes.toString('utf8'))), release = join(base, 'releases', manifest.packageHash), executable = join(release, 'bin/node');
    const checkIdentity = () => assertInstalledControllerIdentity({ serviceUid: manifest.serviceUid, interactiveUids: manifest.allowedUserIds, executable, stateRoot: state });
    checkIdentity();
    const inventoryPath = join(base, 'releases', manifest.packageHash + '.json');
    assertRootProtectedFile(inventoryPath);
    if (lstatSync(inventoryPath).size > 8 * 1024 ** 2)
        throw Error('controller_lifetime_inventory');
    const inventory = parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')));
    if (inventory.packageHash !== manifest.packageHash)
        throw Error('controller_lifetime_package');
    verifyDeploymentPackage(release, inventory);
    const controllerFile = join(release, 'app/controller.cjs'), peerHelper = join(release, 'bin/socket-audit-peer');
    assertRootProtectedFile(controllerFile);
    assertRootProtectedExecutable(peerHelper);
    const lock = acquireControllerLifetimeLock(state);
    let database;
    try {
        const keyPath = join(state, 'authority-key.pem');
        const initial = lstatSync(keyPath);
        function keyBytes() { const stat = lstatSync(keyPath); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== manifest.serviceUid || (stat.mode & 0o777) !== 0o600 || stat.size > 8192 || stat.dev !== initial.dev || stat.ino !== initial.ino)
            throw Error('controller_lifetime_key'); return readFileSync(keyPath); }
        const raw = keyBytes(), privateKey = createPrivateKey(raw), publicKey = createPublicKey(privateKey);
        if (privateKey.asymmetricKeyType !== 'ed25519' || !publicKey.export({ format: 'der', type: 'spki' }).equals(createPublicKey(manifest.publicKeyPem).export({ format: 'der', type: 'spki' })))
            throw Error('controller_lifetime_key_binding');
        const keyHash = createHash('sha256').update(raw).digest('hex');
        raw.fill(0);
        database = openPrivateVerificationDatabase(state);
        assertStorageOwnerSchema(database, manifest);
        const db = database;
        let closed = false, invalidated = false;
        function current() { if (invalidated)
            throw Error('controller_lifetime_invalidated'); try {
            if (closed || !db.open)
                throw Error('controller_lifetime_closed');
            lock.assertCurrent();
            checkIdentity();
            assertRootProtectedFile(manifestPath);
            if (!readFileSync(manifestPath).equals(manifestBytes))
                throw Error('controller_lifetime_manifest_changed');
            const bytes = keyBytes();
            try {
                if (createHash('sha256').update(bytes).digest('hex') !== keyHash)
                    throw Error('controller_lifetime_key_changed');
            }
            finally {
                bytes.fill(0);
            }
        }
        catch (error) {
            invalidated = true;
            throw error;
        } }
        current();
        const result = Object.freeze({ base, state, release, manifest, database: db, privateKey, publicKey, serviceEpoch: randomUUID(), peerHelper, assertCurrent: current,
            close() { if (closed)
                return; /* Caller first stops admission and drains all users. */ /* Caller first stops admission and drains all users. */ db.close(); lock.close(); closed = true; },
        });
        installedLifetimes.set(result, current);
        return result;
    }
    catch (error) {
        const retained = { database, lock };
        failedConstructionLocks.add(retained);
        try {
            database?.close();
            lock.close();
            failedConstructionLocks.delete(retained);
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'controller_lifetime_cleanup_unknown', { cause: error });
        }
        throw error;
    }
}
