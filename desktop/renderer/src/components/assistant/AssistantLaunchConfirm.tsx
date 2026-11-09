import {useState} from 'react';
import type {AssistantLaunchDraft} from '../../../../shared/assistant-launch-contract';
import {useLocale} from '../../contexts/LocaleContext';import {Modal} from '../shared/Modal';
interface AssistantLaunchConfirmProps {draft:AssistantLaunchDraft;busy:boolean;unknown:boolean;onConfirm:(instruction:string,goalConsentChecked?:boolean)=>void;onClose:()=>void;onLookup:()=>void}
export function AssistantLaunchConfirm(props:AssistantLaunchConfirmProps){
 return <AssistantLaunchConfirmForm key={`${props.draft.id}:${props.draft.threadTarget?.goalBinding?.consentId??''}`} {...props}/>;
}
function AssistantLaunchConfirmForm({draft,busy,unknown,onConfirm,onClose,onLookup}:AssistantLaunchConfirmProps){
 const {t}=useLocale();const [instruction,setInstruction]=useState(draft.instruction);const labels=t.assistant;
 const [goalConsentChecked,setGoalConsentChecked]=useState(false);const goal=draft.threadTarget?.goalBinding?.state;
 const evidenceLabels={answer:t.goalBar.evidenceAnswer,file_artifact:t.goalBar.evidenceFile,command_action:t.goalBar.evidenceCommand,project_update:t.goalBar.evidenceProject};
 return <Modal open onClose={()=>{if(!busy)onClose();}} title={labels.launchTitle} width="600px">
  <div role="dialog" aria-modal="true" aria-label={labels.launchTitle} className="space-y-3 [-webkit-app-region:no-drag]">
   <p className="text-sm text-[var(--c-text-primary)]">{draft.title}</p>
   <p className="text-xs text-[var(--c-text-secondary)]">{labels.launchConsent}</p>
   {draft.threadTarget&&<p className="break-all text-sm text-[var(--c-text-primary)]">{draft.threadTarget.title}</p>}
   {goal&&<fieldset className="min-w-0 space-y-2 rounded-md border border-[var(--c-border-subtle)] p-3" disabled={busy||unknown}>
    <legend className="px-1 text-sm font-medium text-[var(--c-text-primary)]">{labels.launchGoalHeading}</legend>
    <p className="whitespace-pre-wrap break-words text-sm text-[var(--c-text-primary)]">{goal.objective}</p>
    <p className="text-xs text-[var(--c-text-secondary)]">{labels.launchGoalCompletion}</p>
    {goal.completionCriterion&&<p className="whitespace-pre-wrap break-words text-sm text-[var(--c-text-primary)]">{goal.completionCriterion}</p>}
    <p className="text-xs text-[var(--c-text-secondary)]">{t.goalBar.evidence}</p>
    <ul className="list-inside list-disc text-xs text-[var(--c-text-primary)]">{goal.expectedEvidenceKinds.map(kind=><li key={kind}>{evidenceLabels[kind]}</li>)}</ul>
    <p className="text-xs text-[var(--c-text-secondary)]">{labels.launchGoalBudget(Math.max(0,goal.budgetLimits.turnLimit-goal.turnsUsed),goal.budgetLimits.tokenLimit===undefined?null:Math.max(0,goal.budgetLimits.tokenLimit-goal.tokensUsed))}</p>
    <p className="text-xs text-[var(--c-text-secondary)]">{labels.launchGoalWallClock(goal.budgetLimits.activeWallClockLimitMs===undefined?null:Math.max(0,goal.budgetLimits.activeWallClockLimitMs-goal.activeWallClockMs))}</p>
    <label className="flex items-start gap-2 text-xs text-[var(--c-text-primary)]"><input type="checkbox" checked={goalConsentChecked} disabled={busy||unknown} onChange={event=>setGoalConsentChecked(event.target.checked)}/><span className="break-words">{labels.launchGoalConsent(goal.objective)}</span></label>
   </fieldset>}
   <label className="block text-xs text-[var(--c-text-secondary)]">{labels.launchInstruction}<textarea autoFocus value={instruction} maxLength={4000} disabled={busy||unknown} onChange={event=>setInstruction(event.target.value)} className="mt-1 min-h-40 w-full resize-y rounded-md border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] p-2 text-sm text-[var(--c-text-primary)]"/></label>
   <p className="text-xs text-[var(--c-text-secondary)]">{labels.launchWorkspace}</p><p className="break-all text-xs text-[var(--c-text-primary)]">{draft.domain.cwd}</p>
   {unknown&&<p role="status" className="text-xs text-[var(--c-text-secondary)]">{labels.launchUnknown}</p>}
   <div className="flex flex-wrap justify-end gap-3">
    <button type="button" disabled={busy} onClick={onClose} className="text-xs text-[var(--c-text-secondary)]">{labels.launchClose}</button>
    {unknown&&<button type="button" disabled={busy} onClick={onLookup} className="text-xs text-[var(--c-accent)]">{labels.launchLookup}</button>}
    <button type="button" disabled={busy||unknown||!instruction.trim()||!!goal&&!goalConsentChecked} onClick={()=>{if(busy||unknown||!instruction.trim()||goal&&!goalConsentChecked)return;if(goal)onConfirm(instruction,true);else onConfirm(instruction);}} className="rounded-md bg-[var(--c-accent)] px-3 py-2 text-xs text-white disabled:opacity-50">{labels.launchConfirm}</button>
   </div>
  </div>
 </Modal>;
}
