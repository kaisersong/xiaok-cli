import {createHash} from 'node:crypto';
import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';
/** Shared enrollment/read/publication identity mapping. Original loop IDs retain
 * their exact bytes and kind; no trim, case folding, or metadata fallback. */
export function completionConsumerOwner(raw:{ownerKind:'task'|'intent'|'goal'|'project'|'loop_stage'|'loop_run';ownerId:string}):Pick<VerificationOwner,'ownerKind'|'ownerId'>{
 if(!raw||Object.keys(raw).sort().join(',')!=='ownerId,ownerKind'||typeof raw.ownerId!=='string'||!raw.ownerId||Buffer.byteLength(raw.ownerId)>160||/[\x00-\x1f\x7f]/.test(raw.ownerId))throw Error('completion_consumer_owner');
 if(raw.ownerKind==='loop_stage'||raw.ownerKind==='loop_run')return Object.freeze({ownerKind:'loop',ownerId:(raw.ownerKind==='loop_stage'?'loop-stage:':'loop-run:')+createHash('sha256').update(json({version:1,kind:raw.ownerKind,id:raw.ownerId})).digest('hex')});
 if(!['task','intent','goal','project'].includes(raw.ownerKind))throw Error('completion_consumer_owner');return Object.freeze({ownerKind:raw.ownerKind,ownerId:raw.ownerId});
}
