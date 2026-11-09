import {useLocale} from '../contexts/LocaleContext';
import type {NativeActivityQuestionForm} from '../../../shared/native-activity-question-contract.js';
import type {NeedsUserQuestion} from '../../../shared/task-types.js';

export type NativeAnswerState='pending'|'accepted'|'uncertain';
export const nativeAnswerKey=(form:NativeActivityQuestionForm)=>JSON.stringify([form.questionRef,form.expectedDigest]);
export interface NativeTaskScope {taskId:string;taskSessionId:string}
export interface NativeActivityCoverage {threadId:string;forbiddenScopes:ReadonlyArray<NativeTaskScope>;questions:ReadonlyArray<NativeTaskScope&{questionId:string}>}
export function questionOutsideNativeActivity(question:NeedsUserQuestion|null,threadId:string|undefined,coverage:NativeActivityCoverage|null):NeedsUserQuestion|null{
  if(!question||question.owner?.kind!=='codex_native_approval'||!coverage||coverage.threadId!==threadId)return question;
  return coverage.forbiddenScopes.some(item=>item.taskId===question.taskId&&item.taskSessionId===question.owner!.taskSessionId)||coverage.questions.some(item=>item.taskId===question.taskId&&item.taskSessionId===question.owner!.taskSessionId&&item.questionId===question.questionId&&item.questionId===question.owner!.approvalToken)?null:question;
}

/** Forms and action receipts are transient UI state; Main owns every question. */
export function NativeWorkControls({forms,states,error,onAnswer,onRefresh}:{forms:NativeActivityQuestionForm[];states:ReadonlyMap<string,NativeAnswerState>;error:boolean;
  onAnswer(form:NativeActivityQuestionForm,choiceId:'approve'|'deny'):void;onRefresh():void}){
  const{t}=useLocale(),labels=t.conversationActivity;
  return <div className="mt-3 space-y-3">
    {forms.map(form=>{const state=states.get(nativeAnswerKey(form));return <section key={nativeAnswerKey(form)} data-testid={`native-question-${form.questionRef}`} className="space-y-2 rounded border border-[var(--c-border)] p-3">
      <p className="whitespace-pre-wrap break-words text-sm">{form.prompt}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={Boolean(state)} onClick={()=>onAnswer(form,'approve')} className="text-xs text-[var(--c-accent)]">{labels.nativeApprove}</button>
        <button type="button" disabled={Boolean(state)} onClick={()=>onAnswer(form,'deny')} className="text-xs text-[var(--c-text-secondary)]">{labels.nativeDeny}</button>
      </div>
      {state==='pending'&&<p role="status" className="text-xs text-[var(--c-text-muted)]">{labels.nativeSubmitting}</p>}
      {state==='accepted'&&<p role="status" className="text-xs text-[var(--c-text-muted)]">{labels.nativeAnswered}</p>}
      {state==='uncertain'&&<p role="alert" className="text-xs text-[var(--c-error)]">{labels.nativeAnswerUnconfirmed}</p>}
    </section>;})}
    {error&&<p role="alert" className="text-xs text-[var(--c-error)]">{labels.error}</p>}
    {(error||forms.some(form=>states.get(nativeAnswerKey(form))==='uncertain'))&&<button type="button" onClick={onRefresh} className="text-xs text-[var(--c-accent)]">{labels.nativeRefresh}</button>}
  </div>;
}
