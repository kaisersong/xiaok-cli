// @vitest-environment node
import {expect,it} from 'vitest';
import {join} from 'node:path';
import * as mapping from '../../electron/kswarm-task-input.js';
import * as preparation from '../../../src/runtime/task-host/default-dispatch-preparation.js';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mapDefaultDispatchObservationInput} from '../../electron/default-dispatch-observation-input.js';
import {captureDispatchBusinessData} from '../../../src/runtime/conversation-activity/dispatch-business-data.js';
const require=createRequire(import.meta.url),{defaultDispatchBusinessIdentity}=require(resolve('../../kswarm/src/core/default-dispatch-birth-rules.js')),{runtimePreparationIntent}=require(resolve('../../kswarm/src/core/default-dispatch-runtime-data.js'));
it('reconstructs both original artifact-path inputs without querying current lane capacity',()=>{
 const execution={project:{id:'p',name:'Project',goal:'Goal',workFolder:join('owned','workspace'),artifactsDir:null},task:{id:'t',title:'Task'}} as any;
 const paths=(mapping as any).buildKSwarmTaskArtifactPaths(execution,'run-original');expect(paths.baseArtifactsDir).toBe(join('owned','workspace','artifacts'));expect(paths.runArtifactsDir).toMatch(/run-[a-f0-9]{32}$/);
 const inputs=(mapping as any).buildKSwarmTaskCreateInputCandidates({execution,runId:'run-original',targetParticipantId:'desktop'});expect(inputs).toHaveLength(2);
 for(let i=0;i<inputs.length;i++)expect(inputs[i]).toEqual(mapping.buildKSwarmTaskCreateInput({execution,targetParticipantId:'desktop',baseArtifactsDir:paths.baseArtifactsDir,artifactsDir:i?paths.runArtifactsDir:paths.baseArtifactsDir}));
 const digest=(preparation as any).originalChildPreparationInputDigest;expect(digest(inputs[0])).toMatch(/^[a-f0-9]{64}$/);expect(digest(inputs[0])).not.toBe(digest(inputs[1]));
 execution.project.workFolder=null;expect((mapping as any).buildKSwarmTaskCreateInputCandidates({execution,runId:'run-original'})).toHaveLength(1);
});
it('uses the original mapper with closed original B arrays that have no inherited iterator',()=>{
 const execution={project:{id:'p',name:'P',goal:'Goal'},task:{id:'p__a',title:'A',requiredOutputs:['report']}} as any;
 const input={execution,targetParticipantId:'desktop',artifactsDir:'',baseArtifactsDir:''},closed=captureDispatchBusinessData(input) as any;
 expect(mapping.buildKSwarmTaskCreateInput(closed)).toEqual(mapping.buildKSwarmTaskCreateInput(input));
});
for(const branch of [0,1])it('maps original B intent and original Host issuer identity for artifact layout '+branch,()=>{
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},execution={project:{id:'p',name:'P',goal:'Goal',artifactsDir:join('owned','artifacts')},task:{id:'p__a',title:'A'}},child={scope,projectId:'p',writerStoreId:'original-B-store',bindingDigest:'b'.repeat(64),id:defaultDispatchBusinessIdentity(scope,'p','p__a').childKey,taskId:'p__a',businessExecutionGeneration:1,payloadHash:'d'.repeat(64),payload:{execution}};
 const target={scope,writerStoreId:child.writerStoreId,projectId:'p',bindingDigest:child.bindingDigest,childKey:child.id,payloadHash:child.payloadHash,hostId:'expected-local-marker',targetParticipantId:'desktop',targetIncarnation:'original-target',inputMapperVersion:mapping.KSWARM_TASK_INPUT_MAPPER_VERSION,inputDigest:'e'.repeat(64)};
 const prototype=runtimePreparationIntent(child,target),input=mapping.buildKSwarmTaskCreateInputCandidates({execution:execution as any,runId:prototype.runId,targetParticipantId:'desktop'})[branch]!,intent=runtimePreparationIntent(child,{...target,inputDigest:preparation.originalChildPreparationInputDigest(input)});
 const request={scope,projectId:'p',parentId:'parent-reference',planRevision:1,dispatchGeneration:1,childKey:child.id,taskId:child.taskId,payloadHash:child.payloadHash},basis={ok:true,protocol:'ordinary_default_dispatch_preparation_basis_v1',revision:1,child,intent,admission:null,observation:null},mapped=mapDefaultDispatchObservationInput(request,basis);
 expect(mapDefaultDispatchObservationInput(request,{...basis,protocol:'ordinary_default_dispatch_preparation_basis_v2',hostEffect:{registration:null,noEffectFinish:null}}).kind).toBe('mapped');
 for(const hostEffect of [undefined,null,{}, {registration:null}, {registration:null,noEffectFinish:null,extra:true}])expect(()=>mapDefaultDispatchObservationInput(request,{...basis,protocol:'ordinary_default_dispatch_preparation_basis_v2',hostEffect})).toThrow(/HOST_EFFECT_BASIS|DISPATCH_BUSINESS_DATA_INVALID/);
 expect(mapped.kind).toBe('mapped');if(mapped.kind!=='mapped')throw Error('mapped result required');expect(mapped.data.taskId).toBe(child.taskId);expect(mapped.marker.taskId).toBe(intent.taskId);
 const proof=Object.freeze({}),store={},issuer=preparation.createTaskDefaultDispatchPreparationIssuer(store,{resolve(candidate){if(candidate!==proof)throw Error('controlled fixture proof');return{data:mapped.data,assertCurrent(){}};}}),frame=issuer.open(proof,'scheduler','observe');expect(frame.marker).toEqual(mapped.marker);expect(frame.input).toEqual(input);
 expect(mapDefaultDispatchObservationInput(request,{...basis,intent:null})).toEqual({kind:'unavailable',reason:'preparation_intent_missing'});
 expect(mapDefaultDispatchObservationInput(request,{...basis,intent:{...intent,inputDigest:'f'.repeat(64)}})).toEqual({kind:'unavailable',reason:'input_mapping_unverified'});
 expect(()=>mapDefaultDispatchObservationInput({...request,taskId:intent.taskId},basis)).toThrow('CHILD_MISMATCH');expect(()=>mapDefaultDispatchObservationInput(request,{...basis,intent:{...intent,writerStoreId:'other'}})).toThrow('INTENT_MISMATCH');
});
