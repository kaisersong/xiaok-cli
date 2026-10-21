import type {Command} from 'commander';
import {canonicalVerificationJson as json} from '../runtime/verification/protocol.js';
import type {VerificationOwner} from '../runtime/verification/proof-authority.js';
interface DiagnosisRequest {requestSource:'user'|'agent'|'scheduler';ownerKind:VerificationOwner['ownerKind'];ownerId:string;cursor:string|null;limit:number}
function fields(value:any,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('maintenance_response');}
/** Fixed installed read-only diagnosis. No engine initialization, source read,
 * registration, migration retry or deletion is exposed by this command. */
export async function diagnoseProtectedController(raw:DiagnosisRequest,signal:AbortSignal){
 const request=JSON.parse(json(raw)) as DiagnosisRequest;
 if(request.requestSource!=='user'||!['task','goal','intent','project','loop'].includes(request.ownerKind)||typeof request.ownerId!=='string'||!request.ownerId||Buffer.byteLength(request.ownerId)>160||/[\x00-\x1f\x7f]/.test(request.ownerId)||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>64||request.cursor!==null&&(typeof request.cursor!=='string'||request.cursor.length>160))throw Error('maintenance_request');
 const {createInstalledVerificationClient}=await import('../runtime/verification/controller-client.js'),client=createInstalledVerificationClient();
 try{
  const encoded=json(await client.maintenanceTransport.call('maintenance.diagnose',request,signal));signal.throwIfAborted();if(Buffer.byteLength(encoded)>65536)throw Error('maintenance_response');const response=JSON.parse(encoded);
  fields(response,['mode','items','nextCursor','unmappedInventoryPresent']);
  if(response.mode!=='maintenance'||typeof response.unmappedInventoryPresent!=='boolean'||!Array.isArray(response.items)||response.items.length>request.limit||response.nextCursor!==null&&(typeof response.nextCursor!=='string'||response.nextCursor.length>160))throw Error('maintenance_response');
  let previous='';for(const item of response.items){fields(item,['resourceId','kind','state','mapping','reason']);if(typeof item.resourceId!=='string'||!item.resourceId||Buffer.byteLength(item.resourceId)>160||/[\x00-\x1f\x7f]/.test(item.resourceId)||item.resourceId<=previous||!['host-staging','guest-input','guest-output','host-export'].includes(item.kind)||!['reserved','released'].includes(item.state)||!['mapped','unmapped'].includes(item.mapping)||item.reason!==(item.mapping==='mapped'?null:'capacity_mapping_missing'))throw Error('maintenance_response');previous=item.resourceId;Object.freeze(item);}
  return Object.freeze({...response,items:Object.freeze(response.items)});
 }finally{client.dispose();}
}
export function registerProtectedControllerCommands(program:Command):void{
 program.command('protected-controller').description('查看受保护控制器维护状态')
  .command('diagnose').description('查询已登记 owner 的容量恢复信息')
  .requiredOption('--owner-kind <kind>','task、goal、intent、project 或 loop')
  .requiredOption('--owner-id <id>','已登记业务 owner ID')
  .option('--cursor <cursor>','上一页的原始 nextCursor')
  .option('--limit <count>','每页 1 至 64 项','64')
  .action(async(options:{ownerKind:VerificationOwner['ownerKind'];ownerId:string;cursor?:string;limit:string})=>{
   if(!/^\d+$/.test(options.limit))throw Error('maintenance_request');
   const page=await diagnoseProtectedController({requestSource:'user',ownerKind:options.ownerKind,ownerId:options.ownerId,cursor:options.cursor??null,limit:Number(options.limit)},AbortSignal.timeout(30000));console.log(JSON.stringify(page));
  });
}
