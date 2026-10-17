import { types } from 'node:util';
import { VERIFICATION_BUDGET } from './protocol.js';
export const METADATA_EMERGENCY_BYTES = 1024 ** 2;
export const METADATA_CAPACITY_METHODS = ['capacity.metadata.prepare', 'capacity.metadata.confirm', 'capacity.metadata.query'];
function fields(raw, keys) {
    if (types.isProxy(raw) || !raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).length !== keys.length)
        throw Error('metadata_capacity_shape');
    const out = {};
    for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(raw, key);
        if (!d || !('value' in d))
            throw Error('metadata_capacity_shape');
        out[key] = d.value;
    }
    return out;
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    throw Error('metadata_capacity_identity'); }
function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw Error('metadata_capacity_number'); }
/** Pure wire validation; none of these values are a capacity owner or writer permit. */
export function parseMetadataCapacityPrepare(raw) { const p = fields(raw, ['requestId', 'resourceId', 'expectedRevision', 'minimumPageCount']); id(p.requestId); id(p.resourceId); integer(p.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1); integer(p.minimumPageCount, 1, Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / 512)); return Object.freeze(p); }
export function parseMetadataCapacityConfirm(raw) { const p = fields(raw, ['requestId', 'resourceId', 'intentId', 'allocationDigest']); id(p.requestId); id(p.resourceId); id(p.intentId); if (typeof p.allocationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.allocationDigest))
    throw Error('metadata_capacity_digest'); return Object.freeze(p); }
export function parseMetadataCapacityQuery(raw) { const p = fields(raw, ['resourceId', 'intentId']); id(p.resourceId); id(p.intentId); return Object.freeze(p); }
export function parseMetadataCapacityAllocation(raw) { const p = fields(raw, ['resourceId', 'intentId', 'requestId', 'resourceRevision', 'writerGeneration', 'allocationDigest', 'beneficiaryCensusHash', 'pageSize', 'usableMaximumPageCount', 'chargedMaximumPageCount', 'journalMode', 'synchronous', 'state']); for (const key of ['resourceId', 'intentId', 'requestId'])
    id(p[key]); integer(p.resourceRevision, 1); id(p.writerGeneration); for (const key of ['allocationDigest', 'beneficiaryCensusHash'])
    if (typeof p[key] !== 'string' || !/^[a-f0-9]{64}$/.test(p[key]))
        throw Error('metadata_capacity_digest'); integer(p.pageSize, 512, 65536); if ((p.pageSize & (p.pageSize - 1)) !== 0)
    throw Error('metadata_capacity_page_size'); integer(p.usableMaximumPageCount, 1, Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / p.pageSize)); integer(p.chargedMaximumPageCount, 1, Math.floor(VERIFICATION_BUDGET.controlDatabaseBytes / p.pageSize)); if (p.chargedMaximumPageCount - p.usableMaximumPageCount !== METADATA_EMERGENCY_BYTES / p.pageSize)
    throw Error('metadata_capacity_headroom'); if (p.journalMode !== 'delete' || p.synchronous !== 'full' || !['prepared', 'confirmed', 'unknown'].includes(p.state))
    throw Error('metadata_capacity_state'); return Object.freeze(p); }
