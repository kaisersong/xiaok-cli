// @vitest-environment node
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const modulePath='../../electron/context-continuity/sync-canonical-codec.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/continuity-sync/canonical-batch-v1.json',import.meta.url),'utf8'));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex');
const manifest=(batch:any)=>{const {manifestHash:_,...body}=batch;batch.manifestHash=hash(['xiaok/canonical-batch/v1',body]);return batch;};

it('validates independent exact immutable version and frozen old reference fixture, without creating authority',async()=>{
 const codec=await import(modulePath),batch=fixture(),result=codec.validateCanonicalBatch(batch,batch.scope);
 expect(result.messages[0].messageId).toBe('message-original');expect(result.messages[0].versions).toHaveLength(2);
 expect(result.references[0].entries[0].revision).toBe(1);expect(Object.isFrozen(result.messages[0].versions)).toBe(true);
 expect(result.messages[0].versions.map((v:any)=>v.sourceRevision)).toEqual([10,15]);expect(result.references[0].refId).toContain('_-');
 expect(result.inputProjection).toEqual({state:'unavailable'});expect(result).not.toHaveProperty('verified');
});
it('denies a mismatched scope even with an internally valid manifest',async()=>{
 const codec=await import(modulePath),batch=fixture();expect(()=>codec.validateCanonicalBatch(batch,{...batch.scope,logicalProfileId:'other'})).toThrow('canonical_batch_invalid');
});
it('denies changed text, origin digest, or frozen reference entries rather than rebasing IDs',async()=>{
 const codec=await import(modulePath);
 for(const mutate of [(b:any)=>{b.messages[0].versions[0].text='other';},(b:any)=>{b.messages[0].versions[0].originHash='0'.repeat(64);},(b:any)=>{b.references[0].entries[0].revision=2;}]){
  const batch=fixture();mutate(batch);manifest(batch);expect(()=>codec.validateCanonicalBatch(batch,batch.scope)).toThrow('canonical_batch_invalid');
 }
});
it('keeps immutable origin digests independent of received execution observations and times',async()=>{
 const codec=await import(modulePath),batch=fixture(),prior=batch.messages[0].versions[0].originHash;
 batch.messages[0].versions[0].observedAt=9999;batch.messages[0].versions[0].executionObservation='unknown';manifest(batch);
 expect(codec.validateCanonicalBatch(batch,batch.scope).messages[0].versions[0].originHash).toBe(prior);
});
it('requires explicit dependency evidence and contiguous versions/coverage',async()=>{
 const codec=await import(modulePath);
 for(const mutate of [(b:any)=>{delete b.messages[0].versions[0].dependencies;},(b:any)=>{b.messages[0].versions[1].revision=3;},(b:any)=>{b.coverage.versionCount=1;},(b:any)=>{delete b.inputProjection;}]){
  const batch=fixture();mutate(batch);manifest(batch);expect(()=>codec.validateCanonicalBatch(batch,batch.scope)).toThrow('canonical_batch_invalid');
 }
});
it('does not treat an unselected authenticated ancestor as an empty dependency list',async()=>{
 const codec=await import(modulePath),batch=fixture(),v=batch.messages[0].versions[0];
 v.dependencies=[{kind:'history',scope:{...batch.scope,conversationId:'ancestor'},sourceKind:'desktop_task',sourceId:'ancestor-source',sourceEpoch:'ancestor-epoch',versions:[{messageId:'ancestor-message',revision:1,contentHash:'a'.repeat(64),originHash:'b'.repeat(64)}]}];
 v.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],v);manifest(batch);
 const checked=codec.validateCanonicalBatch(batch,batch.scope);expect(()=>codec.validateCanonicalBundle([checked])).toThrow('canonical_dependency_unavailable');
});
it('validates selected ancestor versions and refuses missing recursive lineage',async()=>{
 const codec=await import(modulePath),batch=fixture(),ancestor=fixture();ancestor.scope.conversationId='ancestor';
 const message=ancestor.messages[0];message.messageId='ancestor-message';message.sourceId='ancestor-source';
 for(const version of message.versions)version.originHash=codec.canonicalVersionDigest(ancestor.scope,message,version);
 ancestor.references=[];manifest(ancestor);
 const version=batch.messages[0].versions[0];version.dependencies=[{kind:'history',scope:{...ancestor.scope},sourceKind:message.sourceKind,sourceId:message.sourceId,sourceEpoch:message.sourceEpoch,versions:[{messageId:message.messageId,revision:1,contentHash:message.versions[0].contentHash,originHash:message.versions[0].originHash}]}];version.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],version);manifest(batch);
 expect(codec.validateCanonicalBundle([batch,ancestor])).toHaveLength(2);
 const prior=message.versions[0];prior.dependencies=[{kind:'history',scope:{...ancestor.scope,conversationId:'grandparent'},sourceKind:'desktop_task',sourceId:'grandparent-source',sourceEpoch:'grandparent-epoch',versions:[{messageId:'grandparent-message',revision:1,contentHash:'a'.repeat(64),originHash:'b'.repeat(64)}]}];prior.originHash=codec.canonicalVersionDigest(ancestor.scope,message,prior);manifest(ancestor);
 version.dependencies[0].versions[0].originHash=prior.originHash;version.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],version);manifest(batch);
 expect(()=>codec.validateCanonicalBundle([batch,ancestor])).toThrow('canonical_dependency_unavailable');
});
it('checks a selected source reference and original grant revision instead of laundering attached text',async()=>{
 const codec=await import(modulePath),batch=fixture(),ancestor=fixture();ancestor.scope.conversationId='ancestor';
 const message=ancestor.messages[0];message.messageId='ancestor-message';message.sourceId='ancestor-source';for(const version of message.versions)version.originHash=codec.canonicalVersionDigest(ancestor.scope,message,version);
 const reference=ancestor.references[0];reference.entries[0].messageId=message.messageId;reference.contentHash=createHash('sha256').update(JSON.stringify(reference.entries.map((e:any)=>[e.messageId,e.revision,e.contentHash]))).digest('hex');
 ancestor.grants=[{grantId:'original-grant',refId:reference.refId,targetConversationId:batch.scope.conversationId,revision:4,revoked:false}];manifest(ancestor);
 const version=batch.messages[0].versions[0];version.dependencies=[{kind:'reference',scope:{...ancestor.scope},sourceKind:message.sourceKind,sourceId:message.sourceId,sourceEpoch:message.sourceEpoch,versions:[{messageId:message.messageId,revision:1,contentHash:message.versions[0].contentHash,originHash:message.versions[0].originHash}],reference:{refId:reference.refId,snapshotRevision:reference.snapshotRevision,contentHash:reference.contentHash,grantId:'original-grant',grantRevision:4}}];version.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],version);manifest(batch);
 expect(codec.validateCanonicalBundle([batch,ancestor])).toHaveLength(2);
 ancestor.grants[0].revision=5;manifest(ancestor);expect(()=>codec.validateCanonicalBundle([batch,ancestor])).toThrow('canonical_dependency_unavailable');
 ancestor.grants[0].revision=4;ancestor.grants[0].revoked=true;manifest(ancestor);expect(()=>codec.validateCanonicalBundle([batch,ancestor])).toThrow('canonical_dependency_unavailable');
});
it('accepts an original reference spanning multiple source tasks only when every source group covers the full ordered reference',async()=>{
 const codec=await import(modulePath),batch=fixture(),ancestor=fixture();ancestor.scope.conversationId='ancestor';
 const first=ancestor.messages[0];first.messageId='ancestor-first';first.sourceId='source-first';
 const second=structuredClone(first);second.messageId='ancestor-second';second.sourceId='source-second';second.sourceMessageId='event-second';second.sequence=2;ancestor.messages.push(second);
 for(const message of ancestor.messages)for(const version of message.versions)version.originHash=codec.canonicalVersionDigest(ancestor.scope,message,version);
 const reference=ancestor.references[0];reference.entries=ancestor.messages.map((m:any)=>({messageId:m.messageId,revision:1,contentHash:m.versions[0].contentHash}));reference.contentHash=createHash('sha256').update(JSON.stringify(reference.entries.map((e:any)=>[e.messageId,e.revision,e.contentHash]))).digest('hex');
 ancestor.coverage={firstSequence:1,lastSequence:2,anchorCount:2,versionCount:4};ancestor.grants=[{grantId:'multi-source-grant',refId:reference.refId,targetConversationId:batch.scope.conversationId,revision:1,revoked:false}];manifest(ancestor);
 const version=batch.messages[0].versions[0];version.dependencies=ancestor.messages.map((m:any)=>({kind:'reference',scope:{...ancestor.scope},sourceKind:m.sourceKind,sourceId:m.sourceId,sourceEpoch:m.sourceEpoch,versions:[{messageId:m.messageId,revision:1,contentHash:m.versions[0].contentHash,originHash:m.versions[0].originHash}],reference:{refId:reference.refId,snapshotRevision:reference.snapshotRevision,contentHash:reference.contentHash,grantId:'multi-source-grant',grantRevision:1}}));version.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],version);manifest(batch);
 expect(codec.validateCanonicalBundle([batch,ancestor])).toHaveLength(2);
 version.dependencies.pop();version.originHash=codec.canonicalVersionDigest(batch.scope,batch.messages[0],version);manifest(batch);expect(()=>codec.validateCanonicalBundle([batch,ancestor])).toThrow('canonical_dependency_unavailable');
});
it('rejects getters/proxies/then/shared objects before consuming their values',async()=>{
 const codec=await import(modulePath);let reads=0;
 const getter=Object.defineProperty({},'kind',{enumerable:true,get(){reads++;throw new Error('getter_ran');}});
 for(const bad of [getter,new Proxy(fixture(),{}),{...fixture(),then:()=>{}}])expect(()=>codec.validateCanonicalBatch(bad,fixture().scope)).toThrow('canonical_batch_invalid');
 const shared=fixture();shared.messages[0].versions[1].dependencies=shared.messages[0].versions[0].dependencies;
 expect(()=>codec.validateCanonicalBatch(shared,shared.scope)).toThrow('canonical_batch_invalid');expect(reads).toBe(0);
});
it('rejects bundle array and batch-scope accessors before invoking any caller getter',async()=>{
 const codec=await import(modulePath);let reads=0;
 const badScope=Object.defineProperty({},'scope',{enumerable:true,get(){reads++;throw new Error('scope_getter_executed');}});
 const badIndex=Object.defineProperty([fixture()],0,{get(){reads++;throw new Error('array_getter_executed');}});
 const proxy=new Proxy([fixture()],{get(){reads++;throw new Error('proxy_getter_executed');}});
 for(const value of [[badScope],badIndex,proxy]){expect(()=>codec.validateCanonicalBundle(value)).toThrow();expect(reads).toBe(0);}
});
it('explicitly rejects an oversized snapshot without claiming empty/complete history',async()=>{
 const codec=await import(modulePath),batch=fixture();batch.messages[0].versions[0].text='x'.repeat(600*1024);
 expect(()=>codec.validateCanonicalBatch(batch,batch.scope)).toThrow('snapshot_chunking_required');
});
