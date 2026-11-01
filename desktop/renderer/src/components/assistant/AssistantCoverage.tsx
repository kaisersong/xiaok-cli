import { useLocale } from '../../contexts/LocaleContext';
import type { AssistantHomeSnapshot } from './view-types';

export function AssistantCoverage({snapshot}:{snapshot:AssistantHomeSnapshot}) {
 const {t,locale}=useLocale();
 const labels=t.assistant;
 const rows=snapshot.coverage??[];
 if(snapshot.coverageState!=='known' || !rows.length)return <p className="mt-3 text-xs text-[var(--c-text-secondary)]">{labels.coverageUnknown}</p>;
 const active=rows.filter(row=>row.status!=='disabled');
 const incomplete=active.length===0 || active.some(row=>row.status!=='checked');
 const stale=active.some(row=>row.freshUntil<Date.now());
 return <div className="mt-3 text-xs text-[var(--c-text-secondary)]">
   <p>{incomplete?labels.coverageIncomplete:stale?labels.coverageStale:labels.coverageComplete}</p>
   {snapshot.analysisStatus==='failed' && <p>{labels.coverageAnalysisFailed}</p>}
   {snapshot.analysisStatus==='pending' && <p>{labels.coverageAnalysisPending}</p>}
   <details className="mt-1">
     <summary className="cursor-pointer [-webkit-app-region:no-drag]">{labels.coverageDetails}</summary>
     <ul className="mt-2 space-y-2">
       {rows.map(row=><li key={row.sourceId}>
         <span className="font-medium">{labels.coverageSource(row.sourceId)}</span>{' · '}{labels.coverageStatus(row.status)}
         {row.status!=='disabled' && <>
           <span className="block">{labels.coverageCount(row.includedCount,row.recordCount)}</span>
           <span className="block">{labels.coverageTime(new Date(row.checkedAt).toLocaleString(locale))}</span>
         </>}
       </li>)}
     </ul>
   </details>
 </div>;
}
