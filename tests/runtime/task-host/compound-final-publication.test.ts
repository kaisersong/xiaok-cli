import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createProductObservationOwner,parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {installProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import {runCompoundPublicationIteration,runCompoundObservationPublication,prepareCompoundFinalPublication,getCompoundFinalPublicationBinding,closeCompoundPublicationWindow,runCompoundFinalPublication} from '../../../src/runtime/sol-pi/compound-publication-producer.js';
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {getTaskHostCompoundFinalPublicationReceipt} from '../../../src/runtime/task-host/compound-final-publication-receipt.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {bindCompoundFinalPublicationConsumer,publishCompoundFinalPublication} from '../../../src/runtime/sol-pi/compound-publication-producer.js';
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json'))).each(['saved','write-failure','history-changed','group-canonical','group-rebind'] as const)('actual Host final producer %s preserves the original write and canonical history',async mode=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'host-final-producer-'))),snapshotRoot=join(root,'host');
 const snapshots=new FileTaskSnapshotStore(snapshotRoot),storeRoot=join(snapshotRoot,'protected-observation-sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();
 session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(mode.startsWith('group-')?'canonical-task':'task'),cwd:root});
 const source=join(root,'source.txt'),policyFile=join(root,'policy.json');writeFileSync(source,'selected');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const permission=new PermissionManager({mode:'auto'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const createProduct=()=>createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let product!:Awaited<ReturnType<typeof createProduct>>;
 let coordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>;
 let release!:()=>void,blocked!:()=>void,registered!:()=>void;
 const barrier=new Promise<void>(r=>{release=r;}),atTerminal=new Promise<void>(r=>{blocked=r;}),ready=new Promise<void>(r=>{registered=r;});
 const originalSave=snapshots.saveWithReceipt.bind(snapshots);
 snapshots.saveWithReceipt=async (snapshot,previous)=>{if(['completed','failed','cancelled'].includes(snapshot.status)){blocked();await barrier;if(mode==='write-failure')throw Error('actual final snapshot unavailable');}return originalSave(snapshot,previous);};
 const groupReferences=new WeakMap<object,{taskId:string;canonicalTaskId:string;closure:NonNullable<ReturnType<AgentSessionState['getProtectedObservationClosure']>>}>();
 let inspected=0,runnerError:unknown;
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024*1024}),createTaskId:()=> 'task',
  groupObservationSource:{inspectGroupObservationReference(ticket){const value=groupReferences.get(ticket);if(!value)throw Error('unknown test Main reference');return value;},async commitGroupObservationReference(ticket){if(!groupReferences.has(ticket))throw Error('unknown test Main reference');groupReferences.delete(ticket);}},
  runner:async input=>{
   try {
   product=await createProduct();
   coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
   expect(input.sessionId).not.toBe(session.exportSnapshot().sessionId);
   if(mode.startsWith('group-')){
    session.addProtectedObservationReferences([]);
    await runCompoundPublicationIteration(product.owner,'reference-initialization',()=>registry.publishCompoundHistory());
    const ticket=Object.freeze({id:'original-reference'});groupReferences.set(ticket,{taskId:'task',canonicalTaskId:'canonical-task',closure:session.getProtectedObservationClosure()!});
    await host.publishGroupObservationReference(ticket);
    if(mode==='group-rebind'){
     const changed=Object.freeze({id:'changed-reference'});groupReferences.set(changed,{taskId:'task',canonicalTaskId:'different-canonical',closure:session.getProtectedObservationClosure()!});
     await expect(host.publishGroupObservationReference(changed)).rejects.toThrow('task_host_final_canonical_changed');
    }
   }
   bindCompoundFinalPublicationConsumer(product.owner,'root-turn',{register:input.registerCompoundFinalPublication!,inspectReceipt(receipt){inspected++;return getTaskHostCompoundFinalPublicationReceipt(receipt);}});
   await runCompoundPublicationIteration(product.owner,'root-turn',async()=>publishCompoundFinalPublication(product.owner,'root-turn'));
   } catch(error){runnerError=error;throw error;} finally{registered();}
  }
 });
 try{
  await host.createTask({prompt:'short answer',materials:[]});await ready;if(runnerError)throw runnerError;await atTerminal;
  const window=closeCompoundPublicationWindow(product.owner);let drained=false;void window.drained.then(()=>{drained=true;},()=>{});
  await Promise.resolve();expect(inspected).toBe(0);expect(drained).toBe(false);
  if(mode==='history-changed')session.replaceMessages([...session.getMessages(),{role:'user',content:[{type:'text',text:'a later history'}]}]);
  release();await host.drain();
  if(mode==='saved'||mode.startsWith('group-')){await window.drained;expect(inspected).toBe(1);expect(drained).toBe(true);window.release();}
  else {expect(inspected).toBe(0);expect(drained).toBe(false);const failure=Error('original final publication unconfirmed');window.fail(failure);await expect(window.drained).rejects.toBe(failure);}
  expect(()=>getTaskHostCompoundFinalPublicationReceipt({})).toThrow('task_host_final_publication_receipt');
 }finally{release();await host.drain();await coordinator?.dispose();product?.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);
