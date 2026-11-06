import {useLocale} from '../../contexts/LocaleContext';
import type {AttentionItem,AttentionAction,AssistantCoverage} from '../../../../shared/assistant-inbox-contract';
export interface AttentionControls {busy:boolean;onStart:(item:AttentionItem)=>void;onOpen:(item:AttentionItem)=>void;onAct:(item:AttentionItem,action:AttentionAction['action'])=>void;onAnswer?:(item:AttentionItem,choiceId:string)=>void}
export function AssistantAttentionList({items,...controls}:AttentionControls&{items:AttentionItem[]}){const {t}=useLocale(),l=t.assistantInbox;return <ul className="divide-y divide-[var(--c-border-subtle)]">{items.map(item=><li key={item.id} className="py-3"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-medium">{item.title}</span><span className="text-[10px] text-[var(--c-text-tertiary)]">{l.sources[item.source]} · {l.statuses[item.status]}</span></div><p className="mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">{item.reason}</p>{item.outcome&&<p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--c-text-secondary)]">{item.outcome}</p>}{item.status==='unknown'&&<p className="mt-2 text-xs text-[var(--c-text-secondary)]">{l.unknownTask}</p>}<div className="mt-2 flex flex-wrap gap-3 text-xs"><button type="button" disabled={controls.busy||(['working','unknown'].includes(item.status)&&!item.taskId)} className="text-[var(--c-accent)] disabled:opacity-40" onClick={()=>item.taskId&&item.status!=='failed'?controls.onOpen(item):controls.onStart(item)}>{item.status==='failed'?l.retry:item.taskId?l.open:l.start}</button><button type="button" disabled={controls.busy} onClick={()=>controls.onAct(item,'snooze')} className="text-[var(--c-text-tertiary)]">{l.snooze}</button><button type="button" disabled={controls.busy} onClick={()=>controls.onAct(item,'hide')} className="text-[var(--c-text-tertiary)]">{l.hide}</button><button type="button" disabled={controls.busy} onClick={()=>controls.onAct(item,'resolve')} className="text-[var(--c-text-tertiary)]">{l.resolve}</button></div></li>)}</ul>;}
export function AssistantCoverageView({coverage}:{coverage:AssistantCoverage[]}) {
 const {t,locale}=useLocale(),l=t.assistantInbox;
 if(!coverage.length)return null;
 return <details open={coverage.some(c=>c.state!=='ok')} className="mt-3 text-xs text-[var(--c-text-tertiary)]">
  <summary className="cursor-pointer">{l.coverage}</summary>
  <ul className="mt-2 space-y-2">{coverage.map(c=><li key={c.key}>
   {l.sources[c.source]} · {c.state==='ok'?l.coverageStates.ok:c.code?l.coverageReasons[c.code]:l.coverageStates[c.state]}
   <span className="ml-2 opacity-70">{new Date(c.checkedAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}</span>
  </li>)}</ul>
 </details>;
}
