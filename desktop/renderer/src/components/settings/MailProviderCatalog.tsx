import {Plus,ChevronRight} from 'lucide-react';
import {useLocale} from '../../contexts/LocaleContext';
import type {MailProvider,MailAccountDto} from '../../../../shared/mail-connectors-ipc-contract';
const colors:Record<MailProvider,string>={gmail:'text-red-500 bg-red-500/5',outlook:'text-blue-500 bg-blue-500/5',qq:'text-sky-500 bg-sky-500/5',netease163:'text-red-600 bg-red-600/5',imap:'text-[var(--c-accent)] bg-[var(--c-accent)]/10'};
const button='rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-primary)] hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] disabled:opacity-40';
export function MailProviderCatalog({providers:filtered,accounts,disabled,onAdd:open,onManage:manageProvider}:{providers:MailProvider[];accounts:MailAccountDto[]|null;disabled:boolean;onAdd:(provider:MailProvider)=>void;onManage:(provider:MailProvider)=>void}){
 const {t}=useLocale(),labels=t.mailConnectors;
 return (
  <div className="grid gap-2 sm:grid-cols-2">{filtered.map(provider=>{
   const p=labels.providers[provider],count=accounts?.filter(a=>a.provider===provider).length??0;
   return <div key={provider} className="flex min-w-0 items-center rounded-xl border border-transparent hover:border-[var(--c-border)] hover:bg-[var(--c-bg-card)]">
    <button type="button" aria-label={count?labels.manageProvider(p.name):labels.add(p.name)} onClick={()=>count?manageProvider(provider):open(provider)} disabled={accounts===null||disabled} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] disabled:opacity-50">
     <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--c-border-subtle)] text-sm font-bold ${colors[provider]}`}>{p.badge}</span>
     <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--c-text-primary)]">{p.name}</span><span className="mt-1 block text-xs leading-5 text-[var(--c-text-secondary)]">{p.description}</span>{count>0&&<span className="mt-1 block text-[10px] text-[var(--c-accent)]">{labels.accountCount(count)} · {labels.manage}</span>}</span>
     {count?<ChevronRight size={18} className="shrink-0 text-[var(--c-text-tertiary)]"/>:<Plus size={18} className="shrink-0 text-[var(--c-text-tertiary)]"/>}
    </button>
    {count>0&&<button type="button" aria-label={labels.add(p.name)} title={labels.add(p.name)} disabled={disabled} onClick={()=>open(provider)} className={`${button} mr-3 shrink-0`}><Plus size={16}/></button>}
   </div>;
  })}</div>
 );
}
