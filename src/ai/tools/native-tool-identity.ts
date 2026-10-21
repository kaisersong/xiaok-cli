import {isDeepStrictEqual} from 'node:util';
import type {Tool} from '../../types.js';
export type NativeToolKind='readonly'|'file'|'command';
interface Binding {kind:NativeToolKind;execute:Tool['execute'];permission:Tool['permission'];definition:Tool['definition'];precondition:Tool['compoundFilePrecondition'];readonlyEligibility:()=>boolean}
const nativeTools=new WeakMap<Tool,Binding>();
/** Host builtin factory registration, never a model or plugin descriptor field. */
export function registerBuiltinToolIdentity(tool:Tool,kind:NativeToolKind):void{
 if(nativeTools.has(tool)){if(getBuiltinToolIdentity(tool)!==kind)throw Error('compound_builtin_tool_changed');return;}
 nativeTools.set(tool,{kind,execute:tool.execute,permission:tool.permission,definition:structuredClone(tool.definition),precondition:tool.compoundFilePrecondition,readonlyEligibility:()=>kind==='readonly'});
}
export function getBuiltinToolIdentity(tool:Tool):NativeToolKind|undefined{
 const record=nativeTools.get(tool);if(!record)return undefined;
 if(record.execute!==tool.execute||record.permission!==tool.permission||record.precondition!==tool.compoundFilePrecondition||!isDeepStrictEqual(record.definition,tool.definition))throw Error('compound_builtin_tool_changed');
 return record.kind;
}
/** Called only by audited host sandbox/registry wrappers, not tool registration. */
export function isNativeReadonlyExecutionEligible(tool:Tool):boolean{
 const binding=nativeTools.get(tool);if(!binding||getBuiltinToolIdentity(tool)!=='readonly')return false;
 return binding.readonlyEligibility();
}
export function inheritBuiltinToolIdentity(source:Tool,target:Tool, auditedReadonlyGuard?:()=>boolean):void{
 const kind=getBuiltinToolIdentity(source);if(!kind)return;
 registerBuiltinToolIdentity(target,kind);
 const clone=target.execute===source.execute&&target.permission===source.permission&&target.compoundFilePrecondition===source.compoundFilePrecondition&&isDeepStrictEqual(target.definition,source.definition);
 nativeTools.get(target)!.readonlyEligibility=()=>isNativeReadonlyExecutionEligible(source)&&(clone||auditedReadonlyGuard?.()===true);
}

