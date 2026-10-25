import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { canonicalVerificationJson } from './protocol.js';
function identity(value) {
    if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
        throw Error('kswarm_subject_identity');
}
export function parseKSwarmHostSubject(raw) {
    // Reflection on a proxy can execute caller code, including revoked proxies.
    if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw))
        throw Error('kswarm_subject_shape');
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null)
        throw Error('kswarm_subject_shape');
    const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string') || keys.sort().join(',') !== 'projectId,taskId,version'
        || Object.values(descriptors).some(d => !('value' in d) || !d.enumerable))
        throw Error('kswarm_subject_shape');
    const version = descriptors.version.value, projectId = descriptors.projectId.value, taskId = descriptors.taskId.value;
    if (version !== 1)
        throw Error('kswarm_subject_version');
    identity(projectId);
    if (taskId !== null)
        identity(taskId);
    return Object.freeze({ version: 1, projectId, taskId });
}
export function kswarmHostSubjectHash(raw) {
    return createHash('sha256').update('xiaok-kswarm-host-subject-v1\0')
        .update(canonicalVerificationJson(parseKSwarmHostSubject(raw))).digest('hex');
}
/** A distinct data namespace. This mapping does not register or activate it. */
export function kswarmHostSubjectOwner(raw) {
    return Object.freeze({ ownerKind: 'kswarm', ownerId: 'kswarm-subject-v1:' + kswarmHostSubjectHash(raw) });
}
export function isKSwarmOwnerIdentity(value) {
    return value.ownerKind === 'kswarm' && typeof value.ownerId === 'string' && /^kswarm-subject-v1:[a-f0-9]{64}$/.test(value.ownerId);
}
