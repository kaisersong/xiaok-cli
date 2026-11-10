import {ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA,ASSISTANT_CALENDAR_MEMORY_SCHEMA} from '../shared/assistant-calendar-memory-contract.js';
import {ASSISTANT_CALENDAR_STATUS_SCHEMA as CALENDAR_SOURCE_STATUS_SCHEMA} from '../shared/assistant-calendar-observation-contract.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { z } from 'zod';
import { types } from 'node:util';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import { ASSISTANT_INPUT_SCHEMAS, ASSISTANT_OUTPUT_SCHEMAS } from '../shared/assistant-ipc-contract.js';
import type { AssistantSemanticController } from './semantic-ipc.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';

const isPromise = types.isPromise, promiseThen = Promise.prototype.then, apply = Reflect.apply;

// Root and Desktop keep separate Zod major versions. Calendar validation stays
// Main-only; existing renderer schemas never import the host-side contract.
const calendarStatus=z.unknown().transform((raw,context)=>{const parsed=CALENDAR_SOURCE_STATUS_SCHEMA.safeParse(raw);if(!parsed.success){context.addIssue({code:'custom',message:'assistant_calendar_status_invalid'});return z.NEVER;}return parsed.data;});
const inputSchemas=Object.freeze({...ASSISTANT_INPUT_SCHEMAS,getCalendarMemorySettings:z.tuple([]),configureCalendarMemory:z.tuple([ASSISTANT_CALENDAR_MEMORY_INPUT_SCHEMA]),getCalendarStatus:z.tuple([]),connectCalendar:z.tuple([]),disconnectCalendar:z.tuple([]),refreshCalendar:z.tuple([])});
const outputSchemas=Object.freeze({...ASSISTANT_OUTPUT_SCHEMAS,getCalendarMemorySettings:ASSISTANT_CALENDAR_MEMORY_SCHEMA,configureCalendarMemory:ASSISTANT_CALENDAR_MEMORY_SCHEMA,getCalendarStatus:calendarStatus,connectCalendar:calendarStatus,disconnectCalendar:calendarStatus,refreshCalendar:calendarStatus});


const channels = Object.freeze({
  getActionOverview: 'desktop:assistant:getActionOverview', getOverview: 'desktop:assistant:getOverview', activate: 'desktop:assistant:activate',
  pause: 'desktop:assistant:pause', resume: 'desktop:assistant:resume',
  acceptCandidate: 'desktop:assistant:acceptCandidate', rejectCandidate: 'desktop:assistant:rejectCandidate',
  dismissAction:'desktop:assistant:dismissAction',snoozeAction:'desktop:assistant:snoozeAction',
  getActionCandidatesPage:'desktop:assistant:getActionCandidatesPage',
  getCalendarMemorySettings:'desktop:assistant:getCalendarMemorySettings',configureCalendarMemory:'desktop:assistant:configureCalendarMemory',
  getAnalysisProvider:'desktop:assistant:getAnalysisProvider',configureAnalysisProvider:'desktop:assistant:configureAnalysisProvider',listLaunchTargets:'desktop:assistant:listLaunchTargets',
  getQualityStatus:'desktop:assistant:getQualityStatus',exportQualityReview:'desktop:assistant:exportQualityReview',importQualityReview:'desktop:assistant:importQualityReview',revokeQualityReview:'desktop:assistant:revokeQualityReview',
  getPeriodicStatus:'desktop:assistant:getPeriodicStatus',configurePeriodic:'desktop:assistant:configurePeriodic',checkPeriodic:'desktop:assistant:checkPeriodic',
  cancelLaunch:'desktop:assistant:cancelLaunch',prepareReconfirmation:'desktop:assistant:prepareReconfirmation',prepareFollowUpLaunch:'desktop:assistant:prepareFollowUpLaunch',prepareLaunch:'desktop:assistant:prepareLaunch',confirmLaunch:'desktop:assistant:confirmLaunch',getActionLaunch:'desktop:assistant:getActionLaunch',resolveActionLaunch:'desktop:assistant:resolveActionLaunch',
  refreshCalendar:'desktop:assistant:refreshCalendar',getCalendarStatus:'desktop:assistant:getCalendarStatus',connectCalendar:'desktop:assistant:connectCalendar',disconnectCalendar:'desktop:assistant:disconnectCalendar',

});
type Method = keyof typeof channels;
type Input = [] | [{ candidateId?: string; collectionId?: string;proposalId?:string;expectedRevision?:number;snoozeUntil?:number;cursor?:string;draftId?:string;instruction?:string;expectedResultDigest?:string;enabled?:boolean;notificationsEnabled?:boolean;intervalMinutes?:number;quietHours?:{start:string;end:string};attestHumanReview?:true;modelId?:string;existingThreadId?:string;goalConsentChecked?:boolean }];
const captureOptions = Object.freeze({ preserveDataPrototype: true });
const deny = () => false;
const methods = new Map<string, Method>(Object.entries(channels).map(([method, channel]) => [channel, method as Method]));
type Owner = Readonly<{
  controller: AssistantSemanticController; authorize: (event: unknown) => boolean; registrar: IpcHandleRegistrar;
  installed: Set<Method>;
}>;
const owners = new WeakMap<IpcHandleRegistrar, Owner>();
const localRisks: RiskTag[] = ['fs-read', 'fs-write-userData', 'internal-mutation'];
const risks: Record<Method, RiskTag[]> = {
 refreshCalendar:[...localRisks,'network','external-process'],
  getCalendarMemorySettings:[...localRisks],configureCalendarMemory:[...localRisks],
  getAnalysisProvider:[...localRisks],configureAnalysisProvider:[...localRisks,'network','external-process','capability-token'],listLaunchTargets:[...localRisks],
  getQualityStatus:[...localRisks],exportQualityReview:[...localRisks,'fs-write'],importQualityReview:[...localRisks,'fs-read','capability-token','issues-token'],revokeQualityReview:[...localRisks,'capability-token'],
  getPeriodicStatus:[...localRisks,'network','external-process','capability-token'],configurePeriodic:[...localRisks,'network','external-process','capability-token'],checkPeriodic:[...localRisks,'network','external-process','capability-token'],
  cancelLaunch:[...localRisks,'fs-write','network','external-process','capability-token'],prepareReconfirmation:[...localRisks,'network','external-process','capability-token'],prepareFollowUpLaunch:[...localRisks,'network','external-process','capability-token'],prepareLaunch:[...localRisks,'network','external-process','capability-token'],confirmLaunch:[...localRisks,'fs-write','network','external-process','capability-token'],getActionLaunch:[...localRisks],resolveActionLaunch:[...localRisks],
  getCalendarStatus:[...localRisks],connectCalendar:[...localRisks,'external-process','capability-token','network'],disconnectCalendar:[...localRisks],
  getActionCandidatesPage:[...localRisks],
  dismissAction:[...localRisks,'network','external-process','capability-token'],
  snoozeAction:[...localRisks,'network','external-process','capability-token'],
  getActionOverview: [...localRisks, 'network', 'external-process', 'capability-token'],
  getOverview: [...localRisks, 'network', 'external-process', 'capability-token'],
  activate: [...localRisks], pause: [...localRisks], resume: [...localRisks], rejectCandidate: [...localRisks],
  acceptCandidate: [...localRisks, 'fs-write', 'network', 'external-process', 'capability-token', 'issues-token'],
};

/** Validate the old wire domain on the captured data; never recapture or return a JSON clone. */
function legacyInputDomain(value: unknown): void {
  const seen = new WeakSet<object>(); let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 200000 || depth > 64) throw Error('loop_verification_execution_input');
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || seen.has(item)) throw Error('loop_verification_execution_input');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) visit(Object.getOwnPropertyDescriptor(item, key)!.value, depth + 1);
  }
  visit(value, 0);
  if (Buffer.byteLength(canonicalVerificationJson(value)) > 4 * 1024 ** 2) throw Error('loop_verification_execution_size');
}
function readId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('id_required');
  return value.trim();
}
function optionalId(value: unknown): string | undefined { return value === undefined ? undefined : readId(value); }
function admission(ipc: IpcHandleRegistrar, controller: AssistantSemanticController,
  authorize: (event: unknown) => boolean): Owner {
  const prior = owners.get(ipc);
  if (prior) {
    if (prior.controller !== controller || prior.authorize !== authorize) throw Error('assistant_ipc_registrar_owner_conflict');
    return prior;
  }
  const registrar: IpcHandleRegistrar = Object.freeze({ handle(channel: string, listener: IpcHandlerListener) {
    const method = methods.get(channel);
    if (!method) throw Error('assistant_ipc_channel');
    return ipc.handle(channel, (event, ...args) => {
      if (authorize(event) !== true) throw Error('assistant_ipc_denied');
      if (args.length !== (['configureCalendarMemory','configureAnalysisProvider','listLaunchTargets','importQualityReview','acceptCandidate','rejectCandidate','dismissAction','snoozeAction','getActionCandidatesPage','prepareLaunch','configurePeriodic','cancelLaunch','prepareReconfirmation','prepareFollowUpLaunch','confirmLaunch','getActionLaunch','resolveActionLaunch'].includes(method) ? 1 : 0)) throw Error('assistant_ipc_input');
      return listener(event, ...args);
    });
  } });
  const owner = Object.freeze({ controller, authorize, registrar, installed: new Set<Method>() });
  owners.set(ipc, owner);
  return owner;
}
function inputSchema(method: Method) {
  return z.custom<Input>(() => true).transform(raw => {
    const value = captureIpcData(raw, 'assistant_ipc_input', captureOptions);
    if (method === 'acceptCandidate' || method === 'rejectCandidate') {
      const input = value[0]; legacyInputDomain(input);
      const fields = method === 'acceptCandidate' ? ['candidateId', 'collectionId'] : ['candidateId'];
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !fields.includes(key))) throw Error('assistant_ipc_input');
      readId(input.candidateId); if (method === 'acceptCandidate') optionalId(input.collectionId);
    }
    if (!inputSchemas[method].safeParse(value).success) throw Error('assistant_ipc_input');
    return value;
  });
}
export function registerAssistantTypedIpc(ipc: IpcHandleRegistrar, controller: AssistantSemanticController,
  authorize: (event: unknown) => boolean = deny): void {
  const owner = admission(ipc, controller, authorize);
  for (const [key, channel] of Object.entries(channels)) {
    const method = key as Method, output = outputSchemas[method];
    if (owner.installed.has(method)) continue;
    registerIpcHandler<Input, unknown>({ registrar: owner.registrar, channel, payloadMode: 'tuple', input: inputSchema(method), output,
      sourceFile: 'desktop/electron/assistant-typed-ipc.ts', rolloutRound: 10, riskTags: [...risks[method]],
      handler: async input => {
        let result: unknown;
        if(method==='getCalendarMemorySettings'){
          if(!controller.getCalendarMemorySettings)throw Error('assistant_calendar_memory_unavailable');result=controller.getCalendarMemorySettings();
        }else if(method==='configureCalendarMemory'){
          if(!controller.configureCalendarMemory)throw Error('assistant_calendar_memory_unavailable');result=controller.configureCalendarMemory({enabled:input[0]!.enabled!,expectedRevision:input[0]!.expectedRevision!,requestSource:'user'});
        }else if(method==='getAnalysisProvider'){
          if(!controller.getAnalysisProvider)throw Error('assistant_analysis_unavailable');result=controller.getAnalysisProvider();
        }else if(method==='configureAnalysisProvider'){
          if(!controller.configureAnalysisProvider)throw Error('assistant_analysis_unavailable');result=controller.configureAnalysisProvider({modelId:input[0]!.modelId!,expectedRevision:input[0]!.expectedRevision!,requestSource:'user'});
        }else if(method==='listLaunchTargets'){
          if(!controller.listLaunchTargets)throw Error('assistant_launch_unavailable');result=controller.listLaunchTargets({...input[0]?.cursor?{cursor:input[0].cursor}:{},requestSource:'user'});
        }else if(method==='getQualityStatus'){
          if(!controller.getQualityStatus)throw Error('assistant_quality_unavailable');result=controller.getQualityStatus();
        }else if(method==='exportQualityReview'){
          if(!controller.exportQualityReview)throw Error('assistant_quality_unavailable');result=controller.exportQualityReview({requestSource:'user'});
        }else if(method==='importQualityReview'){
          if(!controller.importQualityReview)throw Error('assistant_quality_unavailable');result=controller.importQualityReview({attestHumanReview:input[0]!.attestHumanReview!,requestSource:'user'});
        }else if(method==='revokeQualityReview'){
          if(!controller.revokeQualityReview)throw Error('assistant_quality_unavailable');result=controller.revokeQualityReview({requestSource:'user'});
        }else if(method==='getPeriodicStatus'){
          if(!controller.getPeriodicStatus)throw Error('assistant_periodic_unavailable');result=controller.getPeriodicStatus();
        }else if(method==='configurePeriodic'){
          if(!controller.configurePeriodic)throw Error('assistant_periodic_unavailable');const p=input[0]!;result=controller.configurePeriodic({enabled:p.enabled!,notificationsEnabled:p.notificationsEnabled!,intervalMinutes:p.intervalMinutes!,expectedRevision:p.expectedRevision!,...(p.quietHours?{quietHours:p.quietHours}:{}),requestSource:'user'});
        }else if(method==='checkPeriodic'){
          if(!controller.checkPeriodic)throw Error('assistant_periodic_unavailable');result=controller.checkPeriodic({requestSource:'user'});
        }else if(method==='cancelLaunch'){
          if(!controller.cancelLaunch)throw Error('assistant_launch_unavailable');result=controller.cancelLaunch({draftId:input[0]!.draftId!,requestSource:'user'});
        }else if(method==='prepareReconfirmation'){
          if(!controller.prepareReconfirmation)throw Error('assistant_launch_unavailable');result=controller.prepareReconfirmation({draftId:input[0]!.draftId!,...(input[0]!.existingThreadId?{existingThreadId:input[0]!.existingThreadId}:{}),requestSource:'user'});
        }else if(method==='prepareFollowUpLaunch'){
          if(!controller.prepareFollowUpLaunch)throw Error('assistant_launch_unavailable');result=controller.prepareFollowUpLaunch({candidateId:input[0]!.candidateId!,...(input[0]!.existingThreadId?{existingThreadId:input[0]!.existingThreadId}:{}),requestSource:'user'});
        }else if(method==='prepareLaunch'){
          if(!controller.prepareLaunch)throw Error('assistant_launch_unavailable');result=controller.prepareLaunch({proposalId:input[0]!.proposalId!,expectedRevision:input[0]!.expectedRevision!,...(input[0]!.existingThreadId?{existingThreadId:input[0]!.existingThreadId}:{}),requestSource:'user'});
        }else if(method==='confirmLaunch'){
          if(!controller.confirmLaunch)throw Error('assistant_launch_unavailable');result=controller.confirmLaunch({draftId:input[0]!.draftId!,instruction:input[0]!.instruction!,...(input[0]!.goalConsentChecked!==undefined?{goalConsentChecked:input[0]!.goalConsentChecked}:{}),requestSource:'user'});
        }else if(method==='getActionLaunch'){
          if(!controller.getActionLaunch)throw Error('assistant_launch_unavailable');result=controller.getActionLaunch({draftId:input[0]!.draftId!,requestSource:'user'});
        }else if(method==='resolveActionLaunch'){
          if(!controller.resolveActionLaunch)throw Error('assistant_launch_unavailable');result=controller.resolveActionLaunch({draftId:input[0]!.draftId!,expectedResultDigest:input[0]!.expectedResultDigest!,requestSource:'user'});
        }else if(method==='getCalendarStatus'){
          if(!controller.getCalendarStatus)throw Error('assistant_calendar_unavailable');result=controller.getCalendarStatus();
        }else if(method==='refreshCalendar'||method==='connectCalendar'||method==='disconnectCalendar'){
          if(method==='refreshCalendar'){if(!controller.refreshCalendar)throw Error('assistant_calendar_unavailable');result=controller.refreshCalendar({requestSource:'user'});}
          else if(method==='connectCalendar'){if(!controller.connectCalendar)throw Error('assistant_calendar_unavailable');result=controller.connectCalendar({requestSource:'user'});}
          else{if(!controller.disconnectCalendar)throw Error('assistant_calendar_unavailable');result=controller.disconnectCalendar({requestSource:'user'});}
        }else if(method==='getActionCandidatesPage'){
          if(!controller.getActionCandidatesPage)throw Error('assistant_v2_unavailable');
          result=controller.getActionCandidatesPage({cursor:readId(input[0]!.cursor)});
        }else if(method==='dismissAction'){
          if(!controller.dismissAction)throw Error('assistant_actions_unavailable');
          result=controller.dismissAction({proposalId:readId(input[0]!.proposalId),expectedRevision:input[0]!.expectedRevision!,requestSource:'user'});
        }else if(method==='snoozeAction'){
          if(!controller.snoozeAction)throw Error('assistant_actions_unavailable');
          result=controller.snoozeAction({proposalId:readId(input[0]!.proposalId),expectedRevision:input[0]!.expectedRevision!,snoozeUntil:input[0]!.snoozeUntil!,requestSource:'user'});
        }
        else if (method === 'acceptCandidate') result = controller.acceptCandidate({
          candidateId: readId(input[0]!.candidateId), collectionId: optionalId(input[0]!.collectionId), requestSource: 'user',
        });
        else if (method === 'rejectCandidate') result = controller.rejectCandidate({ candidateId: readId(input[0]!.candidateId), requestSource: 'user' });
        else if (method === 'getActionOverview') {
          if (!controller.getActionOverview) throw Error('assistant_v2_unavailable');
          result = controller.getActionOverview();
        }
        else if (method === 'getOverview') result = controller.getOverview();
        else result = controller[method]({ requestSource: 'user' });
        const snapshot = (value: unknown): unknown => {
          let captured: unknown;
          try { captured = captureIpcData(value, 'assistant_operation_unknown', captureOptions); }
          catch { throw Error('assistant_operation_unknown'); }
          if(method==='getActionOverview'&&captured&&typeof captured==='object'&&Object.hasOwn(captured,'calendar')&&!CALENDAR_SOURCE_STATUS_SCHEMA.safeParse((captured as {calendar:unknown}).calendar).success)throw Error('assistant_operation_unknown');
          if (!output.safeParse(captured).success) throw Error('assistant_operation_unknown');
          return captured;
        };
        // Capture synchronous producers before registry's await; use intrinsic
        // Promise.then so data objects' then accessors are never invoked.
        if (isPromise(result)) {
          assertStandardIpcPromise(result, 'assistant_operation_unknown');
          return apply(promiseThen, result, [snapshot]);
        }
        return snapshot(result);
      },
    });
    owner.installed.add(method);
  }
}
