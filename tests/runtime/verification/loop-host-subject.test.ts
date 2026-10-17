import {expect,it} from 'vitest';
import {parseLoopHostSubject,loopHostSubjectHash,loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {completionConsumerOwner} from '../../../src/runtime/verification/completion-consumer-owner.js';
const run={kind:'loop-run',loopId:'loop',runId:'run',stage:null};
it('captures actual host run identity without inventing a chat session or execution invocation',()=>{
 const captured=parseLoopHostSubject(run);expect(captured).toEqual(run);expect(Object.isFrozen(captured)).toBe(true);
 expect(loopHostSubjectOwner(captured)).toEqual(completionConsumerOwner({ownerKind:'loop_run',ownerId:'run'}));
 expect(loopHostSubjectHash(captured)).not.toBe(loopHostSubjectHash({...run,loopId:'other'}));
});
it('isolates stage and run namespaces and freezes the actual stage identity',()=>{
 const source={...run,stage:{stageId:'run',stageKind:'verify'}};const captured=parseLoopHostSubject(source);
 source.stage.stageKind='execute';expect(captured.stage?.stageKind).toBe('verify');expect(Object.isFrozen(captured.stage)).toBe(true);
 expect(loopHostSubjectOwner(captured)).toEqual(completionConsumerOwner({ownerKind:'loop_stage',ownerId:'run'}));
 expect(loopHostSubjectOwner(captured)).not.toEqual(loopHostSubjectOwner(run));
 expect(loopHostSubjectHash(captured)).not.toBe(loopHostSubjectHash(source));
});
it.each([
 {...run,sessionId:'invented'}, {...run,invocations:[]}, {...run,profileId:'caller'}, {...run,kind:'goal'},
 {...run,stage:{stageId:'stage',stageKind:'verify',ordinal:1}}, {...run,stage:{stageId:'stage',stageKind:'completed'}},
 {...run,stage:[]}, {...run,runId:''}, {...run,runId:'line\nbreak'}, {...run,loopId:'中'.repeat(54)},
 {...run,stage:{stageId:'a'.repeat(161),stageKind:'verify'}}, {...run,stage:undefined},
])('rejects extra identities, invented stage positions and invalid source bytes',raw=>{
 expect(()=>parseLoopHostSubject(raw)).toThrow();
});
it('preserves exact case and spaces rather than normalizing distinct owners',()=>{
 expect(loopHostSubjectOwner({...run,runId:'RUN'})).not.toEqual(loopHostSubjectOwner(run));
 expect(loopHostSubjectOwner({...run,runId:' run'})).not.toEqual(loopHostSubjectOwner(run));
});
