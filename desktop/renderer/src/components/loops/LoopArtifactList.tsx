import {useLayoutEffect,useRef,useState} from 'react';
import {api} from '../../api/bridge';
import type {LoopArtifactListView,LoopArtifactPageRequest} from '../../api/types';
import {useLocale} from '../../contexts/LocaleContext';

export function LoopArtifactList({loopId,refreshGeneration}:{loopId:string;refreshGeneration:number}){
 const {t}=useLocale(),labels=t.desktopSettings,generation=useRef(0);
 const [scope,setScope]=useState<{loopId:string;refreshGeneration:number}>();
 const [page,setPage]=useState<LoopArtifactListView>(),[loading,setLoading]=useState(false),[error,setError]=useState(false);
 useLayoutEffect(()=>{generation.current++;setPage(undefined);setError(false);setLoading(false);return ()=>{generation.current++;};},[loopId,refreshGeneration]);
 async function load(request:LoopArtifactPageRequest){
  const current=++generation.current;setScope({loopId,refreshGeneration});setPage(undefined);setError(false);setLoading(true);
  try{const result=await api.listLoopPublishedArtifacts(loopId,request);if(current===generation.current)setPage(result);}
  catch{if(current===generation.current)setError(true);}
  finally{if(current===generation.current)setLoading(false);}
 }
 const visible=scope?.loopId===loopId&&scope?.refreshGeneration===refreshGeneration,displayPage=visible?page:undefined;
 const button='rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] disabled:opacity-50';
 return <section className="mt-3 min-w-0">
  <button type="button" className={button} data-testid={`loop-artifacts-open-${loopId}`} disabled={visible&&loading} onClick={()=>void load({offset:0,identity:null})}>{visible&&loading?labels.userLoopArtifactsLoading:labels.userLoopArtifactsOpen}</button>
  {visible&&error?<p role="alert" className="mt-2 text-xs text-[var(--c-status-error-text)]">{labels.userLoopArtifactsUnavailable}</p>:null}
  {displayPage?<div data-testid="loop-artifacts-observation" className="mt-2 rounded-lg border border-[var(--c-border)] p-3 text-xs" aria-live="polite">
   <p className="text-[var(--c-text-secondary)]">{labels.loopDiagnosticsVerifiedAt(new Date(displayPage.checkedAt).toLocaleString())}</p>
   {displayPage.items.length?<ul className="my-2 grid gap-2">{displayPage.items.map((item,i)=><li key={i} className="flex min-w-0 flex-wrap justify-between gap-2"><span className="min-w-0 break-all">{item.path}</span><span className="text-[var(--c-text-secondary)]">{labels.userLoopArtifactBytes(item.size)}</span></li>)}</ul>:<p className="my-2">{labels.userLoopArtifactsEmpty}</p>}
   <div className="flex flex-wrap items-center gap-2">
    <span>{labels.userLoopArtifactsPage(displayPage.total? displayPage.offset+1:0,displayPage.offset+displayPage.items.length,displayPage.total)}</span>
    {displayPage.offset>0?<button type="button" className={button} data-testid="loop-artifacts-previous" onClick={()=>void load({offset:displayPage.offset-20,identity:displayPage.offset===20?null:displayPage.identity})}>{labels.userLoopArtifactsPrevious}</button>:null}
    {displayPage.nextOffset!==null?<button type="button" className={button} data-testid="loop-artifacts-next" onClick={()=>void load({offset:displayPage.nextOffset!,identity:displayPage.identity})}>{labels.userLoopArtifactsNext}</button>:null}
   </div>
  </div>:null}
 </section>;
}
