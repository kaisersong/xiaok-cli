import {canonicalVerificationJson as json} from '../verification/protocol.js';
import {parseGoalVerificationDefinition,type GoalVerificationDefinition} from '../goal/verification-definition.js';
import type {LoopStageKind} from './producer-types.js';
export type LoopPublicationContractDefinition=
 | {kind:'builtin-diagnostic';scanner:'artifact-evidence-regression'|'kswarm-service-health';objective:string;completionCriterion:string}
 | {kind:'assistant';assistantKind:'evening'|'morning';objective:string;completionCriterion:string}
 | {kind:'user-template'};
export interface LoopPublicationConfiguration {version:1;contract:LoopPublicationContractDefinition;verificationDefinitions:{run:Readonly<GoalVerificationDefinition>;stages:Partial<Record<LoopStageKind,Readonly<GoalVerificationDefinition>>>}}
export interface StoredLoopPublicationConfiguration {loopId:string;revision:number;configuration:Readonly<LoopPublicationConfiguration>;createdAt:number;updatedAt:number}
function fields(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('loop_publication_config_shape');}
export function freezeLoopPublicationValue<T>(value:T):Readonly<T>{if(value&&typeof value==='object'){Object.values(value).forEach(freezeLoopPublicationValue);Object.freeze(value);}return value;}
/** Explicit configuration only; recipes use the existing independent-definition
 * parser. No default criteria or completion proof is created here. */
export function parseLoopPublicationConfiguration(raw:unknown):Readonly<LoopPublicationConfiguration>{
 const encoded=json(raw);if(Buffer.byteLength(encoded)>256*1024)throw Error('loop_publication_config_limit');const value=JSON.parse(encoded);
 fields(value,['version','contract','verificationDefinitions']);if(value.version!==1)throw Error('loop_publication_config_version');
 const c=value.contract;let stages:string[];
 if(c?.kind==='builtin-diagnostic'){fields(c,['kind','scanner','objective','completionCriterion']);if(!['artifact-evidence-regression','kswarm-service-health'].includes(c.scanner))throw Error('loop_publication_config_scanner');stages=['scan'];}
 else if(c?.kind==='assistant'){fields(c,['kind','assistantKind','objective','completionCriterion']);if(!['evening','morning'].includes(c.assistantKind))throw Error('loop_publication_config_assistant');stages=[];}
 else if(c?.kind==='user-template'){fields(c,['kind']);stages=['execute','verify'];}else throw Error('loop_publication_config_kind');
 if(c.kind!=='user-template')for(const key of ['objective','completionCriterion'])if(typeof c[key]!=='string'||!c[key].trim())throw Error('loop_publication_config_text');
 fields(value.verificationDefinitions,['run','stages']);fields(value.verificationDefinitions.stages,stages);
 value.verificationDefinitions.run=parseGoalVerificationDefinition(value.verificationDefinitions.run);
 for(const stage of stages)value.verificationDefinitions.stages[stage]=parseGoalVerificationDefinition(value.verificationDefinitions.stages[stage]);
 return freezeLoopPublicationValue(value) as Readonly<LoopPublicationConfiguration>;
}
