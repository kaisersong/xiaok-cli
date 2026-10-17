import { expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { parseObservationPolicyFile } from '../../../src/runtime/sol-pi/product-bootstrap.js';
import { DesktopTaskObservationStore } from '../../../src/runtime/task-host/protected-observation-store.js';
import { createDesktopProductObservationBinding } from '../../../desktop/electron/desktop-observation-owner.js';
const installed=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:installed.create}));
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
// This deliberately negative factory test does not mint or claim OS qualification.
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))('requires actual installed-client qualification before enabling a Desktop materials-backed coordinator and disposes a failed client',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-validation-bootstrap-'))),source=join(root,'source.txt');writeFileSync(source,'source');
 const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+120000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const registry=new ToolRegistry({autoMode:true},[]),sidecar=new DesktopTaskObservationStore(join(root,'tasks')),taskId='qualification-failure';
 const authorize=vi.fn(),client={requireQualifiedExecution:vi.fn(async()=>{throw Error('real-probe-denied-fixture');}),dispose:vi.fn()};installed.create.mockReturnValue(client);
 let active:Awaited<ReturnType<typeof createDesktopProductObservationBinding>>|undefined;
 try{
  const opening=createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,persist:value=>sidecar.persistSession(taskId,value),executionPersistence:sidecar.getExecutionPersistence(taskId,()=>{}),authorizeValidationMaterials:authorize} as Parameters<typeof createDesktopProductObservationBinding>[0]).then(value=>{active=value;return value;});
  await expect(opening).rejects.toThrow('real-probe-denied-fixture');
  expect(installed.create).toHaveBeenCalledOnce();expect(client.requireQualifiedExecution).toHaveBeenCalledOnce();expect(client.dispose).toHaveBeenCalledOnce();expect(authorize).not.toHaveBeenCalled();
 }finally{await active?.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});installed.create.mockReset();}
},30000);
