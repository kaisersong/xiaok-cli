import {createHash} from 'node:crypto';
import {capturedFields,parseCapturedSourceJson} from './captured-source-json.js';
import {KSWARM_STATE_WRITER_PROFILES as PROFILES,KSWARM_STATE_TRANSITION_WRITER as TRANSITION} from './kswarm-state-profile-data.js';
import type {CapturedSqliteCell} from './source-sqlite-cell.js';

type SchemaRow=Readonly<{type:string;name:string;tbl_name:string;sql:string|null}>;
type Writer=typeof PROFILES[number];
const TABLES=['state_entities','state_entity_history','state_meta'] as const;
const ACTIONS=['INSERT','UPDATE','DELETE'] as const;
const FLOOR='writer_floor_v1',TRANSITION_KEY='writer_transition_v1';
function fail():never{throw Error('captured_kswarm_state_profile');}
function object(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))fail();return raw as Record<string,unknown>;}
function hash(value:unknown){return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');}
function hex(v:unknown):v is string{return typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);}
function scope(raw:unknown):Record<string,unknown>{capturedFields(raw,['profileId','workspaceId']);const v=object(raw);if(!hex(v.profileId)||!hex(v.workspaceId))fail();return v;}
function parse(raw:string):Record<string,unknown>{const v=object(parseCapturedSourceJson(raw));if(JSON.stringify(v)!==raw)fail();return v;}
function writer(raw:Record<string,unknown>):Writer{
 const p=PROFILES.find(p=>p.schemaVersion===raw.schemaVersion&&p.profile===raw.profile&&p.digest===raw.writerProfileDigest);if(!p)fail();
 capturedFields(raw,['schemaVersion','profile','storeId','writerProfileDigest',...(p.schemaVersion===1?[]:['scope'])]);
 if(typeof raw.storeId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.storeId))fail();
 if(p.schemaVersion!==1)scope(raw.scope);return p;
}
function triggers(p:Readonly<{digest:string;functionName:string}>,transition=false):SchemaRow[]{
 const result:SchemaRow[]=[],key=transition?TRANSITION_KEY:FLOOR,immutableCode=transition?'writer_transition_immutable':'writer_floor_immutable',guard=transition?'writer_transition_profile_required':'writer_floor_profile_required';
 for(const table of TABLES)for(const action of ACTIONS){
  const name=`kswarm_writer_floor_${transition?'transition_':''}${table}_${action.toLowerCase()}`;
  const immutable=table!=='state_meta'?'':action==='INSERT'
   ?`SELECT CASE WHEN NEW.meta_key='${key}' AND EXISTS(SELECT 1 FROM state_meta WHERE meta_key='${key}') THEN RAISE(ABORT,'${immutableCode}') END;`
   :`SELECT CASE WHEN ${action==='UPDATE'?`NEW.meta_key='${key}' OR `:''}OLD.meta_key='${key}' THEN RAISE(ABORT,'${immutableCode}') END;`;
  result.push({type:'trigger',name,tbl_name:table,sql:`CREATE TRIGGER ${name} BEFORE ${action} ON ${table} BEGIN SELECT CASE WHEN ${p.functionName}() IS NOT '${p.digest}' THEN RAISE(ABORT,'${guard}') END;${immutable} END`});
 }return result;
}
function validateTransition(raw:string,base:Record<string,unknown>,baseRaw:string,revision:string):void{
 const r=parse(raw),target=PROFILES.find(p=>p.schemaVersion===4)!;
 capturedFields(r,['schemaVersion','kind','migrationId','storeId','fromFloorRawDigest','fromFloor','toFloor','transitionWriter','baseRevision','committedRevision','snapshotDigest','actorId']);
 if(![1,2].includes(base.schemaVersion as number)||r.schemaVersion!==1||r.kind!=='writer_floor_transition'||!hex(r.snapshotDigest)||!Number.isSafeInteger(r.baseRevision)||(r.baseRevision as number)<0||!Number.isSafeInteger(r.committedRevision)||r.committedRevision!==(r.baseRevision as number)+1)fail();
 if(!/^(0|[1-9][0-9]*)$/.test(revision)||BigInt(revision)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(revision)<BigInt(r.committedRevision as number))fail();
 const to=object(r.toFloor),domain=scope(to.scope);if(base.schemaVersion===2&&JSON.stringify(base.scope)!==JSON.stringify(domain))fail();
 const toFloor={schemaVersion:4,profile:target.profile,storeId:base.storeId,writerProfileDigest:target.digest,scope:{profileId:domain.profileId,workspaceId:domain.workspaceId}};
 const fromFloorRawDigest=hash(baseRaw),migrationId='writer-transition:'+hash(['writer-transition-v1',base.storeId,fromFloorRawDigest,toFloor,r.snapshotDigest,r.baseRevision]);
 const expected={schemaVersion:1,kind:'writer_floor_transition',migrationId,storeId:base.storeId,fromFloorRawDigest,fromFloor:base,toFloor,transitionWriter:{profile:TRANSITION.profile,functionName:TRANSITION.functionName,digest:TRANSITION.digest},baseRevision:r.baseRevision,committedRevision:r.committedRevision,snapshotDigest:r.snapshotDigest,actorId:'desktop-user:'+String(domain.profileId)};
 if(JSON.stringify(expected)!==raw)fail();
}
/** Reads the original reserved metadata and builds only the fixed expected
 * schema. All other metadata bytes still flow through the lossless collector. */
export function expectedKSwarmStateSchema(base:readonly SchemaRow[],rows:Iterable<{record:Readonly<Record<string,CapturedSqliteCell>>}>):readonly SchemaRow[]{
 let floor:string|undefined,transition:string|undefined,revision:string|undefined;
 for(const row of rows){const key=row.record.meta_key,value=row.record.meta_value;if(key?.type!=='text')continue;
  if(key.value===FLOOR||key.value===TRANSITION_KEY||key.value==='revision'){
   if(value?.type!=='text')fail();
   if(key.value===FLOOR){if(floor!==undefined||value.value.length>4096)fail();floor=value.value;}
   else if(key.value===TRANSITION_KEY){if(transition!==undefined||value.value.length>16384)fail();transition=value.value;}
   else{if(revision!==undefined)fail();revision=value.value;}
  }
 }
 if(floor===undefined){if(transition!==undefined)fail();return base;}
 const data=parse(floor),p=writer(data),expected=[...base,...triggers(p)];
 if(transition!==undefined){if(revision===undefined)fail();validateTransition(transition,data,floor,revision);expected.push(...triggers(TRANSITION,true));}
 return expected.sort((a,b)=>a.type<b.type?-1:a.type>b.type?1:a.name<b.name?-1:a.name>b.name?1:0);
}
