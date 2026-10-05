import {AsyncResource} from 'node:async_hooks';
import {getCompoundPublicationOwnerBinding} from '../../../src/runtime/sol-pi/compound-managed-lifecycle.js';
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
import {runCompoundPublicationIteration,runCompoundObservationPublication,prepareCompoundFinalPublication,getCompoundFinalPublicationBinding,closeCompoundPublicationWindow,runCompoundFinalPublication,openCompoundFollowupPublicationWindow,getCompoundPublicationWindowOrigin} from '../../../src/runtime/sol-pi/compound-publication-producer.js';
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))('uses the actual coordinator owner and retains its final publication after runner return',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'compound-producer-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();
 session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const source=join(root,'source.txt'),policyFile=join(root,'policy.json');writeFileSync(source,'selected');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const permission=new PermissionManager({mode:'auto'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 let coordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>;
 try{
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  await expect(prepareCompoundFinalPublication(product.owner,'turn')).rejects.toThrow('compound_final_publication_scope');
  await expect(runCompoundPublicationIteration({...product.owner},'turn',async()=>{})).rejects.toThrow();
  const paused=closeCompoundPublicationWindow(product.owner);await paused.drained;let publicationCalls=0;
  const pending=runCompoundObservationPublication(product.owner,async()=>{publicationCalls++;});
  await Promise.resolve();expect(publicationCalls).toBe(0);paused.release();await pending;expect(publicationCalls).toBe(1);
  await runCompoundPublicationIteration(product.owner,'older',async()=>{
   const window=closeCompoundPublicationWindow(product.owner);
   await runCompoundObservationPublication(product.owner,async()=>{publicationCalls++;});
   expect(publicationCalls).toBe(2);
   void window.drained.then(()=>window.release());
  });
  const tree=getCompoundPublicationOwnerBinding(product.owner)!.tree;
  let escaped!:()=>unknown;
  await runCompoundPublicationIteration(product.owner,'old-origin',async()=>{
   const window=openCompoundFollowupPublicationWindow(product.owner,new AbortController().signal,Date.now()+30000,{session,nativeInvocationId:'actual-pending-origin'});
   expect(getCompoundPublicationWindowOrigin(tree)).toEqual({session,nativeInvocationId:'actual-pending-origin'});
   await runCompoundObservationPublication(product.owner,async()=>expect(getCompoundPublicationWindowOrigin(tree)?.session).toBe(session));
   escaped=AsyncResource.bind(()=>getCompoundPublicationWindowOrigin(tree));
   const cancelled=expect(window.drained).rejects.toThrow('original pending cancelled');
   window.cancelBeforeActivation(Error('original pending cancelled'));await cancelled;
   expect(getCompoundPublicationWindowOrigin(tree)).toBeUndefined();
  });
  expect(escaped()).toBeUndefined();
  await runCompoundPublicationIteration(product.owner,'new-origin',async()=>expect(getCompoundPublicationWindowOrigin(tree)).toBeUndefined());
  const ticket=await runCompoundPublicationIteration(product.owner,'turn',async()=>prepareCompoundFinalPublication(product.owner,'turn'));
  expect(getCompoundFinalPublicationBinding(ticket)).toMatchObject({session,sessionId:session.exportSnapshot().sessionId,turnId:'turn'});
  expect(()=>getCompoundFinalPublicationBinding({...ticket})).toThrow('compound_final_publication_ticket');
  const window=closeCompoundPublicationWindow(product.owner);let drained=false;void window.drained.then(()=>{drained=true;},()=>{});
  await runCompoundFinalPublication(ticket,async()=>{});await Promise.resolve();expect(drained).toBe(false);
  const failure=Error('tail has no committed Host receipt');window.fail(failure);await expect(window.drained).rejects.toBe(failure);
 }finally{await coordinator?.dispose();product.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);
