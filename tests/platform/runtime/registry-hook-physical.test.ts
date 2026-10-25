import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { createBackgroundRunner } from '../../../src/platform/agents/background-runner.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import type { PlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import type { ModelAdapter } from '../../../src/types.js';
import { waitFor } from '../../support/wait-for.js';

it.skipIf(process.platform==='win32').each(['main','original-child'])('factory retains the actual %s tool hook after the registry is disposed',async agentId=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'registry-hook-physical-'))),entered=join(root,'entered'),gate=join(root,'gate'),script=join(root,'hook.cjs'),input=join(root,'original.txt');
 writeFileSync(input,'original bytes');writeFileSync(script,`const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();fs.writeFileSync(${JSON.stringify(entered)},'original hook');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);process.exit(0);}},5);`);
 const quote=(text:string)=>"'"+text.replace(/'/g,"'\\''")+"'";
 const background=createBackgroundRunner({rootDir:join(root,'jobs'),execute:async()=>({ok:true}),notify:()=>{}});
 const platform={customAgents:[],pluginRuntime:{hookConfigs:[{command:`exec ${quote(process.execPath)} ${quote(script)}`,async:true,events:['PreToolUse'],timeoutMs:20000}],agentDirs:[]},mcpTools:[],capabilityRegistry:new CapabilityRegistry(),createBackgroundRunner:()=>background,createReminderApi:()=>undefined,onMcpToolsChanged:()=>()=>{}} as unknown as PlatformRuntimeContext;
 const factory=createPlatformRegistryFactory({platform,source:'chat',sessionId:'actual-session',adapter:()=>({} as ModelAdapter),permissionManager:new PermissionManager({mode:'auto'}),buildSystemPrompt:async()=>''});
 let physical:Promise<void>|undefined;
 try{
  const registry=factory.createRegistry(root,['read'],agentId);const result=await registry.executeTool('read',{file_path:input});expect(result).toContain('original bytes');
  await waitFor(()=>expect(existsSync(entered)).toBe(true));registry.dispose();await factory.dispose();let closed=false;physical=factory.waitForDisposedResources().then(()=>{closed=true;});
  await new Promise(r=>setTimeout(r,40));expect(closed).toBe(false);writeFileSync(gate,'finish original child');await physical;expect(closed).toBe(true);
 }finally{writeFileSync(gate,'cleanup');await factory.dispose();await (physical??factory.waitForDisposedResources());rmSync(root,{recursive:true,force:true});}
},30000);
