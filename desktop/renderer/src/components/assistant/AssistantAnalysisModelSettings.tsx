import {useState} from 'react';
import type {AssistantAnalysisStatus,AssistantAnalysisSettingsInput} from '../../../../shared/assistant-analysis-settings-contract';
import {useLocale} from '../../contexts/LocaleContext';
export function AssistantAnalysisModelSettings({status,busy,onConfigure}:{status:AssistantAnalysisStatus;busy:boolean;onConfigure:(input:AssistantAnalysisSettingsInput)=>void}){
 const {t}=useLocale(),labels=t.assistant;const [modelId,setModelId]=useState(status.selectedModelId??'');
 return <details className="mt-3 border-t border-[var(--c-border-subtle)] pt-2 text-xs text-[var(--c-text-secondary)] [-webkit-app-region:no-drag]">
  <summary className="cursor-pointer">{labels.analysisModelTitle}</summary>
  <p className="mt-2">{labels.analysisModelExplanation}</p><p className="mt-1">{labels.analysisModelState(status.state)}</p>
  {status.reason&&<p className="mt-1">{labels.analysisModelReason(status.reason)}</p>}
  <label className="mt-3 block">{labels.analysisModelSelect}<select value={modelId} disabled={busy} onChange={event=>setModelId(event.target.value)} className="mt-1 block max-w-full rounded border border-[var(--c-border-subtle)] bg-[var(--c-bg-card)] px-2 py-1">
   <option value="">{labels.analysisModelChoose}</option>{status.models.map(model=><option key={model.modelId} value={model.modelId}>{model.label}</option>)}
  </select></label>
  {!status.models.length&&<p className="mt-2">{labels.analysisModelNone}</p>}
  <button type="button" disabled={busy||!status.models.some(model=>model.modelId===modelId)} onClick={()=>onConfigure({modelId,expectedRevision:status.revision})} className="mt-3 text-[var(--c-accent)] disabled:opacity-50">{labels.analysisModelPrepare}</button>
 </details>;
}
