import { createPublicKey, createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
function key(pem) { const k = createPublicKey(pem); if (k.type !== 'public' || k.asymmetricKeyType !== 'ed25519')
    throw Error('composite_service_key'); return k.export({ format: 'der', type: 'spki' }); }
export function parseCompositeServiceRegistration(raw, kind, binding) {
    const serialized = json(raw);
    if (Buffer.byteLength(serialized) > 16384)
        throw Error('composite_service_registration');
    const r = JSON.parse(serialized);
    if (!r || Object.keys(r).sort().join(',') !== 'authorityId,controllerAuthorityId,instanceEpoch,keyId,kind,packageHash,publicKeyPem,serviceUid,version' || r.version !== 1 || r.kind !== kind || !Number.isSafeInteger(r.instanceEpoch) || r.instanceEpoch < 1 || !Number.isSafeInteger(r.serviceUid) || r.serviceUid < 1 || r.serviceUid >= 0xffffffff || binding.forbiddenUids.includes(r.serviceUid) || r.packageHash !== binding.packageHash || !/^[a-f0-9]{64}$/.test(r.packageHash) || r.controllerAuthorityId !== binding.controllerAuthorityId || typeof r.authorityId !== 'string' || !r.authorityId || Buffer.byteLength(r.authorityId) > 160 || /[\x00-\x1f\x7f]/.test(r.authorityId) || r.authorityId === binding.controllerAuthorityId || typeof r.publicKeyPem !== 'string')
        throw Error('composite_service_registration');
    const der = key(r.publicKeyPem);
    if (createHash('sha256').update(der).digest('hex') !== r.keyId || binding.forbiddenPublicKeys.some(p => key(p).equals(der)))
        throw Error('composite_service_key');
    return Object.freeze(r);
}
/** Both registrations are mandatory. A single valid file never activates either
 * service, and installation identity is not physical execution generation. */
export function parseCompositeServicePair(egress, participant, binding) {
    const e = parseCompositeServiceRegistration(egress, 'egress', binding), p = parseCompositeServiceRegistration(participant, 'participant', binding);
    if (e.serviceUid === p.serviceUid || e.authorityId === p.authorityId || e.keyId === p.keyId)
        throw Error('composite_service_pair');
    return Object.freeze({ egress: e, participant: p });
}
