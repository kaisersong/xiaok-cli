import type {DesktopTaskEvent,NeedsUserQuestion,TaskSnapshot} from '../../../shared/task-types.js';
export interface NativeQuestionPresentation {namespace?:string;native:NeedsUserQuestion[];current:NeedsUserQuestion|null}
export const emptyNativeQuestionPresentation=():NativeQuestionPresentation=>({native:[],current:null});
/** Display identity only. Every actual answer remains authorized by Main. */
export function nativeQuestionNamespace(question:NeedsUserQuestion):string|undefined{
 const owner=question.owner;if(owner?.kind!=='codex_native_approval'||owner.approvalToken!==question.questionId)return undefined;
 return JSON.stringify([question.taskId,owner.taskSessionId,owner.nativeIncarnation,owner.nativeSessionId,owner.nativeThreadId,owner.nativeTurnId,owner.nativeTurnGeneration]);
}
/** Same-source stream projection, synchronously applied before React updates. */
export function reduceNativeQuestionPresentation(state:NativeQuestionPresentation,event:DesktopTaskEvent,taskId:string):NativeQuestionPresentation{
 if(event.type==='task_terminal'||event.type==='task_cancelled'||event.type==='result')return emptyNativeQuestionPresentation();
 if(event.type==='needs_user'){
  const question=event.question;
  if(question.owner?.kind!=='codex_native_approval')return{...state,current:question};
  const namespace=nativeQuestionNamespace(question);if(question.taskId!==taskId||!namespace)return state;
  const pending=state.namespace===namespace?state.native:[];
  return{namespace,native:[...pending.filter(item=>item.questionId!==question.questionId),question],current:question};
 }
 if(event.type==='question_resolved'){
  const pending=state.native.filter(item=>item.questionId!==event.questionId);
  return{...state,native:pending,current:state.current?.questionId===event.questionId?pending.at(-1)??null:state.current};
 }
 return state;
}
export function nativeQuestionPresentationFromSnapshot(snapshot:Pick<TaskSnapshot,'taskId'|'status'|'events'>):NativeQuestionPresentation{
 if(!['running','waiting_user'].includes(snapshot.status))return emptyNativeQuestionPresentation();
 const state=snapshot.events.reduce((state,event)=>reduceNativeQuestionPresentation(state,event,snapshot.taskId),emptyNativeQuestionPresentation());
 return state.native.length?{...state,current:state.current?.owner?.kind==='codex_native_approval'?state.current:state.native.at(-1)??null}
  :snapshot.status==='waiting_user'?state:{...state,current:null};
}
