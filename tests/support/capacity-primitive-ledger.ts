import {vi} from 'vitest';
import type {Database} from 'better-sqlite3';
import * as root from '../../src/runtime/verification/installed-controller.js';
import * as shared from '../../src/runtime/verification/shared-blob-capacity.js';
import {createSharedCapacityLedger,assertSharedCapacityLedgerAuthority,type CapacityRecord,type CapacityMetadataReplacementFacts,type CapacityMetadataReplacementCommitContext} from '../../src/runtime/verification/shared-capacity-ledger.js';

/** SQLite algorithm/fault harness ONLY. These test boundary mocks are not an
 * installed authority, owner, replacement issuer, deletion grant or OS proof.
 * Actual installed positive tests use the zero-argument start separately. */
interface Options {database:Database;authorityId:string;host:{assertCurrent():unknown;inspectOwner(binding:object):{sessionKey:string;producerKey:string};assertReleased(receipt:object,record:Readonly<CapacityRecord>):unknown;assertMetadataReplacement?(receipt:object,facts:Readonly<CapacityMetadataReplacementFacts>):unknown;assertMetadataReplacementCommit?(receipt:object,facts:Readonly<CapacityMetadataReplacementFacts>):unknown;executeMetadataReplacementCommit?(receipt:object,context:CapacityMetadataReplacementCommitContext):unknown}}
const contexts=new WeakMap<object,{options:Options;claimed:boolean}>();
let patched=false;
function install(){if(patched)return;patched=true;
 const claim=root.claimInstalledCapacityLayer,read=root.readInstalledCapacityAuthority,finish=root.finishInstalledCapacityLayer,fail=root.failInstalledCapacityLayer,replace=root.assertInstalledCapacityReplacement,owner=shared.readSharedCapacityOwner,released=shared.assertSharedCapacityReleased;
 vi.spyOn(root,'claimInstalledCapacityLayer').mockImplementation((token,layer)=>{const c=contexts.get(token);if(!c)return claim(token,layer);if(layer!=='ledger'||c.claimed)throw Error('test primitive layer');c.claimed=true;c.options.host.assertCurrent();return {database:c.options.database,authorityId:c.options.authorityId};});
 vi.spyOn(root,'readInstalledCapacityAuthority').mockImplementation(token=>{const c=contexts.get(token);if(!c)return read(token);c.options.host.assertCurrent();return {database:c.options.database,authorityId:c.options.authorityId};});
 vi.spyOn(root,'finishInstalledCapacityLayer').mockImplementation((token,layer,component)=>{if(!contexts.has(token))return finish(token,layer,component);if(layer!=='ledger')throw Error('test primitive layer');assertSharedCapacityLedgerAuthority(component,token);});
 vi.spyOn(root,'failInstalledCapacityLayer').mockImplementation((token,layer)=>{if(!contexts.has(token))return fail(token,layer);});
 vi.spyOn(root,'assertInstalledCapacityReplacement').mockImplementation((token,proof,facts)=>{const c=contexts.get(token);if(!c)return replace(token,proof,facts);if(!c.options.host.assertMetadataReplacement)throw Error('shared_capacity_replacement_unavailable');return c.options.host.assertMetadataReplacement(proof,facts) as void;});
 // Optional only while the production entry is absent in the pre-code red.
 // The fixture intercepts fixed installed boundaries, never the SQLite ledger.
 const exports=root as unknown as Record<string,(...args:any[])=>unknown>;
 if(typeof exports.assertInstalledCapacityReplacementCommit==='function'){
  const verify=exports.assertInstalledCapacityReplacementCommit;
  vi.spyOn(exports,'assertInstalledCapacityReplacementCommit').mockImplementation((token:object,proof:object,facts:Readonly<CapacityMetadataReplacementFacts>)=>{const c=contexts.get(token);if(!c)return verify!(token,proof,facts);if(!c.options.host.assertMetadataReplacementCommit)throw Error('shared_capacity_replacement_commit_unavailable');return c.options.host.assertMetadataReplacementCommit(proof,facts);});
 }
 if(typeof exports.executeInstalledCapacityReplacementCommit==='function'){
  const execute=exports.executeInstalledCapacityReplacementCommit;
  vi.spyOn(exports,'executeInstalledCapacityReplacementCommit').mockImplementation((token:object,proof:object,context:CapacityMetadataReplacementCommitContext)=>{const c=contexts.get(token);if(!c)return execute!(token,proof,context);if(!c.options.host.executeMetadataReplacementCommit)throw Error('shared_capacity_replacement_commit_unavailable');return c.options.host.executeMetadataReplacementCommit(proof,context);});
 }
 vi.spyOn(shared,'readSharedCapacityOwner').mockImplementation((token,binding)=>{const c=contexts.get(token);return c?c.options.host.inspectOwner(binding):owner(token,binding);});
 const batch=shared.readSharedCapacityOwners;
 vi.spyOn(shared,'readSharedCapacityOwners').mockImplementation((token,bindings)=>{const c=contexts.get(token);return c?bindings.map(binding=>c.options.host.inspectOwner(binding)):batch(token,bindings);});
 vi.spyOn(shared,'assertSharedCapacityReleased').mockImplementation((token,proof,record)=>{const c=contexts.get(token);return c?c.options.host.assertReleased(proof,record) as void:released(token,proof,record);});
}
export function createPrimitiveCapacityLedger(options:Options):ReturnType<typeof createSharedCapacityLedger>{install();const token=Object.freeze({});contexts.set(token,{options,claimed:false});return createSharedCapacityLedger(token);}
