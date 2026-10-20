import {useEffect,useRef,useState} from 'react';
import {useLocale} from '../contexts/LocaleContext';
import {getDesktopApi} from '../shared/desktop';
import type {CliArchiveList,CliArchivePreview} from '../../../shared/cli-archive';

/** A user-selected fixed archive; imported history is still attached separately. */
export function CliArchiveImport({onImported}:{onImported:()=>void}){
 const {t}=useLocale(),l=t.cliArchive;
 const [open,setOpen]=useState(false),[list,setList]=useState<CliArchiveList|null>(null),[preview,setPreview]=useState<CliArchivePreview|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[imported,setImported]=useState<number|null>(null);
 const generation=useRef(0),inFlight=useRef(false);
 useEffect(()=>()=>{generation.current++;},[]);
 const request=async<T,>(operation:(api:NonNullable<ReturnType<typeof getDesktopApi>>)=>Promise<T>,receive:(result:T)=>void)=>{
  if(inFlight.current)return;const api=getDesktopApi(),attempt=++generation.current;
  inFlight.current=true;setBusy(true);setFailed(false);setPreview(null);setImported(null);
  const current=()=>attempt===generation.current&&getDesktopApi()===api;
  try{if(!api)throw new Error('unavailable');const result=await operation(api);if(current())receive(result);}
  catch{if(current()){setPreview(null);setFailed(true);}}
  finally{if(current()){inFlight.current=false;setBusy(false);}}
 };
 if(!getDesktopApi()?.listCliArchives)return null;
 const load=(after?:string)=>request(api=>api.listCliArchives(after?{after}:{}),setList);
 const toggle=()=>{
  generation.current++;inFlight.current=false;setBusy(false);setFailed(false);setPreview(null);setImported(null);setList(null);setOpen(!open);
  if(!open)void load();
 };
 const claim=()=>{
  if(!preview)return;const original=preview;
  void request(api=>api.claimCliArchive({previewId:original.previewId,manifestHash:original.manifestHash,operationId:crypto.randomUUID()}),result=>{setImported(result.messageCount);onImported();});
 };
 return <div className="my-3 border-t border-[var(--c-border)] pt-3">
  <button type="button" aria-expanded={open} className="text-xs underline" onClick={toggle}>{open?l.close:l.open}</button>
  {open&&<div className="mt-2 space-y-2 text-xs">
   <p className="text-[var(--c-text-secondary)]">{l.notice}</p>
   {busy&&<p role="status">{l.loading}</p>}
   {failed&&<p role="alert">{l.failed} <button type="button" className="underline" disabled={busy} onClick={()=>void load()}>{l.retry}</button></p>}
   {list?.items.length===0&&<p>{l.empty}</p>}
   <div className="max-h-32 overflow-y-auto">
    {list?.items.map(item=><div key={item.sessionId} className="flex items-center gap-2 py-1">
     <button type="button" disabled={busy||!item.available} className="min-w-0 truncate underline disabled:opacity-50" onClick={()=>void request(api=>api.previewCliArchive({sessionId:item.sessionId,operationId:crypto.randomUUID()}),setPreview)}>{item.sessionId}</button>
     {!item.available&&<span>{l.unavailable}</span>}
    </div>)}
   </div>
   {list?.nextAfter&&<button type="button" disabled={busy} className="underline" onClick={()=>void load(list.nextAfter)}>{l.more}</button>}
   {preview&&<div className="rounded border border-[var(--c-border)] p-2">
    <p>{l.preview(preview.messageCount)}</p><p className="my-2 whitespace-pre-wrap break-words">{preview.sample}</p>
    <button type="button" disabled={busy} className="rounded border border-[var(--c-border)] px-2 py-1" onClick={claim}>{l.claim}</button>
   </div>}
   {imported!==null&&<p role="status">{l.imported(imported)}</p>}
  </div>}
 </div>;
}
