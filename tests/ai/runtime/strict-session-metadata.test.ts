import {expect,it} from 'vitest';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {projectStrictToolExecutionContext} from '../../../src/ai/runtime/provider-private-projection.js';
import {createCompoundOperationLedger} from '../../../src/runtime/sol-pi/compound-operation.js';
function context(){const session=new AgentSessionState();return {taskId:'task',session:session.exportSnapshot(),messages:session.getMessages(),systemPrompt:'system',toolDefinitions:[]};}
it('validates durable control metadata without disclosing it as projected session state',()=>{
 const c=context();Object.assign(c.session,{storeRevision:3,historyDigest:'a'.repeat(64),executionProtected:true,compoundOperations:createCompoundOperationLedger(),semanticCompaction:{version:1,currency:'USD',generation:0,policies:[],reservations:[],commits:[]}});
 const projected=projectStrictToolExecutionContext(c);expect(projected.session).not.toHaveProperty('storeRevision');expect(projected.session).not.toHaveProperty('semanticCompaction');expect(projected.session).not.toHaveProperty('compoundOperations');
});
it.each([{storeRevision:-1},{storeRevision:1.5},{historyDigest:'bad'},{executionProtected:false},{semanticCompaction:{}},{compoundOperations:{}}])('rejects malformed host fields %j',metadata=>{const c=context();Object.assign(c.session,metadata);expect(()=>projectStrictToolExecutionContext(c)).toThrow();});
