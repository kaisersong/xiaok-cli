import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';import {homedir,tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {parseObservationPolicyFile,createProductObservationOwner} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {installProductCompoundCoordinator,type ProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import {bindManagedCompoundSpawnTool} from '../../../src/runtime/sol-pi/compound-managed-tool.js';
import {bindManagedCompoundMessageTool} from '../../../src/runtime/sol-pi/compound-managed-control.js';
import {getManagedCompoundAdmissionBinding} from '../../../src/runtime/sol-pi/compound-managed-admission.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import type {Tool} from '../../../src/types.js';
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
const qualified=process.platform==='darwin'&&process.arch==='arm64'&&existsSync(join(environmentRoot,'manifest.json'));
it.skipIf(!qualified).each(['success','registration-failure','same-id-copy'] as const)('actual registry native scope binds durable managed admission and exact ACK (%s)',async(scenario)=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'managed-product-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const path=join(root,'policy.json');writeFileSync(path,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:path,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const permission=new PermissionManager({mode:'auto'}),product=await createProductObservationOwner({policy:parseObservationPolicyFile(path),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let coordinator:ProductCompoundCoordinator|undefined,prepared:Awaited<ReturnType<ProductCompoundCoordinator['prepareManagedChild']>>|undefined,nativeInvocationId='',nativeCalls=0;
 const child=new AgentSessionState();child.restoreSnapshot({...child.exportSnapshot(),sessionId:'actual-child',cwd:root});
 const preparation=Object.freeze({}),receipt=Object.freeze({}),ack='{"agentId":"actual-child","status":"applied"}';
 const tool:Tool={definition:{name:'spawn_agent',description:'Fixture native main preparation boundary',inputSchema:{type:'object',properties:{},additionalProperties:false}},permission:'write',execute:async(_args,context)=>{
  nativeCalls++;nativeInvocationId=context!.toolInvocationId!;
  const candidate=scenario==='same-id-copy'?new AgentSessionState():child;
  if(candidate!==child)candidate.restoreSnapshot(child.exportSnapshot());
  prepared=await coordinator!.prepareManagedChild({preparation,childSession:candidate,registerPersistence:async()=>{if(scenario==='registration-failure')throw Error('fixture_registration_failure');}});
  const durable=(await store.load(session.exportSnapshot().sessionId))!;expect(durable.compoundOperations!.directOperations![0]).toMatchObject({stage:'started',delegation:{childPhase:'not_started',managed:{ackBytes:ack,ackReady:false}}});
  expect(getManagedCompoundAdmissionBinding(prepared.admission)).toMatchObject({parentSessionId:session.exportSnapshot().sessionId,parentOperationId:nativeInvocationId,childSessionId:'actual-child'});
  await expect(coordinator!.prepareManagedChild({preparation,childSession:child})).rejects.toThrow('compound_managed_invocation_required');
  return ack;
 }};
 bindManagedCompoundSpawnTool(tool,{inspectPreparation(value){if(value!==preparation)throw Error('fixture_preparation');return {groupId:'group',agentId:'actual-child',rootEpoch:1,childTurnId:'actual-turn',initialMessage:'hello',operationId:'turn:spawn',nativeInvocationId,childSessionId:'actual-child',childSession:child,sourceOwner:product.owner,ackBytes:ack};},inspectResourcesReleased(value){if(value!==receipt)throw Error('fixture_receipt');return {admission:prepared!.admission,closedSnapshotDigest:'a'.repeat(64)};}});
 const registry=new ToolRegistry({permissionManager:permission},[tool]);
 try{
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  await expect(coordinator!.prepareManagedChild({preparation,childSession:child})).rejects.toThrow('compound_managed_invocation_required');
  const context={taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'original-tool'};
  const result=await registry.executeTool('spawn_agent',{}, context).catch(error=>String(error));
  if(scenario!=='success'){
   expect(prepared).toBeUndefined();expect(result).not.toBe(ack);
   const row=(await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0];
   expect(row).toMatchObject(scenario==='registration-failure'?{stage:'started',delegation:{childPhase:'not_started'}}:{stage:'settled',outcome:'invalid'});
   expect(!!await store.load('actual-child')).toBe(scenario==='registration-failure');
   await registry.executeTool('spawn_agent',{},context).catch(()=>{});expect(nativeCalls).toBe(1);return;
  }
  expect(result).toBe(ack);
  await expect(prepared!.onResourcesReleased({...receipt})).rejects.toThrow('fixture_receipt');
  await prepared!.onResourcesReleased(receipt);await prepared!.onResourcesReleased(receipt);
  const row=(await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0];
  expect(row).toMatchObject({stage:'started',outcome:null,delegation:{state:'live',childPhase:'not_started',managed:{ackReady:true,ackPublished:false,resourcesReleasedDigest:'a'.repeat(64)}}});
  session.appendUserToolResults([{type:'tool_result',tool_use_id:'original-tool',content:result}]);
  await coordinator!.publishCurrentHistory();
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'started',outcome:null,delegation:{managed:{ackPublished:true}}});
  await expect(coordinator!.prepareManagedChild({preparation,childSession:child})).rejects.toThrow('compound_managed_invocation_required');
 }finally{await coordinator?.dispose();registry.dispose();await product.dispose();rmSync(root,{recursive:true,force:true});}
},30000);
it.skipIf(!qualified).each(['committed','unconfirmed','followup'] as const)('publishes a main message result before settling its separate metadata operation (%s)',async scenario=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'managed-message-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const path=join(root,'policy.json');writeFileSync(path,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:path,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const permission=new PermissionManager({mode:'auto'}),product=await createProductObservationOwner({policy:parseObservationPolicyFile(path),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let calls=0,invocation='';const result='fixture main committed delivery',toolName=scenario==='followup'?'followup_task':'send_message';
 const tool:Tool={definition:{name:toolName,description:'Explicit fixture of the Main commit boundary',inputSchema:{type:'object',properties:{target:{type:'string'},message:{type:'string'}},required:['target','message']}},permission:'safe',async execute(_input,context){calls++;invocation=context!.toolInvocationId!;expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0].stage).toBe('started');return result;}};
 bindManagedCompoundMessageTool(tool,{assertCurrent(){},inspectCommittedResult(facts){if(scenario==='unconfirmed')throw Error('fixture_main_commit_unconfirmed');expect(facts).toEqual({nativeInvocationId:invocation,finalInput:{target:'parent',message:'hello'},result});return{adapter:'desktop-service-metadata-v1',kind:scenario==='followup'?'followup':'send',operationId:`turn:${invocation}`,requestHash:'c'.repeat(64),resultHash:createHash('sha256').update(result).digest('hex'),groupId:'group',actorId:'child',epoch:1};}});
 const registry=new ToolRegistry({permissionManager:permission},[tool]);let coordinator:ProductCompoundCoordinator|undefined;
 try{
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  const context={taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'original-send'};
  const actual=await registry.executeTool(toolName,{target:'parent',message:'hello'},context).catch(error=>String(error));expect(calls).toBe(1);
  if(scenario==='unconfirmed'){expect(actual).toContain('fixture_main_commit_unconfirmed');expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0].stage).toBe('started');}
  else{expect(actual).toBe(result);expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0].stage).toBe('started');session.appendUserToolResults([{type:'tool_result',tool_use_id:'original-send',content:actual}]);await coordinator!.publishCurrentHistory();expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'completed',quiescence:'metadata_commit',metadataCommit:{operationId:`turn:${invocation}`}});}
  await registry.executeTool(toolName,{target:'parent',message:'hello'},context).catch(()=>{});expect(calls).toBe(1);
 }finally{await coordinator?.dispose();registry.dispose();await product.dispose();rmSync(root,{recursive:true,force:true});}
},20000);
