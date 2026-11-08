import type {OriginalRootNmpLedger} from '../../src/runtime/verification/original-root-nmp-ledger.js';
import type {OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import type {GithubProviderDateFact} from './dsh-github-source-session.js';
export type Purpose='initialize'|'migrate_admission'|'read_basis'|'read_history'|'assessment_reserve'|'assessment_result'|'admission_commit'|'owner_reconcile'|'source_scan'|'admission_window'|'control_receipt'|'source_control'|'claim_command'|'github_source_read'|'github_source_setup'|'draft_prepare';
export interface DshOriginalReferences {readonly budgetObservation?:object;readonly budgetAttempt?:object;readonly budgetReservation?:object;readonly modelAttempt?:object;readonly ownerObservation?:object;readonly sourceScan?:object;readonly userControlProof?:object;readonly providerDateFact?:object;readonly budgetReserveProof?:object;readonly admissionProposal?:object;readonly budgetWorkSnapshot?:object}
export interface MainDshBootstrapView {readonly kind:'main_dsh_native_bootstrap_v1';assertCurrent():void;assertLocal():void}
export interface MainDshBootstrapAuthority {
 bindStore(store:object):void;
 openBootstrap(purpose:'initialize'|'migrate_admission'):object;
 openReadBasis(data:unknown,refs?:DshOriginalReferences):object;
 openReadHistory(data:unknown,refs?:DshOriginalReferences):object;
 openAssessmentReserve(data:unknown,refs?:DshOriginalReferences):object;
 openAssessmentResult(data:unknown,refs?:DshOriginalReferences):object;
 openAdmissionCommit(data:unknown,refs?:DshOriginalReferences):object;
 openDraftPrepare(data:unknown,refs?:DshOriginalReferences):object;
 openOwnerReconcile(data:unknown,refs?:DshOriginalReferences):object;
 openSourceScan(data:unknown,refs?:DshOriginalReferences):object;
 openAdmissionWindow(data:unknown,refs?:DshOriginalReferences):object;
 openControlReceipt(data:unknown,refs?:DshOriginalReferences):object;
 openSourceControl(data:unknown,refs?:DshOriginalReferences):object;
 openClaimCommand(data:unknown,refs?:DshOriginalReferences):object;
 openGithubSourceRead(data:unknown,refs?:DshOriginalReferences):object;
 openGithubSourceSetup(data:unknown,refs?:DshOriginalReferences):object;
 resolve(frame:object,purpose:string):Readonly<{data:unknown;assertCurrent():void}>;
 seal():void;
}
export interface MainDshKernelClockCut {readonly kind:'main_kernel_clock_cut_v1';readonly domainId:string;readonly continuousLowerNs:string;readonly continuousUpperNs:string;readonly wallMs:number}
export interface State {startedCore():object|null;readAdmission():OriginalAdmissionDatabaseBundle|null;prepareInstalled(core?:boolean):object;observeClock(fact:GithubProviderDateFact):void;clockView():MainDshClockView;clock():Readonly<MainDshKernelClockCut>|null;authority:MainDshBootstrapAuthority;store?:object;current():void;local():void;references(proof:object,purpose:string):DshOriginalReferences}
export interface InstalledPool {prepareKSwarmChild():Promise<object>;readLedger():Promise<OriginalRootNmpLedger>;assertReadyForOwner():void;open():Promise<object>;close():Promise<void>;startCore():Promise<void>;returnOwner():Promise<void>;readBootstrap(session:unknown):Promise<'fresh'|'restored'>;prepareBudgetWorker(prepared:unknown):Promise<object>;readAdmission():OriginalAdmissionDatabaseBundle|null}
export interface MainDshClockView {
 readonly projection:Readonly<{state:'verified';domainId:string;qualificationEpoch:number;nowMs:number}|{state:'unverified'|'rollback_detected'}>;
 assertCurrent():void;assertLocal():void;
}

export interface MainDshCoreCloseFailure {raw:unknown;secondary?:unknown[]}
