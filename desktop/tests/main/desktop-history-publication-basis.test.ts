// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {DesktopTaskObservationStore} from '../../../src/runtime/task-host/protected-observation-store.js';
import {createDesktopProductObservationBinding,requireDesktopProductHost} from '../../electron/desktop-observation-owner.js';
it.each(['success','host-failure','other-writer'] as const)('actual Desktop full-history publisher retains its exact basis: %s',async scenario=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-basis-'))),source=join(root,'source.txt'),policyFile=join(root,'policy.json');writeFileSync(source,'source');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+120000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const registry=new ToolRegistry({autoMode:true},buildToolList(undefined,{cwd:root})),sidecar=new DesktopTaskObservationStore(join(root,'tasks')),taskId='basis',store=new FileSessionStore(join(root,'compound-sessions'));
 let armed=false,product:Awaited<ReturnType<typeof createDesktopProductObservationBinding>>|undefined;
 try{
  product=await createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,executionPersistence:sidecar.getExecutionPersistence(taskId,()=>{}),persist:async value=>{
   if(armed&&scenario==='host-failure')throw Error('actual host publication failed');
   if(armed&&scenario==='other-writer'){const previous=(await store.load(value.sessionId))!;await store.save({...previous,messages:[...previous.messages,{role:'user',content:[{type:'text',text:'Other writer committed.'}]}]});}
   if(!sidecar.publishCanonicalFacts(taskId,value))await sidecar.persistSession(taskId,value);
  }});
  const host=requireDesktopProductHost(product.binding),session=host.session,basis=session.getPublishedHistoryBasis();session.replaceMessages([{role:'user',content:[{type:'text',text:'This publication.'}]}]);const snapshot=session.exportSnapshot();armed=true;
  if(scenario==='success'){await host.persistHistory(snapshot);expect(session.getPublishedHistoryBasis()).toBe(computeSessionHistoryDigest(snapshot));await host.persistHistory(session.exportSnapshot());}
  else{await expect(host.persistHistory(snapshot)).rejects.toThrow();expect(session.getPublishedHistoryBasis()).toBe(basis);}
 }finally{await product?.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);
