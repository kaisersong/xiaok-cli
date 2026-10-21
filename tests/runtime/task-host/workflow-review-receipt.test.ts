import {expect,it} from 'vitest';
import {projectRuntimeEventToDesktopEvent} from '../../../src/runtime/task-host/event-projection.js';
const output={summary:'reference checked',artifacts:[],evidenceRefs:['artifact:reference.txt']};
function project(note:unknown){return projectRuntimeEventToDesktopEvent({taskId:'task',event:{type:'receipt_emitted',sessionId:'session',turnId:'turn',intentId:'intent',stepId:'step',note:JSON.stringify(note)}});}
it('preserves the complete record review decision envelope at the real receipt projection producer',()=>{
 const reviewDecision={status:'passed',reason:'reference read',evidenceRefs:['artifact:reference.txt']};const envelope={reviewDecision,output};
 expect(project(envelope)).toEqual({type:'result',result:{summary:output.summary,structuredOutput:envelope,artifacts:[]}});
});
it('retains the existing ordinary receipt output contract',()=>{expect(project({output})).toEqual({type:'result',result:{summary:output.summary,structuredOutput:output,artifacts:[]}});});
it('does not treat malformed scalar reviewDecision as a structured review envelope',()=>{expect(project({reviewDecision:'passed',output})).toEqual({type:'result',result:{summary:output.summary,structuredOutput:output,artifacts:[]}});});
