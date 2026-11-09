import {useState} from 'react';import type {AssistantPeriodicStatus,AssistantPeriodicSettings as Settings} from '../../../../shared/assistant-periodic-contract';import {useLocale} from '../../contexts/LocaleContext';
export function AssistantPeriodicSettings({status,busy,onSave,onCheck}:{status:AssistantPeriodicStatus;busy:boolean;onSave:(input:Settings)=>void;onCheck:()=>void}){
 const {t}=useLocale(),labels=t.assistant;const [enabled,setEnabled]=useState(status.enabled),[notifications,setNotifications]=useState(status.notificationsEnabled),[interval,setInterval]=useState(status.intervalMinutes),[start,setStart]=useState(status.quietHours.start),[end,setEnd]=useState(status.quietHours.end);
 const unavailable=!status.available&&!status.enabled;
 return <details className="mt-3 border-t border-[var(--c-border-subtle)] pt-2 text-xs text-[var(--c-text-secondary)] [-webkit-app-region:no-drag]">
  <summary className="cursor-pointer">{labels.periodicTitle(status.enabled)}</summary>
  <p className="mt-2">{labels.periodicWindow}</p><p className="mt-1">{labels.periodicBudget}</p>
  {status.reason&&<p className="mt-1">{labels.periodicReason(status.reason)}</p>}
  <form className="mt-3 space-y-3" onSubmit={event=>{event.preventDefault();onSave({enabled,notificationsEnabled:notifications,intervalMinutes:interval,quietHours:{start,end},expectedRevision:status.revision});}}>
   <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={busy||unavailable} onChange={event=>setEnabled(event.target.checked)}/>{labels.periodicEnable}</label>
   <label className="flex flex-wrap items-center gap-2">{labels.periodicInterval}<select disabled={busy||unavailable} value={interval} onChange={event=>setInterval(Number(event.target.value))} className="rounded border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-2 py-1">{[30,60,120,240,480,720,1440].map(value=><option key={value} value={value}>{labels.periodicEveryMinutes(value)}</option>)}</select></label>
   <label className="flex items-center gap-2"><input type="checkbox" checked={notifications} disabled={busy||!status.available||!enabled||!status.notificationsAvailable} onChange={event=>setNotifications(event.target.checked)}/>{labels.periodicNotifications}</label>
   {status.available&&!status.notificationsAvailable&&<p>{labels.periodicNotificationsUnavailable}</p>}
   <div className="flex flex-wrap items-center gap-2"><span>{labels.periodicQuietHours}</span><label>{labels.periodicQuietStart}<input aria-label={labels.periodicQuietStart} type="time" value={start} disabled={busy||unavailable} onChange={event=>setStart(event.target.value)} className="ml-1 rounded border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-1 py-1"/></label><label>{labels.periodicQuietEnd}<input aria-label={labels.periodicQuietEnd} type="time" value={end} disabled={busy||unavailable} onChange={event=>setEnd(event.target.value)} className="ml-1 rounded border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-1 py-1"/></label></div>
   <div className="flex flex-wrap gap-4 text-[var(--c-accent)]"><button type="submit" disabled={busy||unavailable} className="disabled:opacity-50">{labels.periodicSave}</button><button type="button" disabled={busy||!status.enabled||!status.available} className="disabled:opacity-50" onClick={onCheck}>{labels.periodicCheck}</button></div>
  </form>
 </details>;
}
