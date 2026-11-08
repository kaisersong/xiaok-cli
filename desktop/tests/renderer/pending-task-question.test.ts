import{expect,it}from'vitest';
import{pendingTaskQuestion}from'../../renderer/src/lib/pending-task-question';
import type{DesktopTaskEvent}from'../../shared/task-types';
const question:Extract<DesktopTaskEvent,{type:'needs_user'}>={type:'needs_user',question:{taskId:'A',questionId:'qa',kind:'freeform',prompt:'QA',choices:[{id:'a',label:'QA choice'}]}};
it('restores only an unresolved question owned by the same waiting task',()=>{expect(pendingTaskQuestion({taskId:'A',status:'waiting_user',events:[question]})).toEqual(question.question);expect(pendingTaskQuestion({taskId:'B',status:'waiting_user',events:[question]})).toBeNull();});
it('does not resurrect a resolved question or an older superseded question',()=>{expect(pendingTaskQuestion({taskId:'A',status:'waiting_user',events:[question,{type:'question_resolved',questionId:'qa',answerText:'done'}]})).toBeNull();});
it.each(['running','completed','failed','cancelled'] as const)('keeps %s snapshots non-interactive',status=>{expect(pendingTaskQuestion({taskId:'A',status,events:[question]})).toBeNull();});
it('does not restore input after a cancellation or terminal boundary',()=>{expect(pendingTaskQuestion({taskId:'A',status:'waiting_user',events:[question,{type:'task_terminal',status:'cancelled'}]})).toBeNull();});
