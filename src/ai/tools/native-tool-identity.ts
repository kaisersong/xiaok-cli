import {isDeepStrictEqual} from 'node:util';
import type {Tool} from '../../types.js';
export type NativeToolKind='readonly'|'file'|'command';
interface Binding {kind:NativeToolKind;execute:Tool['execute'];permission:Tool['permission'];definition:Tool['definition'];precondition:Tool['compoundFilePrecondition']}
const nativeTools=new WeakMap<Tool,Binding>();
/** Host builtin factory registration, never a model or plugin descriptor field. */
export function registerBuiltinToolIdentity(tool:Tool,kind:NativeToolKind):void{
 if(nativeTools.has(tool)){if(getBuiltinToolIdentity(tool)!==kind)throw Error('compound_builtin_tool_changed');return;}
 nativeTools.set(tool,{kind,execute:tool.execute,permission:tool.permission,definition:structuredClone(tool.definition),precondition:tool.compoundFilePrecondition});
}
export function getBuiltinToolIdentity(tool:Tool):NativeToolKind|undefined{
 const record=nativeTools.get(tool);if(!record)return undefined;
 if(record.execute!==tool.execute||record.permission!==tool.permission||record.precondition!==tool.compoundFilePrecondition||!isDeepStrictEqual(record.definition,tool.definition))throw Error('compound_builtin_tool_changed');
 return record.kind;
}
/** Called only by audited host sandbox/registry wrappers, not tool registration. */
export function inheritBuiltinToolIdentity(source:Tool,target:Tool):void{
 const kind=getBuiltinToolIdentity(source);if(kind)registerBuiltinToolIdentity(target,kind);
}
