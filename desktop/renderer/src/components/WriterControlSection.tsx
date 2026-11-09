import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api/bridge';
import type {WriterControlResult} from '../api/types';
import {useLocale} from '../contexts/LocaleContext';
type Operation='inspect'|'prepare';
/** Local presentation only. Permission, pending transport and uncertain outcomes
 * belong to Main. Closing this view does not cancel an admitted mutation. */
export function WriterControlSection(){
 const {t}=useLocale(),labels=t.desktopSettings;
 const [data,setData]=useState<WriterControlResult|null>(null),[busy,setBusy]=useState<Operation|null>(null),[readFailed,setReadFailed]=useState(false),[unknown,setUnknown]=useState(false);
 const mounted=useRef(false),generation=useRef(0),sequence=useRef(0),inFlight=useRef<{generation:number;ticket:number}|null>(null),unknownRef=useRef(false);
 const readInFlight=useRef<Promise<WriterControlResult>|null>(null);
 const perform=useCallback(async(operation:Operation)=>{
  if(!mounted.current||inFlight.current||operation==='prepare'&&unknownRef.current)return;
  const request={generation:generation.current,ticket:++sequence.current};inFlight.current=request;setBusy(operation);
  const current=()=>mounted.current&&generation.current===request.generation&&inFlight.current===request;
  const accept=(value:WriterControlResult)=>{if(!current())return;setData(value);setReadFailed(false);if(!value.ok&&value.reason==='outcome_unknown'){unknownRef.current=true;setUnknown(true);}};
  const observe=async()=>{
   // StrictMode may replace an effect generation while its read still runs.
   // Share only that pending observation, never an action or settled result.
   const raw=readInFlight.current??api.inspectWriterConfiguration();readInFlight.current=raw;
   try{return await raw;}finally{if(readInFlight.current===raw)readInFlight.current=null;}
  };
  try{
   if(operation==='inspect')accept(await observe());
   else{
    const result=await api.prepareWriterConfiguration();if(!current())return;accept(result);
    // A follow-up observation cannot replace a known refusal or clear unknown.
    try{const observation=await observe();if(current()&&result.ok)accept(observation);}
    catch{if(current())setReadFailed(true);}
   }
  }catch{
   if(current()){if(operation==='prepare'){unknownRef.current=true;setUnknown(true);}else setReadFailed(true);}
  }finally{if(current()){inFlight.current=null;setBusy(null);}}
 },[]);
 useEffect(()=>{mounted.current=true;generation.current++;void perform('inspect');return()=>{mounted.current=false;generation.current++;inFlight.current=null;};},[perform]);
 const reason=!data||data.ok?null:data.reason;
 const status=readFailed?labels.writerControlReadError:unknown?labels.writerControlUnknown:!data?labels.writerControlChecking:data.ok
  ?data.state==='prepared'?labels.writerControlPrepared:labels.writerControlUnprepared
  :reason==='existing_data'?labels.writerControlExistingData:reason==='reconciliation_required'?labels.writerControlReconciliation:reason==='runtime_not_ready'?labels.writerControlMigrationUnavailable:labels.writerControlUnavailable;
 const button='rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50';
 return <section className="space-y-3" aria-labelledby="writer-control-title">
  <h3 id="writer-control-title" className="text-sm font-medium text-[var(--c-text-primary)]">{labels.writerControlTitle}</h3>
  <div className="space-y-3 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4">
   <p className="text-xs text-[var(--c-text-secondary)]">{labels.writerControlDescription}</p>
   <p role="status" aria-live="polite" className="text-xs text-[var(--c-text-secondary)]">{status}</p>
   <div className="flex flex-wrap gap-2">
    <button type="button" className={button} disabled={busy!==null} onClick={()=>void perform('inspect')}>{labels.writerControlRead}</button>
    <button type="button" className={button} disabled={busy!==null||readFailed||unknown||data?.canPrepare!==true} onClick={()=>void perform('prepare')}>{busy==='prepare'?labels.writerControlPreparing:labels.writerControlPrepare}</button>
    <button type="button" className={button} disabled>{labels.writerControlMigrationUnavailable}</button>
   </div>
  </div>
 </section>;
}
