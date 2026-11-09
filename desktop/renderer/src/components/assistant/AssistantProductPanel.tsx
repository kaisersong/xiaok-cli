import {useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLocale} from '../../contexts/LocaleContext';
import {getDesktopApi} from '../../shared/desktop';
import type {useAssistantWorkspace} from '../../hooks/useAssistantWorkspace';
import {ASSISTANT_ANALYSIS_STATUS_SCHEMA} from '../../../../shared/assistant-analysis-settings-contract';
import {ASSISTANT_QUALITY_RESULT_SCHEMA,ASSISTANT_QUALITY_STATUS_SCHEMA} from '../../../../shared/assistant-quality-contract';
import {ASSISTANT_PERIODIC_STATUS_SCHEMA,ASSISTANT_PERIODIC_CHECK_SCHEMA} from '../../../../shared/assistant-periodic-contract';
import {ASSISTANT_ACTION_DECISION_RESULT_SCHEMA} from '../../../../shared/assistant-action-contract';
import {ASSISTANT_LAUNCH_DRAFT_SCHEMA,ASSISTANT_LAUNCH_LOOKUP_SCHEMA,ASSISTANT_LAUNCH_OPERATION_SCHEMA,ASSISTANT_THREAD_TARGET_PAGE_SCHEMA,type AssistantLaunchDraft,type AssistantThreadTargetPage} from '../../../../shared/assistant-launch-contract';
import {AssistantAnalysisModelSettings} from './AssistantAnalysisModelSettings';
import {AssistantQualityReview} from './AssistantQualityReview';
import {AssistantPeriodicSettings} from './AssistantPeriodicSettings';
import {AssistantLaunchTargetPicker} from './AssistantLaunchTargetPicker';
import {AssistantLaunchConfirm} from './AssistantLaunchConfirm';
import {AssistantLaunchHistory} from './AssistantLaunchHistory';
/** Renderer-local drafts only; durable work, receipts and qualification remain in Main. */
export function AssistantProductPanel({data}:{data:ReturnType<typeof useAssistantWorkspace>}){
 const {t}=useLocale(),navigate=useNavigate(),life=useRef(true);
 const [draft,setDraft]=useState<AssistantLaunchDraft>();
 const [target,setTarget]=useState<{proposalId:string;expectedRevision:number;page:AssistantThreadTargetPage;unavailable:boolean}>();
 useEffect(()=>{life.current=true;return()=>{life.current=false;};},[]);
 const product=data.product,busy=data.mutationBusy||data.operationUnknown;
 if(!product)return null;
 const api=()=>{const value=getDesktopApi();if(!value)throw Error('desktop_unavailable');return value;};
 const act=(work:()=>Promise<unknown>)=>{void data.mutate(work);};
 const lookup=(draftId:string)=>act(async()=>{ASSISTANT_LAUNCH_LOOKUP_SCHEMA.parse(await api().getAssistantLaunch({draftId}));});
 const choose=(proposalId:string,expectedRevision:number)=>act(async()=>{
  let page:AssistantThreadTargetPage={items:[],nextCursor:null},unavailable=false;
  try{page=ASSISTANT_THREAD_TARGET_PAGE_SCHEMA.parse(await api().getAssistantLaunchTargets({}));}catch{unavailable=true;}
  if(life.current)setTarget({proposalId,expectedRevision,page,unavailable});
 });
 return <section data-testid="assistant-product-controls" className="mt-4 space-y-3">
  {product.analysisProvider&&<AssistantAnalysisModelSettings key={product.analysisProvider.revision} status={product.analysisProvider} busy={busy} onConfigure={input=>act(async()=>{ASSISTANT_ANALYSIS_STATUS_SCHEMA.parse(await api().configureAssistantAnalysisProvider(input));})}/>}
  {product.quality&&<AssistantQualityReview status={product.quality} busy={busy} onExport={()=>act(async()=>{ASSISTANT_QUALITY_RESULT_SCHEMA.parse(await api().exportAssistantQualityReview());})} onImport={input=>act(async()=>{ASSISTANT_QUALITY_RESULT_SCHEMA.parse(await api().importAssistantQualityReview(input));})} onRevoke={()=>act(async()=>{ASSISTANT_QUALITY_STATUS_SCHEMA.parse(await api().revokeAssistantQualityReview());})}/>}
  {product.periodic&&<AssistantPeriodicSettings key={product.periodic.revision} status={product.periodic} busy={busy} onSave={input=>act(async()=>{ASSISTANT_PERIODIC_STATUS_SCHEMA.parse(await api().configureAssistantPeriodic(input));})} onCheck={()=>act(async()=>{ASSISTANT_PERIODIC_CHECK_SCHEMA.parse(await api().checkAssistantPeriodic());})}/>}
  {product.proposals.map(proposal=><article key={proposal.id} className="rounded-lg border border-[var(--c-border-subtle)] p-3 text-xs">
   <p className="font-medium">{proposal.title}</p><p className="mt-1">{proposal.reason}</p><p className="mt-1">{proposal.nextStep}</p>
   {proposal.decision==='open'&&<div className="mt-2 flex flex-wrap gap-3 text-[var(--c-accent)]">
    <button type="button" disabled={busy||proposal.startAvailability!=='available'} onClick={()=>choose(proposal.id,proposal.revision)}>{t.assistant.launchStart}</button>
    <button type="button" disabled={busy} onClick={()=>act(async()=>{ASSISTANT_ACTION_DECISION_RESULT_SCHEMA.parse(await api().dismissAssistantAction({proposalId:proposal.id,expectedRevision:proposal.revision}));})}>{t.assistant.dismissAction}</button>
    <button type="button" disabled={busy} onClick={()=>act(async()=>{ASSISTANT_ACTION_DECISION_RESULT_SCHEMA.parse(await api().snoozeAssistantAction({proposalId:proposal.id,expectedRevision:proposal.revision,snoozeUntil:Date.now()+3600000}));})}>{t.assistant.snoozeAction}</button>
   </div>}
  </article>)}
  <AssistantLaunchHistory items={product.launches??[]} busy={busy} onOpen={item=>navigate('/t/'+encodeURIComponent(item.threadId))} onLookup={item=>lookup(item.draftId)} onCancel={item=>act(async()=>{ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(await api().cancelAssistantLaunch({draftId:item.draftId}));})} onResolve={item=>{if(item.resultDigest)act(async()=>{ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(await api().resolveAssistantLaunch({draftId:item.draftId,expectedResultDigest:item.resultDigest!}));});}} onReconfirm={item=>act(async()=>{const next=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(await api().prepareAssistantReconfirmation({draftId:item.draftId}));if(life.current)setDraft(next);})}/>
  {target&&<AssistantLaunchTargetPicker items={target.page.items} busy={busy} unavailable={target.unavailable} hasMore={!!target.page.nextCursor} onClose={()=>setTarget(undefined)} onMore={()=>act(async()=>{if(!target.page.nextCursor)return;const page=ASSISTANT_THREAD_TARGET_PAGE_SCHEMA.parse(await api().getAssistantLaunchTargets({cursor:target.page.nextCursor}));if(life.current)setTarget(current=>current===target?{...target,page:{items:[...target.page.items,...page.items],nextCursor:page.nextCursor}}:current);})} onContinue={existingThreadId=>act(async()=>{const next=ASSISTANT_LAUNCH_DRAFT_SCHEMA.parse(await api().prepareAssistantLaunch({proposalId:target.proposalId,expectedRevision:target.expectedRevision,...(existingThreadId?{existingThreadId}:{})}));if(life.current){setDraft(next);setTarget(undefined);}})}/>}
  {draft&&<AssistantLaunchConfirm draft={draft} busy={data.mutationBusy} unknown={data.operationUnknown} onClose={()=>setDraft(undefined)} onLookup={()=>lookup(draft.id)} onConfirm={(instruction,goalConsentChecked)=>act(async()=>{const result=ASSISTANT_LAUNCH_OPERATION_SCHEMA.parse(await api().confirmAssistantLaunch({draftId:draft.id,instruction,...(goalConsentChecked!==undefined?{goalConsentChecked}:{})}));if(life.current&&result.state!=='outcome_unknown')setDraft(undefined);})}/>}
 </section>;
}
