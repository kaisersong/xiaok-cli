import {types} from 'node:util';
import {z} from 'zod/v3';
import {parseProjectActivityPage,PROJECT_ACTIVITY_BODY_LIMIT,type ParsedProjectActivityPage} from './project-delivery-data.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().min(1).max(256);
const scopeSchema=z.object({profileId:hash,workspaceId:hash}).strict();
const audienceSchema=scopeSchema.extend({projectId:key,sourceDataEpoch:key,after:z.number().int().nonnegative().safe()}).strict();
const envelopeSchema=z.object({ok:z.literal(true),protocol:z.literal('scoped_project_activity_v1'),projectId:key,scope:scopeSchema,bindingDigest:hash,page:z.unknown()}).strict();
export type ScopedProjectActivityAudience=z.infer<typeof audienceSchema>;
export type ParsedScopedProjectActivityPage=Omit<z.infer<typeof envelopeSchema>,'page'>&{page:ParsedProjectActivityPage};
function invalid():never {throw Error('activity_project_scoped_page_invalid');}
/** Capture only the fixed shallow envelope. The existing page parser owns all
 * nested page validation, bounds and descriptor-safe data capture. */
function fields(raw:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||Array.isArray(raw)||Object.getOwnPropertySymbols(raw).length
    ||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))invalid();
  const result:Record<string,unknown>=Object.create(null);
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  if(Object.keys(descriptors).length!==keys.length)invalid();
  for(const[name,field]of Object.entries(descriptors)){
    if(!keys.includes(name)||!field.enumerable||!Object.hasOwn(field,'value'))invalid();
    Object.defineProperty(result,name,{value:field.value,enumerable:true});
  }
  return result;
}
export function captureScopedProjectActivityAudience(raw:unknown):ScopedProjectActivityAudience {
  const captured=fields(raw,['projectId','sourceDataEpoch','after','profileId','workspaceId']);
  if(['projectId','sourceDataEpoch','profileId','workspaceId'].some(name=>typeof captured[name]!=='string')||typeof captured.after!=='number')invalid();
  const parsed=audienceSchema.safeParse(captured);if(!parsed.success)invalid();return Object.freeze(parsed.data);
}
/** Transport data only. Matching audience and hashes never mint a private
 * source frame, permission, database witness or execution admission. */
export function parseScopedProjectActivityPage(raw:unknown,expected:ScopedProjectActivityAudience):ParsedScopedProjectActivityPage {
  const audience=captureScopedProjectActivityAudience(expected);
  const captured=fields(raw,['ok','protocol','projectId','scope','bindingDigest','page']);
  if(captured.ok!==true||['protocol','projectId','bindingDigest'].some(name=>typeof captured[name]!=='string'))invalid();
  const scope=fields(captured.scope,['profileId','workspaceId']);
  if(typeof scope.profileId!=='string'||typeof scope.workspaceId!=='string')invalid();
  const envelope=envelopeSchema.safeParse({...captured,scope});if(!envelope.success)invalid();
  const body=envelope.data;
  if(body.projectId!==audience.projectId||body.scope.profileId!==audience.profileId||body.scope.workspaceId!==audience.workspaceId)invalid();
  const page=parseProjectActivityPage(body.page,audience);
  // The original parser has now verified every nested descriptor/prototype.
  // Count the original page bytes, before unknown delivery data is reduced.
  if(Buffer.byteLength(JSON.stringify(body))>PROJECT_ACTIVITY_BODY_LIMIT)invalid();
  return{...body,page};
}
