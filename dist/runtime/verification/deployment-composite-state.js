import { generateKeyPairSync, randomUUID, createHash, createPublicKey } from 'node:crypto';
import { openSync, closeSync, writeFileSync, fsyncSync, lstatSync, mkdirSync, chownSync, chmodSync, readFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { parseInstalledReceiverRegistration } from './installed-receiver-registration.js';
import { parseCompositeServicePair } from './composite-service-registration.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { syncDirectoryTreeStrict } from '../../utils/atomic-file.js';
/** Explicit installer only. Partial state is retained and never automatically
 * adopted, overwritten, rekeyed or treated as proof of service readiness. */
export function initializeInstalledCompositeState(packageHash, egressUid, participantUid) {
    if (process.platform !== 'darwin' || process.getuid?.() !== 0 || process.geteuid?.() !== 0)
        throw Error('composite_root_required');
    if (!/^[a-f0-9]{64}$/.test(packageHash) || [egressUid, participantUid].some(n => !Number.isSafeInteger(n) || n < 1 || n >= 0xffffffff) || egressUid === participantUid)
        throw Error('composite_identity');
    const base = '/Library/Application Support/xiaok-verification';
    const read = (name) => { const path = join(base, name); assertRootProtectedFile(path); if (lstatSync(path).size > 8 * 1024 ** 2)
        throw Error('composite_file_limit'); return JSON.parse(readFileSync(path, 'utf8')); };
    const manifest = parseInstalledDeploymentManifest(read('deployment.json'));
    if (manifest.packageHash !== packageHash)
        throw Error('composite_package');
    const receiver = parseInstalledReceiverRegistration(read('receiver.json'), { controllerPublicKey: createPublicKey(manifest.publicKeyPem), controllerServiceUid: manifest.serviceUid, interactiveUids: manifest.allowedUserIds });
    const inventory = parseDeploymentPackageInventory(read(join('releases', packageHash + '.json')));
    if (inventory.packageHash !== packageHash)
        throw Error('composite_package');
    verifyDeploymentPackage(join(base, 'releases', packageHash), inventory);
    const forbiddenUids = [manifest.serviceUid, receiver.serviceUid, ...manifest.allowedUserIds, lstatSync('/dev/console').uid];
    if ([egressUid, participantUid].some(n => forbiddenUids.includes(n)))
        throw Error('composite_identity');
    assertRootProtectedExecutable('/usr/bin/id');
    assertRootProtectedExecutable('/bin/ls');
    const services = [{ kind: 'egress', uid: egressUid }, { kind: 'participant', uid: participantUid }];
    for (const { kind, uid } of services) {
        for (const flag of ['-u', '-g']) {
            const r = spawnSync('/usr/bin/id', [flag, '_xiaok_' + kind], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
            if (r.error || r.status !== 0 || Number(r.stdout.trim()) !== uid)
                throw Error('composite_account_identity');
        }
        const state = join(base, kind + '-state'), s = lstatSync(state), acl = spawnSync('/bin/ls', ['-lde', state], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
        if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== uid || s.gid !== uid || (s.mode & 0o777) !== 0o700 || acl.error || acl.status !== 0 || acl.stdout.split(/\s/, 1)[0].includes('+'))
            throw Error('composite_state');
        for (const path of [join(state, 'authority-key.pem'), join(base, kind + '.json'), join(base, kind)]) {
            try {
                lstatSync(path);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    continue;
                throw error;
            }
            throw Error('composite_existing_state');
        }
    }
    const prepared = services.map(({ kind, uid }) => { const keys = generateKeyPairSync('ed25519'); return { kind, uid, keys, registration: { version: 1, kind, authorityId: randomUUID(), instanceEpoch: 1, keyId: createHash('sha256').update(keys.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'), publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(), serviceUid: uid, packageHash, controllerAuthorityId: manifest.authorityId } }; });
    const binding = { packageHash, controllerAuthorityId: manifest.authorityId, forbiddenUids, forbiddenPublicKeys: [manifest.publicKeyPem, receiver.publicKeyPem] };
    parseCompositeServicePair(prepared[0].registration, prepared[1].registration, binding);
    function exclusive(path, bytes, mode, uid) { const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode); try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    } chownSync(path, uid, uid); chmodSync(path, mode); const verify = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
        fsyncSync(verify);
    }
    finally {
        closeSync(verify);
    } }
    for (const { kind, uid, keys, registration } of prepared) {
        const state = join(base, kind + '-state'), socketDir = join(base, kind);
        mkdirSync(socketDir, { mode: 0o755 });
        chownSync(socketDir, uid, uid);
        chmodSync(socketDir, 0o755);
        syncDirectoryTreeStrict(socketDir);
        exclusive(join(state, 'authority-key.pem'), keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), 0o600, uid);
        syncDirectoryTreeStrict(state);
        exclusive(join(base, kind + '.json'), JSON.stringify(registration) + '\n', 0o644, 0);
    }
    syncDirectoryTreeStrict(base);
    parseCompositeServicePair(read('egress.json'), read('participant.json'), binding);
}
