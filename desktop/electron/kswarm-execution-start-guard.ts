import type {KSwarmService,KSwarmExecutionStartRead} from './kswarm-service.js';

// Classification only: original reader/assert failures retain their exact cause
// across the transport cancellation path. This is never a permission grant.
const sourceFailures=new WeakSet<object>();
function rememberSourceFailure(error:unknown){if(error!==null&&(typeof error==='object'||typeof error==='function'))sourceFailures.add(error);}
export function isKSwarmExecutionStartFailure(error:unknown):boolean{return error!==null&&(typeof error==='object'||typeof error==='function')&&sourceFailures.has(error);}

/** Original local reader receipt only. This is not a remote claim or a capacity grant. */
export interface KSwarmExecutionStartContext {
  readonly projectId:string;
  readonly receipt:KSwarmExecutionStartRead;
}

export function assertKSwarmExecutionStart(service:KSwarmService,context:KSwarmExecutionStartContext):void {
  try{
  if(!service||typeof service.assertProjectExecutionStartRead!=='function')throw Error('project_execution_start_reader_unavailable');
  service.assertProjectExecutionStartRead(context.projectId,context.receipt);
  }catch(error){rememberSourceFailure(error);throw error;}
}

export async function readKSwarmExecutionStart(service:KSwarmService,projectId:string):Promise<KSwarmExecutionStartContext> {
  try{
  if(!service||typeof service.readProjectExecutionStart!=='function'||typeof service.assertProjectExecutionStartRead!=='function')throw Error('project_execution_start_reader_unavailable');
  const receipt=await service.readProjectExecutionStart(projectId);
  const context=Object.freeze({projectId,receipt});
  assertKSwarmExecutionStart(service,context);
  return context;
  }catch(error){rememberSourceFailure(error);throw error;}
}
