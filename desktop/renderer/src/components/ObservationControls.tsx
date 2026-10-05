import {useEffect,useState} from 'react';
import {api} from '../api';
import {useLocale} from '../contexts/LocaleContext';
import type {CompoundExecutionStatus} from '../../../shared/host-observation-types';
import type {SemanticCompactionStatus} from '../../../shared/host-observation-types';
export function ObservationControls({draftId,onDraft,taskId,running,activityRevision=0}:{draftId:string|null;onDraft:(id:string|null)=>void;taskId?:string;running:boolean;activityRevision?:number}) {
 const {t}=useLocale();const [busy,setBusy]=useState(false),[mode,setMode]=useState(''),[failed,setFailed]=useState(false);
 const [semantic,setSemantic]=useState<SemanticCompactionStatus>();
 const [compound,setCompound]=useState<CompoundExecutionStatus>();
 useEffect(()=>{setMode('');setSemantic(undefined);setCompound(undefined);},[taskId]);
 // Reuse task activity notifications; renderer owns no background polling loop.
 useEffect(()=>{let live=true;if(taskId)void api.getObservationTaskStatus(taskId).then(result=>{if(live){setMode(result.mode);setSemantic(result.semantic);setCompound(result.compound);}}).catch(()=>{});return()=>{live=false;};},[taskId,running,activityRevision]);
 const act=async(operation:()=>Promise<void>)=>{setBusy(true);setFailed(false);try{await operation();}catch{setFailed(true);}finally{setBusy(false);}};
 return <div className="px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
  {!running&&!draftId&&<button type="button" disabled={busy} className="underline" onClick={()=>void act(async()=>{const draft=await api.prepareObservationTask();if(draft)onDraft(draft.draftId);})}>{t.observation.enable}</button>}
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
  {running&&taskId&&mode==='active'&&<button type="button" disabled={busy} className="ml-3 underline" onClick={()=>void act(async()=>setMode((await api.stopObservationTask(taskId)).mode))}>{t.observation.stop}</button>}
  {running&&taskId&&(mode==='active'||mode==='recall-only')&&<button type="button" disabled={busy} className="ml-3 underline" onClick={()=>void act(async()=>setMode((await api.revokeObservationTask(taskId)).mode))}>{t.observation.revoke}</button>}
  {failed&&<p role="alert">{t.observation.failed}</p>}
 </div>;
}
