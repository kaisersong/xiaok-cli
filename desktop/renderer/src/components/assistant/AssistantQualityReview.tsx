import {useState} from 'react';
import type {AssistantQualityStatus} from '../../../../shared/assistant-quality-contract';
import {useLocale} from '../../contexts/LocaleContext';
export function AssistantQualityReview({status,busy,onExport,onImport,onRevoke}:{status:AssistantQualityStatus;busy:boolean;onExport:()=>void;onImport:(input:{attestHumanReview:true})=>void;onRevoke:()=>void}){
 const {t}=useLocale(),labels=t.assistant;const [attested,setAttested]=useState(false);
 return <details className="mt-3 border-t border-[var(--c-border-subtle)] pt-2 text-xs text-[var(--c-text-secondary)] [-webkit-app-region:no-drag]">
  <summary className="cursor-pointer">{labels.qualityTitle}</summary>
  <p className="mt-2">{labels.qualityExplanation}</p>
  <p className="mt-1">{labels.qualityState(status.state)}</p>
  {status.reason&&<p className="mt-1">{labels.qualityReason(status.reason)}</p>}
  <p className="mt-1">{labels.qualityCounts(status.populationCount,status.sampleCount,status.needsAction)}</p>
  {status.precision!==null&&status.recall!==null&&<p className="mt-1">{labels.qualityMetrics(Math.round(status.precision*1000)/10,Math.round(status.recall*1000)/10,status.seriousMisses)}</p>}
  <div className="mt-3 space-y-3">
   <button type="button" disabled={busy} className="text-[var(--c-accent)] disabled:opacity-50" onClick={onExport}>{status.state==='passed'||status.state==='failed'?labels.qualityExportReport:labels.qualityExport}</button>
   <label className="flex items-start gap-2"><input type="checkbox" checked={attested} disabled={busy} onChange={event=>setAttested(event.target.checked)}/><span>{labels.qualityAttestation}</span></label>
   <div className="flex flex-wrap gap-4 text-[var(--c-accent)]">
    <button type="button" disabled={busy||!attested} className="disabled:opacity-50" onClick={()=>{setAttested(false);onImport({attestHumanReview:true});}}>{labels.qualityImport}</button>
    {(status.state==='passed'||status.sampleCount>0)&&<button type="button" disabled={busy} onClick={onRevoke}>{status.state==='passed'?labels.qualityRevoke:labels.qualityDiscard}</button>}
   </div>
  </div>
 </details>;
}
