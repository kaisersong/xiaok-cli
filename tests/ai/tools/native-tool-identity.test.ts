import {expect,it} from 'vitest';import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';import {grepTool} from '../../../src/ai/tools/grep.js';
it('a plugin name/readOnly property does not issue builtin identity',()=>{
 const native=buildToolList().find(t=>t.definition.name==='read')!;expect(getBuiltinToolIdentity(native)).toBe('readonly');
 expect(getBuiltinToolIdentity({...native})).toBeUndefined();expect(getBuiltinToolIdentity({...native,readOnly:true} as any)).toBeUndefined();
 const registry=new ToolRegistry({autoMode:true},[native]);const fork=registry.forkForObservation([],['read']);try{fork.installCompoundExecutionPort(tools=>{expect(getBuiltinToolIdentity(tools[0])).toBe('readonly');return{execute:async()=> 'blocked'};});}finally{fork.dispose();registry.dispose();}
});
it('later builtin construction cannot rebrand a changed singleton execute',()=>{
 const execute=grepTool.execute;try{grepTool.execute=async()=> 'changed';expect(()=>buildToolList()).toThrow('compound_builtin_tool_changed');}finally{grepTool.execute=execute;}
 expect(getBuiltinToolIdentity(grepTool)).toBe('readonly');
});
