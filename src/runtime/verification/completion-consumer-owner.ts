import {ownDataArrayPrototypeIncludes,ownDataArrayPrototypeJoin,ownDataArrayPrototypeSort,ownDataBufferByteLength,ownDataCryptoCreateHash,ownDataHashPrototypeDigest,ownDataHashPrototypeUpdate,ownDataObjectFreeze,ownDataObjectKeys,ownDataRegExpPrototypeTest} from './application-native-intrinsics.js';
import { createHash } from 'node:crypto';
import type { VerificationOwner } from './proof-authority.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Shared enrollment/read/publication identity mapping. Original loop IDs retain
 * their exact bytes and kind; no trim, case folding, or metadata fallback. */
export function completionConsumerOwner(raw: {
    ownerKind: 'task' | 'intent' | 'goal' | 'project' | 'loop_stage' | 'loop_run';
    ownerId: string;
}): Pick<VerificationOwner, 'ownerKind' | 'ownerId'> {
    if (!raw || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(raw)), ',') !== 'ownerId,ownerKind' || typeof raw.ownerId !== 'string' || !raw.ownerId || ownDataBufferByteLength(raw.ownerId) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, raw.ownerId))
        throw Error('completion_consumer_owner');
    if (raw.ownerKind === 'loop_stage' || raw.ownerKind === 'loop_run')
        return ownDataObjectFreeze({ ownerKind: 'loop', ownerId: (raw.ownerKind === 'loop_stage' ? 'loop-stage:' : 'loop-run:') + ownDataHashPrototypeDigest(ownDataHashPrototypeUpdate(ownDataCryptoCreateHash('sha256'), json({ version: 1, kind: raw.ownerKind, id: raw.ownerId })), 'hex') });
    if (!ownDataArrayPrototypeIncludes(['task', 'intent', 'goal', 'project'], raw.ownerKind))
        throw Error('completion_consumer_owner');
    return ownDataObjectFreeze({ ownerKind: raw.ownerKind, ownerId: raw.ownerId });
}
