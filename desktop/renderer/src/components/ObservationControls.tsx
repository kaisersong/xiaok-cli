import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {api} from '../api';
import {useLocale} from '../contexts/LocaleContext';
import type {CompoundExecutionStatus} from '../../../shared/host-observation-types';
import type {SemanticCompactionStatus} from '../../../shared/host-observation-types';
export interface ObservationCommandHandle { execute: (command: string) => Promise<void> }
export const ObservationControls = forwardRef<ObservationCommandHandle, {draftId:string|null;onDraft:(id:string|null)=>void;taskId?:string;running:boolean;activityRevision?:number}>(function ObservationControls({draftId,onDraft,taskId,running,activityRevision=0},ref) {
 const {t}=useLocale();const [visible,setVisible]=useState(false),[notice,setNotice]=useState('');const [busy,setBusy]=useState(false),[mode,setMode]=useState(''),[failed,setFailed]=useState(false);
 const [semantic,setSemantic]=useState<SemanticCompactionStatus>();
 const [compound,setCompound]=useState<CompoundExecutionStatus>();
 // Scope, action and read epochs prevent held work from publishing into a new task/draft.
 const scope=useRef(0),action=useRef(0),read=useRef(0),pending=useRef(false),alive=useRef(true);
 const [readFailed,setReadFailed]=useState(false);
 const visibleRef=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;scope.current++;read.current++;action.current++;pending.current=false;};},[]);
 useEffect(()=>{scope.current++;read.current++;action.current++;pending.current=false;setBusy(false);setFailed(false);},[taskId,draftId,running]);
 useEffect(()=>{visibleRef.current=false;setVisible(false);setNotice('');setMode('');setSemantic(undefined);setCompound(undefined);setReadFailed(false);},[taskId]);
 const applyStatus=(result:Awaited<ReturnType<typeof api.getObservationTaskStatus>>)=>{setNotice('');setMode(result.mode);setSemantic(result.semantic);setCompound(result.compound);setReadFailed(false);};
 // Reuse existing task activity notifications; no additional polling/event owner.
 useEffect(()=>{
  let live=true;const revision=++read.current,epoch=scope.current;
  if(visibleRef.current&&taskId&&!pending.current)void api.getObservationTaskStatus(taskId).then(result=>{
   if(live&&alive.current&&epoch===scope.current&&revision===read.current&&!pending.current){applyStatus(result);setReadFailed(false);}
  }).catch(()=>{if(live&&alive.current&&epoch===scope.current&&revision===read.current&&!pending.current)setReadFailed(true);});
  return()=>{live=false;};
 },[taskId,running,activityRevision]);
 const act=async<T,>(operation:()=>Promise<T>,publish:(value:T)=>void)=>{
  if(pending.current)return;
  pending.current=true;const epoch=scope.current,revision=++action.current;read.current++;
  const current=()=>alive.current&&epoch===scope.current&&revision===action.current;
  setBusy(true);setFailed(false);
  try{const value=await operation();if(current()){read.current++;publish(value);}}
  catch{if(current())setFailed(true);}
  finally{if(current()){pending.current=false;setBusy(false);}}
 };
 const execute=async(command:string)=>{
  if(pending.current)return;
  visibleRef.current=true;setVisible(true);setNotice('');setFailed(false);
  if(command==='status') {
   if(taskId&&!draftId)await act(()=>api.getObservationTaskStatus(taskId),result=>{applyStatus(result);setReadFailed(false);});
  } else if(command==='on') {
   if(running){setNotice(t.observation.running);return;}
   if(!draftId)await act(()=>api.prepareObservationTask(),draft=>{if(draft){setMode('');setSemantic(undefined);setCompound(undefined);setReadFailed(false);onDraft(draft.draftId);}});
  } else if(command==='off') {
   if(draftId){onDraft(null);setNotice(t.observation.disabled);}
   else if(running&&taskId)await act(()=>api.stopObservationTask(taskId),applyStatus);
   else setNotice(t.observation.unavailable);
  } else if(command==='revoke') {
   if(draftId){onDraft(null);setNotice(t.observation.disabled);}
   else if(running&&taskId)await act(()=>api.revokeObservationTask(taskId),applyStatus);
   else setNotice(t.observation.unavailable);
  } else setNotice(t.observation.commandHint);
 };
 useImperativeHandle(ref,()=>({execute}));
 if(!visible)return null;
 return <div className="w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-4 py-2 text-xs text-[var(--c-text-secondary)]" role="region" aria-label={t.observation.menuTitle} aria-live="polite">
  <button type="button" className="float-right ml-3" aria-label={t.observation.dismiss} onClick={()=>{visibleRef.current=false;setVisible(false);}}>×</button>
  <p className="mb-2 font-medium text-[var(--c-text-primary)]">{t.observation.menuTitle}</p>
  {busy&&<p role="status">{t.observation.pending}</p>}
  {notice&&<p>{notice}</p>}
  {draftId&&<span>{t.observation.ready}</span>}
  {!draftId&&!mode&&!notice&&!busy&&<span>{t.observation.unavailable}</span>}
  {!draftId&&mode==='active'&&<span>{t.observation.active}</span>}
  {mode==='recall-only'&&<span>{t.observation.recallOnly}</span>}
  {(mode==='closed'||mode==='restore-blocked')&&<span>{t.observation.closed}</span>}
  {mode==='revoked'&&<span>{running?t.observation.revokedStopping:t.observation.revoked}</span>}
  {!draftId&&mode==='unavailable'&&<span>{t.observation.unavailable}</span>}
  {compound&&<div className="mt-1">
   <p>{t.observation.compoundExperiment}</p>
   <span>{t.observation.compoundEdit(t.observation.compoundStep[compound.edit])}</span>{' · '}
   <span>{t.observation.compoundValidation(t.observation.compoundStep[compound.validation])}</span>
   {compound.unknownOperations>0&&<p role="status">{t.observation.compoundUnknown(compound.unknownOperations)}</p>}
  </div>}
  {semantic&&<div className="mt-1">
   <span>{t.observation.semanticState[semantic.state]}</span>
   {semantic.reason&&<span>{' '}{t.observation.semanticReason[semantic.reason]}</span>}
   <p>{t.observation.semanticBudget(semantic.attempts,semantic.maxAttempts,(semantic.reservedCostUnits/1e9).toFixed(6),(semantic.maxCostUnits/1e9).toFixed(6))}</p>
   {semantic.mode==='mechanism-experiment'&&<p>{t.observation.semanticExperiment}</p>}
  </div>}
  <div className="mt-2 flex flex-wrap gap-2">
   {!running&&!draftId&&<button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-[var(--c-bg-deep)]" onClick={()=>void execute('on')}>{t.observation.enable}</button>}
   {draftId&&<button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-[var(--c-bg-deep)]" onClick={()=>void execute('off')}>{t.observation.cancel}</button>}
   {running&&taskId&&mode==='active'&&<button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-[var(--c-bg-deep)]" onClick={()=>void execute('off')}>{t.observation.stop}</button>}
   {running&&taskId&&(mode==='active'||mode==='recall-only')&&<button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-[var(--c-bg-deep)]" onClick={()=>void execute('revoke')}>{t.observation.revoke}</button>}
   {taskId&&!draftId&&<button type="button" disabled={busy} className="rounded-md px-2 py-1 hover:bg-[var(--c-bg-deep)]" onClick={()=>void execute('status')}>{t.observation.refresh}</button>}
  </div>
  {(failed||readFailed)&&<p role="alert">{t.observation.failed}</p>}
 </div>;
});
