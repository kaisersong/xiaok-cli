import type {AssistantLaunchSummary} from '../../../../shared/assistant-launch-contract';import {useLocale} from '../../contexts/LocaleContext';
export function AssistantLaunchHistory({items,busy,onOpen,onLookup,onResolve,onReconfirm,onCancel}:{items:AssistantLaunchSummary[];busy:boolean;onOpen:(item:AssistantLaunchSummary)=>void;onLookup:(item:AssistantLaunchSummary)=>void;onResolve:(item:AssistantLaunchSummary)=>void;onReconfirm?:(item:AssistantLaunchSummary)=>void;onCancel?:(item:AssistantLaunchSummary)=>void}){
 const {t}=useLocale();const labels=t.assistant;if(!items.length)return null;
 return <section className="mt-3 space-y-3 rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-4 py-3 [-webkit-app-region:no-drag]" aria-label={labels.launchHistoryTitle}>
  <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{labels.launchHistoryTitle}</h3>
  {items.map(item=>{const resolved=!!item.resultDigest&&item.resultDigest===item.resolvedDigest;const stopping=!!item.cancelRequestedAt&&!['completed','failed','cancelled'].includes(item.taskStatus??'');const state=stopping?'stopping':item.taskStatus==='waiting_user'?'needs_input':item.taskStatus==='failed'?'failed':item.taskStatus==='cancelled'?'cancelled':item.taskStatus==='completed'?resolved?'resolved':'ready_for_review':item.state==='outcome_unknown'?'unknown':item.state==='blocked'?'blocked':item.taskStatus==='running'?'working':'preparing';return <div key={item.operationId} className="text-xs">
   <p className="font-medium text-[var(--c-text-primary)]">{item.title}</p><p className="mt-1 text-[var(--c-text-secondary)]">{labels.launchState(state)}</p>
   <div className="mt-1 flex flex-wrap gap-3 text-[var(--c-accent)]">
    {item.state==='attached'&&item.taskId&&<button type="button" disabled={busy} onClick={()=>onOpen(item)}>{labels.launchOpen}</button>}
    <button type="button" disabled={busy} onClick={()=>onLookup(item)}>{labels.launchLookup}</button>
    {onCancel&&item.state!=='cancelled'&&!['completed','failed','cancelled'].includes(item.taskStatus??'')&&!item.cancelRequestedAt&&<button type="button" disabled={busy} onClick={()=>onCancel(item)}>{labels.launchCancel}</button>}
    {onReconfirm&&item.state==='blocked'&&item.taskId===null&&<button type="button" disabled={busy} onClick={()=>onReconfirm(item)}>{labels.launchReconfirm}</button>}
    {item.resultDigest&&!resolved&&<button type="button" disabled={busy} onClick={()=>onResolve(item)}>{labels.launchResolve}</button>}
   </div>
  </div>;})}
 </section>;
}
