import type {ConversationActivityApi} from './service.js';
import type {ConversationActivityStore} from './store.js';
import type {ConversationMcpActivities} from './mcp.js';

/** Seal the original ingress, await every original physical read/coordination
 * tail, then close its original database. Never own or close the MCP transport. */
export async function closeConversationActivity(input:{mcp?:ConversationMcpActivities;service?:ConversationActivityApi;
 sources?:{dispose():void;close?():Promise<void>|void};store?:ConversationActivityStore;presentationTails?:readonly Promise<unknown>[]}):Promise<void>{
 const failures:unknown[]=[];
 for(const seal of [()=>input.mcp?.dispose(),()=>input.sources?.dispose(),()=>input.service?.dispose()])try{seal();}catch(error){failures.push(error);}
 const drains=[()=>input.mcp?.close(),()=>input.sources?.close?.(),()=>input.service?.close?.()];
 const results=await Promise.allSettled([...drains.map(async drain=>drain()),...input.presentationTails??[]]);
 failures.push(...results.flatMap(result=>result.status==='rejected'?[result.reason]:[]));
 // A rejected close may precede its physical drain proof. Keep the original
 // database available on every failed/unknown close; never infer proof from
 // allSettled alone. The original owner retains the error and the store.
 if(failures.length)throw new AggregateError(failures,'conversation_activity_close_failed');
 input.store?.close();
}
