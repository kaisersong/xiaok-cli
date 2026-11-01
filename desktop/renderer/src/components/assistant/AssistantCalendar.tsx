import type {AssistantCalendarMemorySettingsDto,AssistantCalendarMemoryInput} from '../../../../shared/assistant-calendar-memory-contract';
import type {AssistantCalendarStatus} from '../../../../shared/assistant-calendar-contract';
import {useLocale} from '../../contexts/LocaleContext';
export function AssistantCalendar({status,memory,onConfigureMemory,busy,onConnect,onDisconnect}:{status?:AssistantCalendarStatus;memory?:AssistantCalendarMemorySettingsDto;onConfigureMemory?:(input:AssistantCalendarMemoryInput)=>void;busy?:boolean;onConnect?:()=>void;onDisconnect?:()=>void}){
 const {t,locale}=useLocale();const labels=t.assistant;
 return <details className="mt-3 border-t border-[var(--c-border-subtle)] pt-2 text-xs text-[var(--c-text-secondary)] [-webkit-app-region:no-drag]">
  <summary className="cursor-pointer">{labels.calendarTitle}</summary>
  {status&&<p className="mt-2">{labels.calendarReadOnly}</p>}
  {status&&<p className="mt-1">{!status.enabled?labels.calendarDisabled:status.snapshot.status==='partial'?labels.calendarPartial:labels.calendarUnavailable}</p>}
  {status?.enabled&&status.snapshot.events.length>0&&<ul className="mt-2 space-y-1">{status.snapshot.events.map(event=><li key={event.id} className="break-words"><time>{new Date(event.start).toLocaleString(locale)}</time>{' · '}{event.title}</li>)}</ul>}
  {status?.enabled&&<p className="mt-1">{labels.calendarEvents(status.snapshot.recordCount??status.snapshot.events.length)}</p>}
  {status&&(status.enabled?onDisconnect&&<button type="button" disabled={busy} className="mt-2 text-[var(--c-accent)] disabled:opacity-50" onClick={onDisconnect}>{labels.calendarDisconnect}</button>:onConnect&&<button type="button" disabled={busy} className="mt-2 text-[var(--c-accent)] disabled:opacity-50" onClick={onConnect}>{labels.calendarConnect}</button>)}
  {memory&&<div className="mt-3 border-t border-[var(--c-border-subtle)] pt-2">
   <label className="flex items-start gap-2"><input type="checkbox" checked={memory.enabled} disabled={busy||!onConfigureMemory} onChange={event=>onConfigureMemory?.({enabled:event.currentTarget.checked,expectedRevision:memory.revision})}/><span>{labels.calendarMemoryConsent}</span></label>
   <p className="mt-1">{labels.calendarMemoryDescription}</p>
  </div>}
 </details>;
}
