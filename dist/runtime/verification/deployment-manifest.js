import { createPublicKey } from 'node:crypto';
import { canonicalVerificationJson } from './protocol.js';
/** Strict root-owned deployment data; parsing is not proof of root ownership or installation. */
export function parseInstalledDeploymentManifest(raw) {
    const text = canonicalVerificationJson(raw);
    if (Buffer.byteLength(text) > 65536)
        throw Error('controller_deployment_manifest');
    const m = JSON.parse(text);
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).sort().join(',') !== (m.version === 3 ? 'allowedUserIds,authorityId,completionOwnerSchema,packageHash,publicKeyPem,serviceUid,version' : 'allowedUserIds,authorityId,packageHash,publicKeyPem,serviceUid,version') || !(m.version === 2 || m.version === 3 && m.completionOwnerSchema === 2) || typeof m.authorityId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(m.authorityId) || typeof m.publicKeyPem !== 'string' || m.publicKeyPem.length > 8192 || !/^([a-f0-9]{64})$/.test(m.packageHash) || !Number.isSafeInteger(m.serviceUid) || m.serviceUid < 1 || m.serviceUid >= 0xffffffff || !Array.isArray(m.allowedUserIds) || !m.allowedUserIds.length || m.allowedUserIds.length > 64 || new Set(m.allowedUserIds).size !== m.allowedUserIds.length || m.allowedUserIds.some((uid) => !Number.isSafeInteger(uid) || uid < 1 || uid >= 0xffffffff || uid === m.serviceUid))
        throw Error('controller_deployment_manifest');
    const key = createPublicKey(m.publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519')
        throw Error('controller_deployment_key');
    Object.freeze(m.allowedUserIds);
    return Object.freeze(m);
}
