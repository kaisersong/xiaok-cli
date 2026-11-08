import {useCallback,useEffect,useRef,useState} from 'react';
import {getDesktopApi} from '../shared/desktop';
import {ASSISTANT_STATE_SCHEMA,type AssistantState,type AttentionStart,type AttentionItem,type AttentionAction,type OutboxApproval,type OutboxDraft} from '../../../shared/assistant-inbox-contract';
export function useAssistantInbox(profileStatus?:string){
 const [state,setState]=useState<AssistantState|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[initializing,setInitializing]=useState(false);
 const life=useRef({active:false,reading:false,queued:false,mutation:false});const request=useRef<()=>void>(()=>{});
 const read=useCallback(()=>{const owner=life.current;if(!owner.active)return;if(owner.reading){owner.queued=true;return;}const api=getDesktopApi();if(!api?.getAssistantState)return;owner.reading=true;void api.getAssistantState().then(value=>{if(owner.active&&life.current===owner)setState(ASSISTANT_STATE_SCHEMA.parse(value));}).catch(()=>{if(owner.active&&life.current===owner)setError('failed');}).finally(()=>{owner.reading=false;if(owner.active&&owner.queued){owner.queued=false;request.current();}});},[]);request.current=read;
 useEffect(()=>{const owner={active:true,reading:false,queued:false,mutation:false};life.current=owner;read();const stop=getDesktopApi()?.onAssistantInboxChanged?.(read);const stopDue=getDesktopApi()?.onScheduledTaskDue?.(read);return()=>{owner.active=false;stop?.();stopDue?.();};},[read]);
 useEffect(()=>{const owner=life.current,api=getDesktopApi();if(!api?.ensureAssistantToday||profileStatus==='paused'||profileStatus==='needs_consent')return;setInitializing(true);void api.ensureAssistantToday().then(()=>{if(owner.active&&life.current===owner)read();}).catch(()=>{if(owner.active&&life.current===owner)setError('failed');}).finally(()=>{if(owner.active&&life.current===owner)setInitializing(false);});},[profileStatus,read]);
 const mutate=useCallback(async<T,>(run:()=>Promise<T>):Promise<T|undefined>=>{const owner=life.current;if(!owner.active||owner.mutation)return;owner.mutation=true;setBusy(true);setError(null);try{return await run();}catch(e){if(owner.active&&life.current===owner){const text=e instanceof Error?e.message:'';setError(text.match(/\b(?:assistant|mail)_[a-z_]+\b/)?.[0]??'failed');}return;}finally{owner.mutation=false;if(owner.active&&life.current===owner){setBusy(false);read();}}},[read]);
 return {state,error,busy,initializing,clearError:()=>setError(null),read,
 testMessage:()=>mutate(()=>getDesktopApi()!.testAssistantMessage()),
 refresh:()=>mutate(()=>getDesktopApi()!.refreshAssistantSources()),
 start:(input:AttentionStart)=>mutate<AttentionItem>(()=>getDesktopApi()!.startAssistantItem(input)),
 act:(input:AttentionAction)=>mutate(()=>getDesktopApi()!.actOnAssistantItem(input)),
 approve:(input:OutboxApproval)=>mutate(()=>getDesktopApi()!.approveAssistantSend(input)),
 refuse:(draft:OutboxDraft)=>mutate(()=>getDesktopApi()!.refuseAssistantSend({id:draft.id,expectedRevision:draft.revision})),
 };
}
