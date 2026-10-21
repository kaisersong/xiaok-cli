import {it,expect} from 'vitest';
import {bindManagedCompoundSpawnTool,getManagedCompoundSpawnAdapter} from '../../../src/runtime/sol-pi/compound-managed-tool.js';
import type {Tool} from '../../../src/types.js';
it('recognizes only the exact host wrapper and invalidates handler/schema/permission drift',()=>{
 const tool:Tool={definition:{name:'spawn_agent',description:'host',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=>''};
 const adapter={inspectPreparation(){throw Error('untrusted preparation');}};
 expect(getManagedCompoundSpawnAdapter(tool)).toBeUndefined();bindManagedCompoundSpawnTool(tool,adapter);
 expect(getManagedCompoundSpawnAdapter(tool)).toBeDefined();expect(getManagedCompoundSpawnAdapter({...tool})).toBeUndefined();
 const execute=tool.execute;tool.execute=async()=> 'changed';expect(getManagedCompoundSpawnAdapter(tool)).toBeUndefined();tool.execute=execute;
 tool.definition.description='changed';expect(getManagedCompoundSpawnAdapter(tool)).toBeUndefined();
});
