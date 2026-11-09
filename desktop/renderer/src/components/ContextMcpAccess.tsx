import { useEffect, useRef, useState } from 'react';
import { getDesktopApi } from '../shared/desktop';
import { useLocale } from '../contexts/LocaleContext';
import type { ContextMcpStatus, ExternalContextReaderView } from '../../../shared/context-continuity-types';

export function ContextMcpAccess({refId,targetConversationId,allowed}:{refId:string;targetConversationId:string;allowed:boolean}){
  const {t}=useLocale(),l=t.contextContinuity;
  const [open,setOpen]=useState(false),[status,setStatus]=useState<ContextMcpStatus|null>(null),[readers,setReaders]=useState<ExternalContextReaderView[]>([]);
  const [config,setConfig]=useState<{credentialId:string;clientConfig:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[copied,setCopied]=useState(false);
  const generation=useRef(0),working=useRef(false);
  useEffect(()=>{generation.current++;working.current=false;setBusy(false);setConfig(null);setCopied(false);},[allowed,refId,targetConversationId]);
  useEffect(()=>{
    const current=++generation.current;working.current=false;setBusy(false);setConfig(null);setCopied(false);
    if(open){void Promise.all([getDesktopApi()!.getContextMcpStatus(),getDesktopApi()!.listExternalContextReaders()]).then(([next,list])=>{
      if(current===generation.current){setStatus(next);setReaders(list);setError(false);}
    }).catch(()=>{if(current===generation.current)setError(true);});}
    return ()=>{generation.current++;};
  },[open,refId,targetConversationId]);
  if(!getDesktopApi()?.issueContextMcpConfig)return null;
  const act=async(kind:'issue'|'toggle'|'copy'|'revoke'|'reset',credentialId?:string)=>{
    if(working.current)return;working.current=true;setBusy(true);setError(false);const current=generation.current;
    try{
      const api=getDesktopApi()!;
      if(kind==='issue'){
        if(!allowed)throw new Error('grant_required');const next=await api.issueContextMcpConfig({operationId:crypto.randomUUID(),targetConversationId,refIds:[refId]});
        if(current===generation.current){setConfig(next);setCopied(false);}
      }else if(kind==='toggle'){await api.setContextMcpEnabled({enabled:!status?.enabled});}
      else if(kind==='reset'){await api.resetContextMcpPort();if(current===generation.current)setConfig(null);}
      else if(kind==='revoke'&&credentialId){await api.revokeExternalContextReader({credentialId});if(current===generation.current&&config?.credentialId===credentialId)setConfig(null);}
      else if(kind==='copy'&&config){await navigator.clipboard.writeText(config.clientConfig);if(current===generation.current)setCopied(true);}
      if(kind!=='copy'){
        const [next,list]=await Promise.all([api.getContextMcpStatus(),api.listExternalContextReaders()]);
        if(current===generation.current){setStatus(next);setReaders(list);}
      }
    }catch{if(current===generation.current)setError(true);}
    finally{if(current===generation.current){working.current=false;setBusy(false);}}
  };
  return <section className="mt-3 border-t border-[var(--c-border)] pt-2">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{l.mcpConnect}</button>
    {open&&<div className="mt-2 space-y-2">
      <p className="text-xs">{l.mcpNotice}</p>
      <p role="status" className="break-all text-xs">{status?.state==='listening'?`${l.mcpListening} ${status.url}`:status?.state==='disabled'?l.mcpDisabled:l.mcpUnavailable}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy||!allowed} onClick={()=>void act('issue')}>{l.mcpIssue}</button>
        {status&&<button type="button" disabled={busy} onClick={()=>void act('toggle')}>{status.enabled?l.mcpStop:l.mcpStart}</button>}
        {status?.state==='unavailable'&&<button type="button" disabled={busy} onClick={()=>void act('reset')}>{l.mcpResetPort}</button>}
      </div>
      {config&&<div className="space-y-2"><p className="text-xs">{l.mcpOneTime}</p><textarea aria-label={l.mcpConfig} readOnly value={config.clientConfig} rows={9} className="w-full resize-y rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-2 font-mono text-xs" />
        <button type="button" disabled={busy} onClick={()=>void act('copy')}>{copied?l.mcpCopied:l.mcpCopy}</button></div>}
      {readers.filter(reader=>reader.targetConversationId===targetConversationId&&reader.refIds.includes(refId)&&!reader.revoked).map(reader=><div key={reader.credentialId} className="flex items-center gap-3 text-xs"><span>{reader.credentialId.slice(0,8)}</span><button type="button" disabled={busy} onClick={()=>void act('revoke',reader.credentialId)}>{l.mcpRevoke}</button></div>)}
      {error&&<p role="alert">{l.mcpUnavailable}</p>}
    </div>}
  </section>;
}
