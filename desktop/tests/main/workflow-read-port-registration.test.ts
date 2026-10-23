import {it,expect} from 'vitest';
import * as checkpoint from '../../../src/runtime/task-host/workflow-restriction-checkpoint.ts';

it('an arbitrary request data-property callback cannot register a native workflow service',()=>{
 let calls=0;
 const counterfeit={request:async()=>{calls++;throw Error('counterfeit_callback_must_never_run');}};
 const unsafe=(checkpoint as unknown as Record<string,unknown>).registerNativeWorkflowReadService;
 if(typeof unsafe==='function')expect(()=>unsafe(counterfeit)).toThrow();
 else expect(unsafe).toBeUndefined();
 const fixed=(checkpoint as unknown as Record<string,unknown>).createNativeWorkflowReadPort;
 if(typeof fixed==='function')expect(()=>fixed(counterfeit)).toThrow('workflow_stored_restrictions_denied');
 expect(calls).toBe(0);
});

it('a copied opaque port cannot be accepted as native',()=>{
 expect(()=>checkpoint.assertNativeWorkflowReadPort(Object.freeze(Object.create(null)))).toThrow('workflow_stored_restrictions_denied');
});
