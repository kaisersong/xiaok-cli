import type {NeedsUserQuestion,TaskSnapshot} from '../../../shared/task-types';
/** Restore presentation only; Main still owns whether a live answer can be accepted. */
export function pendingTaskQuestion(snapshot:Pick<TaskSnapshot,'taskId'|'status'|'events'>|undefined):NeedsUserQuestion|null {
 if(snapshot?.status!=='waiting_user')return null;
 const resolved=new Set<string>();
 for(let i=snapshot.events.length-1;i>=0;i--){
  const event=snapshot.events[i];
  if(event.type==='task_terminal'||event.type==='task_cancelled')return null;
  if(event.type==='question_resolved')resolved.add(event.questionId);
  if(event.type==='needs_user')return event.question.taskId===snapshot.taskId&&!resolved.has(event.question.questionId)?event.question:null;
 }
 return null;
}
