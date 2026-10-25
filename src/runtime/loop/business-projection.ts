import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {freezeLoopPublicationValue} from './publication-config.js';
import type {CurrentLoopPublicationSet} from '../loop/published-set.js';
import type {LoopRunRow,LoopStageRow,AssistantCandidateRow,StoredLoopPublicationCandidate} from './producer-types.js';
import type {LoopPublicationAttempt} from './publication-attempt.js';
import type {TaskSnapshot} from '../task-host/types.js';
export interface LoopProjectionRows {run:LoopRunRow;stages:LoopStageRow[];members:AssistantCandidateRow[]}
export interface LoopProjectionOrigin {before:LoopProjectionRows;after:LoopProjectionRows}
export interface LoopBusinessProjection {runId:string;originHash:string;origin:LoopProjectionOrigin;generation:number;previousGenerationHash:string|null;generationHash:string;observation:Readonly<CurrentLoopPublicationSet>}
export interface LoopBusinessProjectionTarget {runId:string;vector:string;rows:LoopProjectionRows;candidates:readonly Readonly<StoredLoopPublicationCandidate>[];publications:readonly Readonly<LoopPublicationAttempt>[];executions:readonly TaskSnapshot[];projection:Readonly<LoopBusinessProjection>|null}
export function loopProjectionHash(value:unknown){return createHash('sha256').update('loop-business-projection-v1\0').update(json(value)).digest('hex');}
export function freezeProjection<T>(value:T):Readonly<T>{return freezeLoopPublicationValue(JSON.parse(json(value)));}
export function projectedLoopRows(before:LoopProjectionRows,now:number):LoopProjectionRows{
 if(!Number.isSafeInteger(now)||now<before.run.updated_at||before.run.status!=='running'||before.stages.some(s=>s.status!=='running'||now<s.updated_at)||before.members.some(m=>m.status!=='staged'))throw Error('loop_projection_original_state');
 return {run:{...before.run,status:'success',finished_at:now,updated_at:now,failure_kind:null,message:null},
 stages:before.stages.map(s=>({...s,status:'success',finished_at:now,updated_at:now,failure_kind:null,message:null})),members:before.members.map(m=>({...m,status:'pending'}))};
}
export function validateLoopProjectionOrigin(origin:LoopProjectionOrigin):void{
 if(json(projectedLoopRows(origin.before,origin.after.run.updated_at))!==json(origin.after))throw Error('loop_projection_origin_transition');
}
const decisionFields=['status','target_kind','target_id','accepted_target_ref','decided_at'] as const;
/** Interpret only an exact originally projected row. Decisions may overlay an
 * original member, but can never change its immutable business contents. */
export function normalizeLoopProjectionRows(current:LoopProjectionRows,origin:LoopProjectionOrigin):LoopProjectionRows{
 validateLoopProjectionOrigin(origin);const rows=JSON.parse(json(current)) as LoopProjectionRows;
 if(json(rows.run)!==json(origin.after.run)||json(rows.stages)!==json(origin.after.stages)||rows.members.length!==origin.after.members.length)throw Error('loop_projection_rows_changed');
 for(let i=0;i<rows.members.length;i++)assertLoopProjectedMember(rows.members[i]!,origin.after.members[i]!);
 return JSON.parse(json(origin.before));
}

/** The exact ordinary decision overlay used by the full projector and captured
 * row reader. It neither mutates the source row nor establishes current proof. */
export function assertLoopProjectedMember(current:AssistantCandidateRow,after:AssistantCandidateRow):void{
 const actual=JSON.parse(json(current)) as AssistantCandidateRow;
 if(!['pending','accepting','accepted','accept_failed','rejected'].includes(actual.status))throw Error('loop_projection_decision');
 if(actual.status==='accepted'&&(!actual.target_kind||!actual.target_id||!actual.accepted_target_ref||actual.decided_at===null))throw Error('loop_projection_decision');
 if(actual.status!=='pending'&&actual.decided_at===null)throw Error('loop_projection_decision');
 for(const field of decisionFields)(actual as any)[field]=after[field];
 if(json(actual)!==json(after))throw Error('loop_projection_member_changed');
}
