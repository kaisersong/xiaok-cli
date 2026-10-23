import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {readInstalledCurrentOwner} from '../../src/runtime/verification/installed-owner-state.js';
import {completionConsumerOwner} from '../../src/runtime/verification/completion-consumer-owner.js';
export interface LoopRunContext {requestSource:'user'|'agent'|'scheduler'}
export function captureLoopRunContext(raw:LoopRunContext):Readonly<{requestSource:'user'|'scheduler'}>{
 const value=captureLoopProducerValue(raw) as LoopRunContext;
 if(!value||Object.keys(value).join(',')!=='requestSource'||!['user','scheduler'].includes(value.requestSource))throw Error('loop_run_source');
 return Object.freeze({requestSource:value.requestSource as 'user'|'scheduler'});
}
export function assertOrdinaryLoopOwner(kind:'loop_run'|'loop_stage',id:string):void {
 if(readInstalledCurrentOwner(completionConsumerOwner({ownerKind:kind,ownerId:id})).kind!=='ordinary')throw Error('loop_publication_required');
}
