import {useState} from 'react';
import type {AssistantThreadTargetPage} from '../../../../shared/assistant-launch-contract';
import {useLocale} from '../../contexts/LocaleContext';import {Modal} from '../shared/Modal';
export function AssistantLaunchTargetPicker({items,busy,unavailable,hasMore,onMore,onContinue,onClose}:{items:AssistantThreadTargetPage['items'];busy:boolean;unavailable:boolean;hasMore:boolean;onMore:()=>void;onContinue:(existingThreadId?:string)=>void;onClose:()=>void}){
 const {t}=useLocale(),labels=t.assistant;const [threadId,setThreadId]=useState('');
 return <Modal open onClose={()=>{if(!busy)onClose();}} title={labels.launchTargetTitle} width="560px">
  <div className="space-y-3 [-webkit-app-region:no-drag]">
   <p className="text-sm text-[var(--c-text-secondary)]">{labels.launchTargetExplanation}</p>
   {unavailable&&<p role="status" className="text-xs text-[var(--c-text-secondary)]">{labels.launchTargetsUnavailable}</p>}
   <label className="block text-sm text-[var(--c-text-primary)]">{labels.launchTargetSelect}<select autoFocus disabled={busy} value={threadId} onChange={event=>setThreadId(event.target.value)} className="mt-2 block w-full rounded border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-2 py-2">
    <option value="">{labels.launchTargetNew}</option>{items.map(row=><option key={row.threadId} value={row.threadId} disabled={!row.available}>{row.title}</option>)}
   </select></label>
   {hasMore&&<button type="button" disabled={busy} onClick={onMore} className="text-xs text-[var(--c-accent)]">{labels.launchTargetsMore}</button>}
   <div className="flex justify-end gap-4"><button type="button" disabled={busy} onClick={onClose}>{labels.closeDetails}</button><button type="button" disabled={busy||!!threadId&&!items.some(row=>row.threadId===threadId&&row.available)} onClick={()=>onContinue(threadId||undefined)} className="text-[var(--c-accent)]">{labels.launchTargetContinue}</button></div>
  </div>
 </Modal>;
}
