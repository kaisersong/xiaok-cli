import {useEffect,useRef,useState} from 'react';
import {api} from '../../api/bridge';
import {useLocale} from '../../contexts/LocaleContext';
import type {LoopPublicationAction,LoopPublicationStateView,StoredLoopPublicationConfiguration} from '../../api/types';

const button='rounded border border-[var(--c-border)] px-2 py-1 text-xs disabled:opacity-40';
const inputClass='w-full rounded border border-[var(--c-border)] bg-[var(--c-bg-card)] p-2 text-xs';
export function LoopPublicationPanel({loopId,runs,onChanged}:{loopId:string;runs:ReadonlyArray<{id:string}>;onChanged?:()=>void}){
 const {t}=useLocale(),text=t.loopPublication;
 const [open,setOpen]=useState(false),[selected,setSelected]=useState('');
 const runId=runs.some(r=>r.id===selected)?selected:(runs[0]?.id??'');
 const [state,setState]=useState<Readonly<LoopPublicationStateView>|null>(null),[configuration,setConfiguration]=useState<Readonly<StoredLoopPublicationConfiguration>|null>(null);
 const [configText,setConfigText]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState<number|null>(null),[refresh,setRefresh]=useState(0);
 const [argv,setArgv]=useState('[]'),[cwd,setCwd]=useState('.'),[minutes,setMinutes]=useState(30);
 const actionBusy=useRef(false),generation=useRef(0);
 useEffect(()=>{
  if(!open)return;
  const current=++generation.current;setLoading(true);setState(null);setChecked(null);
  void Promise.all([api.getLoopPublicationConfiguration(loopId),runId?api.getLoopPublicationState(runId):Promise.resolve(null)]).then(([config,next])=>{
   if(generation.current!==current)return;setConfiguration(config);setConfigText(config?JSON.stringify(config.configuration,null,2):'');setState(next);
  }).catch(e=>{if(generation.current===current)setError(text.error(e instanceof Error?e.message:String(e)));}).finally(()=>{if(generation.current===current)setLoading(false);});
  return()=>{generation.current++;};
 },[open,loopId,runId,refresh,text]);
 async function perform(action:LoopPublicationAction){
  if(actionBusy.current)return;actionBusy.current=true;setBusy(true);setError('');setChecked(null);const current=generation.current;
  try{
   const result=await api.performLoopPublicationAction(action);
   if(current!==generation.current)return;
   if(action.kind==='inspect')setChecked(result.inspection?.checkedAt??null);
   else{
    const [config,next]=await Promise.all([api.getLoopPublicationConfiguration(loopId),runId?api.getLoopPublicationState(runId):Promise.resolve(null)]);
    if(current!==generation.current)return;setConfiguration(config);setState(next);onChanged?.();
   }
  }catch(e){
   if(current===generation.current){
    setError(text.error(e instanceof Error?e.message:String(e)));
    if(runId){try{const next=await api.getLoopPublicationState(runId);if(current===generation.current)setState(next);}catch{/* Preserve the original operation error. */}}
   }
  }
  finally{actionBusy.current=false;setBusy(false);}
 }
 function save(){try{void perform({kind:'saveConfiguration',loopId,expectedRevision:configuration?.revision??null,configuration:JSON.parse(configText)});}catch(e){setError(text.error(e instanceof Error?e.message:String(e)));}}
 function verify(id:string){try{const args:unknown=JSON.parse(argv);if(!Array.isArray(args)||args.length===0||args.some(v=>typeof v!=='string')||!Number.isFinite(minutes)||minutes<=0||minutes>1440)throw Error(text.command);void perform({kind:'verify',id,exactCommand:{argv:args as string[],cwdRelative:cwd},expiresAt:Date.now()+Math.floor(minutes*60000)});}catch(e){setError(text.error(e instanceof Error?e.message:String(e)));}}
 const phase=(value:string)=>text.phase[value]??text.unknown;
 const disabled=busy||loading;
 return <section className="mt-3 border-t border-[var(--c-border)] pt-2">
  <button type="button" className={button} data-testid={`loop-publication-open-${loopId}`} disabled={busy} onClick={()=>{setOpen(!open);setError('');setChecked(null);}}>{open?text.close:text.title}</button>
  {open?<div className="mt-3 grid gap-3 text-xs">
   <p className="text-[var(--c-text-secondary)]">{text.history}</p>
   <div className="flex flex-wrap items-center gap-2"><label>{text.run}<select className={button} value={runId} disabled={disabled} onChange={e=>{setSelected(e.target.value);setError('');}}>{runs.map(r=><option key={r.id} value={r.id}>{r.id}</option>)}</select></label><button type="button" className={button} data-testid="loop-publication-refresh" disabled={disabled} onClick={()=>{setError('');setChecked(null);setRefresh(n=>n+1);}}>{text.refresh}</button></div>
   {loading?<p>{text.loading}</p>:null}
   {error?<p role="alert" className="break-words text-[var(--c-status-error-text)]">{error}</p>:null}
   <details><summary>{text.configuration}</summary><p className="my-2 text-[var(--c-text-secondary)]">{text.configHelp}</p><textarea aria-label={text.configuration} className={`${inputClass} min-h-40 font-mono`} value={configText} onChange={e=>setConfigText(e.target.value)} disabled={disabled}/><button type="button" className={button} disabled={disabled||!configText.trim()} onClick={save}>{text.save}</button></details>
   {!runId?<p>{text.noRun}</p>:null}
   {state?<><p>{text.workspace}: <code className="break-all">{state.workspaceRoot}</code></p>{state.projection?<p>{text.generation(state.projection.generation)}</p>:null}
    <div className="grid gap-2"><label>{text.command}<input className={`${inputClass} font-mono`} value={argv} onChange={e=>setArgv(e.target.value)} disabled={disabled}/></label><div className="grid grid-cols-2 gap-2"><label>{text.relativeDirectory}<input className={inputClass} value={cwd} onChange={e=>setCwd(e.target.value)} disabled={disabled}/></label><label>{text.minutes}<input className={inputClass} type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(Number(e.target.value))} disabled={disabled}/></label></div></div>
    {!state.candidates.length?<p>{text.noCandidates}</p>:null}
    {state.candidates.map(candidate=>{const native=candidate.natives.at(-1),publication=candidate.publications.at(-1);return <article key={candidate.candidateId} className="grid gap-2 rounded border border-[var(--c-border)] p-3">
     <strong>{candidate.stageKind?text.stage[candidate.stageKind]??text.unknown:text.runSubject}</strong><code className="break-all text-[var(--c-text-secondary)]">{candidate.candidateId}</code>
     <div className="flex flex-wrap gap-2">{native?<span>{phase(native.phase)}</span>:null}<button type="button" className={button} data-testid={`loop-publication-reserve-${candidate.candidateId}`} disabled={disabled||!!native&&(!['ready','retired','stale'].includes(native.phase)||native.kind==='application-reauthorization'&&native.phase==='retired')} onClick={()=>void perform({kind:'reserveNative',candidateId:candidate.candidateId,expectedLatestAttemptId:native?.id??null})}>{text.reserve}</button>
      {native&&(native.phase==='needs_reauthorization'||native.kind==='application-reauthorization'&&native.phase==='retired')?<button type="button" className={button} data-testid={`loop-publication-reauthorize-${native.id}`} disabled={disabled} onClick={()=>void perform({kind:'reauthorizeNative',attemptId:native.id,expectedRevision:native.revision})}>{text.reauthorizeNative}</button>:null}
      {native? <>{['reserved','enrolled'].includes(native.phase)?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'advanceNative',attemptId:native.id})}>{text.continueNative}</button>:null}<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'recoverNative',attemptId:native.id})}>{text.recoverNative}</button></>:null}</div>
     {native?.phase==='ready'?candidate.definition.obligations.map(obligation=>{const session=native.sessions.find(s=>s.obligationId===obligation.obligationId),execution=session?.executions.at(-1);return <div className="grid gap-2 border-t border-[var(--c-border)] pt-2" key={obligation.obligationId}>
      <span>{text.obligations}: <code>{obligation.obligationId}</code></span><div className="flex flex-wrap items-center gap-2">
       {!session?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'prepareSession',nativeAttemptId:native.id,obligationId:obligation.obligationId})}>{text.prepareSession}</button>:<><span>{phase(session.phase)}</span>
        {session.phase==='reserved'?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'recoverSession',id:session.id})}>{text.recoverSession}</button>:null}
        {session.phase==='session_ready'?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'enrollSession',id:session.id})}>{text.enroll}</button>:null}
        {session.phase==='enrolling'?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'recoverEnrollment',id:session.id})}>{text.recoverEnrollment}</button>:null}
        {session.phase==='enrolled'&&!execution?<button type="button" className={button} disabled={disabled} onClick={()=>verify(session.id)}>{text.verify}</button>:null}
        {execution?<><span>{phase(execution.phase)}</span><button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'recoverVerification',id:execution.id})}>{text.recoverVerification}</button></>:null}
       </>}
      </div></div>; }):null}
     <div className="flex flex-wrap items-center gap-2">{publication?<span>{phase(publication.status)}</span>:null}
      {native?.phase==='ready'?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'publish',nativeAttemptId:native.id,expectedLatestAttemptId:publication?.id??null})}>{text.publish}</button>:null}
      {publication?<button type="button" className={button} disabled={disabled} onClick={()=>void perform({kind:'recoverPublication',attemptId:publication.id})}>{text.recoverPublication}</button>:null}</div>
    </article>;})}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled||!state.candidates.length} onClick={()=>void perform({kind:'project',runId})}>{text.project}</button><button type="button" className={button} data-testid="loop-publication-inspect" disabled={disabled||!state.candidates.length} onClick={()=>void perform({kind:'inspect',runId})}>{text.inspect}</button></div>
    {checked!==null?<p data-testid="loop-publication-checked" role="status">{text.checked(new Date(checked).toLocaleString())}</p>:null}
   </>:null}
  </div>:null}
 </section>;
}
