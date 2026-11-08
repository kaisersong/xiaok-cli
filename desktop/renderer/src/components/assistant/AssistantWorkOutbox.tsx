import {useAssistantInbox} from '../../hooks/useAssistantInbox';
import {useLocale} from '../../contexts/LocaleContext';
import {AssistantOutboxCard} from './AssistantOutboxCard';
/** A work conversation receives the same Main confirmations as the assistant home. */
export function AssistantWorkOutbox({taskId}:{taskId?:string|null}){const inbox=useAssistantInbox('paused'),{t}=useLocale();const drafts=inbox.state?.outbox.filter(d=>d.taskId===taskId&&['draft','submitting','unknown','failed'].includes(d.status))??[];return <>{drafts.map(d=><AssistantOutboxCard key={d.id} draft={d} busy={inbox.busy} onApprove={input=>{void inbox.approve(input);}} onRefuse={draft=>{void inbox.refuse(draft);}}/>)}{inbox.error&&<p role="alert" className="text-xs text-[var(--c-text-secondary)]">{t.assistantInbox.errors[inbox.error]??t.assistantInbox.errors.failed}</p>}</>;}
