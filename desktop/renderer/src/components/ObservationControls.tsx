import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {useLocale} from '../contexts/LocaleContext';
import type {CompoundExecutionStatus} from '../../../shared/host-observation-types';
import type {SemanticCompactionStatus} from '../../../shared/host-observation-types';
export function ObservationControls({draftId,onDraft,taskId,running,activityRevision=0}:{draftId:string|null;onDraft:(id:string|null)=>void;taskId?:string;running:boolean;activityRevision?:number}) {
 const {t}=useLocale();const [busy,setBusy]=useState(false),[mode,setMode]=useState(''),[failed,setFailed]=useState(false);
 const [semantic,setSemantic]=useState<SemanticCompactionStatus>();
 const [compound,setCompound]=useState<CompoundExecutionStatus>();
 // Scope, action and read epochs prevent held work from publishing into a new task/draft.
 const scope=useRef(0),action=useRef(0),read=useRef(0),pending=useRef(false),alive=useRef(true);
 const [readFailed,setReadFailed]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;scope.current++;read.current++;action.current++;pending.current=false;};},[]);
 useEffect(()=>{scope.current++;read.current++;action.current++;pending.current=false;setBusy(false);setFailed(false);},[taskId,draftId,running]);
 useEffect(()=>{setMode('');setSemantic(undefined);setCompound(undefined);setReadFailed(false);},[taskId]);
 const applyStatus=(result:Awaited<ReturnType<typeof api.getObservationTaskStatus>>)=>{setMode(result.mode);setSemantic(result.semantic);setCompound(result.compound);};
 // Reuse existing task activity notifications; no additional polling/event owner.
 useEffect(()=>{
  let live=true;const revision=++read.current,epoch=scope.current;
  if(taskId)void api.getObservationTaskStatus(taskId).then(result=>{
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
 return <div className="px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
  {!running&&!draftId&&<button type="button" disabled={busy} className="underline" onClick={()=>void act(()=>api.prepareObservationTask(),draft=>{if(draft)onDraft(draft.draftId);})}>{t.observation.enable}</button>}
  {draftId&&<><span>{t.observation.ready}</span>{' '}<button type="button" disabled={busy} className="underline" onClick={()=>onDraft(null)}>{t.observation.cancel}</button></>}
  {mode==='active'&&<span>{t.observation.active}</span>}
  {mode==='recall-only'&&<span>{t.observation.recallOnly}</span>}
  {(mode==='closed'||mode==='restore-blocked')&&<span>{t.observation.closed}</span>}
  {mode==='revoked'&&<span>{running?t.observation.revokedStopping:t.observation.revoked}</span>}
  {mode==='unavailable'&&<span>{t.observation.unavailable}</span>}
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
  {running&&taskId&&mode==='active'&&<button type="button" disabled={busy} className="ml-3 underline" onClick={()=>void act(()=>api.stopObservationTask(taskId),applyStatus)}>{t.observation.stop}</button>}
  {running&&taskId&&(mode==='active'||mode==='recall-only')&&<button type="button" disabled={busy} className="ml-3 underline" onClick={()=>void act(()=>api.revokeObservationTask(taskId),applyStatus)}>{t.observation.revoke}</button>}
  {(failed||readFailed)&&<p role="alert">{t.observation.failed}</p>}
 </div>;
}
