import {isDeepStrictEqual} from 'node:util';
import type {SessionStore} from '../../ai/runtime/session-store/store.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {parseIntentBusinessContract} from '../verification/intent-business-contract.js';
import {intentHostSubjectOwner,parseIntentHostSubject,type IntentHostSubject} from '../verification/intent-host-subject.js';
import {readCurrentIntentPublicationDependencies} from './published-dependencies.js';
import {parseIntentNativeContracts} from './native-contract-journal.js';
import {captureIntentData,hasProtectedIntentProducerHistory} from './intent-commit-boundary.js';
import {assertSessionWriteOwnership,type SessionWriteOwnershipData} from './ownership.js';
import type {StoredStageInput,StoredStepInput} from './stored-intent-clone.js';

// These local readers do not issue capabilities or claim a full Modern record/ledger.
function providerStages(value:readonly StoredStageInput[]|null|undefined):readonly StoredStageInput[]{
 if(!Array.isArray(value))throw Error('intent_provider_contract_changed');return value;
}
function providerSteps(value:readonly StoredStepInput[]|null|undefined):readonly StoredStepInput[]{
 if(!Array.isArray(value))throw Error('intent_provider_stage_changed');return value;
}
function isTerminalObject(value:unknown):value is Readonly<Record<string,unknown>>{
 return value!==null&&(typeof value==='object'||typeof value==='function');
}
function terminalData(value:object):Readonly<Record<string,unknown>>{
 if(!isTerminalObject(value))throw Error('intent_provider_execution_pending');return value;
}
function assertProviderSubject(value:unknown):asserts value is Readonly<IntentHostSubject>{
 // Reuse the real public parser; keep the original literal object/descriptor identity.
 parseIntentHostSubject(value);
}
type ProviderLedgerRead=ReturnType<NonNullable<SessionStore['getIntentNativeLedgerSync']>>;
function currentOwnershipData(value:ProviderLedgerRead):SessionWriteOwnershipData{
 if(value===undefined||value===null)throw Error('intent_provider_basis_changed');return value;
}

/** Fixed issuer helper. The returned closure can only reject changed local
 * facts; it never issues a provider/native/business capability. */
export async function prepareIntentProviderCurrent(input:{store:SessionStore;sessionId:string;instanceId:string|undefined;signal:AbortSignal}):Promise<()=>void>{
 const {store,sessionId,instanceId,signal}=input,read=store.getIntentNativeLedgerSync?.bind(store);
 if(!read)throw Error('intent_provider_canonical_reader_required');
 signal.throwIfAborted();const original=read(sessionId),before=original===undefined?undefined:captureIntentData(original);
 const ids=new Set((before?.intents??[]).map(row=>row.intentId));if(before?.activeIntentId)ids.add(before.activeIntentId);
 const owners=[...ids].sort().map(ownerId=>({ownerKind:'intent' as const,ownerId})),routes=owners.map(owner=>readInstalledCurrentOwner(owner));
 const protectedIntent=hasProtectedIntentProducerHistory(before)||routes.some(route=>route.kind!=='ordinary');
 const current=()=>{signal.throwIfAborted();if(!isDeepStrictEqual(read(sessionId),before)||owners.some((owner,index)=>!isDeepStrictEqual(readInstalledCurrentOwner(owner),routes[index])))throw Error('intent_provider_basis_changed');signal.throwIfAborted();};
 current();if(!protectedIntent)return current;
 if(!before||!instanceId)throw Error('intent_provider_fixed_instance_required');
 assertSessionWriteOwnership(before,instanceId,'send intent provider request');
 const record=before.intents.find(row=>row.intentId===before.activeIntentId),native=parseIntentNativeContracts(before.nativeContracts,sessionId).find(row=>row.intentId===before.activeIntentId);
 if(!record||!native||before.latestPlan?.intentId!==record.intentId||!isDeepStrictEqual(before.latestPlan,record)||native.subjects.some(subject=>subject.attempts.at(-1)?.phase!=='enrolled'))throw Error('intent_provider_native_contract_required');
 const pick=(value:Record<string,unknown>,keys:readonly string[])=>Object.fromEntries(keys.map(key=>[key,value[key]]));
 const contract=native.contract,body=pick(record as unknown as Record<string,unknown>,Object.keys(contract).filter(key=>!['version','verification','stages'].includes(key)));
 const stages=providerStages(record.stages).map(stage=>{const expected=contract.stages.find(value=>value.stageId===stage.stageId);if(!expected)throw Error('intent_provider_contract_changed');return {...pick(stage as unknown as Record<string,unknown>,Object.keys(expected).filter(key=>!['verification','steps'].includes(key))),verification:expected.verification,steps:providerSteps(stage.steps).map(step=>pick(step as unknown as Record<string,unknown>,['stepId','key','order','role','skillName','dependsOn','riskTier']))};});
 const actual=parseIntentBusinessContract({...body,version:1,verification:contract.verification,stages});
 if(!isDeepStrictEqual(actual,contract))throw Error('intent_provider_contract_changed');
 const stage=providerStages(record.stages).find(value=>value.stageId===record.activeStageId);
 if(!stage||!providerSteps(stage.steps).some(step=>step.stepId===record.activeStepId)||!isDeepStrictEqual(record.steps,stage.steps)||record.activeStepId!==stage.activeStepId)throw Error('intent_provider_stage_changed');
 if(record.executionTerminals?.some(terminal=>terminalData(terminal).kind==='step'&&terminalData(terminal).identity===record.activeStepId))throw Error('intent_provider_execution_pending');
 if((['completed','publication_pending','waiting_user'] as readonly unknown[]).includes(record.overallStatus)||(['completed','publication_pending','failed'] as readonly unknown[]).includes(stage.status))throw Error('intent_provider_execution_pending');
 const subject={version:1 as const,sessionId,intentId:record.intentId,stageId:stage.stageId},owner=intentHostSubjectOwner(subject),route=readInstalledCurrentOwner(owner);
 if(route.kind!=='migrated'&&route.kind!=='protected-unregistered')throw Error('intent_provider_owner_unavailable');
 assertProviderSubject(subject);
 const observed=await readCurrentIntentPublicationDependencies(subject,signal);current();
 if(!isDeepStrictEqual(observed.registration.contract,contract)||!isDeepStrictEqual(observed.subject,subject)||!isDeepStrictEqual(observed.registration.owner,route.owner))throw Error('intent_provider_contract_changed');
 return ()=>{current();assertSessionWriteOwnership(currentOwnershipData(read(sessionId)),instanceId,'send intent provider request');if(!isDeepStrictEqual(readInstalledCurrentOwner(owner),route))throw Error('intent_provider_route_changed');signal.throwIfAborted();};
}
