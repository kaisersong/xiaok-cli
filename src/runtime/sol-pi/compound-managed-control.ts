import {isDeepStrictEqual} from 'node:util';
import type {Tool} from '../../types.js';
import type {DirectOperationRecord} from './compound-direct-operation.js';

export interface ManagedCompoundQueryAdapter {assertCurrent():void}
interface QueryBinding {execute:Tool['execute'];permission:Tool['permission'];definition:Tool['definition'];adapter:Readonly<ManagedCompoundQueryAdapter>}
const queries=new WeakMap<Tool,QueryBinding>();
/** Main factory only, on its actual final service query wrapper. This does not
 * classify a plugin descriptor or grant a new source, mutation, or execution. */
export function bindManagedCompoundQueryTool(tool:Tool,adapter:ManagedCompoundQueryAdapter):Tool {
 if(queries.has(tool)||typeof adapter.assertCurrent!=='function')throw Error('compound_managed_query_binding');
 const check=adapter.assertCurrent.bind(adapter);
 queries.set(tool,{execute:tool.execute,permission:tool.permission,definition:structuredClone(tool.definition),adapter:Object.freeze({assertCurrent(){const result:unknown=check();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('compound_managed_query_async');}}})});return tool;
}
export function getManagedCompoundQueryAdapter(tool:Tool):Readonly<ManagedCompoundQueryAdapter>|undefined {
 const known=queries.get(tool);
 if(!known||known.execute!==tool.execute||known.permission!==tool.permission||!isDeepStrictEqual(known.definition,tool.definition))return undefined;
 return known.adapter;
}

export interface ManagedCompoundMessageAdapter extends ManagedCompoundQueryAdapter {
 inspectCommittedResult(input:Readonly<{nativeInvocationId:string;finalInput:Readonly<Record<string,unknown>>;result:string}>):Readonly<NonNullable<DirectOperationRecord['metadataCommit']>>;
}
const messages=new WeakMap<Tool,QueryBinding&{adapter:Readonly<ManagedCompoundMessageAdapter>}>();
/** Actual Main send wrapper only. The inspector must read its original durable
 * service operation, not accept a serialized model claim of delivery. */
export function bindManagedCompoundMessageTool(tool:Tool,adapter:ManagedCompoundMessageAdapter):Tool {
 if(messages.has(tool)||typeof adapter.assertCurrent!=='function'||typeof adapter.inspectCommittedResult!=='function')throw Error('compound_managed_message_binding');
 const check=adapter.assertCurrent.bind(adapter),inspect=adapter.inspectCommittedResult.bind(adapter);
 const bound:Readonly<ManagedCompoundMessageAdapter>=Object.freeze({assertCurrent(){const value:unknown=check();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('compound_managed_message_async');}},inspectCommittedResult(input:Parameters<ManagedCompoundMessageAdapter['inspectCommittedResult']>[0]){
  const value=inspect(Object.freeze({nativeInvocationId:input.nativeInvocationId,finalInput:Object.freeze(structuredClone(input.finalInput)),result:input.result}));
  if(value&&typeof(value as unknown as {then?:unknown}).then==='function'){void Promise.resolve(value).catch(()=>{});throw Error('compound_managed_message_async');}
  return Object.freeze(structuredClone(value));
 }});
 messages.set(tool,{execute:tool.execute,permission:tool.permission,definition:structuredClone(tool.definition),adapter:bound});return tool;
}
export function getManagedCompoundMessageAdapter(tool:Tool):Readonly<ManagedCompoundMessageAdapter>|undefined {
 const known=messages.get(tool);if(!known||known.execute!==tool.execute||known.permission!==tool.permission||!isDeepStrictEqual(known.definition,tool.definition))return undefined;return known.adapter;
}

export interface ManagedCompoundCancellationAdapter extends ManagedCompoundQueryAdapter {
 prepareCancellation(input:Readonly<{nativeInvocationId:string;finalInput:Readonly<Record<string,unknown>>}>):unknown;
 runCancellation(ticket:unknown,work:()=>Promise<string>):Promise<string>;
}
const cancellations=new WeakMap<Tool,QueryBinding&{adapter:Readonly<ManagedCompoundCancellationAdapter>}>();
/** Main's exact existing-target cancellation scope, never a new-turn grant. */
export function bindManagedCompoundCancellationTool(tool:Tool,adapter:ManagedCompoundCancellationAdapter):Tool {
 if(cancellations.has(tool)||typeof adapter.assertCurrent!=='function'||typeof adapter.prepareCancellation!=='function'||typeof adapter.runCancellation!=='function')throw Error('compound_managed_cancel_binding');
 const check=adapter.assertCurrent.bind(adapter),prepare=adapter.prepareCancellation.bind(adapter),run=adapter.runCancellation.bind(adapter);
 const bound:Readonly<ManagedCompoundCancellationAdapter>=Object.freeze({assertCurrent(){const value:unknown=check();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('compound_managed_cancel_async');}},
  prepareCancellation(input:Parameters<ManagedCompoundCancellationAdapter['prepareCancellation']>[0]){const value=prepare(Object.freeze({nativeInvocationId:input.nativeInvocationId,finalInput:Object.freeze(structuredClone(input.finalInput))}));if(value&&typeof(value as {then?:unknown}).then==='function'){void Promise.resolve(value).catch(()=>{});throw Error('compound_managed_cancel_async');}return value;},
  runCancellation:run});
 cancellations.set(tool,{execute:tool.execute,permission:tool.permission,definition:structuredClone(tool.definition),adapter:bound});return tool;
}
export function getManagedCompoundCancellationAdapter(tool:Tool):Readonly<ManagedCompoundCancellationAdapter>|undefined {
 const known=cancellations.get(tool);if(!known||known.execute!==tool.execute||known.permission!==tool.permission||!isDeepStrictEqual(known.definition,tool.definition))return undefined;return known.adapter;
}
