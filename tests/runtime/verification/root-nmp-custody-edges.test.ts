import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const sdk=vi.hoisted(()=>({raw:undefined as unknown,calls:0}));
vi.mock('../../../src/runtime/verification/root-nmp-custody-process.js',async original=>{
 const actual=await original<typeof import('../../../src/runtime/verification/root-nmp-custody-process.js')>();
 return {...actual,startRootNmpCustodyProcess(){sdk.calls++;throw sdk.raw;}};
});
import {createProfileSourceCustodyRegistry} from '../../../src/runtime/verification/profile-source-custody-registry.js';
const peer={uid:502,gid:502,pid:101,auditSessionId:3};
function review(id='challenge'){
 const sourceSet={schemaVersion:1,authorityId:'authority',profileId:'profile',uid:501,accountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryGeneration:'1',sources:[{sourceId:'source',namespaceId:'namespace',kind:'sqlite-db',snapshotFormat:'root-nmp-ledger-v1',directory:{canonicalPath:'/Users/actual/Library/Application Support/xiaok/runtime',device:'1',inode:'2'},database:{basename:'root-resource-v1.sqlite',device:'1',inode:'3'},reviewedSnapshotSha256:'a'.repeat(64)}]};
 return {version:1,purpose:'profile-source-custody',authorityId:'authority',challengeId:id,principal:{uid:501,accountGeneration:'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',auditSessionId:2},requestSource:'user',sourceSet,inventoryHash:createHash('sha256').update(json(sourceSet)).digest('hex'),deadline:{domainId:'continuous',qualificationEpoch:1,notBefore:1,validUntil:1000}};
}
function setup(){return createProfileSourceCustodyRegistry({authorityId:'authority',allowedUserIds:[501],directoryHelper:'/not-invoked',sqliteHelper:'/not-invoked',rootNmpHelper:'/not-spawned-in-this-unit',clock:()=>({domainId:'continuous',qualificationEpoch:1,evidenceHash:'e'.repeat(64),lowerBound:10,upperBound:11}),observe:async()=> 'same',resolveAccount:async()=> 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',approve:async input=>createHash('sha256').update(input.reviewBytes).digest('hex')});}
afterEach(()=>{sdk.calls=0;sdk.raw=undefined;});
it('requires the original approved Entry and refuses the generic sibling before a Source SDK call',async()=>{
 const r=setup();try{await expect(r.captureRootNmp({challengeId:'absent',reviewHash:'a'.repeat(64)},peer,new AbortController().signal)).rejects.toThrow('consumed');const receipt=await r.authorize(review(),peer,new AbortController().signal);
  await expect(r.capture({challengeId:receipt.challengeId,reviewHash:receipt.reviewHash},peer,new AbortController().signal)).rejects.toThrow('specialized_required');expect(sdk.calls).toBe(0);
  await expect(r.authorize(review('second'),peer,new AbortController().signal)).rejects.toThrow('occupied');
 }finally{await r.close();}
});
it('preserves a bare undefined constructor failure without inventing a successful Source',async()=>{
 const r=setup();try{const receipt=await r.authorize(review(),peer,new AbortController().signal);let got={present:false,raw:1 as unknown};try{await r.captureRootNmp({challengeId:receipt.challengeId,reviewHash:receipt.reviewHash},peer,new AbortController().signal);}catch(raw){got={present:true,raw};}expect(got).toEqual({present:true,raw:undefined});expect(sdk.calls).toBe(1);
 }finally{await r.close();}
});
it('joins an Error own-symbol Promise before returning the original constructor first cause',async()=>{
 const raw=Error('original constructor');let release!:()=>void;const tail=new Promise<void>(yes=>release=yes);Object.defineProperty(raw,Symbol('original-tail'),{value:tail});sdk.raw=raw;
 const r=setup();try{const receipt=await r.authorize(review(),peer,new AbortController().signal);let done=false;const pending=r.captureRootNmp({challengeId:receipt.challengeId,reviewHash:receipt.reviewHash},peer,new AbortController().signal).then(()=>{done=true;throw Error('unexpected Source');},error=>{done=true;throw error;});const caught=pending.catch(error=>error);await new Promise(yes=>setImmediate(yes));expect(sdk.calls).toBe(1);expect(done).toBe(false);release();expect(await caught).toBe(raw);
 }finally{release();await r.close();}
});
it('keeps observed transient accessor inventory unknown and never revives its occupied Entry',async()=>{
 const raw=Error('original accessor');let hits=0;const key=Symbol('tail');Object.defineProperty(raw,key,{configurable:true,get(){hits++;throw 0;}});sdk.raw=raw;
 const r=setup();try{const receipt=await r.authorize(review(),peer,new AbortController().signal);await expect(r.captureRootNmp({challengeId:receipt.challengeId,reviewHash:receipt.reviewHash},peer,new AbortController().signal)).rejects.toBeInstanceOf(AggregateError);delete (raw as unknown as Record<symbol,unknown>)[key];await expect(r.authorize(review('next'),peer,new AbortController().signal)).rejects.toThrow('occupied');expect(hits).toBe(0);await expect(r.close()).rejects.toThrow('shutdown_unknown');
 }finally{await r.close().catch(()=>{});}
});
