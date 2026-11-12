import {readAssistantDigestFacts} from '../assistant/digest-facts.js';
import {showAssistantDigestOwnerNotification} from './owner-notification.js';
import { createPrivateActivityDirectory } from './storage-permissions.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../verification/intrinsic-async-collection.js';
import {types} from 'node:util';
const runtimePromise=Promise,runtimeThen=Promise.prototype.then,runtimeApply=Reflect.apply,runtimeDefine=Object.defineProperty,runtimeDescriptor=Object.getOwnPropertyDescriptor,runtimePrototype=Object.getPrototypeOf;
const runtimeOwned=new WeakSet<object>(),runtimeHas=WeakSet.prototype.has,runtimeAdd=WeakSet.prototype.add,runtimeSpecies=runtimeDescriptor(runtimePromise,Symbol.species),runtimeUnknown=createIntrinsicSet<unknown>();
function ownRuntime<T>(raw:Promise<T>):Promise<T>{runtimeDefine(raw,'constructor',{__proto__:null,value:runtimePromise} as PropertyDescriptor);runtimeApply(runtimeAdd,runtimeOwned,[raw]);return raw;}
function runtimeDeferred(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=ownRuntime(new runtimePromise<void>((yes,no)=>{resolve=yes;reject=no;}));return{promise,resolve,reject};}
function observeRuntime(raw:Promise<void>,yes:()=>void,no:(error:unknown)=>void):void{
 const ctor=runtimeDescriptor(raw,'constructor'),species=runtimeDescriptor(runtimePromise,Symbol.species);
 if(!runtimeApply(runtimeHas,runtimeOwned,[raw])||!types.isPromise(raw)||types.isProxy(raw)||runtimePrototype(raw)!==runtimePromise.prototype||runtimeDescriptor(raw,'then')||ctor?.value!==runtimePromise||!species||!runtimeSpecies||'value'in species||species.get!==runtimeSpecies.get||species.set!==runtimeSpecies.set){runtimeUnknown.add(raw);return;}
 try{runtimeApply(runtimeThen,raw,[yes,no]);}catch{runtimeUnknown.add(raw);}
}
import { readFileSync, statSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { ConversationActivityOwnerHost } from './owner-host.js';
import { ActivityNativeIdentityRepository } from './native-identity.js';
import { ActivityTaskSnapshotReader, ActivityNativeGroupReader } from './owner-sources.js';
import { ConversationActivitySources } from './sources.js';
import type {ActivityProjectSourceHttpRead,ActivityScopedProjectHttpRead} from './project-http-transport.js';
import {ActivityProjectHttpTransport} from './project-http-transport.js';
import { ActivityOwnerMcp } from './owner-mcp.js';
import { z } from 'zod';
import { showActivityOwnerNotification } from './owner-notification.js';
import { ActivitySourceSupervisor,revokeSupervisedKSwarmConfigTarget,mintCanonicalDesktopConfigBirth,bindCanonicalDesktopConfigBirth,observeCanonicalDesktopConfigClose,type CanonicalDesktopConfigEndpoint,type ActivityManagedSource } from './source-supervisor.js';
import {mintCanonicalDesktopBusinessBirth,bindCanonicalDesktopBusinessBirth,observeCanonicalDesktopBusinessClose,type CanonicalDesktopBusinessEndpoint} from './canonical-dispatch-business.js';

export interface ActivityOwnerConfig {
  schemaVersion: 1; dataRoot: string; profileId: string; actorId: string;
  /** Desktop only: the data root Main hashed into profileId (before realpath). */
  profileRoot?: string;
  identity: { kind: 'desktop' | 'cli'; path: string; workspaceRoot?: string };
  managedSources?: ActivityManagedSource[];
  kswarm?: { url: string; mutationToken: string; brokerUrl: string; roomToken: string };
}
import {activityOwnerConfigDigest} from './owner-config.js';
export {activityOwnerConfigDigest} from './owner-config.js';
import {hasCanonicalActivityProfile} from './owner-qualification.js';

/** Private configuration is supplied by the verified native bootstrap owner. */
export async function startConversationActivityOwner(config: ActivityOwnerConfig, options: { idle?(): void;businessBirth?:object;configFile?:string } = {}) {
  if (config.schemaVersion !== 1) throw new Error('activity_owner_config_unsupported');
  createPrivateActivityDirectory(config.dataRoot);
  const identity = new ActivityNativeIdentityRepository({ ...config.identity, profileId: config.profileId });
  const tasks = new ActivityTaskSnapshotReader(join(config.dataRoot, 'tasks'));
  const daemonTaskHost=tasks.host();
  const groups = config.identity.kind === 'desktop' ? new ActivityNativeGroupReader(config.identity.path) : undefined;
  let sources: ConversationActivitySources;
  let ready = false;
  let mcp: ActivityOwnerMcp;
  let supervisor: ActivitySourceSupervisor;
  let socket: WebSocket | undefined, reconnect: ReturnType<typeof setTimeout> | undefined, closed = false;
  let projectHttp:ActivityProjectHttpTransport|undefined;
  const ks = config.kswarm?Object.freeze({...config.kswarm}):undefined;
  const host = new ConversationActivityOwnerHost({ dataRoot: config.dataRoot, profileId: config.profileId, actorId: config.actorId, configDigest: activityOwnerConfigDigest(config),
    nativeSourceSupported:config.identity.kind==='desktop',
    idle: options.idle,
    disconnected: clientId => mcp.disconnected(clientId),
    mcpRequest: async (method, params, clientId) => {
      if (method === 'mcpRegister') return mcp.register(params, clientId);
      const actor = { requestSource: 'user' as const, actorId: config.actorId };
      if (method === 'mcpAnswer') {
        const input = z.object({ watchId: z.string().min(1).max(256), input: z.object({ inputId: z.string().min(1).max(256), expectedDigest: z.string().length(64), action: z.enum(['accept','decline','cancel']), content: z.record(z.string(), z.unknown()).optional() }).strict() }).strict().parse(params);
        return mcp.activities.answerInput(input.watchId, input.input, actor);
      }
      const input = z.object({ watchId: z.string().min(1).max(256) }).strict().parse(params);
      return method === 'mcpInputs' ? mcp.activities.inputs(input.watchId, actor) : mcp.activities.cancel(input.watchId, actor);
    },
    ready: () => ready, notify: showActivityOwnerNotification,
    ...(config.identity.kind==='desktop'?{assistantDigest:{readFacts:(envelope:import('../assistant/notification-policy.js').AssistantDigestEnvelope)=>readAssistantDigestFacts(config.dataRoot,envelope),platformAvailable:()=>process.platform==='darwin'||process.platform==='linux',notify:showAssistantDigestOwnerNotification}}:{}),
    sourceControl: async (method, params) => {
      if (method === 'sourceProtected') { if (Object.keys(params).length !== 1 || !Number.isSafeInteger(params.pid) || Number(params.pid) <= 0) throw new Error('activity_source_request_invalid'); return supervisor.protectedPid(Number(params.pid)); }
      if (Object.keys(params).some(key => !['name','ownerEpoch'].includes(key)) || params.ownerEpoch !== host.ownerEpoch || !['kswarm','broker'].includes(String(params.name))) throw new Error('activity_source_stale_lease');
      const source = config.managedSources?.find(item => item.name === params.name); if (!source) throw new Error('activity_source_not_managed');
      if(method==='sourceRestart'&&source.name==='kswarm')revokeSupervisedKSwarmConfigTarget(supervisor);
      projectHttp?.invalidate();await sources.projectConnectionChanged('reconnecting');
      if (method === 'sourceRestart') await supervisor.stopOwned(source.name, host.ownerEpoch);
      const receipt=await supervisor.ensure(source);
      await sources.projectConnectionChanged(socket?.readyState===WebSocket.OPEN?'connected':'reconnecting');return receipt;
    },
    getThread: threadId => identity.getThread(threadId), authorizeProducer: (threadId, instanceId) => identity.authorizeProducer(threadId, instanceId),
    assertTaskSourceOwner:(watch,owner)=>watch.source==='task_host'&&owner===daemonTaskHost,
    ...(ks?{projectSource:{
      assertOwner(owner:object){if(owner!==sources||closed)throw Error('activity_project_source_forbidden');},
      read(audience,signal,beforeEffects){if(!projectHttp)throw Error('activity_kswarm_unavailable');return projectHttp.readProjectSource(audience,signal,beforeEffects);},
      assertRead(audience,frame){if(!projectHttp)throw Error('activity_kswarm_unavailable');projectHttp.assertProjectSourceRead(audience,frame as ActivityProjectSourceHttpRead);},
      assertScoped(audience,frame){if(!projectHttp)throw Error('activity_kswarm_unavailable');projectHttp.assertScopedProjectRead(audience,frame as ActivityScopedProjectHttpRead);},
      ensureRound(projectId){return sources.ensureProjectRound(projectId);},
      admitHint(projectId){return sources.admitProjectHint(projectId);},
    } satisfies import('./project-source-port.js').ProjectSourcePort}:{}),
    canObserveWork: async watch => {
      if (watch.source === 'task_host') {if(hasCanonicalActivityProfile(config.dataRoot))return false;const snapshot=await tasks.snapshot(watch.workId);return snapshot?.taskId===watch.workId&&snapshot.sessionId===watch.sourceDataEpoch&&snapshot.context?.threadId === (watch.actualExecutionThreadId ?? watch.origin.threadId);}
      if (watch.source === 'mcp') return mcp?.canObserve(watch) ?? false;
      if (watch.source === 'agent_group') return groups?.groupThread(watch.workId) === watch.origin.threadId;
      if (watch.source !== 'kswarm' || !projectHttp) return false;
      return projectHttp.canObserveProject(watch.workId,watch.sourceDataEpoch);
    }, stopWatch: watchId => { sources?.stopWatch(watchId); mcp?.activities.stopWatch(watchId); }, watchBound: async watchId => { await sources?.startWatch(watchId); const watch = host.store.getWatch(watchId); if (watch?.source === 'mcp') mcp.bound(watch); },
    sourceHint: (source, workId) => source === 'kswarm' ? sources.refreshProject(workId, true) : sources.refreshGroup(workId, true), onError: () => {} });
  projectHttp=ks?new ActivityProjectHttpTransport({ownerEpoch:host.ownerEpoch,kswarm:ks,onInvalidated:()=>host.invalidateProjectReads()}):undefined;
  sources = new ConversationActivitySources({ store: host.store, service: host.service,
    taskHost: () => daemonTaskHost, fixedProjectSource:!!ks, ...(groups ? { readGroup: (groupId: string, after: number) => groups.events(groupId, after), groupMembers: (runId: string) => groups.members(runId) } : {}),
  });
  mcp = new ActivityOwnerMcp({ root: config.dataRoot, store: host.store, service: host.service, actorId: config.actorId });
  supervisor = new ActivitySourceSupervisor(config.dataRoot, host.ownerEpoch);
  let businessEndpoint:CanonicalDesktopBusinessEndpoint|undefined;
  if(options.businessBirth){if(!options.configFile)throw Error('activity_business_original_birth_required');businessEndpoint=bindCanonicalDesktopBusinessBirth(options.businessBirth,supervisor,options.configFile,config);businessEndpoint.start();}
  const connect = () => {
    if (!ks || closed) return;
    projectHttp?.invalidate();
    const ws=new WebSocket(`${ks.url.replace(/^http/, 'ws')}/ws`);socket=ws;
    ws.on('open', () => { if(closed||socket!==ws)return;projectHttp?.invalidate();void sources.projectConnectionChanged('connected').catch(()=>{}); });
    ws.on('message', data => {
      if(closed||socket!==ws)return;
      try { const hint = JSON.parse(data.toString()); if (hint.type === 'project_activity' && typeof hint.projectId === 'string') void sources.refreshProject(hint.projectId, true); } catch { /* Hints are not facts. */ }
    });
    ws.on('close', () => { if (closed||socket!==ws) return;projectHttp?.invalidate();void sources.projectConnectionChanged('disconnected').catch(()=>{});reconnect=setTimeout(connect,1000);reconnect.unref(); });
    ws.on('error', () => ws.close());
  };
  let shutdown: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (shutdown) return shutdown;
    const completion=runtimeDeferred();shutdown=completion.promise;
    closed = true; ready = false;businessEndpoint?.seal();
    const begin=(businessFailure?:unknown)=>{
    const raw=ownRuntime((async()=>{
    const step = (run: () => void | Promise<void>): Promise<void> => {
      try { return Promise.resolve(run()); } catch (error) { return Promise.reject(error); }
    };
    const httpDrain=step(()=>projectHttp?.close());
    // Seal real IPC admission; managed daemon lifetime is unchanged.
    const hostDrain = step(() => host.sealAndDrain());
    const sourceDrain = step(() => { if (reconnect) clearTimeout(reconnect); socket?.close(); return sources.close(); });
    const mcpDrain = step(() => mcp.close());
      const outcomes = await Promise.allSettled([hostDrain, sourceDrain, mcpDrain,httpDrain]);
      const failures = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, 'activity_owner_shutdown_failed');
      await host.service.close();
      const readers = await Promise.allSettled([step(() => tasks.close()), step(() => groups?.close()), step(() => identity.close())]);
      const readerFailures = readers.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (readerFailures.length) throw new AggregateError(readerFailures, 'activity_owner_readers_close_failed');
      await host.stop();
      if(businessFailure)throw businessFailure;
    })());observeRuntime(raw,completion.resolve,completion.reject);
    };
    if(businessEndpoint)observeCanonicalDesktopBusinessClose(businessEndpoint,begin);else begin();
    return shutdown;
  };
  try { await host.start(); for (const source of config.managedSources ?? []) await supervisor.ensure(source); for (const watch of host.store.listWatches()) await sources.startWatch(watch.watchId); await mcp.restore(); connect(); ready = true; }
  catch (error) {
    try { await stop(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'activity_owner_start_and_cleanup_failed'); }
    throw error;
  }
  return { host, supervisor,businessEndpoint, stop };
}

export function serveConversationActivityOwner(configFile:string):Promise<void>{return serveOwner(configFile,false);}
export function serveCanonicalConversationActivityOwner(configFile:string):Promise<void>{return serveOwner(configFile,true);}
async function serveOwner(configFile:string,canonical:boolean):Promise<void>{
  if(canonical&&(!process.argv[2]||realpathSync.native(configFile)!==realpathSync.native(process.argv[2])))throw Error('activity_owner_entry_config_mismatch');
  process.umask(0o077);
  const state = statSync(configFile);
  if (state.size > 256 * 1024 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0)) throw new Error('activity_owner_config_not_private');
  const config = JSON.parse(readFileSync(configFile, 'utf8')) as ActivityOwnerConfig;
  const birth=canonical&&config.identity.kind==='desktop'?mintCanonicalDesktopConfigBirth():undefined;
  const businessBirth=canonical&&config.identity.kind==='desktop'?mintCanonicalDesktopBusinessBirth():undefined;
  let endpoint:CanonicalDesktopConfigEndpoint|undefined;
  const stopTails=createIntrinsicSet<Promise<void>>();
  let runtime: Awaited<ReturnType<typeof startConversationActivityOwner>>;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    runtime.businessEndpoint?.seal();
    const done=runtimeDeferred(),raw=done.promise;stopTails.add(raw);
    observeRuntime(raw,()=>{stopTails.delete(raw);process.exit(0);},()=>{stopTails.delete(raw);process.exit(1);});
    const failures:unknown[]=[];let remaining=(endpoint?1:0)+(runtime.businessEndpoint?1:0);
    const finish=()=>{let closing:Promise<void>;try{closing=runtime.stop();}catch(error){appendIntrinsic(failures,error);done.reject(aggregateIntrinsicErrors(failures,'activity_owner_endpoint_shutdown_failed'));return;}
      observeRuntime(closing,()=>{if(failures.length)done.reject(aggregateIntrinsicErrors(failures,'activity_owner_endpoint_shutdown_failed'));else done.resolve();},error=>{appendIntrinsic(failures,error);done.reject(aggregateIntrinsicErrors(failures,'activity_owner_endpoint_shutdown_failed'));});};
    const settled=(error?:unknown)=>{if(error!==undefined)appendIntrinsic(failures,error);if(--remaining===0)finish();};
    if(!remaining){finish();return;}
    // Each original owner reports its physical close. Unknown observation
    // keeps that lane pending and cannot authorize teardown of its siblings.
    if(endpoint)try{observeCanonicalDesktopConfigClose(endpoint,settled);}catch(error){runtimeUnknown.add(error);}
    if(runtime.businessEndpoint)try{observeCanonicalDesktopBusinessClose(runtime.businessEndpoint,settled);}catch(error){runtimeUnknown.add(error);}
  };
  runtime = await startConversationActivityOwner(config, { idle: stop,...(businessBirth?{businessBirth,configFile}:{}) });
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  if(birth)try{endpoint=bindCanonicalDesktopConfigBirth(birth,runtime.supervisor,configFile,config);}catch(error){try{await runtime.stop();}catch(cleanup){throw new AggregateError([error,cleanup],'activity_owner_config_start_and_cleanup_failed');}throw error;}
}
