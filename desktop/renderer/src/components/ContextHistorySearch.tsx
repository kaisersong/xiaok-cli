import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLocale } from '../contexts/LocaleContext';
import { getDesktopApi } from '../shared/desktop';
import { ContextReferenceCard } from './ContextReference';
import { CliArchiveImport } from './CliArchiveImport';
import type { HistorySearchResult } from '../../../shared/context-continuity-types';

export function ContextHistorySearch({conversationId}:{conversationId:string}){
  const {t}=useLocale(),l=t.historySearch,id=useId();
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState<HistorySearchResult|null>(null);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[consent,setConsent]=useState<boolean|null>(null),[consentBusy,setConsentBusy]=useState(false),[consentFailed,setConsentFailed]=useState(false);
  const scope=useRef(conversationId),generation=useRef(0),consentGeneration=useRef(0),inFlight=useRef(false);
  scope.current=conversationId;
  const current=(owner:ReturnType<typeof getDesktopApi>,expected:string,attempt:number)=>scope.current===expected&&generation.current===attempt&&getDesktopApi()===owner;
  useEffect(()=>{
    generation.current++;consentGeneration.current++;inFlight.current=false;setOpen(false);setQuery('');setResult(null);setBusy(false);setFailed(false);setConsent(null);setConsentFailed(false);setConsentBusy(false);
    return ()=>{generation.current++;consentGeneration.current++;};
  },[conversationId]);
  useEffect(()=>{
    if(!open)return;
    const owner=getDesktopApi(),expected=conversationId,attempt=++consentGeneration.current;
    setConsent(null);setConsentFailed(false);setConsentBusy(false);
    void owner?.getHistorySearchConsent({conversationId:expected}).then(value=>{
      if(scope.current===expected&&consentGeneration.current===attempt&&getDesktopApi()===owner)setConsent(value.enabled);
    }).catch(()=>{if(scope.current===expected&&consentGeneration.current===attempt)setConsentFailed(true);});
    return ()=>{consentGeneration.current++;};
  },[conversationId,open]);
  if(!getDesktopApi()?.searchContextHistory)return null;
  const clear=()=>{generation.current++;inFlight.current=false;setBusy(false);setResult(null);setFailed(false);};
  const search=async()=>{
    if(inFlight.current||!query.trim())return;
    const owner=getDesktopApi(),expected=conversationId,attempt=++generation.current;
    inFlight.current=true;setBusy(true);setFailed(false);setResult(null);
    try{
      if(!owner)throw new Error('unavailable');
      const next=await owner.searchContextHistory({query:query.trim(),limit:20});
      if(current(owner,expected,attempt))setResult(next);
    }catch{if(current(owner,expected,attempt))setFailed(true);}
    finally{if(current(owner,expected,attempt)){inFlight.current=false;setBusy(false);}}
  };
  const toggle=async(enabled:boolean)=>{
    if(consentBusy)return;
    const owner=getDesktopApi(),expected=conversationId,attempt=++consentGeneration.current;
    const previous=consent;
    setConsent(enabled);setConsentBusy(true);setConsentFailed(false);
    try{
      if(!owner)throw new Error('unavailable');
      const next=await owner.setHistorySearchConsent({conversationId:expected,enabled});
      if(scope.current===expected&&consentGeneration.current===attempt&&getDesktopApi()===owner){setConsent(next.enabled);window.dispatchEvent(new Event('xiaok:context-grants-changed'));}
    }catch{if(scope.current===expected&&consentGeneration.current===attempt){setConsent(previous);setConsentFailed(true);}}
    finally{if(scope.current===expected&&consentGeneration.current===attempt)setConsentBusy(false);}
  };
  return <div className="relative text-sm">
    <button type="button" title={l.open} aria-label={l.open} aria-expanded={open} aria-controls={id} className="rounded p-1.5 text-[var(--c-text-tertiary)] hover:bg-[var(--c-bg-hover)]" onClick={()=>{clear();setOpen(value=>!value);}}><Search size={14}/></button>
    {open&&<section id={id} aria-label={l.open} className="absolute right-0 z-50 w-[420px] max-w-[calc(100vw-32px)] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-primary)] p-4 shadow-lg" onKeyDown={event=>{if(event.key==='Escape'){clear();setOpen(false);}}}>
      <div className="mb-3 flex items-center justify-between"><strong>{l.open}</strong><button type="button" aria-label={l.close} onClick={()=>{clear();setOpen(false);}}><X size={16}/></button></div>
      <form className="flex gap-2" onSubmit={event=>{event.preventDefault();void search();}}>
        <input aria-label={l.query} maxLength={256} value={query} onChange={event=>{clear();setQuery(event.target.value);}} className="min-w-0 flex-1 rounded border border-[var(--c-border)] bg-transparent px-2 py-1"/>
        <button type="submit" disabled={busy||!query.trim()} className="rounded border border-[var(--c-border)] px-3 py-1">{busy?l.searching:l.submit}</button>
      </form>
      <p className="my-2 text-xs text-[var(--c-text-tertiary)]">{l.coverage}</p>
      <CliArchiveImport key={`${conversationId}:${query}`} onImported={()=>{clear();if(query.trim())void search();}}/>
      <label className="my-3 flex items-start gap-2 text-xs"><input type="checkbox" aria-label={l.consent} aria-describedby={`${id}-consent-notice`} disabled={consent===null||consentBusy} checked={consent===true} onChange={event=>void toggle(event.target.checked)}/><span>{l.consent}<span id={`${id}-consent-notice`} className="mt-1 block text-[var(--c-text-tertiary)]">{l.consentNotice}</span></span></label>
      {consentFailed&&<p role="alert" className="my-2 text-xs">{l.consentFailed}</p>}
      {consentBusy&&<p role="status" className="my-2 text-xs">{l.saving}</p>}
      {failed&&<p role="alert">{l.failed}</p>}
      <div aria-live="polite" className="max-h-[55vh] overflow-y-auto">
        {result&&result.hits.length===0&&<p className="py-3 text-[var(--c-text-secondary)]">{l.empty}</p>}
        {result?.hits.map(hit=><article key={`${hit.refId}:${hit.messageId}:${hit.revision}`} className="border-t border-[var(--c-border)] pt-3">
          <p className="text-xs text-[var(--c-text-tertiary)]">{hit.title??l.reference} · {new Date(hit.observedAt).toLocaleString()}</p>
          <p className="my-2 whitespace-pre-wrap break-words">{hit.excerpt}</p>
          {hit.visibilityBasis==='user_claimed_archive'&&<p className="text-xs">{t.contextContinuity.archiveUnknown}</p>}
          <ContextReferenceCard url={hit.url} targetConversationId={conversationId}/>
        </article>)}
      </div>
    </section>}
  </div>;
}
