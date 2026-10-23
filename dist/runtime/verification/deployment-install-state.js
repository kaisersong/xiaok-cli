import { generateKeyPairSync, randomUUID, createHash } from 'node:crypto';
import { openSync, closeSync, writeFileSync, fsyncSync, lstatSync, mkdirSync, existsSync, chownSync, chmodSync, readFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { parseInstalledReceiverRegistration } from './installed-receiver-registration.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
/** Explicit installer action, never startup self-elevation. Root account creation and
 * reviewable package staging precede this call; interrupted installation is not auto-repaired. */
export function initializeInstalledMacState(packageHash, expectedServiceUid, expectedReceiverUid) {
    if (process.platform !== 'darwin' || process.getuid?.() !== 0 || process.geteuid?.() !== 0)
        throw Error('deployment_root_required');
    if (!/^[a-f0-9]{64}$/.test(packageHash) || !Number.isSafeInteger(expectedServiceUid) || expectedServiceUid < 1 || !Number.isSafeInteger(expectedReceiverUid) || expectedReceiverUid < 1 || expectedReceiverUid === expectedServiceUid)
        throw Error('deployment_identity');
    const base = '/Library/Application Support/xiaok-verification', release = join(base, 'releases', packageHash), inventoryPath = join(base, 'releases', packageHash + '.json');
    assertRootProtectedFile(inventoryPath);
    const inventory = parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')));
    if (inventory.packageHash !== packageHash)
        throw Error('deployment_package');
    verifyDeploymentPackage(release, inventory);
    assertRootProtectedExecutable('/usr/bin/id');
    const id = spawnSync('/usr/bin/id', ['-u', '_xiaok_verifier'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
    const gid = spawnSync('/usr/bin/id', ['-g', '_xiaok_verifier'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
    if (id.error || gid.error || id.status !== 0 || gid.status !== 0 || Number(id.stdout.trim()) !== expectedServiceUid || Number(gid.stdout.trim()) !== expectedServiceUid)
        throw Error('deployment_identity');
    const receiverId = spawnSync('/usr/bin/id', ['-u', '_xiaok_receiver'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }), receiverGid = spawnSync('/usr/bin/id', ['-g', '_xiaok_receiver'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
    if (receiverId.error || receiverGid.error || receiverId.status !== 0 || receiverGid.status !== 0 || Number(receiverId.stdout.trim()) !== expectedReceiverUid || Number(receiverGid.stdout.trim()) !== expectedReceiverUid)
        throw Error('deployment_receiver_identity');
    const userUid = lstatSync('/dev/console').uid;
    if (userUid < 1 || userUid === expectedServiceUid || userUid === expectedReceiverUid)
        throw Error('deployment_interactive_user');
    const state = join(base, 'state');
    const stat = lstatSync(state);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== expectedServiceUid || (stat.mode & 0o077) !== 0)
        throw Error('deployment_state');
    const receiverState = join(base, 'receiver-state'), receiverStat = lstatSync(receiverState);
    if (!receiverStat.isDirectory() || receiverStat.isSymbolicLink() || receiverStat.uid !== expectedReceiverUid || (receiverStat.mode & 0o077) !== 0)
        throw Error('deployment_receiver_state');
    for (const path of [join(state, 'authority-key.pem'), join(receiverState, 'receiver-key.pem'), join(base, 'deployment.json'), join(base, 'receiver.json'), ...['public', 'migrations', 'receiver'].map(name => join(base, name))]) {
        try {
            lstatSync(path);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                continue;
            throw error;
        }
        throw Error('deployment_existing_state');
    }
    for (const name of ['public', 'migrations', 'receiver']) {
        const path = join(base, name);
        if (existsSync(path))
            throw Error('deployment_existing_state');
        mkdirSync(path, { mode: 0o755 });
        chownSync(path, name === 'receiver' ? expectedReceiverUid : expectedServiceUid, name === 'receiver' ? expectedReceiverUid : expectedServiceUid);
        chmodSync(path, 0o755);
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519'), receiverKeys = generateKeyPairSync('ed25519');
    const manifest = parseInstalledDeploymentManifest({ version: 3, completionOwnerSchema: 2, authorityId: randomUUID(), packageHash, publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(), serviceUid: expectedServiceUid, allowedUserIds: [userUid] });
    const receiver = parseInstalledReceiverRegistration({ version: 1, receiverId: randomUUID(), receiverInstanceEpoch: 1, keyId: createHash('sha256').update(receiverKeys.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'), publicKeyPem: receiverKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(), serviceUid: expectedReceiverUid }, { controllerPublicKey: publicKey, controllerServiceUid: expectedServiceUid, interactiveUids: [userUid] });
    function exclusive(path, bytes, mode, owner) { const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode); try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    } chownSync(path, owner, owner); chmodSync(path, mode); const again = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
        fsyncSync(again);
    }
    finally {
        closeSync(again);
    } }
    exclusive(join(state, 'authority-key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), 0o600, expectedServiceUid);
    syncDirectoryTreeStrict(state);
    exclusive(join(receiverState, 'receiver-key.pem'), receiverKeys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), 0o600, expectedReceiverUid);
    syncDirectoryTreeStrict(receiverState);
    exclusive(join(base, 'receiver.json'), JSON.stringify(receiver) + '\n', 0o644, 0);
    exclusive(join(base, 'deployment.json'), JSON.stringify(manifest) + '\n', 0o644, 0);
    syncDirectoryTreeStrict(base);
}
