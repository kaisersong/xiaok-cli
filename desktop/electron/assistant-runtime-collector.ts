import type {AssistantLoopExecutorDependencies} from './assistant-loop-executor.js';
import type {AssistantCalendarSource} from './assistant-calendar-source.js';

type Input=Parameters<AssistantLoopExecutorDependencies['collect']>[0];
export interface AssistantRuntimeCollectorOptions {
 inbox:{ensureToday(requestSource:'scheduler'):unknown|Promise<unknown>};
 snapshotReader:{collect:AssistantLoopExecutorDependencies['collect']};
 calendarSource:Pick<AssistantCalendarSource,'collect'|'context'>;
 contextReader:{buildMorningContext(input:{snapshot:unknown;pinnedThreadIds:string[]}):unknown|Promise<unknown>};
 threadMetaStore:{getThreadIds(kind:'pinned'):Iterable<string>};
}
/** Main-only composition of the existing owners. No second timer, account,
 * provider, path or authority is selected by the caller or renderer. */
export function createAssistantRuntimeCollector(options:AssistantRuntimeCollectorOptions):AssistantLoopExecutorDependencies['collect'] {
 const {inbox,snapshotReader,calendarSource,contextReader,threadMetaStore}=options;
 const ensure=inbox.ensureToday,snapshot=snapshotReader.collect,observe=calendarSource.collect,sourceContext=calendarSource.context,context=contextReader.buildMorningContext,pinned=threadMetaStore.getThreadIds;
 return async(input:Input)=>{
  input.signal?.throwIfAborted();
  if(input.kind==='morning')await Reflect.apply(ensure,inbox,['scheduler']);
  input.signal?.throwIfAborted();
  const captured=await Reflect.apply(snapshot,snapshotReader,[input]);
  input.signal?.throwIfAborted();
  if(input.kind==='evening')return captured;
  await Reflect.apply(observe,calendarSource,[{now:input.now,requestSource:'scheduler',...(input.signal?{signal:input.signal}:{})}]);
  input.signal?.throwIfAborted();
  if(!Reflect.apply(sourceContext,calendarSource,[]).isCurrent())throw Error('assistant_calendar_closed');
  const result=await Reflect.apply(context,contextReader,[{snapshot:captured,pinnedThreadIds:[...Reflect.apply(pinned,threadMetaStore,['pinned'])]}]);
  input.signal?.throwIfAborted();
  if(!Reflect.apply(sourceContext,calendarSource,[]).isCurrent())throw Error('assistant_calendar_closed');
  return result;
 };
}
