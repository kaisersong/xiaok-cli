import {readOriginalDshModelPricingRequest,type OriginalDshModelPricingRequest} from './main-dsh-model-source.js';
import {parseDshSourceConfiguration} from '../../src/runtime/multi-agent/dsh-source-configuration.js';
import { types } from 'node:util';
import {randomUUID} from 'node:crypto';
import {readOriginalMainDshControl} from './main-dsh-control-source.js';
import {readOriginalDshAdmissionPort,readOriginalDshUserControlPort,readOriginalDshGithubReadAuthority,readOriginalDshDesktopState,readOriginalDshAutoAdmissionWindow,type DshAutoAdmissionWindowView,type DshGithubReadAuthority} from './desktop-multi-agent-store.js';
import {readOriginalMainDshBootstrapAuthority,readOriginalMainDshClock,readOriginalMainDshClockCut,observeOriginalMainDshClockDate,type MainDshKernelClockCut,type MainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalDshSourceReadPort,dshSourceReadCommandDigest,readOriginalDshSourceReadReservation,takeOriginalDshSourceReadReservation,type OriginalDshSourceReadPort} from './harness-optimization-service.js';
import {planGithubSetupRepositoryGet,decodeGithubSetupRepository,planGithubIssueIdentityGet,decodeGithubIssueIdentity,type GithubIssueIdentityPlan,type GithubIssueIdentityPage,parseGithubRepositoryCandidate,type GithubSetupRepositoryPlan,type GithubSetupRepositoryPage,type GithubRepositoryCandidate} from '../../src/runtime/multi-agent/dsh-github-setup-data.js';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import { createIntrinsicSet, settleIntrinsicOperations, aggregateIntrinsicErrors } from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody,type RoomTurnCustody} from '../../src/runtime/verification/original-sdk-custody.js';
import { retainSourceErrorTails } from '../../src/runtime/verification/source-error-tails.js';
import { createSingleRequestHttpsFetch, readSingleRequestOwnedReply, readOriginalSingleRequestPhysicalReceipt, isSingleRequestSourceUnknown } from '../../src/runtime/sol-pi/single-request-https.js';
import { captureGithubReadData, captureGithubOpaqueRecord, decodeGithubPage, githubReadFields, githubReadFreeze, githubReadHash, githubReadId, githubReadRecord, githubReadText, githubReadTest, parseGithubBoundRepository, type GithubBoundRepository, type GithubDecodedPage } from './dsh-github-read-data.js';
import { planGithubGet, type GithubGetPlan } from './dsh-github-read-plan.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys, own = Object.hasOwn, prototype = Object.getPrototypeOf;
const objectPrototype = Object.prototype, functionPrototype = Function.prototype, isProxy = types.isProxy, isPromise = types.isPromise, isError = types.isNativeError;
const NativeError = Error, NativeAbort = AbortController, abortNative = AbortController.prototype.abort;
const setTimer = setTimeout, clearTimer = clearTimeout, NativeParams = URLSearchParams, paramsAppend = URLSearchParams.prototype.append, paramsString = URLSearchParams.prototype.toString;
const safeInteger = Number.isSafeInteger, nativeNumber = Number;
const NativeWeakMap=WeakMap, weakGet=WeakMap.prototype.get, weakSet=WeakMap.prototype.set;
const sessionOwners=new NativeWeakMap<object,object>(), originalReads=new NativeWeakMap<object,{owner:object;receipt:GithubSessionCustodyReceipt;frameData:FrameData;clockBefore:Readonly<MainDshKernelClockCut>|null;clockAfter:Readonly<MainDshKernelClockCut>|null;assertCurrent():void;assertLocal():void}>();
const sessionInventories=new NativeWeakMap<object,(raw:unknown)=>void>();
const pricingNow=Date.now,pricingSignalAny=AbortSignal.any;
const NativeDate=Date,dateString=Date.prototype.toISOString,dateParse=Date.parse,dateUTC=Date.prototype.toUTCString;
export interface GithubSessionCustodyReceipt {
 plan:PhysicalPlan; page:PhysicalPage; status:number; attemptId:string; reservationRef:string; bytes:number;
 headers:{etag:string|null;requestId:string|null;link:string|null;retryAfter:string|null;date:string|null};
 credentialEpoch:number|null; sourceSnapshotAt:string; physical:'closed'; meter:{kind:'unqualified_callback_ack'}|{kind:'original_budget_settled';accountId:string;scanId:string;attemptId:string;requestDigest:string};
}
/** Membership narrowing only; never a Native/A/budget grant. */
export function isOriginalGithubSourceSession(value:unknown):value is MainGithubSourceSession {
 return !!value&&typeof value==='object'&&!isProxy(value)&&apply(weakGet,sessionOwners,[value])!==undefined;
}
/** Original session/result custody only. Neither this reader nor its meter marker grants Native/A/read authority. */
export function readOriginalGithubSessionRead(session:unknown,result:unknown):GithubSessionCustodyReceipt {
 if(!session||typeof session!=='object'||isProxy(session)||!result||typeof result!=='object'||isProxy(result))fail('DSH_GITHUB_READ_RECEIPT_REQUIRED');
 const owner=apply(weakGet,sessionOwners,[session]) as object|undefined;
 const found=apply(weakGet,originalReads,[result]) as {owner:object;receipt:GithubSessionCustodyReceipt}|undefined;
 if(!owner||!found||found.owner!==owner)fail('DSH_GITHUB_READ_RECEIPT_REQUIRED');return found.receipt;
}
export interface GithubProviderDateFact {
 readonly kind:'owned_github_provider_date_v1';readonly factRef:string;readonly sourceBindingId:string;readonly configurationRevision:number;readonly credentialEpoch:number;readonly providerAccountId:string;readonly repository:GithubBoundRepository;
 readonly attemptId:string;readonly rawBodyHash:string;readonly requestId:string|null;readonly rawDate:string;readonly secondLowerBound:string;readonly exclusiveSecondUpperBound:string;readonly observedAtLocal:string;readonly clockRelation:'unconfirmed';readonly localClockCut:Readonly<{before:Readonly<MainDshKernelClockCut>;after:Readonly<MainDshKernelClockCut>}>|null;assertCurrent():void;assertLocal():void;
}
const providerDates=new NativeWeakMap<object,{session:object;result:object;realm:object;store:object;source:object}>();
/** Actual HTTP Date custody only. Its second interval never confirms event-clock skew. */
export function readOriginalGithubSessionProviderDate(session:unknown,result:unknown,realm:unknown,store:unknown,source:unknown):GithubProviderDateFact {
 assertOriginalGithubSourceSessionOrigin(session,realm,store,source);const receipt=readOriginalGithubSessionRead(session,result);
 const row=apply(weakGet,originalReads,[result]) as {frameData:FrameData;clockBefore:Readonly<MainDshKernelClockCut>|null;clockAfter:Readonly<MainDshKernelClockCut>|null;assertCurrent():void;assertLocal():void}|undefined;
 if(!row||setup(row.frameData)||receipt.meter.kind!=='original_budget_settled'||receipt.physical!=='closed'||receipt.status!==200||receipt.plan.kind!=='repository'||receipt.page.kind!=='repository'||receipt.page.completeness!=='complete'||receipt.page.entry.kind!=='value'||receipt.page.entry.value.id!==row.frameData.repository.repositoryId||receipt.page.entry.value.nodeId!==row.frameData.repository.nodeId)fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');
 row.assertLocal();const rawDate=receipt.headers.date;
 if(typeof rawDate!=='string'||!githubReadTest(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/,rawDate))fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');
 const ms=dateParse(rawDate);if(!safeInteger(ms)||ms<0||ms>253402300798999||ms%1000!==0||apply(dateUTC,new NativeDate(ms),[])!==rawDate)fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');
 const frame=row.frameData,lower=apply(dateString,new NativeDate(ms),[]) as string,upper=apply(dateString,new NativeDate(ms+1000),[]) as string;
 const fact:GithubProviderDateFact=githubReadFreeze({kind:'owned_github_provider_date_v1',factRef:'github-provider-date:'+githubReadHash('dsh-github-owned-provider-date-v1',[frame.sourceBindingId,frame.configurationRevision,frame.credentialEpoch,receipt.attemptId,rawDate,receipt.page.rawBodyHash]),sourceBindingId:frame.sourceBindingId,configurationRevision:frame.configurationRevision,credentialEpoch:frame.credentialEpoch,providerAccountId:frame.providerAccountId,repository:frame.repository,attemptId:receipt.attemptId,rawBodyHash:receipt.page.rawBodyHash,requestId:receipt.headers.requestId,rawDate,secondLowerBound:lower,exclusiveSecondUpperBound:upper,observedAtLocal:receipt.sourceSnapshotAt,clockRelation:'unconfirmed',localClockCut:row.clockBefore&&row.clockAfter?githubReadFreeze({before:row.clockBefore,after:row.clockAfter}):null,assertCurrent:row.assertCurrent,assertLocal:row.assertLocal});
 apply(weakSet,providerDates,[fact,{session,result,realm,store,source}]);observeOriginalMainDshClockDate(fact,realm,store,source);return fact;
}
/** Ref strings and copied DTOs cannot reconstruct a time-basis fact. */
export function readOriginalGithubProviderDateFact(fact:unknown,realm:unknown,store:unknown,source:unknown):GithubProviderDateFact {
 if(!fact||typeof fact!=='object'||isProxy(fact))fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');const row=apply(weakGet,providerDates,[fact]) as {session:object;result:object;realm:object;store:object;source:object}|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.source!==source)fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');
 assertOriginalGithubSourceSessionOrigin(row.session,realm,store,source);readOriginalGithubSessionRead(row.session,row.result);const original=apply(weakGet,originalReads,[row.result]) as {assertLocal():void}|undefined;if(!original)fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');original.assertLocal();return fact as GithubProviderDateFact;
}
const nativeCreate=Object.create,nativeDefine=Object.defineProperty;
type BudgetProofView={frameData:FrameData;plan:PhysicalPlan;requestDigest:string;attemptId?:string;reservation?:object;outcome?:{actualResponseBytes:number|null;requestSent:boolean;physicallyClosed:boolean;outcome:'known'|'unknown'};assertCurrent():void;assertLocal():void};
const budgetProofs=new NativeWeakMap<object,{owner:object;purpose:string;view:BudgetProofView}>();
/** Original SDK request/fate provenance only; fixed A and budget Sources still validate their own scope/authority. */
export function readOriginalGithubSessionBudgetProof(session:unknown,proof:unknown,purpose:string):BudgetProofView {
 if(!isOriginalGithubSourceSession(session)||!proof||typeof proof!=='object'||isProxy(proof))fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
 const owner=apply(weakGet,sessionOwners,[session]),row=apply(weakGet,budgetProofs,[proof]) as {owner:object;purpose:string;view:BudgetProofView}|undefined;
 if(!row||row.owner!==owner||row.purpose!==purpose)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');return row.view;
}
interface SessionComposition {realm:object;store:object;authoritySource:object}
const sessionCompositions=new NativeWeakMap<object,SessionComposition>(),setupResults=new NativeWeakMap<object,{owner:object;view:GithubSourceSetupResultView}>();
const originalAContexts=new NativeWeakMap<object,{view:unknown;proof:object;assertLocal:()=>void}>();
const originalBindingContexts=new NativeWeakMap<object,{session:MainGithubSourceSession;view:DshGithubReadAuthority;proof:object;scanId:string}>();
export function assertOriginalGithubSourceSessionOrigin(session:unknown,realm:unknown,store:unknown,authoritySource:unknown):void {
 if(!isOriginalGithubSourceSession(session))fail('DSH_GITHUB_SESSION_ORIGIN_REQUIRED');const found=apply(weakGet,sessionCompositions,[session]) as SessionComposition|undefined;
 if(!found||found.realm!==realm||found.store!==store||found.authoritySource!==authoritySource)fail('DSH_GITHUB_SESSION_ORIGIN_REQUIRED');
}
export function readOriginalGithubBindingContext(session:unknown,context:unknown):{view:DshGithubReadAuthority;proof:object;scanId:string}|null {
 if(!isOriginalGithubSourceSession(session)||!context||typeof context!=='object'||isProxy(context))return null;const row=apply(weakGet,originalBindingContexts,[context]) as {session:MainGithubSourceSession;view:DshGithubReadAuthority;proof:object;scanId:string}|undefined;
 return row&&row.session===session?{view:row.view,proof:row.proof,scanId:row.scanId}:null;
}
/** Only the original binding context may project its real repository reply
 * into an HTTP Date fact. Missing Date keeps ordinary observation available. */
export function readOriginalGithubSessionProviderDateForContext(session:unknown,result:unknown,context:unknown):GithubProviderDateFact|null {
 const binding=readOriginalGithubBindingContext(session,context);if(!binding)return null;
 const origin=apply(weakGet,sessionCompositions,[session]) as SessionComposition|undefined;if(!origin)fail('DSH_GITHUB_SESSION_ORIGIN_REQUIRED');binding.view.assertLocal();
 try{return readOriginalGithubSessionProviderDate(session,result,origin.realm,origin.store,origin.authoritySource);}
 catch(error){const inventory=apply(weakGet,sessionInventories,[session]) as ((raw:unknown)=>void)|undefined;inventory?.(error);if(error&&typeof error==='object'&&!isProxy(error)&&isError(error)){const message=descriptor(error,'message');if(message&&own(message,'value')&&message.value==='DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED')return null;}throw error;}
}
/** Reads the original SQL Window under this session's captured A tuple. A
 * private-core fixture, absent Window or copied context cannot supply one. */
export function readOriginalGithubSourceAdmissionWindows(session:unknown,context:unknown):Readonly<{windows:readonly DshAutoAdmissionWindowView[];sourceSnapshotAt:string|null}> {
 const binding=readOriginalGithubBindingContext(session,context);
 if(!binding)return githubReadFreeze({windows:[],sourceSnapshotAt:null});
 const origin=apply(weakGet,sessionCompositions,[session]) as SessionComposition|undefined;
 if(!origin||binding.view.kind!=='source_binding')fail('DSH_GITHUB_SESSION_ORIGIN_REQUIRED');
 binding.view.assertLocal();
 const state=readOriginalDshDesktopState(origin.realm,origin.store,origin.authoritySource,{profileId:binding.view.profileId,workspaceId:binding.view.workspaceId}),windows:DshAutoAdmissionWindowView[]=[];
 for(let i=0;i<state.authorizations.publishedMandates.length;i++){
  const row=githubReadRecord(state.authorizations.publishedMandates[i]),document=githubReadRecord(githubReadRecord(row.projection).document);
  if(document.sourceBindingId!==binding.view.sourceBindingId||document.status!=='active')continue;
  let view:DshAutoAdmissionWindowView|null;
  try{view=readOriginalDshAutoAdmissionWindow(origin.realm,origin.store,origin.authoritySource,binding.view.sourceBindingId,githubReadText(document.mandateId));}
  catch(error){const inventory=apply(weakGet,sessionInventories,[session]) as ((raw:unknown)=>void)|undefined;inventory?.(error);if(!error||typeof error!=='object'||isProxy(error)||!isError(error))throw error;const message=descriptor(error,'message');if(!message||!own(message,'value'))throw error;const code=message.value;if(code!=='DSH_A_WINDOW_UNCONFIRMED'&&code!=='DSH_A_WINDOW_REBASELINE_REQUIRED'&&code!=='DSH_A_WINDOW_TIME_UNCONFIRMED'&&code!=='DSH_A_WINDOW_GUARD_CHANGED'&&code!=='DSH_A_MODE_OFF'&&code!=='DSH_A_SCOPE_POLICY_DENIED'&&code!=='DSH_A_MANDATE_CLOSED'&&code!=='DSH_A_SOURCE_BINDING_CLOSED'&&code!=='DSH_A_BASELINE_UNCONFIRMED'&&code!=='DSH_A_OWNER_DOMAIN_REQUIRED')throw error;continue;}
  if(view){view.assertCurrent();windows[windows.length]=view;}
 }
 if(!windows.length)return githubReadFreeze({windows,sourceSnapshotAt:null});
 const clock=readOriginalMainDshClock(origin.realm,origin.store,origin.authoritySource);if(clock.projection.state!=='verified')return githubReadFreeze({windows:[],sourceSnapshotAt:null});
 const sourceSnapshotAt=apply(dateString,new NativeDate(clock.projection.nowMs),[]) as string;
 clock.assertLocal();binding.view.assertLocal();return githubReadFreeze({windows,sourceSnapshotAt});
}
export interface GithubSourceSetupResultView {
 readonly kind:'github_source_setup_result_v1';readonly setupId:string;readonly configurationRevision:number;
 readonly profileId:string;readonly tenantId:string;readonly workspaceId:string;readonly candidateRepository:GithubRepositoryCandidate;
 readonly providerAccountId:string;readonly repository:GithubBoundRepository;readonly requestProof:object;
 readonly reads:readonly [GithubSessionCustodyReceipt,GithubSessionCustodyReceipt];assertCurrent():void;assertLocal():void;
}
/** Original production birth tuple AND actual two GET/ledger receipts; never a caller result/known flag. */
export function readOriginalGithubSourceSetupResult(session:unknown,result:unknown,realm:unknown,store:unknown,authoritySource:unknown):GithubSourceSetupResultView {
 if(!isOriginalGithubSourceSession(session)||!result||typeof result!=='object'||isProxy(result))fail('DSH_GITHUB_SETUP_RESULT_REQUIRED');
 const composition=apply(weakGet,sessionCompositions,[session]) as SessionComposition|undefined;
 const row=apply(weakGet,setupResults,[result]) as {owner:object;view:GithubSourceSetupResultView}|undefined;
 if(!composition||composition.realm!==realm||composition.store!==store||composition.authoritySource!==authoritySource||!row||row.owner!==apply(weakGet,sessionOwners,[session]))fail('DSH_GITHUB_SETUP_RESULT_REQUIRED');
 if(row.view.reads[0].meter.kind!=='original_budget_settled'||row.view.reads[1].meter.kind!=='original_budget_settled')fail('DSH_GITHUB_SETUP_BUDGET_REQUIRED');return row.view;
}
function fail(code: string): never { throw new NativeError(code); }
type Scope = { profileId: string; tenantId: string; workspaceId: string };
type BindingFrameData = Scope & { requestSource: 'user' | 'scheduler'; mode: 'off' | 'observe' | 'auto_draft'; sourceBindingId: string; configurationRevision: number; credentialEpoch: number; providerAccountId: string; repository: GithubBoundRepository };
type SetupFrameData=Scope&{kind:'source_setup';requestSource:'user';mode:'observe';setupId:string;configurationRevision:number;candidateRepository:GithubRepositoryCandidate};
type FrameData=BindingFrameData|SetupFrameData;
function setup(data:FrameData):data is SetupFrameData{return 'kind'in data&&data.kind==='source_setup';}
type PhysicalPlan=GithubGetPlan|GithubSetupRepositoryPlan|GithubIssueIdentityPlan;
type PhysicalPage=GithubDecodedPage|GithubSetupRepositoryPage|GithubIssueIdentityPage;
type Frame = { data: FrameData; current: Function; raw: object };
type Reservation = { attemptId: string; reservationRef: string; maxResponseBytes: number; timeoutMs: number; budget?:{cap:object;proof:object;port:OriginalDshSourceReadPort;settle:Function;accountId:string;scanId:string;requestDigest:string} };
interface ReadAuthority { resolve: Function; reserve: Function; settle: Function; bind: Function }
export interface GithubSessionStatus { state: 'unavailable' | 'credential_required' | 'validating' | 'connected' | 'unknown' | 'closing' | 'closed'; sourceBindingId: string | null; repositoryId: string | null; credentialEpoch: number | null }
export interface GithubSessionRead { page: PhysicalPage; status: number; planHash: string; attemptId: string; reservationRef: string; bytes: number }
export interface MainGithubSourceSession {
  connect(input: unknown, context: unknown): Promise<GithubSessionStatus>;
  read(plan: unknown, context: unknown): Promise<GithubSessionRead>;
  disconnect(context: unknown): Promise<void>;
  getStatus(): GithubSessionStatus;
  stopAccepting(): void;
  abortAllActive(reason?: string): void;
  drain(deadlineMs: number): Promise<boolean>;
  close(): Promise<void>;
}
function parseScope(raw: unknown): Scope {
  const r = githubReadRecord(captureGithubReadData(raw)); githubReadFields(r, ['profileId', 'tenantId', 'workspaceId']);
  return { profileId: githubReadText(r.profileId), tenantId: githubReadText(r.tenantId), workspaceId: githubReadText(r.workspaceId) };
}
function method(receiver: object, key: string, synchronous: boolean): Function {
  const row = descriptor(receiver, key);
  if (!row || !own(row, 'value') || typeof row.value !== 'function' || isProxy(row.value)
    || synchronous && (types.isAsyncFunction(row.value) || prototype(row.value) !== functionPrototype)) fail('DSH_GITHUB_SOURCE_INVALID');
  return row.value;
}
/** Production composition is intentionally not installed until original A and source_read metering issue genuine capabilities.
 * No callback/known flag/credential helper can turn this public factory into a network grant. */
export function createMainGithubSourceSession(scope: unknown): MainGithubSourceSession {
  return createSessionCore(parseScope(scope), undefined);
}
// The test loader exposes this private assembler only to isolated TLS fixtures. It is not a product option or exported grant API.
function createSessionCore(rawScope: unknown, rawAuthority: object | undefined): MainGithubSourceSession {
  const scope = parseScope(rawScope), sessionOwner = {};
  let authority: ReadAuthority | undefined;
  let sourceReadPort:OriginalDshSourceReadPort|undefined,sourceReadSettle:Function|undefined;
  if (rawAuthority !== undefined) {
    if (isProxy(rawAuthority) || prototype(rawAuthority) !== objectPrototype && prototype(rawAuthority) !== null) fail('DSH_GITHUB_SOURCE_INVALID');
    authority = { resolve: method(rawAuthority, 'resolve', true), reserve: method(rawAuthority, 'reserve', false), settle: method(rawAuthority, 'settle', false), bind: method(rawAuthority, 'bind', false) };
    const port=descriptor(rawAuthority,'sourceReadPort');if(port){if(!own(port,'value')||!port.value||typeof port.value!=='object'||isProxy(port.value))fail('DSH_GITHUB_SOURCE_INVALID');sourceReadPort=port.value as OriginalDshSourceReadPort;sourceReadSettle=method(sourceReadPort,'settleRequest',false);}
  }
  const roots = createIntrinsicSet<object>(), tails = createIntrinsicSet<object>(), observedPromises = createIntrinsicSet<unknown>(), unknown = createIntrinsicSet<unknown>(), waiters = createIntrinsicSet<() => void>();
  const controllers = createIntrinsicSet<AbortController>();
  let accepting = true, generation = 0, poisoned = false, firstPresent = false, first: unknown, closing: Promise<void> | undefined, finished = false;
  let credential: { token: string; data: FrameData; operationId: string } | undefined, connected = false;
  const remember = (raw: unknown) => { if (!firstPresent) { firstPresent = true; first = raw; } };
  const wake = () => { const values = waiters.snapshot(); for (let i = 0; i < values.length; i++) values[i]!(); };
  function inventory(raw: unknown): void {
    retainSourceErrorTails(raw, (value, kind) => {
      if (kind === 'unknown') { unknown.add(value); poisoned = true; return; }
      if (observedPromises.has(value)) return; observedPromises.add(value);
      const root = {}; tails.add(root);
      try {
        const done = (outcome: unknown) => { try { inventory(outcome); } catch (error) { unknown.add(error); poisoned = true; } finally { tails.delete(root); wake(); } };
        assertStandardIpcPromise(value, 'DSH_GITHUB_SOURCE_UNCONFIRMED');
        apply(nativeThen, value, [done, done]);
      } catch (error) { unknown.add(value); unknown.add(error); poisoned = true; tails.delete(root); wake(); }
    });
  }
  // A witnessed authority/transport loss fences this credential generation permanently.
  // Preserve the original SDK value before aborting, because abort can synchronously re-enter observers.
  function fence(raw: unknown): void {
    remember(raw); inventory(raw);
    if (!credential) return;
    credential = undefined; connected = false; generation++;
    const active = controllers.snapshot();
    for (let i = 0; i < active.length; i++) {
      try { apply(abortNative, active[i]!, []); } catch (error) { remember(error); inventory(error); unknown.add(error); poisoned = true; }
    }
  }
  function local(expectedGeneration?: number): void {
    if (!accepting || expectedGeneration !== undefined && generation !== expectedGeneration) fail('DSH_GITHUB_SESSION_CLOSED');
    if (poisoned || unknown.size) fail('DSH_GITHUB_SOURCE_UNCONFIRMED');
  }
  // Only this local box crosses async resolution. Foreign SDK outcomes are never
  // returned/awaited directly, which would assimilate an untrusted `then` getter.
  function invoke(fn: Function, args: unknown[], receiver:unknown=rawAuthority): Promise<{ value: unknown }> {
    const root = {}; roots.add(root);
    return new NativePromise((yes, no) => {
      const finish = (value: unknown, rejected: boolean) => {
        try {
          inventory(value);
          if (rejected) { remember(value); no(value); }
          else yes({ __proto__: null, value } as { value: unknown });
        } catch (error) { remember(error); no(error); }
        finally { roots.delete(root); wake(); }
      };
      let raw: unknown;
      try { raw = apply(fn, receiver, args); }
      catch (error) { finish(error, true); return; }
      try {
        inventory(raw);
        if (isPromise(raw)) {
          assertStandardIpcPromise(raw, 'DSH_GITHUB_SOURCE_UNCONFIRMED');
          apply(nativeThen, raw, [(value: unknown) => finish(value, false), (error: unknown) => finish(error, true)]);
        } else finish(raw, false);
      } catch (error) { remember(raw); inventory(error); unknown.add(raw); poisoned = true; finish(error, true); }
    });
  }
  function frame(context: unknown, purpose: 'connect' | 'read' | 'disconnect', input: unknown): Frame {
    if (!authority) fail('DSH_GITHUB_SOURCE_NOT_READY');
    const root = {}; roots.add(root);
    try {
      let raw: unknown;
      try { raw = apply(authority.resolve, rawAuthority, [context, purpose, input]); } catch (error) { remember(error); inventory(error); throw error; }
      if (!raw || typeof raw !== 'object' || isProxy(raw) || isPromise(raw) || prototype(raw) !== objectPrototype && prototype(raw) !== null) { inventory(raw); poisoned = true; fail('DSH_GITHUB_SOURCE_UNCONFIRMED'); }
      const names = keys(raw); let dataValue: unknown, current: Function | undefined;
      for (let i = 0; i < names.length; i++) {
        const key = names[i]!, row = descriptor(raw, key);
        if (!row || !own(row, 'value') || !row.enumerable) { inventory(raw); poisoned = true; fail('DSH_GITHUB_SOURCE_UNCONFIRMED'); }
        if (key === 'assertCurrent' && typeof row.value === 'function' && !isProxy(row.value) && !types.isAsyncFunction(row.value) && prototype(row.value) === functionPrototype) current = row.value;
        else { inventory(row.value); if (key === 'data') dataValue = row.value; }
      }
      if (names.length !== 2 || !current) { poisoned = true; unknown.add(raw); fail('DSH_GITHUB_SOURCE_INVALID'); }
      const r = githubReadRecord(captureGithubReadData(dataValue));
      if(r.kind==='source_setup'){
        githubReadFields(r,['profileId','tenantId','workspaceId','kind','requestSource','mode','setupId','configurationRevision','candidateRepository']);
        if(purpose!=='connect'||r.profileId!==scope.profileId||r.tenantId!==scope.tenantId||r.workspaceId!==scope.workspaceId||r.requestSource!=='user'||r.mode!=='observe'||!safeInteger(r.configurationRevision)||nativeNumber(r.configurationRevision)<1)fail('DSH_GITHUB_SETUP_INVALID');
        const data:SetupFrameData={...scope,kind:'source_setup',requestSource:'user',mode:'observe',setupId:githubReadText(r.setupId),configurationRevision:r.configurationRevision as number,candidateRepository:parseGithubRepositoryCandidate(r.candidateRepository)};return{data,current,raw};
      }
      githubReadFields(r, ['profileId', 'tenantId', 'workspaceId', 'requestSource', 'mode', 'sourceBindingId', 'configurationRevision', 'credentialEpoch', 'providerAccountId', 'repository']);
      if (r.profileId !== scope.profileId || r.tenantId !== scope.tenantId || r.workspaceId !== scope.workspaceId
        || r.requestSource !== 'user' && r.requestSource !== 'scheduler' || purpose !== 'read' && r.requestSource !== 'user'
        || r.mode !== 'off' && r.mode !== 'observe' && r.mode !== 'auto_draft'
        || !safeInteger(r.configurationRevision) || nativeNumber(r.configurationRevision) < 1 || !safeInteger(r.credentialEpoch) || nativeNumber(r.credentialEpoch) < 1) fail('DSH_GITHUB_SOURCE_INVALID');
      const data = { ...scope, requestSource: r.requestSource, mode: r.mode, sourceBindingId: githubReadText(r.sourceBindingId), configurationRevision: r.configurationRevision as number, credentialEpoch: r.credentialEpoch as number,
        providerAccountId: githubReadId(r.providerAccountId), repository: parseGithubBoundRepository(r.repository) } as BindingFrameData;
      if (purpose !== 'disconnect' && data.mode === 'off') fail('DSH_GITHUB_MODE_OFF');
      return { data, current, raw };
    } catch (error) { fence(error); throw error; } finally { roots.delete(root); wake(); }
  }
  function current(frame: Frame, expectedGeneration: number): void {
    local(expectedGeneration);
    const root = {}; roots.add(root);
    try {
      let raw: unknown;
      try { raw = apply(frame.current, frame.raw, []); } catch (error) { remember(error); inventory(error); throw error; }
      if (raw !== undefined) { inventory(raw); unknown.add(raw); poisoned = true; fail('DSH_GITHUB_SOURCE_UNCONFIRMED'); }
    } catch (error) { fence(error); throw error; } finally { roots.delete(root); wake(); }
    local(expectedGeneration);
  }
  function operation<T>(work: (born: number) => Promise<T>): Promise<T> {
    const root = {}; roots.add(root); const born = generation;
    const result = (async () => { try { local(born); return await work(born); } finally { roots.delete(root); wake(); } })();
    return result;
  }
  function status(): GithubSessionStatus {
    return githubReadFreeze({ state: poisoned || unknown.size ? 'unknown' : !accepting ? finished ? 'closed' : 'closing' : credential ? connected ? 'connected' : 'validating' : authority ? 'credential_required' : 'unavailable', sourceBindingId: credential&&!setup(credential.data)?credential.data.sourceBindingId:null,
      repositoryId: credential&&!setup(credential.data)?credential.data.repository.repositoryId:null, credentialEpoch: credential&&!setup(credential.data)?credential.data.credentialEpoch:null });
  }
  async function http(frame: Frame, plan: PhysicalPlan, born: number): Promise<GithubSessionRead> {
    current(frame, born);
    const credentialIdentity=setup(frame.data)?{kind:'source_setup',setupId:frame.data.setupId,candidateRepository:frame.data.candidateRepository,configurationRevision:frame.data.configurationRevision}:{kind:'source_binding',sourceBindingId:frame.data.sourceBindingId,configurationRevision:frame.data.configurationRevision,credentialEpoch:frame.data.credentialEpoch,providerAccountId:frame.data.providerAccountId};
    const requestDigest=githubReadHash('dsh-github-source-request-v1',{plan,headers:{accept:'application/vnd.github.raw+json',apiVersion:'2026-03-10',userAgent:'xiaok-github-read-source-v1'},credential:credentialIdentity});
    const reserveProof=githubReadFreeze(nativeCreate(null)) as object;
    apply(weakSet,budgetProofs,[reserveProof,{owner:sessionOwner,purpose:'source_read_reserve',view:githubReadFreeze({frameData:frame.data,plan,requestDigest,assertCurrent(){current(frame,born);},assertLocal(){local(born);}})}]);
    const reservationRaw = (await invoke(authority!.reserve, [frame.raw, { planHash: plan.planHash, requestKind: plan.kind,plan,requestDigest },reserveProof])).value;
    let reservation: Reservation;
    try {
      if(sourceReadPort){
        const raw=captureGithubOpaqueRecord(reservationRaw,['cap','reserveProof']);
        const cap=raw.cap as object,proof=raw.reserveProof as object;
        const view=readOriginalDshSourceReadReservation(sourceReadPort,cap);
        if(proof!==reserveProof||view.requestDigest!==requestDigest)fail('DSH_GITHUB_METER_INVALID');
        reservation={attemptId:view.attemptId,reservationRef:'dsh-source-read:'+view.accountId+':'+view.scanId+':'+view.attemptId,maxResponseBytes:view.responseBytesUpperBound,timeoutMs:view.timeoutMs,budget:{cap,proof,port:sourceReadPort,settle:sourceReadSettle!,accountId:view.accountId,scanId:view.scanId,requestDigest:view.requestDigest}};
      }else{
      const r = githubReadRecord(captureGithubReadData(reservationRaw)); githubReadFields(r, ['attemptId', 'reservationRef', 'maxResponseBytes', 'timeoutMs']);
      if (!safeInteger(r.maxResponseBytes) || nativeNumber(r.maxResponseBytes) < 1 || nativeNumber(r.maxResponseBytes) > 1024 * 1024
        || !safeInteger(r.timeoutMs) || nativeNumber(r.timeoutMs) < 1 || nativeNumber(r.timeoutMs) > 30_000) fail('DSH_GITHUB_METER_INVALID');
      reservation = { attemptId: githubReadText(r.attemptId), reservationRef: githubReadText(r.reservationRef), maxResponseBytes: r.maxResponseBytes as number, timeoutMs: r.timeoutMs as number };
      }
    } catch (error) {
      // No trustworthy reservation reference exists yet. Never guess-settle using
      // claimed IDs; retain the complete original and keep the owner unconfirmed.
      remember(reservationRaw); inventory(reservationRaw); unknown.add(reservationRaw); poisoned = true; fence(error); throw error;
    }
    const abort = new NativeAbort(); controllers.add(abort); let physical: Promise<void> | undefined, connectEntered = false, bytes = 0, succeeded = false, bodyKnown=false;
    let primaryPresent = false, primary: unknown, result: GithubSessionRead | undefined;
    let receipt: GithubSessionCustodyReceipt | undefined;
    let clockBefore:Readonly<MainDshKernelClockCut>|null=null,clockAfter:Readonly<MainDshKernelClockCut>|null=null;
    const clockCut=()=>{const composition=apply(weakGet,sessionCompositions,[api]) as {realm:object;store:object;authoritySource:object}|undefined;return composition?readOriginalMainDshClockCut(composition.realm,composition.store,composition.authoritySource):null;};
    const params = new NativeParams(); for (let i = 0; i < plan.query.length; i++) apply(paramsAppend, params, [plan.query[i]![0], plan.query[i]![1]]);
    const query = apply(paramsString, params, []) as string, destination = plan.origin + plan.pathname + (query ? '?' + query : '');
    try {
      current(frame, born);
      if(reservation.budget)takeOriginalDshSourceReadReservation(reservation.budget.port,reservation.budget.proof,reservation.budget.cap);
      local(born);
      const hooks = { beforeTransport(phase: 'connect' | 'send') { local(born); if (phase === 'connect') {clockBefore=clockCut();connectEntered = true;} }, observeRawFailure(raw: unknown) { fence(raw); } };
      const fetch = createSingleRequestHttpsFetch({ destination, expectedBody: '', method: 'GET', timeoutMs: reservation.timeoutMs, maxResponseBytes: reservation.maxResponseBytes, signal: abort.signal,
        sourceHooks: hooks, trackPhysicalDrain(value) { physical = value; } });
      local(born);
      const response = await fetch(destination, { method: 'GET', headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'xiaok-github-read-source-v1', Authorization: `Bearer ${credential!.token}` }, signal: abort.signal });
      const reply = await readSingleRequestOwnedReply(fetch, response); bytes = reply.bytes.byteLength; bodyKnown=true;
      for (let i = 0; i < reply.ownExtras.length; i++) inventory(reply.ownExtras[i]);
      if (reply.ownUnknown) { unknown.add(response); poisoned = true; fail('DSH_GITHUB_SOURCE_UNCONFIRMED'); }
      current(frame, born);
      if (reply.status !== 200) {const error=new NativeError('DSH_GITHUB_HTTP_UNAVAILABLE');fence(error);throw error;}
      const page = plan.kind==='repository_discovery'?decodeGithubSetupRepository({candidateRepository:plan.candidateRepository,bytes:reply.bytes,maxBytes:reservation.maxResponseBytes}):plan.kind==='issue_identity'?decodeGithubIssueIdentity({boundRepository:plan.boundRepository,expectedIssueId:plan.expectedIssueId,issueNumber:plan.issueNumber,bytes:reply.bytes,maxBytes:reservation.maxResponseBytes,representationTag:reply.headers.etag??'unproven-representation'}):decodeGithubPage({ schemaVersion: 1, kind: plan.kind, boundRepository: plan.boundRepository, parentIssue: plan.parentIssue, bytes: reply.bytes, maxBytes: reservation.maxResponseBytes,
        representationTag: plan.kind === 'user' || plan.kind === 'repository' || plan.kind === 'labels' ? null : reply.headers.etag ?? 'unproven-representation' });
      current(frame, born); succeeded = true;
      result = githubReadFreeze({ page, status: reply.status, planHash: plan.planHash, attemptId: reservation.attemptId, reservationRef: reservation.reservationRef, bytes });
      receipt = githubReadFreeze({plan,page,status:reply.status,attemptId:reservation.attemptId,reservationRef:reservation.reservationRef,bytes,headers:reply.headers,
        credentialEpoch:setup(frame.data)?null:frame.data.credentialEpoch,sourceSnapshotAt:apply(dateString,new NativeDate(),[]) as string,physical:'closed' as const,meter:{kind:'unqualified_callback_ack' as const}});
    } catch (error) { primaryPresent = true; primary = error; remember(error); inventory(error); if (isSingleRequestSourceUnknown(error)) { poisoned = true; unknown.add(error); } }
    finally {
      let physicalClosed = !connectEntered;
      try { if (physical) { await physical; physicalClosed = true; } if(succeeded&&physicalClosed)clockAfter=clockCut(); } catch (error) { remember(error); inventory(error); unknown.add(error); poisoned = true; }
      try {
        if(reservation.budget){
          const actual={actualResponseBytes:bodyKnown?bytes:!connectEntered?0:null,requestSent:connectEntered,physicallyClosed:physicalClosed,outcome:physicalClosed&&!poisoned&&!unknown.size&&(bodyKnown||!connectEntered)?'known' as const:'unknown' as const};
          const proof=githubReadFreeze(nativeCreate(null)) as object;
          apply(weakSet,budgetProofs,[proof,{owner:sessionOwner,purpose:'source_read_settle',view:githubReadFreeze({frameData:frame.data,plan,requestDigest,attemptId:reservation.attemptId,reservation:reservation.budget.cap,outcome:actual,assertCurrent(){},assertLocal(){}})}]);
          const outcome=(await invoke(reservation.budget.settle,[reservation.budget.cap,proof],reservation.budget.port)).value;
          const row=githubReadRecord(captureGithubReadData(outcome));
          if(row.attempt_id!==reservation.attemptId||row.state!=='known'&&row.state!=='not_sent'||row.actual_bytes!==actual.actualResponseBytes||row.request_sent!==Number(actual.requestSent)) {remember(outcome);inventory(outcome);unknown.add(outcome);poisoned=true;if(!primaryPresent){primaryPresent=true;primary=outcome;}}
          else if(receipt)receipt=githubReadFreeze({...receipt,meter:{kind:'original_budget_settled' as const,accountId:reservation.budget.accountId,scanId:reservation.budget.scanId,attemptId:reservation.attemptId,requestDigest}});
        }else{
        const outcome = (await invoke(authority!.settle, [reservationRaw, { attemptId: reservation.attemptId, reservationRef: reservation.reservationRef, requestCount: connectEntered ? 1 : 0, responseBytes: succeeded ? bytes : null,
          responseBytesUpperBound: succeeded ? bytes : reservation.maxResponseBytes, outcome: succeeded ? 'received' : physicalClosed ? 'failed_closed' : 'unknown', physicalClosed }])).value;
        if (outcome !== undefined) {
          remember(outcome); inventory(outcome); unknown.add(outcome); poisoned = true;
          if (!primaryPresent) { primaryPresent = true; primary = outcome; }
        }
        }
      } catch (error) {
        remember(error); inventory(error); unknown.add(error); poisoned = true;
        if (!primaryPresent) { primaryPresent = true; primary = error; }
      } finally { controllers.delete(abort); }
    }
    if (primaryPresent) throw primary;
    current(frame,born);
    apply(weakSet,originalReads,[result!,{owner:sessionOwner,receipt:receipt!,frameData:frame.data,clockBefore,clockAfter,assertCurrent(){current(frame,born);},assertLocal(){local(born);const original=apply(weakGet,originalAContexts,[frame.raw]) as {assertLocal():void}|undefined;if(!original)fail('DSH_GITHUB_PROVIDER_DATE_UNCONFIRMED');original.assertLocal();local(born);}}]);
    return result!;
  }
  const api: MainGithubSourceSession = {
    connect(input, context) { return operation(async born => {
      const grant = frame(context, 'connect', input); current(grant, born);
      const r = githubReadRecord(captureGithubReadData(input)); githubReadFields(r, ['operationId', 'secret', 'expectedConfigurationRevision']);
      const operationId = githubReadText(r.operationId);
      if (typeof r.secret !== 'string' || !githubReadTest(/^[\x21-\x7e]{1,4096}$/, r.secret) || r.expectedConfigurationRevision !== grant.data.configurationRevision) fail('DSH_GITHUB_CONNECT_INVALID');
      if (credential) { if (credential.operationId === operationId && credential.token === r.secret) return status(); fail('DSH_GITHUB_REBIND_REQUIRES_FENCE'); }
      credential = { token: r.secret, data: grant.data, operationId };
      try {
        const user = await http(grant, planGithubGet({ schemaVersion: 1, kind: 'user', boundRepository: null }), born);
        if(user.page.kind!=='user'||user.page.entry.kind!=='value')fail('DSH_GITHUB_ACCOUNT_UNAVAILABLE');
        if(setup(grant.data)){
          const repository=await http(grant,planGithubSetupRepositoryGet(grant.data.candidateRepository),born);
          if(repository.page.kind!=='repository_discovery'||repository.page.entry.kind!=='value')fail('DSH_GITHUB_REPOSITORY_UNAVAILABLE');
          const actual=repository.page.entry.value,bound={repositoryId:actual.id,nodeId:actual.nodeId,owner:actual.owner,repo:actual.repo};
          current(grant,born);
          const setupResult=githubReadFreeze(nativeCreate(null)) as object;
          const setupData=grant.data,aContext=apply(weakGet,originalAContexts,[grant.raw]) as {proof:object;assertLocal:()=>void}|undefined;
          const userReceipt=readOriginalGithubSessionRead(api,user),repoReceipt=readOriginalGithubSessionRead(api,repository);
          const assertSetupLocal=()=>{local(born);aContext?.assertLocal();local(born);};
          const setupView=githubReadFreeze({kind:'github_source_setup_result_v1' as const,setupId:setupData.setupId,configurationRevision:setupData.configurationRevision,profileId:scope.profileId,tenantId:scope.tenantId,workspaceId:scope.workspaceId,candidateRepository:setupData.candidateRepository,providerAccountId:user.page.entry.value.id,repository:bound,requestProof:aContext?.proof??setupResult,reads:[userReceipt,repoReceipt] as const,assertCurrent:assertSetupLocal,assertLocal:assertSetupLocal});
          apply(weakSet,setupResults,[setupResult,{owner:sessionOwner,view:setupView}]);
          const proof=(await invoke(authority!.bind,[grant.raw,{providerAccountId:user.page.entry.value.id,repository:bound,readAttempts:[user.attemptId,repository.attemptId]},setupResult])).value;
          const boundFrame=frame(proof,'read',null);current(boundFrame,born);
          if(setup(boundFrame.data)||boundFrame.data.providerAccountId!==user.page.entry.value.id||githubReadHash('dsh-setup-bound',boundFrame.data.repository)!==githubReadHash('dsh-setup-bound',bound))fail('DSH_GITHUB_SETUP_BINDING_REQUIRED');
          credential!.data=boundFrame.data;connected=true;return status();
        }
        if(user.page.entry.value.id!==grant.data.providerAccountId)fail('DSH_GITHUB_ACCOUNT_MISMATCH');
        const repository=await http(grant,planGithubGet({schemaVersion:1,kind:'repository',boundRepository:grant.data.repository}),born);
        if(repository.page.kind!=='repository'||repository.page.entry.kind!=='value')fail('DSH_GITHUB_REPOSITORY_MISMATCH');
        current(grant,born);
        const outcome=(await invoke(authority!.bind,[grant.raw,{providerAccountId:grant.data.providerAccountId,repository:grant.data.repository,readAttempts:[user.attemptId,repository.attemptId]}])).value;
        if(outcome!==undefined){inventory(outcome);unknown.add(outcome);poisoned=true;fail('DSH_GITHUB_BIND_UNCONFIRMED');}
        current(grant,born);connected=true;return status();
      } catch (error) { credential = undefined; connected = false; throw error; }
    }); },
    read(input, context) { return operation(async born => {
      if (!credential || !connected) fail('DSH_GITHUB_CREDENTIAL_REQUIRED');
      const grant = frame(context, 'read', input),candidate=githubReadRecord(captureGithubReadData(input));let plan:GithubGetPlan|GithubIssueIdentityPlan;
      if(candidate.kind==='issue_identity'){githubReadFields(candidate,['schemaVersion','kind','boundRepository','expectedIssueId','issueNumber']);if(candidate.schemaVersion!==1)fail('DSH_GITHUB_SOURCE_INVALID');plan=planGithubIssueIdentityGet({boundRepository:candidate.boundRepository,expectedIssueId:candidate.expectedIssueId,issueNumber:candidate.issueNumber});}else plan=planGithubGet(candidate);
      if(setup(grant.data)||setup(credential.data))fail('DSH_GITHUB_CREDENTIAL_REQUIRED');
      if (!plan.boundRepository || githubReadHash('dsh-github-session-repository-v1', plan.boundRepository) !== githubReadHash('dsh-github-session-repository-v1', credential.data.repository)
        || grant.data.credentialEpoch !== credential.data.credentialEpoch || grant.data.configurationRevision !== credential.data.configurationRevision || grant.data.sourceBindingId !== credential.data.sourceBindingId) { const error = new NativeError('DSH_GITHUB_SCOPE_MISMATCH'); fence(error); throw error; }
      return http(grant, plan, born);
    }); },
    disconnect(context) { return operation(async () => { if (authority) frame(context, 'disconnect', null); generation++; credential = undefined; connected = false; const active = controllers.snapshot(); for (let i = 0; i < active.length; i++) apply(abortNative, active[i]!, []); }); },
    getStatus: status,
    stopAccepting() { accepting = false; generation++; },
    abortAllActive() { const active = controllers.snapshot(); for (let i = 0; i < active.length; i++) apply(abortNative, active[i]!, []); },
    drain(deadlineMs) { return new NativePromise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const check = () => { if (roots.size || tails.size) return; waiters.delete(check); clearTimer(timer); resolve(!poisoned && !unknown.size); };
      timer = setTimer(() => { waiters.delete(check); resolve(false); }, Math.max(0, deadlineMs)); waiters.add(check); check();
    }); },
    close() {
      if (!closing) { api.stopAccepting(); api.abortAllActive(); closing = (async () => {
        await new NativePromise<void>(yes => { const check = () => { if (roots.size || tails.size) return; waiters.delete(check); yes(); }; waiters.add(check); check(); });
        credential = undefined; connected = false; if (poisoned || unknown.size) { if (firstPresent) throw first; fail('DSH_GITHUB_SOURCE_UNCONFIRMED'); }
        finished = true;
      })(); }
      return closing;
    },
  };
  apply(weakSet,sessionOwners,[api,sessionOwner]);
  apply(weakSet,sessionInventories,[api,inventory]);
  return githubReadFreeze(api);
}

export interface MainGithubSourceConnectionOwner {
 readonly sourceReadAuthoritySource:object;
 bindStore(store:object):void;bindRuntime(runtime:object):void;
 getSession():MainGithubSourceSession;
 openBindingContext(proof:object,scanId:string):object;
 openSetupContext(proof:object,scanId:string):object;
 disconnectUser(proof:object,bodyHash:string,sourceBindingId:string):Promise<void>;
 close():Promise<void>;
}
export interface MainGithubSourceConnectionPopulation {
 readonly sourceReadAuthoritySource:object;
 bindStore(store:object):void;
 bindRuntime(runtime:object):void;
 readSetupOwner(originalAProof:object):MainGithubSourceConnectionOwner;
 readBindingOwner(originalAProof:object):MainGithubSourceConnectionOwner;
 getStatuses():readonly Readonly<{tenantId:string;status:GithubSessionStatus}>[];
 stopAccepting():void;
 abortAllActive():void;
 disconnectUser(originalUserProof:object,bodyHash:string,sourceBindingId:string):Promise<void>;
 close():Promise<void>;
}
interface ConnectionChildBirth {owner?:MainGithubSourceConnectionOwner;resolve?:Function;failure?:{error:unknown}}
interface ConnectionPopulationOrigin {
 scope:{profileId:string;workspaceId:string};realm:object;userSource:object;store?:object;runtime?:object;port?:OriginalDshSourceReadPort;
 closed:boolean;population:MainGithubSourceConnectionPopulation;stocks:ReturnType<typeof createIntrinsicSet<RoomTurnCustody>>;
 children:ReturnType<typeof createIntrinsicSet<MainGithubSourceConnectionOwner>>;
 bySource:Map<string,ConnectionChildBirth>;
 bindingOwners:Map<string,ConnectionChildBirth>;
 proofOwners:WeakMap<object,{owner:MainGithubSourceConnectionOwner;purpose:string}>;
 sessionOwners:WeakMap<object,MainGithubSourceConnectionOwner>;
 actorOwners:WeakMap<object,MainGithubSourceConnectionOwner>;
 held:ReturnType<typeof createIntrinsicSet<unknown>>;
}
interface ConnectionOrigin {pricing(proof:object,request:OriginalDshModelPricingRequest):Promise<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>>;scope:Scope;realm:object;userSource:object;store?:object;runtime?:object;owner:MainGithubSourceConnectionOwner;isActor(actor:unknown):boolean;ownsActor(actor:unknown):boolean;status():GithubSessionStatus;stop():void;abort():void;parent?:ConnectionPopulationOrigin;sourceKey?:string}
const connectionPopulations=new NativeWeakMap<object,ConnectionPopulationOrigin>();
const runtimeConnections=new NativeWeakMap<object,ConnectionPopulationOrigin|ConnectionOrigin>();
/** Fixed original public-pricing transport only. Runtime identity comes from
 * the original model token and the original once-bound Source constructor. */
export async function readOriginalMainDshModelPricing(modelSource:unknown,token:unknown):Promise<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>> {
 const model=readOriginalDshModelPricingRequest(modelSource,token);
 const connection=apply(weakGet,runtimeConnections,[model.runtime]) as ConnectionPopulationOrigin|ConnectionOrigin|undefined;
 if(!connection||connection.realm!==model.realm||connection.store!==model.store||connection.runtime!==model.runtime)fail('DSH_MODEL_PRICING_CONNECTION_REQUIRED');
 model.assertCurrent();model.assertLocal();
 const thread=githubReadRecord(model.request.evidenceManifest.thread),envelope=githubReadRecord(model.request.input.envelope),auth=githubReadRecord(envelope.authScope);
 const bindingId=githubReadText(thread.sourceBindingId);
 const state=readOriginalDshDesktopState(model.realm,model.store,model.realm,model.request.storageScope);
 let revision:number|undefined;
 for(let i=0;i<state.sourceConfigurations.length;i++){
  const row=githubReadRecord(state.sourceConfigurations[i]),configuration=githubReadRecord(row.configuration),binding=githubReadRecord(configuration.binding);
  if(binding.bindingId!==bindingId)continue;
  if(revision!==undefined||!safeInteger(row.revision)||nativeNumber(row.revision)<1)fail('DSH_MODEL_PRICING_SOURCE_UNCONFIRMED');
  const candidate=githubReadRecord(binding.authScope);
  for(const key of ['tenantId','workspaceId','connectionId','providerAccountId','repositoryId','credentialEpoch'])if(candidate[key]!==auth[key])fail('DSH_MODEL_PRICING_SOURCE_UNCONFIRMED');
  revision=row.revision as number;
 }
 if(revision===undefined)fail('DSH_MODEL_PRICING_SOURCE_UNCONFIRMED');
 const proof=apply(method(model.realm,'openGithubSourceRead',false),model.realm,[{bindingId,configurationRevision:revision}]) as object;
 const view=readOriginalDshGithubReadAuthority(model.realm,model.store,model.realm,proof,'source_binding');
 if(view.kind!=='source_binding'||view.tenantId!==model.request.tenantId||view.sourceBindingId!==bindingId)fail('DSH_MODEL_PRICING_SOURCE_UNCONFIRMED');
 let owner:MainGithubSourceConnectionOwner;
 if('population' in connection)owner=connection.population.readBindingOwner(proof);
 else owner=connection.owner;
 const origin=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin|undefined;
 if(!origin||origin.realm!==model.realm||origin.store!==model.store||origin.runtime!==model.runtime||origin.scope.tenantId!==model.request.tenantId)fail('DSH_MODEL_PRICING_CONNECTION_REQUIRED');
 return origin.pricing(proof,model);
}
const ConnectionMap=Map,connectionMapGet=Map.prototype.get,connectionMapSet=Map.prototype.set;
function populationLive(row:ConnectionPopulationOrigin):void {
 if(row.closed||!row.store||!row.runtime||!row.port)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');
 const stocks=row.stocks.snapshot();for(let i=0;i<stocks.length;i++)stocks[i]!.assertPhysicalKnown();
}
function populationStock(row:ConnectionPopulationOrigin):RoomTurnCustody {const stock=createRoomTurnCustody();row.stocks.add(stock);return stock;}
function connectionSourceKey(scope:{profileId:string;workspaceId:string},view:DshGithubReadAuthority):string {
 const repository=parseGithubRepositoryCandidate(view.kind==='source_setup'?view.candidateRepository:{owner:view.repository.owner,repo:view.repository.repo});
 return githubReadHash('dsh-github-connection-source-v1',[{profileId:scope.profileId,workspaceId:scope.workspaceId},view.tenantId,'github',repository]);
}
/** Composition membership, not an effect grant. No caller-selected child factory. */
export function readOriginalMainGithubSourceConnectionPopulation(population:unknown,realm:unknown,store:unknown,userSource:unknown,runtime:unknown):MainGithubSourceConnectionPopulation {
 const row=apply(weakGet,connectionPopulations,[population]) as ConnectionPopulationOrigin|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.userSource!==userSource||row.runtime!==runtime)fail('DSH_GITHUB_CONNECTION_POPULATION_REQUIRED');
 populationLive(row);return row.population;
}
/** Actor membership only. The original Source.resolve still checks current. */
export function isOriginalGithubSourcePopulationBudgetActor(population:unknown,actor:unknown):boolean {
 const row=apply(weakGet,connectionPopulations,[population]) as ConnectionPopulationOrigin|undefined;
 if(!row||row.closed||!row.store||!row.runtime||!actor||typeof actor!=='object'||isProxy(actor))return false;
 const owner=apply(weakGet,row.actorOwners,[actor]) as MainGithubSourceConnectionOwner|undefined;
 if(!owner||!row.children.has(owner))return false;
 const child=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin|undefined;
 return !!child&&child.parent===row&&child.realm===row.realm&&child.store===row.store&&child.runtime===row.runtime&&child.ownsActor(actor);
}
export function createMainGithubSourceConnectionPopulation(raw:unknown):MainGithubSourceConnectionPopulation {
 const options=captureGithubOpaqueRecord(raw,['scope','realm','userSource']);
 const data=githubReadRecord(captureGithubReadData(options.scope));githubReadFields(data,['profileId','workspaceId']);
 const scope={profileId:githubReadText(data.profileId),workspaceId:githubReadText(data.workspaceId)};
 const realm=options.realm as object,userSource=options.userSource as object;
 if(!realm||typeof realm!=='object'||isProxy(realm)||!userSource||typeof userSource!=='object'||isProxy(userSource))fail('DSH_GITHUB_CONNECTION_POPULATION_REQUIRED');
 const row:ConnectionPopulationOrigin={scope,realm,userSource,closed:false,population:undefined!,stocks:createIntrinsicSet(),children:createIntrinsicSet(),bySource:new ConnectionMap(),bindingOwners:new ConnectionMap(),proofOwners:new NativeWeakMap(),sessionOwners:new NativeWeakMap(),actorOwners:new NativeWeakMap(),held:createIntrinsicSet()};
 let closing:Promise<void>|undefined;
 const sourceReadAuthoritySource=githubReadFreeze({resolve(proof:object,purpose:string){
  if(!proof||typeof proof!=='object'||isProxy(proof))fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  if(purpose!=='source_read_settle')populationLive(row);
  let owner:MainGithubSourceConnectionOwner|undefined;
  const pricing=apply(weakGet,row.proofOwners,[proof]) as {owner:MainGithubSourceConnectionOwner;purpose:string}|undefined;
  if(pricing?.purpose===purpose)owner=pricing.owner;
  else if(purpose==='source_read_migrate'||purpose==='source_read_scan'||purpose==='source_read_reserve'){
   const found=apply(weakGet,row.proofOwners,[proof]) as {owner:MainGithubSourceConnectionOwner;purpose:string}|undefined;
   if(found?.purpose!==purpose)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');owner=found.owner;
  }else if(purpose==='source_read_settle'){
   const found=apply(weakGet,budgetProofs,[proof]) as {owner:object;purpose:string}|undefined;
   if(found?.purpose!==purpose)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');owner=apply(weakGet,row.sessionOwners,[found.owner]) as MainGithubSourceConnectionOwner|undefined;
  }else fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  if(!owner||!row.children.has(owner))fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  const child=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin|undefined;
  if(!child||child.parent!==row||child.realm!==row.realm||child.store!==row.store||child.runtime!==row.runtime)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  const birth=child.sourceKey?apply(connectionMapGet,row.bySource,[child.sourceKey]) as ConnectionChildBirth|undefined:undefined;
  if(!birth||birth.owner!==owner||!birth.resolve||birth.failure)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  return apply(birth.resolve,owner.sourceReadAuthoritySource,[proof,purpose]);
 }});
 function ownerFor(proof:object,kind:'source_setup'|'source_binding'):MainGithubSourceConnectionOwner {
  populationLive(row);let view!:DshGithubReadAuthority;
  populationStock(row).syncVoid(()=>{
   view=readOriginalDshGithubReadAuthority(row.realm,row.store,row.realm,proof,kind);row.held.add(view);
   if(view.profileId!==scope.profileId||view.workspaceId!==scope.workspaceId||view.kind!==kind)fail('DSH_GITHUB_SCOPE_MISMATCH');
   view.assertCurrent();view.assertLocal();
  },undefined,[]);
  const tenant=githubReadText(view.tenantId);
  const sourceKey=connectionSourceKey(scope,view);
  let birth=view.kind==='source_binding'?apply(connectionMapGet,row.bindingOwners,[view.sourceBindingId]) as ConnectionChildBirth|undefined:undefined;
  birth??=apply(connectionMapGet,row.bySource,[sourceKey]) as ConnectionChildBirth|undefined;
  if(birth){
   if(birth.failure)throw birth.failure.error;if(!birth.owner||!birth.resolve)fail('DSH_GITHUB_CONNECTION_BIRTH_PENDING');
   const origin=apply(weakGet,connectionOrigins,[birth.owner]) as ConnectionOrigin|undefined;
   if(!origin||origin.parent!==row||origin.scope.tenantId!==tenant)fail('DSH_GITHUB_SCOPE_MISMATCH');
   if(view.kind==='source_binding')apply(connectionMapSet,row.bindingOwners,[view.sourceBindingId,birth]);
   return birth.owner;
  }
  birth={};apply(connectionMapSet,row.bySource,[sourceKey,birth]); // Reserve before any child/Native birth.
  try{
   populationStock(row).syncVoid(()=>{
    const child=createConnectionOwner({scope:{...scope,tenantId:tenant},realm,userSource},row,sourceKey);
    birth!.owner=child;row.children.add(child);
    child.bindStore(row.store!);child.bindRuntime(row.runtime!);
    birth!.resolve=method(child.sourceReadAuthoritySource,'resolve',true);
   },undefined,[]);
   if(view.kind==='source_binding')apply(connectionMapSet,row.bindingOwners,[view.sourceBindingId,birth]);
   return birth.owner!;
  }catch(error){birth.failure={error};throw error;}
 }
 function controlChildren(kind:'stop'|'abort'):void {
  const children=row.children.snapshot(),errors:unknown[]=[];
  for(let i=0;i<children.length;i++){
   const origin=apply(weakGet,connectionOrigins,[children[i]!]) as ConnectionOrigin|undefined;
   if(!origin||origin.parent!==row){errors[errors.length]=new NativeError('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');continue;}
   try{populationStock(row).syncVoid(kind==='stop'?origin.stop:origin.abort,undefined,[]);}catch(error){errors[errors.length]=error;}
  }
  if(errors.length===1)throw errors[0];if(errors.length)throw aggregateIntrinsicErrors(errors,'DSH_GITHUB_POPULATION_CONTROL_FAILED');
 }
 const population:MainGithubSourceConnectionPopulation=githubReadFreeze({sourceReadAuthoritySource,
  bindStore(store:object){
   if(row.store||row.closed)fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');
   populationStock(row).syncVoid(()=>{readOriginalMainDshBootstrapAuthority(realm,store,realm).assertCurrent();readOriginalDshUserControlPort(store,userSource);},undefined,[]);
   row.store=store;
  },
  bindRuntime(runtime:object){
   if(row.runtime||row.closed)fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');
   const port=readOriginalDshSourceReadPort(runtime,sourceReadAuthoritySource);if(apply(weakGet,runtimeConnections,[runtime]))fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');row.port=port;row.runtime=runtime;apply(weakSet,runtimeConnections,[runtime,row]);
  },
  readSetupOwner(proof:object){return ownerFor(proof,'source_setup');},
  readBindingOwner(proof:object){return ownerFor(proof,'source_binding');},
  getStatuses(){
   const children=row.children.snapshot(),statuses:Array<Readonly<{tenantId:string;status:GithubSessionStatus}>>=[];
   for(let i=0;i<children.length;i++){
    const origin=apply(weakGet,connectionOrigins,[children[i]!]) as ConnectionOrigin|undefined;
    if(!origin||origin.parent!==row)fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');
    statuses[statuses.length]=githubReadFreeze({tenantId:origin.scope.tenantId,status:origin.status()});
   }
   return githubReadFreeze(statuses);
  },
  stopAccepting(){row.closed=true;controlChildren('stop');},
  abortAllActive(){controlChildren('abort');},
  async disconnectUser(proof:object,bodyHash:string,bindingId:string){
   if(!row.store)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');githubReadText(bindingId);
   const custody=populationStock(row);let user!:ReturnType<typeof readOriginalMainDshControl>;
   custody.syncVoid(()=>{user=readOriginalMainDshControl(row.userSource,proof,row.store,'policy_control',bodyHash);row.held.add(user);user.assertCurrent();user.assertLocal();},undefined,[]);
   if(user.storageScope.profileId!==scope.profileId||user.storageScope.workspaceId!==scope.workspaceId)fail('DSH_GITHUB_SCOPE_MISMATCH');
   const rawReply=apply(method(row.userSource,'resolve',true),row.userSource,[proof,'policy_control']);row.held.add(rawReply);
   const reply=githubReadRecord(rawReply);githubReadFields(reply,['data','assertCurrent']);
   const body=githubReadRecord(captureGithubReadData(reply.data));githubReadFields(body,['control','expectedRevision']);
   const control=githubReadRecord(body.control);githubReadFields(control,['kind','configuration']);
   if(control.kind!=='source_config'||!safeInteger(body.expectedRevision)||nativeNumber(body.expectedRevision)<1)fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');
   const configuration=parseDshSourceConfiguration(control.configuration),binding=githubReadRecord(configuration.binding),auth=githubReadRecord(binding.authScope);
   if(binding.bindingId!==bindingId||auth.workspaceId!==scope.workspaceId)fail('DSH_GITHUB_SCOPE_MISMATCH');
   const children=row.children.snapshot();let selected:ConnectionOrigin|undefined;
   for(let i=0;i<children.length;i++){
    const origin=apply(weakGet,connectionOrigins,[children[i]!]) as ConnectionOrigin|undefined;
    if(!origin||origin.parent!==row)fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');
    const status=origin.status();if(status.sourceBindingId!==bindingId)continue;
    if(selected||origin.scope.tenantId!==auth.tenantId)fail('DSH_GITHUB_SCOPE_MISMATCH');selected=origin;
   }
   user.assertCurrent();user.assertLocal();
   if(!selected)return; // Genuine original intent, no matching accepted resource.
   const status=selected.status();
   if(row.closed||status.state==='closing'||status.state==='closed'||status.state==='unknown'){
    // Existing Source is already fenced. This cannot reopen it or claim drain.
    custody.syncVoid(selected.abort,undefined,[]);return;
   }
   let primary:{error:unknown}|undefined;
   try{await custody.sdk(()=>{const raw=apply(method(selected!.owner,'disconnectUser',false),selected!.owner,[proof,bodyHash,bindingId]);row.held.add(raw);return raw;},undefined,[]);}catch(error){primary={error};}
   try{await custody.waitPhysicalKnown();}catch(error){if(!primary)primary={error};else if(error!==primary.error)primary={error:aggregateIntrinsicErrors([primary.error,error],'DSH_GITHUB_DISCONNECT_AND_DRAIN_FAILED')};}
   if(primary)throw primary.error;
  },
  close(){
   if(closing)return closing;row.closed=true;
   const children=row.children.snapshot();
   closing=(async()=>{
    const outcomes=await settleIntrinsicOperations(children,child=>child.close());const errors:unknown[]=[];
    for(let i=0;i<outcomes.length;i++)if(outcomes[i]!.status==='rejected')errors[errors.length]=(outcomes[i] as PromiseRejectedResult).reason;
    const stocks=row.stocks.snapshot(),joined=await settleIntrinsicOperations(stocks,stock=>stock.waitPhysicalKnown());
    for(let i=0;i<joined.length;i++)if(joined[i]!.status==='rejected')errors[errors.length]=(joined[i] as PromiseRejectedResult).reason;
    if(errors.length===1)throw errors[0];if(errors.length)throw aggregateIntrinsicErrors(errors,'DSH_GITHUB_POPULATION_CLOSE_UNCONFIRMED');
   })();return closing;
  }
 });
 row.population=population;apply(weakSet,connectionPopulations,[population,row]);return population;
}

const connectionOrigins=new NativeWeakMap<object,ConnectionOrigin>();
/** Fixed once-bound composition; no authority callback, mutable source or caller known flag. */
export function readOriginalMainGithubSourceConnectionOwner(owner:unknown,realm:unknown,store:unknown,userSource:unknown,runtime:unknown):MainGithubSourceConnectionOwner {
 if(!owner||typeof owner!=='object'||isProxy(owner))fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');const row=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin|undefined;
 if(!row||row.realm!==realm||row.store!==store||row.userSource!==userSource||row.runtime!==runtime)fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');row.owner.getSession();return row.owner;
}
/** Original private actor membership for the original runtime. Same text is not membership. */
export function isOriginalGithubSourceBudgetActor(owner:unknown,actor:unknown):boolean{if(!owner||typeof owner!=='object'||isProxy(owner))return false;const row=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin|undefined;return row?row.isActor(actor):false;}
export function createMainGithubSourceConnectionOwner(raw:unknown):MainGithubSourceConnectionOwner {return createConnectionOwner(raw);}
function createConnectionOwner(raw:unknown,parent?:ConnectionPopulationOrigin,sourceKey?:string):MainGithubSourceConnectionOwner {
 const options=captureGithubOpaqueRecord(raw,['scope','realm','userSource']);const scope=parseScope(options.scope);
 const realm=options.realm as MainDshBootstrapAuthority,userSource=options.userSource as object;
 if(!realm||typeof realm!=='object'||isProxy(realm)||!userSource||typeof userSource!=='object'||isProxy(userSource))fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');
 let nonce:string|undefined;let sequence=0,store:object|undefined,runtime:object|undefined,port:OriginalDshSourceReadPort|undefined,session:MainGithubSourceSession|undefined,closed=false;
 type Context={kind:'source_binding'|'source_setup';proof:object;scanId:string;view:DshGithubReadAuthority;actor:object|null;narrowGuard?:()=>void};
 let lastBinding:Context|undefined;
 const actors=new NativeWeakMap<object,Context>();
 const contexts=new NativeWeakMap<object,Context>(),frames=new NativeWeakMap<object,Context>(),proofContexts=new NativeWeakMap<object,{context:Context;input:unknown}>();
 const attemptContexts=new NativeWeakMap<object,Context>(),opened=new NativeWeakMap<Context,Promise<unknown>>();
 const pricingProofs=new NativeWeakMap<object,{purpose:string;input:unknown;context:Context;model:OriginalDshModelPricingRequest;cap?:object;known?:()=>void}>();
 const pricingStocks=createIntrinsicSet<RoomTurnCustody>(),pricingControllers=createIntrinsicSet<AbortController>();
 let pricingClosing:Promise<void>|undefined;
 const live=()=>{if(closed||!store||!runtime||!port||!session)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');if(parent)populationLive(parent);};
 const negativeLocal=()=>{
  if(closed||!store||!runtime||!port||!session)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');
  if(parent&&(parent.store!==store||parent.runtime!==runtime||!parent.children.has(owner)))fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');
 };
 const contextOf=(value:unknown)=>{if(!value||typeof value!=='object'||isProxy(value))fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');const found=apply(weakGet,contexts,[value]) as Context|undefined;if(!found)fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');return found;};
 function open(proof:object,scanId:string,kind:Context['kind']):object {
  live();githubReadText(scanId);const view=readOriginalDshGithubReadAuthority(realm,store,realm,proof,kind);
  if(view.profileId!==scope.profileId||view.workspaceId!==scope.workspaceId||view.tenantId!==scope.tenantId)fail('DSH_GITHUB_SCOPE_MISMATCH');view.assertCurrent();view.assertLocal();
  if(parent){
   const birth=sourceKey?apply(connectionMapGet,parent.bySource,[sourceKey]) as ConnectionChildBirth|undefined:undefined;
   const alias=view.kind==='source_binding'?apply(connectionMapGet,parent.bindingOwners,[view.sourceBindingId]) as ConnectionChildBirth|undefined:undefined;
   if(!birth||birth.owner!==owner||connectionSourceKey(scope,view)!==sourceKey&&alias!==birth)fail('DSH_GITHUB_SCOPE_MISMATCH');
  }
  const value=githubReadFreeze(nativeCreate(null)) as object,actor=kind==='source_setup'?githubReadFreeze({requestSource:'user',principalId:'desktop-user:'+scope.profileId}):null;
  const context={kind,proof,scanId,view,actor};if(actor){apply(weakSet,actors,[actor,context]);if(parent)apply(weakSet,parent.actorOwners,[actor,owner]);}apply(weakSet,contexts,[value,context]);if(kind==='source_binding'){lastBinding=context;apply(weakSet,originalBindingContexts,[value,{session:session!,view,proof,scanId}]);}return value;
 }
 const budgetSource=githubReadFreeze({resolve(proof:object,purpose:string){
  const pricing=apply(weakGet,pricingProofs,[proof]) as {purpose:string;input:unknown;context:Context;model:OriginalDshModelPricingRequest;cap?:object;known?:()=>void}|undefined;
  if(pricing){
   if(pricing.purpose!==purpose||pricing.context.view.kind!=='source_binding')fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
   const view=pricing.context.view;
   const current=()=>{if(purpose==='source_read_settle'){pricing.known?.();return;}live();pricing.model.assertCurrent();view.assertCurrent();pricing.model.assertLocal();view.assertLocal();live();};
   const local=()=>{if(purpose==='source_read_settle'){pricing.known?.();return;}live();pricing.model.assertLocal();view.assertLocal();live();};
   return githubReadFreeze({requestSource:'scheduler',actor:null,profileId:scope.profileId,workspaceId:scope.workspaceId,accountId:view.accountId,
    identity:{kind:'source_binding',sourceBindingId:view.sourceBindingId,configurationRevision:view.configurationRevision,credentialEpoch:view.credentialEpoch,providerAccountId:view.providerAccountId,repositoryId:view.repository.repositoryId},
    commandDigest:dshSourceReadCommandDigest(purpose,pricing.input),assertCurrent:current,assertLocal:local,...(purpose==='source_read_settle'?{outcome:pricing.input,reservation:pricing.cap}:{})});
  }
  if(purpose!=='source_read_settle')live();let context:Context,input:unknown,original:BudgetProofView|undefined;
  if(purpose==='source_read_scan'||purpose==='source_read_migrate'){const row=apply(weakGet,proofContexts,[proof]) as {context:Context;input:unknown}|undefined;if(!row)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');context=row.context;input=row.input;}
  else {if(!session)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');original=readOriginalGithubSessionBudgetProof(session,proof,purpose);
   if(purpose==='source_read_reserve'){const row=apply(weakGet,proofContexts,[proof]) as {context:Context;input:unknown}|undefined;if(!row)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');context=row.context;input=row.input;}
   else if(purpose==='source_read_settle'){const row=original.reservation?apply(weakGet,attemptContexts,[original.reservation]) as Context|undefined:undefined;if(!row||!original.outcome)fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');context=row;input=original.outcome;}
   else fail('DSH_GITHUB_BUDGET_PROOF_REQUIRED');
  }
  const view=context.view,identity=view.kind==='source_binding'?{kind:'source_binding',sourceBindingId:view.sourceBindingId,configurationRevision:view.configurationRevision,credentialEpoch:view.credentialEpoch,providerAccountId:view.providerAccountId,repositoryId:view.repository.repositoryId}:{kind:'source_setup',...(parent?{identityVersion:2,tenantId:view.tenantId}:{}),setupId:view.setupId,candidateRepository:{owner:parseGithubRepositoryCandidate(view.candidateRepository).owner,name:parseGithubRepositoryCandidate(view.candidateRepository).repo}};
  const current=()=>{if(purpose==='source_read_settle'){original!.assertLocal();return;}live();view.assertCurrent();original?.assertCurrent();view.assertLocal();live();};
  const local=()=>{if(purpose==='source_read_settle'){original!.assertLocal();return;}live();view.assertLocal();original?.assertLocal();live();};
  return githubReadFreeze({requestSource:view.kind==='source_setup'?'user':'scheduler',actor:context.actor,profileId:scope.profileId,workspaceId:scope.workspaceId,accountId:view.accountId,identity,commandDigest:dshSourceReadCommandDigest(purpose,input),assertCurrent:current,assertLocal:local,...(purpose==='source_read_settle'?{outcome:input,reservation:original!.reservation}:{})});
 }});
 async function executePricing(proof:object,model:OriginalDshModelPricingRequest):Promise<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>> {
  const rootStock=createRoomTurnCustody(),stock=createRoomTurnCustody(),accountingStock=createRoomTurnCustody();
  pricingStocks.add(rootStock);pricingStocks.add(stock);pricingStocks.add(accountingStock);
  let reply:Awaited<ReturnType<typeof readSingleRequestOwnedReply>>|undefined,cap:object|undefined,reserveProof:object|undefined;
  let entered=false,bodyKnown=false,physical:Promise<void>|undefined,physicalClosed=false,unknown=false,primary:{raw:unknown}|undefined;
  const abort=new NativeAbort();pricingControllers.add(abort);
  const pricingUrl='https://api-docs.deepseek.com/quick_start/pricing/';
  const modelToken=model;
  const result=rootStock.root(async()=>{
   let context!:Context;
   const fresh=()=>{live();modelToken.assertCurrent();if(context){context.view.assertCurrent();context.view.assertLocal();}modelToken.assertLocal();live();};
   const local=()=>{live();modelToken.assertLocal();if(context)context.view.assertLocal();live();};
   const makeProof=(purpose:string,input:unknown,heldCap?:object,known?:()=>void)=>{
    const value=githubReadFreeze(nativeCreate(null)) as object;apply(weakSet,pricingProofs,[value,{purpose,input,context,model:modelToken,cap:heldCap,known}]);if(parent)apply(weakSet,parent.proofOwners,[value,{owner,purpose}]);return value;
   };
   try{
    stock.syncVoid(fresh,undefined,[]);
    const view=readOriginalDshGithubReadAuthority(realm,store,realm,proof,'source_binding');
    if(view.kind!=='source_binding'||view.profileId!==scope.profileId||view.workspaceId!==scope.workspaceId||view.tenantId!==scope.tenantId)fail('DSH_GITHUB_SCOPE_MISMATCH');
    const previous=lastBinding?.view;
    const reuse=previous?.kind==='source_binding'&&previous.sourceBindingId===view.sourceBindingId&&previous.configurationRevision===view.configurationRevision&&previous.credentialEpoch===view.credentialEpoch;
    const scanId=reuse?lastBinding!.scanId:'model-pricing:'+model.request.attemptId;
    context={kind:'source_binding',proof,scanId,view,actor:null};
    const scan={accountId:view.accountId,scanId};
    await stock.sdk(port!.openScan,port,[scan,makeProof('source_read_scan',scan)]);
    const requestDigest=githubReadHash('dsh-model-public-pricing-get-v1',{destination:pricingUrl,method:'GET',headers:{accept:'text/html'},assessmentAttemptId:model.request.attemptId,sourceBindingId:view.sourceBindingId,configurationRevision:view.configurationRevision,credentialEpoch:view.credentialEpoch});
    const input={accountId:view.accountId,scanId,attemptId:'model-pricing:'+githubReadHash('model-pricing-attempt-v1',{attemptId:model.request.attemptId,bindingId:view.sourceBindingId}),requestDigest,responseBytesUpperBound:256*1024};
    reserveProof=makeProof('source_read_reserve',input);
    const consumeCap=function(this:object){const reserved=readOriginalDshSourceReadReservation(port!,this);if(reserved.requestDigest!==requestDigest||reserved.accountId!==view.accountId||reserved.scanId!==scanId)fail('DSH_MODEL_PRICING_METER_INVALID');};
    cap=await stock.sdk<object>(port!.reserveRequest,port,[input,reserveProof],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:consumeCap});
    if(readOriginalDshSourceReadReservation(port!,cap).disposition!=='newly_reserved'){cap=undefined;fail('DSH_MODEL_PRICING_ALREADY_RESERVED');}
    await stock.consumeResource(consumeCap,cap,[]);
    const reservation=readOriginalDshSourceReadReservation(port!,cap);
    stock.syncVoid(fresh,undefined,[]);stock.syncVoid(()=>{const raw=takeOriginalDshSourceReadReservation(port,reserveProof,cap);stock.inventory(raw);},undefined,[]);stock.syncVoid(local,undefined,[]);
    const hooks={beforeTransport(phase:'connect'|'send'){stock.syncVoid(fresh,undefined,[]);stock.syncVoid(local,undefined,[]);if(phase==='connect')entered=true;},observeRawFailure(raw:unknown){stock.inventory(raw);}};
    const timeout=Math.min(10000,reservation.timeoutMs,model.validUntil-apply(pricingNow,Date,[]));if(!safeInteger(timeout)||timeout<1)fail('DSH_MODEL_PRICE_EXPIRED');
    const fetch=createSingleRequestHttpsFetch({destination:pricingUrl,method:'GET',expectedBody:'',timeoutMs:timeout,maxResponseBytes:256*1024,signal:apply(pricingSignalAny,AbortSignal,[[model.signal,abort.signal]]),sourceHooks:hooks,trackPhysicalDrain(raw){physical=raw;stock.inventory(raw);}});
    // The original transport already owns its Response graph. Preserve that
    // exact native resource until the fixed body consumer has closed it.
    const consumeReply=function(this:Awaited<ReturnType<typeof readSingleRequestOwnedReply>>){
     const receipt=readOriginalSingleRequestPhysicalReceipt(this);receipt.assertKnown();
     for(const name of ['status','bytes','headers','ownExtras','ownUnknown']){const field=descriptor(this,name);if(!field||!own(field,'value'))fail('DSH_MODEL_PRICING_SDK_UNKNOWN');}
     reply=this;bodyKnown=true;
     if(this.ownUnknown){for(let i=0;i<this.ownExtras.length;i++)stock.inventory(this.ownExtras[i]);unknown=true;fail('DSH_MODEL_PRICING_SDK_UNKNOWN');}
    };
    const consumeResponse=async function(this:Response){
     const actualReply=await stock.sdk<Awaited<ReturnType<typeof readSingleRequestOwnedReply>>>(readSingleRequestOwnedReply,undefined,[fetch,this],{accept:value=>{readOriginalSingleRequestPhysicalReceipt(value);return true;},consumer:consumeReply});
     await stock.consumeResource<void>(consumeReply,actualReply,[]);
    };
    const response=await stock.sdk<Response>(fetch,undefined,[pricingUrl,{method:'GET',headers:{accept:'text/html'}}],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:consumeResponse});
    await stock.consumeResource<void>(consumeResponse,response,[]);
   }catch(raw){primary={raw};stock.inventory(raw);if(isSingleRequestSourceUnknown(raw))unknown=true;}
   finally{
    try{if(physical){await physical;physicalClosed=true;}else physicalClosed=!entered;}catch(raw){stock.inventory(raw);unknown=true;primary??={raw};}
    try{await stock.waitPhysicalKnown();}catch(raw){unknown=true;primary??={raw};}
    if(cap){
     const outcome={actualResponseBytes:bodyKnown?reply!.bytes.byteLength:!entered?0:null,requestSent:entered,physicallyClosed:physicalClosed,outcome:physicalClosed&&!unknown&&(bodyKnown||!entered)?'known' as const:'unknown' as const};
     const known=()=>{if(outcome.outcome==='known'&&bodyKnown){const receipt=readOriginalSingleRequestPhysicalReceipt(reply);if(receipt.destination!==pricingUrl||receipt.method!=='GET'||receipt.requestBody!=='')fail('DSH_MODEL_PRICING_SDK_UNKNOWN');receipt.assertKnown();}};
     try{
      const settleProof=makeProof('source_read_settle',outcome,cap,known);
      const actual=await accountingStock.sdk<unknown>(port!.settleRequest,port,[cap,settleProof]);
      const row=githubReadRecord(captureGithubReadData(actual));
      if(row.state!=='known'&&row.state!=='not_sent'||row.actual_bytes!==outcome.actualResponseBytes||row.request_sent!==Number(outcome.requestSent))fail('DSH_MODEL_PRICING_SETTLEMENT_UNCONFIRMED');
     }catch(raw){accountingStock.inventory(raw);primary??={raw};}
    }
    try{await accountingStock.waitPhysicalKnown();}catch(raw){primary??={raw};}
   }
   if(primary)throw primary.raw;if(!reply)fail('DSH_MODEL_PRICING_REPLY_REQUIRED');
  });
  // The Root is allowed to finish before its own inventory is joined; never
  // waitPhysicalKnown from inside that active Root (self-wait).
  let failure:{raw:unknown}|undefined;
  try{await result;}catch(raw){failure={raw};}finally{pricingControllers.delete(abort);}
  try{await stock.waitPhysicalKnown();}catch(raw){failure??={raw};}
  try{await accountingStock.waitPhysicalKnown();}catch(raw){failure??={raw};}
  try{await rootStock.waitPhysicalKnown();}catch(raw){failure??={raw};}
  if(failure)throw failure.raw;return reply!;
 }
 function activate(){
  if(session||!store||!runtime||!port)return;readOriginalMainDshBootstrapAuthority(realm,store,realm).assertCurrent();readOriginalDshUserControlPort(store,userSource);
  const authority={sourceReadPort:port,resolve(context:unknown,purpose:string){
   const row=contextOf(context),view=row.view;
   const negative=purpose==='disconnect'&&!!row.narrowGuard;
   if(negative)negativeLocal();else live();
   if(purpose!=='connect'&&view.kind==='source_setup')fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');if(negative)row.narrowGuard!();else{view.assertCurrent();view.assertLocal();}
   const common={profileId:scope.profileId,tenantId:scope.tenantId,workspaceId:scope.workspaceId,requestSource:view.kind==='source_setup'?'user' as const:purpose==='connect'||purpose==='disconnect'?'user' as const:'scheduler' as const,mode:view.mode,configurationRevision:view.configurationRevision};
   const data=view.kind==='source_setup'?{...common,kind:'source_setup',setupId:view.setupId,candidateRepository:view.candidateRepository}:{...common,sourceBindingId:view.sourceBindingId,credentialEpoch:view.credentialEpoch,providerAccountId:view.providerAccountId,repository:view.repository};
   const frame={data,assertCurrent(){if(negative){negativeLocal();row.narrowGuard!();negativeLocal();}else{live();view.assertCurrent();view.assertLocal();live();}}};
   apply(weakSet,frames,[frame,row]);apply(weakSet,originalAContexts,[frame,{view,proof:row.proof,assertLocal(){live();view.assertLocal();live();}}]);return frame;
  },async reserve(frame:object,request:{requestDigest:string;plan?:PhysicalPlan},proof:object){
   live();const row=apply(weakGet,frames,[frame]) as Context|undefined;if(!row)fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');row.view.assertCurrent();row.view.assertLocal();
   if(request.plan?.kind==='issue_identity'){
    if(row.view.kind!=='source_binding')fail('DSH_GITHUB_ISSUE_INTENT_REQUIRED');let found=false;
    for(let i=0;i<row.view.candidateIssueRefs.length;i++){const ref=row.view.candidateIssueRefs[i]!;if(ref.issueId===request.plan.expectedIssueId&&ref.issueNumber===request.plan.issueNumber)found=true;}
    if(!found)fail('DSH_GITHUB_ISSUE_INTENT_REQUIRED');
   }
   let scan=apply(weakGet,opened,[row]) as Promise<unknown>|undefined;
   if(!scan){
    let yes!:()=>void,no!:(error:unknown)=>void;
    scan=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
    nativeDefine(scan,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
    apply(weakSet,opened,[row,scan]); // Singleflight before any worker/Source SDK.
    const inventory=apply(weakGet,sessionInventories,[session!]) as ((raw:unknown)=>void)|undefined;
    const operation=(async()=>{
     if(parent&&row.view.kind==='source_setup'){
      const input={accountId:row.view.accountId},migrationProof=githubReadFreeze(nativeCreate(null)) as object;
      apply(weakSet,proofContexts,[migrationProof,{context:row,input}]);
      apply(weakSet,parent.proofOwners,[migrationProof,{owner,purpose:'source_read_migrate'}]);
      await port!.migrateSetup(input,migrationProof);
     }
     const query={accountId:row.view.accountId,scanId:row.scanId},scanProof=githubReadFreeze(nativeCreate(null)) as object;
     apply(weakSet,proofContexts,[scanProof,{context:row,input:query}]);
     if(parent)apply(weakSet,parent.proofOwners,[scanProof,{owner,purpose:'source_read_scan'}]);
     await port!.openScan(query,scanProof);
    })();
    nativeDefine(operation,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);inventory?.(operation);
    const observer=apply(nativeThen,operation,[yes,no]);nativeDefine(observer,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);inventory?.(observer);
   }
   assertStandardIpcPromise(scan,'DSH_GITHUB_BUDGET_UNCONFIRMED');await scan;
   if(nonce===undefined){const raw=randomUUID();const inventory=apply(weakGet,sessionInventories,[session!]) as ((raw:unknown)=>void)|undefined;inventory?.(raw);if(typeof raw!=='string')throw new NativeError('DSH_GITHUB_NONCE_UNCONFIRMED',{cause:raw});nonce=raw;}
   const input={accountId:row.view.accountId,scanId:row.scanId,attemptId:'github-get:'+nonce+':'+(++sequence),requestDigest:request.requestDigest,responseBytesUpperBound:1048576};
   apply(weakSet,proofContexts,[proof,{context:row,input}]);if(parent)apply(weakSet,parent.proofOwners,[proof,{owner,purpose:'source_read_reserve'}]);const cap=await port!.reserveRequest(input,proof);apply(weakSet,attemptContexts,[cap,row]);return{cap,reserveProof:proof};
  },settle(){fail('DSH_GITHUB_ORIGINAL_BUDGET_REQUIRED');},bind(_frame:object,_metadata:unknown,result:object){
   const row=apply(weakGet,frames,[_frame]) as Context|undefined;if(!row)fail('DSH_GITHUB_READ_CONTEXT_REQUIRED');if(row.view.kind==='source_binding')return;
   const admission=readOriginalDshAdmissionPort(store,realm),commit=method(admission,'commitGithubSourceSetup',false);
   const response=apply(commit,admission,[session,result,{requestSource:'scheduler',bootstrapAuthority:realm}]);
   const value=githubReadRecord(captureGithubReadData(response));if(value.ok!==true)fail('DSH_GITHUB_SETUP_COMMIT_UNCONFIRMED');
   const proof=realm.openGithubSourceRead({bindingId:githubReadText(value.bindingId),configurationRevision:value.configurationRevision});
   const context=open(proof,'github-bound:'+randomUUID(),'source_binding');
   if(parent){
    const birth=sourceKey?apply(connectionMapGet,parent.bySource,[sourceKey]) as ConnectionChildBirth|undefined:undefined;
    if(!birth||birth.owner!==owner)fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');
    const previous=apply(connectionMapGet,parent.bindingOwners,[value.bindingId]) as ConnectionChildBirth|undefined;
    if(previous&&previous!==birth)fail('DSH_GITHUB_SCOPE_MISMATCH');
    apply(connectionMapSet,parent.bindingOwners,[value.bindingId,birth]);
   }
   return context;
  }};
  session=createSessionCore(scope,authority);apply(weakSet,sessionCompositions,[session,{realm,store,authoritySource:realm}]);if(parent){const key=apply(weakGet,sessionOwners,[session]) as object;apply(weakSet,parent.sessionOwners,[key,owner]);}
 }
 let owner!:MainGithubSourceConnectionOwner;
 owner=githubReadFreeze({sourceReadAuthoritySource:budgetSource,
  bindStore(value:object){if(store||closed)fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');readOriginalMainDshBootstrapAuthority(realm,value,realm).assertCurrent();readOriginalDshUserControlPort(value,userSource);store=value;const origin=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin;origin.store=value;activate();},
  bindRuntime(value:object){if(runtime||closed)fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');if(parent){if(parent.closed||!parent.store||!parent.runtime||!parent.port)fail('DSH_GITHUB_CONNECTION_NOT_BOUND');if(parent.runtime!==value||parent.store!==store||!parent.children.has(owner)||!parent.port)fail('DSH_GITHUB_CONNECTION_OWNER_REQUIRED');port=parent.port;}else port=readOriginalDshSourceReadPort(value,budgetSource);runtime=value;const origin=apply(weakGet,connectionOrigins,[owner]) as ConnectionOrigin;origin.runtime=value;if(!parent){if(apply(weakGet,runtimeConnections,[value]))fail('DSH_GITHUB_CONNECTION_ALREADY_BOUND');apply(weakSet,runtimeConnections,[value,origin]);}activate();},
  getSession(){live();return session!;},openBindingContext(proof:object,scanId:string){return open(proof,scanId,'source_binding');},openSetupContext(proof:object,scanId:string){return open(proof,scanId,'source_setup');},
  disconnectUser(proof:object,bodyHash:string,sourceBindingId:string){
   negativeLocal();const user=readOriginalMainDshControl(userSource,proof,store,'policy_control',bodyHash);user.assertCurrent();user.assertLocal();
   if(user.storageScope.profileId!==scope.profileId||user.storageScope.workspaceId!==scope.workspaceId)fail('DSH_GITHUB_SCOPE_MISMATCH');
   const state=session!.getStatus();if(state.sourceBindingId===null)return new NativePromise<void>(yes=>yes());if(state.sourceBindingId!==sourceBindingId||!lastBinding)fail('DSH_GITHUB_SCOPE_MISMATCH');
   const context=githubReadFreeze(nativeCreate(null)) as object;apply(weakSet,contexts,[context,{...lastBinding,narrowGuard(){user.assertCurrent();user.assertLocal();}}]);return session!.disconnect(context);
  },
  close(){
   if(pricingClosing)return pricingClosing;closed=true;
   const controllers=pricingControllers.snapshot();for(let i=0;i<controllers.length;i++)try{apply(abortNative,controllers[i],[new NativeError('DSH_GITHUB_CONNECTION_CLOSED')]);}catch(raw){const stock=createRoomTurnCustody();pricingStocks.add(stock);stock.inventory(raw);}
   pricingClosing=(async()=>{let primary:{raw:unknown}|undefined;try{if(session)await session.close();}catch(raw){primary={raw};}const stocks=pricingStocks.snapshot();for(let i=0;i<stocks.length;i++)try{await stocks[i]!.waitPhysicalKnown();}catch(raw){primary??={raw};}if(primary)throw primary.raw;})();return pricingClosing;
  }
 });
 apply(weakSet,connectionOrigins,[owner,{pricing:executePricing,scope,realm,userSource,owner,parent,sourceKey,status(){return session?apply(method(session,'getStatus',true),session,[]) as GithubSessionStatus:githubReadFreeze({state:'unavailable' as const,sourceBindingId:null,repositoryId:null,credentialEpoch:null});},stop(){if(session)apply(method(session,'stopAccepting',true),session,[]);},abort(){if(session)apply(method(session,'abortAllActive',true),session,[]);},ownsActor(actor:unknown){return !closed&&!!store&&!!runtime&&!!actor&&typeof actor==='object'&&!isProxy(actor)&&apply(weakGet,actors,[actor])!==undefined;},isActor(actor:unknown){if(!actor||typeof actor!=='object'||isProxy(actor)||closed||!store||!runtime)return false;const context=apply(weakGet,actors,[actor]) as Context|undefined;if(!context)return false;try{context.view.assertLocal();return true;}catch{return false;}}}]);return owner;
}
