import {useEffect,useRef,useState} from 'react';
import {api} from '../../api/bridge';
import {useLocale} from '../../contexts/LocaleContext';
import type {AssistantCalendarStatus} from '../../../../shared/assistant-calendar-observation-contract';
/** Manual readonly source; no second polling/scheduler owner. IPC owns identity,
 * origin admission, fixed resource selection and durable state. */
export function AssistantCalendarSourceCard(){
 const {t,locale}=useLocale(),labels=t.assistantCalendar;
 const [view,setView]=useState<AssistantCalendarStatus|null>(null),[busy,setBusy]=useState(true),[failed,setFailed]=useState(false);
 const mounted=useRef(false),pending=useRef(false);
 useEffect(()=>{let current=true;mounted.current=true;
  void api.getAssistantCalendarStatus().then(value=>{if(current)setView(value);},()=>{if(current)setFailed(true);}).finally(()=>{if(current)setBusy(false);});
  return()=>{current=false;mounted.current=false;};
 },[]);
 async function operate(kind:'connect'|'disconnect'|'refresh'){
  if(pending.current)return;pending.current=true;setBusy(true);setFailed(false);
  try{const value=await(kind==='connect'?api.connectAssistantCalendar():kind==='disconnect'?api.disconnectAssistantCalendar():api.refreshAssistantCalendar());if(mounted.current)setView(value);}
  catch{if(mounted.current)setFailed(true);}
  finally{pending.current=false;if(mounted.current)setBusy(false);}
 }
 const snapshot=failed?undefined:view?.snapshot,enabled=view?.enabled===true;
 return <section className="mt-3 rounded-xl border border-[var(--c-border-subtle)] p-4" aria-labelledby="assistant-calendar-title">
  <h2 id="assistant-calendar-title" className="text-sm font-medium">{labels.title}</h2>
  <p className="mt-2 text-xs text-[var(--c-text-secondary)]" role="status">{busy?labels.loading:failed||snapshot?.status==='unavailable'?labels.unavailable:snapshot?.status==='partial'?labels.partial:labels.disabled}</p>
  <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={()=>{void operate(enabled?'disconnect':'connect');}}>{enabled?labels.disconnect:labels.connect}</button>
  {enabled&&<button type="button" disabled={busy} onClick={()=>{void operate('refresh');}}>{labels.refresh}</button>}</div>
  {snapshot?.status==='partial'&&<><p className="mt-2 text-xs">{labels.count(snapshot.events.length)}</p><ul className="mt-2 space-y-2">{snapshot.events.map(event=><li key={event.id}><p>{event.title}</p><p className="text-xs text-[var(--c-text-secondary)]">{new Date(event.start).toLocaleString(locale)} – {new Date(event.end).toLocaleString(locale)}</p></li>)}</ul></>}
 </section>;
}
