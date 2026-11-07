// @vitest-environment node
import {expect,it} from 'vitest';
import {compileFunction,constants} from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import * as codec from '../../../src/runtime/multi-agent/dsh-draft-candidate.js';
const load=compileFunction('return import(specifier)',['specifier'],{importModuleDynamically:constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const hash='a'.repeat(64);
function data(text='Original UTF8 正文 😀'){
 return {schemaVersion:1,scope:{profileId:hash,workspaceId:'b'.repeat(64)},thread:{tenantId:'tenant',workspaceId:'workspace',sourceBindingId:'binding',provider:'github',repositoryId:'repo',kind:'issue',threadId:'123'},bindingId:'binding',generation:1,ownerWorkId:'work',draftCommitKey:'commit',artifactId:'artifact',draftInvocationId:'invocation',attemptId:'attempt',expectedOwnerVersion:2,authority:{commandId:'command',expectedOwnerVersion:1,attemptPayloadHash:hash,operationKey:'operation',semanticPayloadHash:hash},manifest:{manifestHash:hash},budgetCommitProof:{proofId:'proof',budgetOwnerId:'owner',reservationRef:'reservation',operationKey:'operation',ownerWorkId:'work',bindingId:'binding',inputManifestHash:hash,finalizedUsageRevision:1,validUntil:'2100-01-01T00:00:00.000Z',receiptDigest:hash,chargedBasis:'actual',ledgerRevision:1},content:{kind:'dsh_model_text_v1',text}};
}
it('builds original CLI draft bytes identical to the original B canonical digest',async()=>{
 const original=await load(pathToFileURL(resolve('../../kswarm/src/core/dsh-draft-data.js')).href),candidate=codec.buildDshDraftCandidate(data());
 expect(candidate.content.contentHash).toBe(original.dshDraftContentHash(candidate.content.text));
 expect({payloadHash:candidate.payloadHash,attemptPayloadHash:candidate.attemptPayloadHash}).toEqual(original.dshDraftHashes(candidate));
 const retry=codec.buildDshDraftCandidate({...data(),attemptId:'retry'});expect(retry.payloadHash).toBe(candidate.payloadHash);expect(retry.attemptPayloadHash).not.toBe(candidate.attemptPayloadHash);
 const changed=codec.buildDshDraftCandidate(data('Changed UTF8 正文'));expect(changed.payloadHash).not.toBe(candidate.payloadHash);
});
it('rejects hidden input getters and invalid UTF16 without executing a getter',()=>{
 let getters=0;const input=Object.defineProperty(data(),'content',{enumerable:true,get(){getters++;return {};}});
 expect(()=>codec.buildDshDraftCandidate(input)).toThrow();expect(getters).toBe(0);
 for(const text of ['\ud800','\udc00','invalid\0text','a'.repeat(65537)])expect(()=>codec.buildDshDraftCandidate(data(text))).toThrow();
});
