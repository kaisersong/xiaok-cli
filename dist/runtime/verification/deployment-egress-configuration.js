import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, fstatSync, lstatSync, fchmodSync, fchownSync, linkSync, renameSync, unlinkSync, constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { parseInstalledReceiverRegistration } from './installed-receiver-registration.js';
import { parseCompositeServicePair } from './composite-service-registration.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { assertInstalledCompositeLifetime } from './installed-composite-lifetime.js';
import { canonicalVerificationJson } from './protocol.js';
import { parseEgressProvisionBundle } from './deployment-egress-provision.js';
const base = '/Library/Application Support/xiaok-verification', intentPath = join(base, 'egress-provision.json'), targetsPath = join(base, 'egress-targets.json'), credentialsPath = join(base, 'egress-state/provider-credentials.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function parseJson(text) { try {
    return JSON.parse(text);
}
catch {
    throw Error('egress_configuration_json');
} }
const bytes = (value) => Buffer.from(JSON.stringify(value) + '\n');
const identity = (s) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.uid, s.gid, s.mode, s.nlink]);
function barrier(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} }
function missing(path) { try {
    lstatSync(path);
    return false;
}
catch (error) {
    if (error.code === 'ENOENT')
        return true;
    throw error;
} }
/** All source paths are fixed. Root-protected ancestors are checked by the
 * caller; private credentials additionally have an original fixed state root. */
function readBound(path, limit, uid, mode, gid) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const initial = fstatSync(fd);
        if (!initial.isFile() || initial.nlink !== 1 || initial.uid !== uid || (mode !== undefined && (initial.mode & 0o777) !== mode) || (gid !== undefined && initial.gid !== gid) || initial.size > limit)
            throw Error('egress_configuration_file');
        const body = readFileSync(fd), final = fstatSync(fd);
        if (body.length > limit || identity(initial) !== identity(final) || identity(final) !== identity(lstatSync(path)))
            throw Error('egress_configuration_changed');
        return body;
    }
    finally {
        closeSync(fd);
    }
}
function parseIntent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('egress_provision_intent');
    const r = value, keys = ['version', 'state', 'packageHash', 'authorityId', 'egressAuthorityId', 'uid', 'registrationHash', 'targetsHash', 'credentialsHash'];
    if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k)) || r.version !== 1 || !['prepared', 'committed'].includes(String(r.state)) || !Number.isSafeInteger(r.uid) || r.uid < 1 || typeof r.authorityId !== 'string' || typeof r.egressAuthorityId !== 'string' || ['packageHash', 'registrationHash', 'targetsHash', 'credentialsHash'].some(k => typeof r[k] !== 'string' || !/^[a-f0-9]{64}$/.test(r[k])))
        throw Error('egress_provision_intent');
    return r;
}
function sameIntent(a, b) { return bytes({ ...a, state: 'prepared' }).equals(bytes({ ...b, state: 'prepared' })); }
function loadIntent(uid) { assertRootProtectedFile(intentPath); return parseIntent(parseJson(readBound(intentPath, 65536, 0, 0o440, uid).toString('utf8'))); }
function state(uid) { const path = dirname(credentialsPath), s = lstatSync(path); assertRootProtectedExecutable('/bin/ls'); const acl = spawnSync('/bin/ls', ['-lde', path], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, maxBuffer: 65536 }); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== uid || s.gid !== uid || (s.mode & 0o777) !== 0o700 || acl.error || acl.status !== 0 || /^\s*\d+:/m.test(acl.stdout))
    throw Error('egress_provision_state'); return JSON.stringify([s.dev, s.ino, s.uid, s.gid, s.mode]); }
function publish(path, body, mode, uid, gid, replace = false) {
    if (!replace && !missing(path)) {
        const old = readBound(path, Math.max(65536, body.length), uid, mode, gid);
        try {
            if (!old.equals(body))
                throw Error('egress_provision_conflict');
        }
        finally {
            old.fill(0);
        }
        barrier(path);
        barrier(dirname(path));
        return;
    }
    const staging = join(base, 'provisioning'), stagingStat = lstatSync(staging);
    assertRootProtectedFile(join(staging, 'egress-input.json'));
    if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink() || stagingStat.uid !== 0 || (stagingStat.mode & 0o777) !== 0o700)
        throw Error('egress_provision_staging');
    const temporary = join(staging, '.' + basename(path) + '-' + randomUUID() + '.tmp');
    let created = false, fd;
    let settledBodyFailure;
    try {
        fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
        created = true;
        writeFileSync(fd, body);
        fchownSync(fd, uid, gid);
        fchmodSync(fd, mode);
        fsyncSync(fd);
        const original = fstatSync(fd);
        let published = true;
        if (replace)
            renameSync(temporary, path);
        else {
            try {
                linkSync(temporary, path);
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                const old = readBound(path, Math.max(65536, body.length), uid, mode, gid);
                try {
                    if (!old.equals(body))
                        throw Error('egress_provision_conflict');
                }
                finally {
                    old.fill(0);
                }
                published = false;
            }
            unlinkSync(temporary);
        }
        created = false;
        if (published) {
            const actual = lstatSync(path);
            if (actual.dev !== original.dev || actual.ino !== original.ino)
                throw Error('egress_provision_changed');
        }
        const actualBytes = readBound(path, Math.max(65536, body.length), uid, mode, gid);
        try {
            if (!actualBytes.equals(body))
                throw Error('egress_provision_changed');
        }
        finally {
            actualBytes.fill(0);
        }
        fsyncSync(fd);
        barrier(path);
        barrier(dirname(path));
        barrier(staging);
    }
    catch (error) {
        settledBodyFailure = { error };
    }
    {
        try {
            if (created) {
                try {
                    unlinkSync(temporary);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    if (settledBodyFailure)
        throw settledBodyFailure.error;
}
/** Explicit root installer operation; no automatic escalation, service start,
 * request execution, credential rotation, or caller-selected input path. */
export function provisionInstalledEgress(packageHash) {
    if (process.platform !== 'darwin' || process.getuid?.() !== 0 || process.geteuid?.() !== 0)
        throw Error('egress_provision_root_required');
    if (!/^[a-f0-9]{64}$/.test(packageHash))
        throw Error('egress_provision_package');
    const rootJson = (name, limit = 65536) => { const path = join(base, name); assertRootProtectedFile(path); return parseJson(readBound(path, limit, 0).toString('utf8')); };
    const manifest = parseInstalledDeploymentManifest(rootJson('deployment.json'));
    if (manifest.packageHash !== packageHash)
        throw Error('egress_provision_package');
    const receiver = parseInstalledReceiverRegistration(rootJson('receiver.json'), { controllerPublicKey: createPublicKey(manifest.publicKeyPem), controllerServiceUid: manifest.serviceUid, interactiveUids: manifest.allowedUserIds });
    const pair = parseCompositeServicePair(rootJson('egress.json'), rootJson('participant.json'), { packageHash, controllerAuthorityId: manifest.authorityId, forbiddenUids: [manifest.serviceUid, receiver.serviceUid, ...manifest.allowedUserIds], forbiddenPublicKeys: [manifest.publicKeyPem, receiver.publicKeyPem] });
    const inventory = parseDeploymentPackageInventory(rootJson(join('releases', packageHash + '.json'), 8 * 1024 ** 2));
    if (inventory.packageHash !== packageHash)
        throw Error('egress_provision_package');
    verifyDeploymentPackage(join(base, 'releases', packageHash), inventory);
    const uid = pair.egress.serviceUid, originalState = state(uid), source = join(base, 'provisioning/egress-input.json');
    assertRootProtectedFile(source);
    const raw = readBound(source, 128 * 1024, 0, 0o600);
    let proposal;
    try {
        proposal = parseEgressProvisionBundle(parseJson(raw.toString('utf8')));
    }
    finally {
        raw.fill(0);
    }
    const targetBytes = bytes(proposal.targets), credentialBytes = bytes(proposal.credentials);
    const wanted = { version: 1, state: 'prepared', packageHash, authorityId: manifest.authorityId, egressAuthorityId: pair.egress.authorityId, uid, registrationHash: hash(canonicalVerificationJson(pair)), targetsHash: hash(targetBytes), credentialsHash: hash(credentialBytes) };
    try {
        if (missing(intentPath)) {
            if (!missing(targetsPath) || !missing(credentialsPath))
                throw Error('egress_provision_existing_configuration');
            publish(intentPath, bytes(wanted), 0o440, 0, uid);
        }
        const original = loadIntent(uid);
        if (!sameIntent(original, wanted))
            throw Error('egress_provision_conflict');
        if (state(uid) !== originalState)
            throw Error('egress_provision_state_changed');
        publish(credentialsPath, credentialBytes, 0o600, uid, uid);
        publish(targetsPath, targetBytes, 0o644, 0, 0);
        if (state(uid) !== originalState || !sameIntent(loadIntent(uid), wanted))
            throw Error('egress_provision_changed');
        publish(intentPath, bytes({ ...wanted, state: 'committed' }), 0o440, 0, uid, true);
    }
    finally {
        credentialBytes.fill(0);
    }
}
/** The actual service validates committed publication before opening a listener.
 * Read-only directory/file fsync is intentional: mere rename visibility does
 * not establish the writer's final durability barrier. */
export function readInstalledEgressConfiguration(lifetime) {
    assertInstalledCompositeLifetime(lifetime);
    if (lifetime.definition.kind !== 'egress' || lifetime.base !== base)
        throw Error('egress_configuration_identity');
    const uid = lifetime.definition.serviceUid, originalState = state(uid), original = loadIntent(uid);
    if (original.state !== 'committed' || original.uid !== uid || original.packageHash !== lifetime.manifest.packageHash || original.authorityId !== lifetime.manifest.authorityId || original.egressAuthorityId !== lifetime.definition.authorityId || original.registrationHash !== hash(canonicalVerificationJson(lifetime.pair)))
        throw Error('egress_configuration_not_committed');
    function read() {
        lifetime.assertCurrent();
        if (state(uid) !== originalState)
            throw Error('egress_configuration_changed');
        const current = loadIntent(uid);
        if (!bytes(current).equals(bytes(original)))
            throw Error('egress_configuration_changed');
        assertRootProtectedFile(targetsPath);
        const targets = readBound(targetsPath, 65536, 0, 0o644, 0), credentials = readBound(credentialsPath, 65536, uid, 0o600, uid);
        try {
            if (hash(targets) !== original.targetsHash || hash(credentials) !== original.credentialsHash)
                throw Error('egress_configuration_changed');
            const targetConfig = parseJson(targets.toString('utf8'));
            return parseEgressProvisionBundle({ version: targetConfig.version, targets: targetConfig.targets, credentials: parseJson(credentials.toString('utf8')) });
        }
        finally {
            credentials.fill(0);
        }
    }
    const configuration = read();
    barrier(intentPath);
    barrier(base);
    read();
    const targets = Object.freeze(configuration.targets.targets.map(target => Object.freeze({ destination: target.destination, model: target.model, protocol: target.protocol, headers: Object.freeze({ ...target.headers, ...(target.credentialId ? configuration.credentials[target.credentialId] : {}) }) })));
    return Object.freeze({ targets, assertCurrent() { read(); } });
}
