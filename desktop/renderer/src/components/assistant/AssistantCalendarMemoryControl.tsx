import {useEffect,useRef,useState} from 'react';
import {api} from '../../api/bridge';
import {useLocale} from '../../contexts/LocaleContext';
import type {AssistantCalendarMemorySettingsDto} from '../../../../shared/assistant-calendar-memory-contract';
/** Explicit user opt-in. Calendar connection never grants memory consent. */
export function AssistantCalendarMemoryControl({onChanged}:{onChanged?:()=>void}){
 const {t}=useLocale(),labels=t.assistantCalendar;
 const [view,setView]=useState<AssistantCalendarMemorySettingsDto|null>(null),[busy,setBusy]=useState(true),[failed,setFailed]=useState(false),mounted=useRef(false),pending=useRef(false);
 useEffect(()=>{let current=true;mounted.current=true;void api.getAssistantCalendarMemorySettings().then(value=>{if(current)setView(value);},()=>{if(current)setFailed(true);}).finally(()=>{if(current)setBusy(false);});return()=>{current=false;mounted.current=false;};},[]);
 async function change(enabled:boolean){
  if(!view||pending.current)return;pending.current=true;setBusy(true);setFailed(false);
  try{const next=await api.configureAssistantCalendarMemory({enabled,expectedRevision:view.revision});if(mounted.current){setView(next);onChanged?.();}}
  catch{if(mounted.current){setFailed(true);setView(null);}}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 return <div className="mt-3 border-t border-[var(--c-border-subtle)] pt-3">
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={view?.enabled===true} disabled={busy||!view} onChange={event=>{void change(event.currentTarget.checked);}}/>{labels.memoryOptIn}</label>
  <p className="mt-1 text-xs text-[var(--c-text-secondary)]">{labels.memoryNotice}</p>
  {failed&&<p role="status" className="mt-1 text-xs">{labels.memoryUnavailable}</p>}
 </div>;
}
