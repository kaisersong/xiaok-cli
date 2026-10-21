import {it,expect} from 'vitest';
import {createLoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';

it('checks the complete Loop candidate shape before parsing a malformed trigger',()=>{
 const raw:any={version:1,kind:'loop',subject:{},candidateId:'candidate',candidateRevision:1,originalTriggerJson:'{',logicalRunKey:null,contract:{},body:{},unexpected:true};
 expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_shape');
});
it.each([['blank',' '],['non-string',42],['oversized','x'.repeat(65537)]] as const)('preserves the Loop trigger label for %s input',(_name,trigger)=>{
 const raw:any={version:1,kind:'loop',subject:{kind:'loop-run',loopId:'loop',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,originalTriggerJson:trigger,logicalRunKey:null,contract:{},body:{}};
 expect(()=>createLoopApplicationBinding(raw)).toThrow(_name==='oversized'?'loop_application_limit':'loop_application_text');
});
