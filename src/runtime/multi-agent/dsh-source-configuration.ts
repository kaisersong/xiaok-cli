import {captureDispatchBusinessData} from '../conversation-activity/dispatch-business-data.js';
import {dshABinding,dshAFields,dshAHash,dshAText,type DshARecord} from './dsh-admission-data.js';
import {parseGithubBoundRepository} from './dsh-github-read-data.js';
const safe=Number.isSafeInteger,define=Object.defineProperty,freeze=Object.freeze,isArray=Array.isArray;
export function parseDshSourceConfiguration(raw:unknown):DshARecord {
  const data=captureDispatchBusinessData(raw);dshAFields(data,['schemaVersion','binding','repository','mode','selection','issueRefs','accountId','minimumIntervalMs']);
  dshABinding(data.binding);const repository=parseGithubBoundRepository(data.repository),auth=data.binding.authScope as DshARecord;
  if(data.schemaVersion!==1||repository.repositoryId!==auth.repositoryId||data.binding.provider!=='github'||data.mode!=='off'&&data.mode!=='observe'&&data.mode!=='auto_draft'||typeof data.minimumIntervalMs!=='number'||!safe(data.minimumIntervalMs)||data.minimumIntervalMs<1000||data.minimumIntervalMs>86400000)throw Error('DSH_A_SOURCE_CONFIG_INVALID');
  dshAText(data.accountId);
  const selectionNames=data.selection&&typeof data.selection==='object'&&(data.selection as DshARecord).kind==='issue_ids'?['kind','issueIds']:['kind','match','labelIds'];
  dshAFields(data.selection,selectionNames);
  if(selectionNames.length===3&&(data.selection as DshARecord).match!=='all')throw Error('DSH_A_SOURCE_CONFIG_INVALID');
  const selected=data.selection as DshARecord,key=selected.kind==='issue_ids'?'issueIds':'labelIds';
  if(selected.kind!=='issue_ids'&&selected.kind!=='label_ids'||!isArray(selected[key])||selected[key].length<1||selected[key].length>1000)throw Error('DSH_A_SOURCE_CONFIG_INVALID');
  for(let i=0;i<selected[key].length;i++){dshAText(selected[key][i]);for(let j=0;j<i;j++)if(selected[key][j]===selected[key][i])throw Error('DSH_A_SOURCE_CONFIG_INVALID');}
  if(!isArray(data.issueRefs)||data.issueRefs.length>1000)throw Error('DSH_A_SOURCE_CONFIG_INVALID');
  for(let i=0;i<data.issueRefs.length;i++){const ref=data.issueRefs[i];dshAFields(ref,['issueId','issueNumber']);dshAText(ref.issueId);if(typeof ref.issueNumber!=='number'||!safe(ref.issueNumber)||ref.issueNumber<1)throw Error('DSH_A_SOURCE_CONFIG_INVALID');let found=false;for(let j=0;j<selected[key].length;j++)if(selected[key][j]===ref.issueId)found=true;if(!found)throw Error('DSH_A_SOURCE_CONFIG_INVALID');for(let j=0;j<i;j++)if(data.issueRefs[j].issueId===ref.issueId||data.issueRefs[j].issueNumber===ref.issueNumber)throw Error('DSH_A_SOURCE_CONFIG_INVALID');}
  if(selected.kind==='issue_ids'&&data.issueRefs.length!==selected[key].length||selected.kind==='label_ids'&&data.issueRefs.length)throw Error('DSH_A_SOURCE_CONFIG_INVALID');
  return data;
}
export function dshSourceScopeIdentity(raw:unknown):DshARecord {
  const value=captureDispatchBusinessData(raw) as DshARecord;
  let names:string[];
  if(value.kind==='global')names=['kind'];
  else if(value.kind==='tenant')names=['kind','tenantId'];
  else if(value.kind==='workspace')names=['kind','tenantId','workspaceId'];
  else if(value.kind==='sourceBinding')names=['kind','tenantId','workspaceId','provider','repositoryId','sourceBindingId'];
  else if(value.kind==='mandate')names=['kind','tenantId','workspaceId','provider','repositoryId','sourceBindingId','mandateId'];
  else throw Error('DSH_A_CONTROL_INVALID');
  dshAFields(value,names);for(let i=1;i<names.length;i++)dshAText(value[names[i]!]);
  if((value.kind==='sourceBinding'||value.kind==='mandate')&&value.provider!=='github')throw Error('DSH_A_CONTROL_INVALID');
  return value;
}
export function dshSourceScopeKey(scope:unknown,identity:unknown):string {
  return 'dsh-scope-key:'+dshAHash(['dsh-trusted-control-scope-v1',scope,dshSourceScopeIdentity(identity)]);
}
export function dshSourceModeId(scopeKey:string):string {
  return 'dsh-policy:'+dshAHash(['dsh-policy-v1',scopeKey,'mode']);
}
export function dshSourceReadScopes(scope:unknown,configuration:DshARecord):readonly DshARecord[]{
  const b=configuration.binding as DshARecord,a=b.authScope as DshARecord;
  const identities=[{kind:'global'},{kind:'tenant',tenantId:a.tenantId},{kind:'workspace',tenantId:a.tenantId,workspaceId:a.workspaceId},{kind:'sourceBinding',tenantId:a.tenantId,workspaceId:a.workspaceId,provider:'github',repositoryId:a.repositoryId,sourceBindingId:b.bindingId}];
  const rows:DshARecord[]=[];
  for(let i=0;i<identities.length;i++)define(rows,rows.length,{__proto__:null,value:freeze({identity:freeze(identities[i]!),scopeKey:dshSourceScopeKey(scope,identities[i])}),enumerable:true} as PropertyDescriptor);
  return freeze(rows);
}
