import {z} from 'zod';
import type {KSwarmService} from './kswarm-service.js';
import {readRoomConversionJson} from './room-conversion-bounded-json.js';
const reference=z.string().min(1).max(256).refine(value=>value.trim()===value&&!value.includes('\0'));
const digest=z.string().regex(/^[a-f0-9]{64}$/);
/** Exact authenticated read projection; this is not a B/model mutation grant. */
export const ORDINARY_FOLLOWUP_CONTEXT=z.object({ok:z.literal(true),protocol:z.literal('ordinary_project_followup_context_v1'),classification:z.literal('ordinary'),
 projectId:reference,projectRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),projectStatus:z.enum(['created','planning','active','delivered','closed']),primaryRoomId:reference.nullable(),
 scope:z.object({profileId:reference,workspaceId:reference}).strict(),bindingDigest:digest,canonicalCreateDigest:digest,
 conversionActions:z.object({add_task:z.object({eligible:z.literal(false),reasonCode:z.literal('CANDIDATE_WORKSPACE_UNAVAILABLE')}).strict(),add_revision:z.object({eligible:z.literal(false),reasonCode:z.literal('REVISION_BASE_NOT_READY')}).strict()}).strict(),
}).strict();
export type OrdinaryFollowupContext=z.infer<typeof ORDINARY_FOLLOWUP_CONTEXT>;
const failure=z.object({ok:z.literal(false),error:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/)}).strict();
export async function readOrdinaryFollowupContext(gateway:Pick<KSwarmService,'request'|'getDesktopMutationToken'>,projectId:string,
 scope:{profileId:string;workspaceId:string},signal:AbortSignal,assertNativeCurrent:()=>void=()=>{}):Promise<OrdinaryFollowupContext>{
 signal.throwIfAborted();if(!reference.safeParse(projectId).success)throw Error('room_conversion_input_invalid');
 const token=gateway.getDesktopMutationToken();if(!token)throw Error('mutation_credential_required');
 const response=await gateway.request(`/projects/${encodeURIComponent(projectId)}/followup-context`,{method:'GET',signal,redirect:'error',headers:{'x-kswarm-mutation-token':token}});
 let raw:unknown;try{raw=await readRoomConversionJson(response,16384,signal,assertNativeCurrent);}catch(error){if(signal.aborted)throw signal.reason;assertNativeCurrent();throw Error('room_conversion_project_source_unavailable',{cause:error});}signal.throwIfAborted();assertNativeCurrent();
 if(!response.ok){const rejected=failure.safeParse(raw);throw Error(rejected.success?rejected.data.error:'room_conversion_project_source_unavailable');}
 const parsed=ORDINARY_FOLLOWUP_CONTEXT.safeParse(raw);if(!parsed.success)throw Error('room_conversion_project_source_unavailable');
 const value=parsed.data;if(value.projectId!==projectId||value.scope.profileId!==scope.profileId||value.scope.workspaceId!==scope.workspaceId)throw Error('room_conversion_room_scope_mismatch');
 return value;
}
