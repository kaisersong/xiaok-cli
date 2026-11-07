import {types} from 'node:util';
import {resolve} from 'node:path';
import {isReadonlySandboxEnforcer} from './enforcer.js';
import {withSandboxSearchScope} from './search-scope.js';
import {inheritBuiltinToolIdentity} from '../../ai/tools/native-tool-identity.js';
import type { Tool, ToolExecutionContext } from '../../types.js';
import type { createSandboxEnforcer } from './enforcer.js';

type SandboxEnforcer = ReturnType<typeof createSandboxEnforcer>;
export type SandboxDenialCallback = (deniedPath:string,toolName:string)=>Promise<{shouldProceed:boolean}>|{shouldProceed:boolean};
export interface SandboxToolWrapperOptions {onSandboxDenied?:SandboxDenialCallback}
function normalizeOptions(options?:SandboxToolWrapperOptions|SandboxDenialCallback):SandboxToolWrapperOptions{return typeof options==='function'?{onSandboxDenied:options}:options??{};}
function detectNetworkIntent(command:string):boolean{return /(curl|wget|https?:\/\/|npm\s+install|pnpm\s+add|yarn\s+add|git\s+clone)/i.test(command);}

type CompoundSandboxPreparation=(input:Readonly<Record<string,unknown>>,context?:ToolExecutionContext)=>Promise<string|undefined>;
interface PreparationBinding {execute:Tool['execute'];prepare:CompoundSandboxPreparation}
const compoundPreparations=new WeakMap<Tool,PreparationBinding>();
/** Only first-party wrappers created below possess this port. A plugin property
 * named compoundPrepare is not consulted and cannot issue a preparation grant. */
export function getCompoundSandboxPreparation(tool:Tool):CompoundSandboxPreparation|undefined{
 const binding=compoundPreparations.get(tool);if(!binding)return undefined;
 if(tool.execute!==binding.execute)throw Error('compound_sandbox_wrapper_changed');return binding.prepare;
}
/** Registry's host-only clone preserves an existing authenticated binding; this
 * cannot create one from arbitrary function properties on an unbranded Tool. */
export function inheritCompoundSandboxPreparation(source:Tool,target:Tool):void{
 const prepare=getCompoundSandboxPreparation(source);if(!prepare)return;
 if(target.execute!==source.execute||target.permission!==source.permission||target.definition.name!==source.definition.name)throw Error('compound_sandbox_clone_changed');
 compoundPreparations.set(target,{execute:target.execute,prepare});
}

export function applySandboxToTools(tools:Tool[],enforcer?:SandboxEnforcer,optionsOrCallback?:SandboxToolWrapperOptions|SandboxDenialCallback):Tool[]{
 if(!enforcer)return tools;
 const options=normalizeOptions(optionsOrCallback);
 return tools.map(tool=>{
  const name=tool.definition.name;if(!['bash','read','write','edit','grep','glob'].includes(name))return tool;
  const search=name==='grep'||name==='glob';
  const prepare=async(input:Readonly<Record<string,unknown>>,context:ToolExecutionContext|undefined,allowPrompt:boolean):Promise<string|undefined>=>{
   context?.signal?.throwIfAborted();
   if(search && input.path!==undefined && typeof input.path!=='string')return 'Error: sandbox denied invalid search path';
   const path=search?resolve((input.path as string|undefined)||process.cwd()):name==='bash'?input.workdir:input.file_path;
   if(typeof path==='string'){
    const decision=enforcer.enforceFile(path);
    if(!decision.allowed){
     const retry=allowPrompt?await options.onSandboxDenied?.(path,name):undefined;
     context?.signal?.throwIfAborted();
     if(!retry?.shouldProceed||!enforcer.enforceFile(path).allowed)return name==='bash'?`Error: sandbox denied bash workdir: ${decision.reason}`:`Error: sandbox denied path: ${decision.reason}`;
    }
   }
   if(name==='bash'&&typeof input.command==='string'&&detectNetworkIntent(input.command)){
    const decision=enforcer.enforceNetwork();if(!decision.allowed)return `Error: sandbox denied network access: ${decision.reason}`;
   }
   return undefined;
  };
  const wrapped:Tool={...tool,execute:async(input,context)=>{
   // Resolve once before a possible approval await; never mutate shared input.
   const effective=search?{...input,path:typeof input.path==='string'?resolve(input.path||process.cwd()):input.path===undefined?process.cwd():input.path}:input;
   const denial=await prepare(effective,context,!context?.compoundPhase);
   if(denial)return denial;
   context?.signal?.throwIfAborted();context?.assertPermissionApproval?.();
   return tool.execute(effective,search?withSandboxSearchScope(context,enforcer):context);
  }};
  inheritBuiltinToolIdentity(tool,wrapped,()=>{
   if(!isReadonlySandboxEnforcer(enforcer)||types.isProxy(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))return false;
   const callback=Object.getOwnPropertyDescriptor(options,'onSandboxDenied');
   if(callback)return 'value' in callback&&callback.value===undefined;
   return Object.getOwnPropertyDescriptor(Object.prototype,'onSandboxDenied')===undefined;
  });
  compoundPreparations.set(wrapped,{execute:wrapped.execute,prepare:(input,context)=>prepare(input,context,true)});
  return wrapped;
 });
}
