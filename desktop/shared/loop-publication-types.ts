import type {GoalVerificationDefinition} from '../../src/runtime/goal/verification-definition.js';
import type {LoopPublicationConfiguration,StoredLoopPublicationConfiguration} from '../electron/loop-publication-config.js';
export type {StoredLoopPublicationConfiguration};
export type LoopPublicationAction =
 | {kind:'saveConfiguration';loopId:string;expectedRevision:number|null;configuration:LoopPublicationConfiguration}
 | {kind:'reserveNative';candidateId:string;expectedLatestAttemptId:string|null}
 | {kind:'advanceNative'|'recoverNative'|'recoverPublication';attemptId:string}
 | {kind:'reauthorizeNative';attemptId:string;expectedRevision:number}
 | {kind:'prepareSession';nativeAttemptId:string;obligationId:string}
 | {kind:'recoverSession'|'enrollSession'|'recoverEnrollment'|'recoverVerification';id:string}
 | {kind:'verify';id:string;exactCommand:{argv:string[];cwdRelative:string};expiresAt:number}
 | {kind:'publish';nativeAttemptId:string;expectedLatestAttemptId:string|null}
 | {kind:'project'|'inspect';runId:string};
export interface LoopPublicationActionResult {
 kind:LoopPublicationAction['kind'];recordId?:string;phase?:string;generation?:number;
 inspection?:{runId:string;checkedAt:number};
}
export interface LoopPublicationStateView {
 historyOnly:true;runId:string;loopId:string;businessState:string;workspaceRoot:string;
 projection:{generation:number;generationHash:string}|null;
 candidates:Array<{
  candidateId:string;stageKind:string|null;definition:Readonly<GoalVerificationDefinition>;
  natives:Array<{id:string;kind:'enrollment-and-application'|'application-reauthorization';revision:number;phase:string;sessions:Array<{id:string;obligationId:string;phase:string;executions:Array<{id:string;phase:string;exactCommand:{argv:string[];cwdRelative:string};expiresAt:number}>}>}>;
  publications:Array<{id:string;nativeAttemptId:string;status:string}>;
 }>;
}
