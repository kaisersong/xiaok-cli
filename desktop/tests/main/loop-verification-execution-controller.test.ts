import '../../../tests/support/installed-controller-fixture.js';
import {createLoopOutputService} from '../../electron/loop-output-service.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {createLoopCurrentViews} from '../../electron/loop-current-views.js';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {createLoopTimedCompletionHost,type LoopTimedCompletionHost} from '../../electron/loop-timed-completion.js';
import {createLoopRunner} from '../../electron/loop-executor.js';
import {createDesktopLoopPublicationService} from '../../electron/loop-desktop-publication-service.js';
import {registerLoopPublicationIpc} from '../../electron/loop-publication-ipc.js';
// @vitest-environment node
import { it, expect, vi, type TestContext } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const leaf = vi.hoisted(() => ({ factory: undefined as any, profile: undefined as any, file: '' }));
vi.mock('../../../src/runtime/verification/controller-client.js', async original => ({ ...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(), createInstalledVerificationClient: () => leaf.factory() }));
vi.mock('../../../src/runtime/verification/migration-markers.js', async original => ({ ...await original<typeof import('../../../src/runtime/verification/migration-markers.js')>(), readInstalledCurrentProfile: () => leaf.profile(), readInstalledMigrationOwner: () => ({ kind: 'ordinary' }) }));
vi.mock('electron', () => ({ app: { getLocale: () => 'zh' }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [leaf.file] }), showMessageBox: async () => ({ response: 1 }) } }));
import {loopPublicationReceiver} from '../../../tests/support/loop-publication-receiver.js';
import {createLoopBusinessPublicationHost} from '../../electron/loop-business-publication-host.js';
import {createLoopPublicationWorkflow} from '../../electron/loop-publication-workflow.js';
import {readCurrentLoopPublishedCandidate} from '../../../src/runtime/loop/published-candidate.js';
import { verifiedOperationFixture } from '../../../tests/support/verified-operation-fixture.js';
import { createAuthenticatedControllerClient } from '../../../src/runtime/verification/controller-client.js';
import { parsePublicProfileIndex } from '../../../src/runtime/verification/profile-index-publication.js';
import * as migrationMarkers from '../../../src/runtime/verification/migration-markers.js';
import { createApplicationBindingAuthority } from '../../../src/runtime/verification/application-binding-authority.js';
import { applicationBindingReviewBytes } from '../../../src/runtime/verification/application-binding-review.js';
import { startPublicController } from '../../../src/runtime/verification/controller-public-daemon.js';
import { createControllerApplicationRouting } from '../../../src/runtime/verification/controller-application-routing.js';
import { createControllerOperationRouting } from '../../../src/runtime/verification/controller-operation-routing.js';
import { callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
import { loopHostSubjectOwner } from '../../../src/runtime/verification/loop-host-subject.js';
import { LoopStore } from '../../electron/loop-store.js';
import { ArtifactEvidenceRegressionScanner } from '../../electron/artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { createLoopNativeWorkflow } from '../../electron/loop-native-workflow.js';
import { createLoopVerificationSessionHost } from '../../electron/loop-verification-session-host.js';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const definition = (id: string) => ({ version: 1, obligations: [{ obligationId: id, predicateId: 'content', predicateVersion: '1', semantics: 'current-subject', recipe: { kind: 'artifact-content', checks: [{ id: 'content', path: 'result', sha256: hash('result'), structure: 'bytes' }] } }] });

// Real product helper/opaque material plan, canonical file lease, SQLite
// authorities, material/raw/run/recipe and signed fixed client. Native dialogs,
// peer identity and engine are fixture leaves, not installed OS qualification.
const scenarios=['terminal','lost-dispatch','publication-lost-ack','full-projection','desktop-service','timed-pending','timed-expired','output-consumer'] as const;
async function closeLoopResources(closes: readonly (() => unknown)[], bodyFailure?: {error:unknown}):Promise<void> {
  const errors:unknown[]=[];
  for(const close of closes){try{await close();}catch(error){errors.push(error);}}
  if(errors.length)throw new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...errors],'loop_controller_scenario_cleanup_failed');
}
async function actualLoopControllerScenario(mode:typeof scenarios[number],testSignal:AbortSignal){
  const started=performance.now();
  const mark=(stage:string)=>{try{console.info('[loop-controller-stage]',JSON.stringify({mode,stage,elapsedMs:performance.now()-started}));}catch{/* Passive evidence must not change the scenario outcome. */}};
  const closes:(()=>unknown)[]=[],restores:(()=>unknown)[]=[];
  const own=(close:()=>unknown)=>{let attempted=false;const once=()=>{if(attempted)return;attempted=true;return close();};closes.unshift(once);return once;};
  let bodyFailure:{error:unknown}|undefined;
  try{
  const f = await verifiedOperationFixture();closes.unshift(()=>f.close());mark('fixture-ready');testSignal.throwIfAborted();
  const receiver = await loopPublicationReceiver(f);closes.unshift(()=>receiver.close());testSignal.throwIfAborted();
  const unused = (): never => { throw Error('unused'); };
  const application = createApplicationBindingAuthority({ database: f.database, authorityId: 'authority', completion: f.composition, clock: f.clock, assertCurrent() {},
    resolvePrincipal: p => ({ ...p, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555', source: 'macos-local-generateduid' as const }),
    async approve(review) { return { uid: f.peer.uid, auditSessionId: f.peer.auditSessionId, reviewHash: hash(applicationBindingReviewBytes(review)) }; } });
  closes.unshift(()=>application.close());
  const appRouting = createControllerApplicationRouting({ application, assertCurrent() {}, async renew() {} });
  const opRouting = createControllerOperationRouting({ assertCurrent() {}, async renew() {}, verification: f.operations, completion: f.composition.public,
    publication: receiver.publication, execution: { invoke: unused } });
  const socketPath = join(f.root, 'loop.sock'); let lost = false, dispatches = 0, publicationApprovals = 0;
  const server = await startPublicController({ socketPath, authorityId: 'authority', serviceEpoch: 'boot', privateKey: f.keys.privateKey, allowedUserIds: [f.peer.uid], acceptPeer: () => f.peer,
    async invoke(method, payload: any, peer, serverSignal) {
      const signal=AbortSignal.any([serverSignal,testSignal]);signal.throwIfAborted();
      if (method.startsWith('application.')) return appRouting.invoke(method, payload, peer, signal);
      if (method === 'materials.prepareRequest') return f.material.prepareRequest(payload, peer, signal);
      if (method === 'materials.authorize') return f.material.authorize(payload.challengeId, peer, signal);
      if (method === 'materials.stage') return f.material.stage(payload, peer, signal);
      if (method === 'materials.retireRequest') return f.material.retireRequest(payload, peer);
      if (method === 'materials.lookupRequest') return f.material.lookupRequest(payload, peer);
      const result = await opRouting.invoke(method, payload, peer, signal);
      if (method === 'verification.dispatch') { dispatches++; if (mode === 'lost-dispatch' && !lost) { lost = true; throw Error('lost after actual terminal commit'); } }
      if (method === 'publication.approve') { publicationApprovals++; if (mode === 'publication-lost-ack') throw Error('lost actual publication ACK'); }
      return result;
    } });
  closes.unshift(()=>server.close());testSignal.throwIfAborted();
  leaf.factory = () => createAuthenticatedControllerClient({ authorityId: 'authority', publicKey: f.keys.publicKey, roundTrip: (bytes, callerSignal) => {
    const signal=callerSignal===undefined?testSignal:AbortSignal.any([callerSignal,testSignal]);signal.throwIfAborted();
    return callControllerIpc(socketPath, bytes, { signal });
  }, roundTripSync: unused });
  const profilePath = join(f.root, 'migrations', 'principals', String(f.peer.uid) + '.json');
  leaf.profile = () => existsSync(profilePath) ? { kind: 'protected', index: parsePublicProfileIndex(JSON.parse(readFileSync(profilePath, 'utf8'))) } : { kind: 'ordinary' };
  // The shared installed fixture also registers identity leaves; bind this case's
  // profile lookup after that fixture is initialized, to its actually published index.
  const profileLeaf = vi.spyOn(migrationMarkers, 'readInstalledCurrentProfile').mockImplementation(() => leaf.profile());
  restores.push(()=>profileLeaf.mockRestore());
  const markerLeaf = vi.spyOn(migrationMarkers, 'readInstalledMigrationOwner').mockReturnValue({kind:'ordinary'});
  restores.push(()=>markerLeaf.mockRestore());
  leaf.file = join(f.root, 'input.txt'); writeFileSync(leaf.file, 'x');
  let storeClosed=false, reopened:LoopStore|undefined;
  const store = new LoopStore(join(f.root, 'loop.sqlite'));closes.unshift(()=>{if(!storeClosed)store.close();});
  const workflow = createLoopNativeWorkflow({ store, assertAdmission() {}, now: () => 20 });closes.unshift(()=>workflow.close());
  const window = { isDestroyed: () => false, once() {}, removeListener() {} } as any;
  const options = { store, window, sessionRoot: join(f.root, 'sessions'), workspaceRoot: f.root, assertAdmission() {}, now: () => 100000 };
  closes.unshift(()=>reopened?.close());
  let timed:TimedActionStore|undefined,timedHost:LoopTimedCompletionHost|undefined,timedRunId:string|undefined;
  closes.unshift(()=>timed?.close());closes.unshift(()=>timedHost?.close());
  let publicationWorkflow=createLoopPublicationWorkflow({store,assertAdmission(){},now:()=>100000});
  closes.unshift(()=>publicationWorkflow.close());
  let host = createLoopVerificationSessionHost(options);closes.unshift(()=>host.close());
  const date = vi.spyOn(Date, 'now').mockReturnValue(100000);restores.unshift(()=>date.mockRestore());
  testSignal.throwIfAborted();
    const outputMode=mode==='output-consumer',loopId=outputMode?'output-template':'artifact-evidence-regression';
    const taskSnapshot:TaskSnapshot={taskId:'output-task',sessionId:'original-session',status:'completed',prompt:'Original',materials:[],events:[],createdAt:4,updatedAt:8};
    store.ensureBuiltInLoops(1);
    if(outputMode)store.createUserLoopTemplate({loopId,kind:'markdown_file',title:'Output',prompt:'Original',outputDirectory:f.root,outputFileName:'result',now:1});
    store.saveLoopPublicationConfiguration({ loopId, expectedRevision: null, requestSource: 'user', now: 2, configuration: { version: 1, contract: outputMode?{kind:'user-template'}:{ kind: 'builtin-diagnostic', scanner:'artifact-evidence-regression', objective: 'Original', completionCriterion: 'Original criterion' }, verificationDefinitions: { run: definition('run-original'), stages: outputMode?{execute:definition('run-original'),verify:definition('run-original')}:{ scan: definition('scan-original') } } } });
    if(mode.startsWith('timed-')){timed=new TimedActionStore(join(f.root,'timed.sqlite'));timed.createAction({id:'timed-original',title:'Original',executor:{kind:'loop',loopId},trigger:{kind:'once',at:2},source:'user',now:1});timedRunId=timed.claimDueActions(2,1,{recoveryReason:'normal_tick'})[0].runId;timed.markRunRunning('timed-original',timedRunId,2);}
    const began = store.beginLoopRun(loopId, { kind: timed?'scheduled':'manual', logicalRunKey:'actual-controller-occurrence',...(timed?{timedActionId:'timed-original',timedActionRunId:timedRunId,scheduledDueAt:2}:{}) }, 3, 1000, { requestSource: timed?'scheduler':'user' }); if (began.status !== 'started') throw Error('begin');
    const stage=store.startLoopStage(began.run.id,loopId,outputMode?'execute':'scan',4,outputMode?{taskId:taskSnapshot.taskId}:undefined),producer=store.openLoopPublicationProducer(began.run);
    if(outputMode){producer.recordTemplateExecution({executeStageId:stage.id,taskSnapshot,summary:'Original execution',evidenceIds:[],artifacts:[],now:9});const verify=store.startLoopStage(began.run.id,loopId,'verify',10,{taskId:taskSnapshot.taskId});producer.recordTemplateTerminal({executeStageId:stage.id,verifyStageId:verify.id,summary:'Original verified summary',evidenceIds:[],artifacts:[{selection:{kind:'local',obligationId:'run-original',path:'result'},sha256:hash('result'),size:6}],now:11});}
    else{const path=join(f.root,'evidence.sqlite'),evidence=new CompletionEvidenceStore(path),scanner=new ArtifactEvidenceRegressionScanner(path);try{producer.recordScan(stage.id,scanner.scan({loopRunId:began.run.id,now:10}),10);}finally{scanner.close();evidence.close();}}
    const candidate = store.recoverLoopPublicationCandidates({ runId: began.run.id, requestSource: 'user' }).find(c => c.stageId === null)!;
    const native = workflow.reserve({ candidateId: candidate.candidateId, expectedLatestAttemptId: null, requestSource: 'user' });
    expect((await workflow.advance({ attemptId: native.attemptId, requestSource: 'user' })).phase).toBe('ready');
    const session = await host.prepare({ nativeAttemptId: native.attemptId, obligationId: 'run-original', requestSource: 'user' });
    expect((await host.enroll({ id: session.id, requestSource: 'user' })).phase).toBe('enrolled');
    const before = (f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n;
    const input = { id: session.id, exactCommand: { argv: ['/bin/true'], cwdRelative: '.' }, expiresAt: 104999, requestSource: 'user' as const };
    if (mode === 'lost-dispatch') await expect(host.verify(input)).rejects.toThrow(); else expect((await host.verify(input)).phase).toBe('terminal');
    const journal = store.listLoopVerificationExecutions(session.id)[0];
    await host.close(); host = createLoopVerificationSessionHost(options);
    const recovered = await host.recoverVerification({ id: journal.id, requestSource: 'scheduler' });
    expect(recovered.phase).toBe('terminal'); expect(dispatches).toBe(1);
    expect((f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n).toBe(before + 1);
    expect(store.getLoopRunLifecycle(began.run.id)?.businessState).toBe('publication_pending');
    const owner = recovered.verificationObservation!.owner;
    expect(owner).toMatchObject(loopHostSubjectOwner(candidate.binding.subject));
    const payload = f.operations.stageVerifiedPayload(owner), body = JSON.parse(f.composition.privateHost.payloads.read(payload.payloadId, owner).toString('utf8'));
    expect(Buffer.from(body.evaluations[0].artifacts[0].bytesBase64, 'base64').toString()).toBe('result');
    const publish={nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user' as const};
    if(mode==='publication-lost-ack')await expect(publicationWorkflow.start(publish)).rejects.toThrow();else expect((await publicationWorkflow.start(publish)).status).toBe('committed');
    const originalPublication=store.listLoopPublicationAttempts(candidate.candidateId)[0];
    await host.close();await workflow.close();await publicationWorkflow.close();store.close();storeClosed=true;
    reopened=new LoopStore(join(f.root,'loop.sqlite'));publicationWorkflow=createLoopPublicationWorkflow({store:reopened,assertAdmission(){},now:()=>100000});
    const finalPublication=await publicationWorkflow.recover({attemptId:originalPublication.attemptId,requestSource:'scheduler'});
    expect(finalPublication.status).toBe('committed');expect(receiver.approvals).toBe(1);expect(publicationApprovals).toBe(1);
    const published=await readCurrentLoopPublishedCandidate(candidate.binding);mark('root-publication-current');
    expect(published.operationId).toBe(finalPublication.observation!.operationId);
    expect(Buffer.from(JSON.parse(published.bytes.toString()).evaluations[0].artifacts[0].bytesBase64,'base64').toString()).toBe('result');
    expect(reopened.getLoopRunLifecycle(began.run.id)?.businessState).toBe('publication_pending');
    expect((f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n).toBe(before+1);
    if(outputMode){
      const business=createLoopBusinessPublicationHost({store:reopened,assertAdmission(){},now:()=>100001,taskPort:{async recoverTask(){return taskSnapshot;}}}),closeBusiness=own(()=>business.close());
      const stageWorkflow=createLoopNativeWorkflow({store:reopened,assertAdmission(){},now:()=>20}),closeStageWorkflow=own(()=>stageWorkflow.close());
      const stageHost=createLoopVerificationSessionHost({...options,store:reopened}),closeStageHost=own(()=>stageHost.close());
      const outputEvidence=new CompletionEvidenceStore(join(f.root,'output-evidence.sqlite')),closeEvidence=own(()=>outputEvidence.close()),openPath=vi.fn(async()=>'');
      const outputs=createLoopOutputService({store:reopened,evidenceStore:outputEvidence,gate:new DesktopShutdownGate(),captureAdmission:()=>()=>{},taskPort:{async recoverTask(){return taskSnapshot;}},openPath}),closeOutputs=own(()=>outputs.close());
      let outputFailure:{error:unknown}|undefined;
      try{
        await expect(outputs.readOutputPreview({loopId,requestSource:'user'})).rejects.toThrow();
        await expect(outputs.listPublishedArtifacts({loopId,requestSource:'user',page:{offset:0,identity:null}})).rejects.toThrow();
        for(const c of reopened.listLoopPublicationCandidates(began.run.id).filter(c=>c.stageId!==null)){
          const n=stageWorkflow.reserve({candidateId:c.candidateId,expectedLatestAttemptId:null,requestSource:'user'});await stageWorkflow.advance({attemptId:n.attemptId,requestSource:'user'});
          const ss=await stageHost.prepare({nativeAttemptId:n.attemptId,obligationId:'run-original',requestSource:'user'});await stageHost.enroll({id:ss.id,requestSource:'user'});await stageHost.verify({...input,id:ss.id});await publicationWorkflow.start({nativeAttemptId:n.attemptId,expectedLatestAttemptId:null,requestSource:'user'});
        }
        mark('output-stage-publications-ready');
        await business.project({runId:began.run.id,requestSource:'user'});mark('output-business-projected');
        writeFileSync(join(f.root,'result'),'polluted workspace');
        expect(await outputs.readOutputPreview({loopId,requestSource:'user'})).toMatchObject({ok:true,content:'result',origin:'verified_publication',runId:began.run.id});mark('output-preview-read');
        expect(await outputs.listPublishedArtifacts({loopId,requestSource:'user',page:{offset:0,identity:null}})).toMatchObject({loopId,total:1,nextOffset:null,items:[{path:'result',size:6,sha256:hash('result')}],identity:{runId:began.run.id,candidateId:candidate.binding.candidateId}});mark('output-artifacts-listed');
        expect(await outputs.readTaskResult({loopId,requestSource:'user'})).toMatchObject({ok:true,content:'Original verified summary',taskId:'output-task',origin:'verified_publication'});mark('output-task-read');
        await expect(outputs.openOutputDirectory({loopId,requestSource:'user'})).rejects.toThrow('loop_output_file_changed');expect(openPath).not.toHaveBeenCalled();mark('output-workspace-mutation-refused');
        writeFileSync(join(f.root,'result'),'result');expect(await outputs.openOutputDirectory({loopId,requestSource:'user'})).toMatchObject({ok:true,origin:'workspace_navigation'});expect(openPath).toHaveBeenCalledTimes(1);mark('output-navigation-complete');
        openPath.mockImplementation(async()=>{f.setTime(10000);return '';});await expect(outputs.openOutputDirectory({loopId,requestSource:'user'})).rejects.toThrow();expect(openPath).toHaveBeenCalledTimes(2);mark('output-late-navigation-refused');
        f.setTime(10000);await expect(outputs.listPublishedArtifacts({loopId,requestSource:'user',page:{offset:0,identity:null}})).rejects.toThrow();for(const method of ['readOutputPreview','readTaskResult','openOutputDirectory'] as const)await expect(outputs[method]({loopId,requestSource:'user'})).rejects.toThrow();expect(openPath).toHaveBeenCalledTimes(2);expect(dispatches).toBe(3);expect(receiver.approvals).toBe(3);mark('output-expiry-refusals-complete');
      }catch(error){outputFailure={error};throw error;}finally{await closeLoopResources([closeOutputs,closeEvidence,closeBusiness,closeStageHost,closeStageWorkflow],outputFailure);}
      mark('scenario-body-complete');return;
    }
    if(mode==='full-projection'||mode==='desktop-service'||mode.startsWith('timed-')){
      const timedInput={actionId:'timed-original',timedRunId:timedRunId!,loopRunId:began.run.id,mode:'normal' as const,requestSource:'scheduler' as const};
      if(timed){timedHost=createLoopTimedCompletionHost({timedStore:timed,loopStore:reopened,captureAdmission:()=>()=>{},now:()=>100001});if(mode==='timed-pending'){expect(await timedHost.finalize(timedInput)).toMatchObject({status:'applied',outcome:'publication_pending'});expect(timed.getAction('timed-original')?.runCount).toBe(1);}}
      const business=createLoopBusinessPublicationHost({store:reopened,assertAdmission(){},now:()=>100001}),closeBusiness=own(()=>business.close());
      const stageWorkflow=createLoopNativeWorkflow({store:reopened,assertAdmission(){},now:()=>20}),closeStageWorkflow=own(()=>stageWorkflow.close());
      const stageHost=createLoopVerificationSessionHost({...options,store:reopened}),closeStageHost=own(()=>stageHost.close());
      const desktop=mode==='desktop-service'?createDesktopLoopPublicationService({...options,store:reopened,captureAdmission:()=>()=>{},taskPort:{async recoverTask(){return undefined;}}}):undefined;
      const closeDesktop=own(()=>desktop?.close());
      const handlers=new Map<string,Function>();if(desktop)registerLoopPublicationIpc({handle:(name,fn)=>{handlers.set(name,fn);}},desktop,()=>true);
      const action=(input:any)=>handlers.get('desktop:loops:performPublicationAction')!({},input);
      let projectionFailure:{error:unknown}|undefined;
      try{
        await expect(business.project({runId:began.run.id,requestSource:'scheduler'})).rejects.toThrow('loop_projection_not_published');
        const scan=reopened.listLoopPublicationCandidates(began.run.id).find(c=>c.stageId===stage.id)!;
        let projected:{generation?:number};
        if(desktop){
          const nativeResult=await action({kind:'reserveNative',candidateId:scan.candidateId,expectedLatestAttemptId:null});
          await action({kind:'advanceNative',attemptId:nativeResult.recordId});
          const sessionResult=await action({kind:'prepareSession',nativeAttemptId:nativeResult.recordId,obligationId:'scan-original'});
          await action({kind:'enrollSession',id:sessionResult.recordId});
          await action({kind:'verify',id:sessionResult.recordId,exactCommand:input.exactCommand,expiresAt:input.expiresAt});
          await action({kind:'publish',nativeAttemptId:nativeResult.recordId,expectedLatestAttemptId:null});
          mark('stage-publication-ready');projected=await action({kind:'project',runId:began.run.id});mark('business-projected');
          expect((await action({kind:'inspect',runId:began.run.id})).inspection.runId).toBe(began.run.id);
          expect(desktop.getState(began.run.id).historyOnly).toBe(true);mark('desktop-inspection-complete');
        }else{
          const stageNative=stageWorkflow.reserve({candidateId:scan.candidateId,expectedLatestAttemptId:null,requestSource:'user'});
          await stageWorkflow.advance({attemptId:stageNative.attemptId,requestSource:'user'});
          const stageSession=await stageHost.prepare({nativeAttemptId:stageNative.attemptId,obligationId:'scan-original',requestSource:'user'});
          await stageHost.enroll({id:stageSession.id,requestSource:'user'});
          await stageHost.verify({...input,id:stageSession.id});
          await publicationWorkflow.start({nativeAttemptId:stageNative.attemptId,expectedLatestAttemptId:null,requestSource:'user'});
          mark('stage-publication-ready');projected=await business.project({runId:began.run.id,requestSource:'scheduler'});mark('business-projected');
        }
        expect(projected.generation).toBe(1);expect(reopened.getLoopRun(began.run.id)?.status).toBe('success');expect(reopened.listLoopStages(began.run.id)[0].status).toBe('success');
        expect(receiver.approvals).toBe(2);expect(dispatches).toBe(2);
        if(timed&&timedHost){
          if(mode==='timed-expired')f.setTime(10000);
          expect(await timedHost.finalize(timedInput)).toMatchObject({status:'applied',outcome:mode==='timed-expired'?'publication_pending':'success'});
          expect(timed.getAction('timed-original')).toMatchObject({runCount:1,status:mode==='timed-expired'?'paused':'completed'});
          expect(timed.getLoopTimedReceipt(timedRunId!)?.revision).toBe(mode==='timed-pending'?2:1);
        }
        const viewTimed=new TimedActionStore(join(f.root,'view-timed.sqlite')),closeViewTimed=own(()=>viewTimed.close());
        const views=createLoopCurrentViews({loopStore:reopened,timedStore:viewTimed,gate:new DesktopShutdownGate(),captureAdmission:()=>()=>{},now:()=>100002}),closeViews=own(()=>views.close());
        if(mode!=='timed-expired')expect((await views.getLoopRuns(loopId))[0]).toMatchObject({businessState:'success',completionObservation:{state:'verified_at_read'}});
        mark('fresh-view-branch-complete');
        const dedupeEvidence=new CompletionEvidenceStore(join(f.root,'dedupe.sqlite')),closeDedupeEvidence=own(()=>dedupeEvidence.close()),scanAgain=vi.fn(()=>{throw Error('must not rerun original scanner');}),runner=createLoopRunner({loopStore:reopened,evidenceStore:dedupeEvidence,scanner:{scan:scanAgain},now:()=>100001});
        let viewFailure:{error:unknown}|undefined;
        try{
          if(mode!=='timed-expired')expect(await runner.runLoopNow(loopId,{kind:'manual',logicalRunKey:'actual-controller-occurrence'},undefined,{requestSource:'scheduler'})).toEqual({status:'already_completed',completedRunId:began.run.id});
          mark('dedupe-current-branch-complete');f.setTime(10000);
          expect((await runner.runLoopNow(loopId,{kind:'manual',logicalRunKey:'actual-controller-occurrence'},undefined,{requestSource:'scheduler'})).status).toBe('publication_pending');
          expect((await views.getLoopRuns(loopId))[0]).toMatchObject({businessState:'publication_pending',completionObservation:{state:'needs_revalidation'}});
          expect(scanAgain).not.toHaveBeenCalled();expect(receiver.approvals).toBe(2);expect(dispatches).toBe(2);mark('expired-runner-view-refusals-complete');
        }catch(error){viewFailure={error};throw error;}finally{await closeLoopResources([closeViews,closeViewTimed,closeDedupeEvidence],viewFailure);}
        f.setTime(10000);if(desktop)await expect(action({kind:'inspect',runId:began.run.id})).rejects.toThrow();else await expect(business.project({runId:began.run.id,requestSource:'scheduler'})).rejects.toThrow();
        expect(reopened.getLoopBusinessProjection(began.run.id)?.generation).toBe(1);expect(dispatches).toBe(2);
      }catch(error){projectionFailure={error};throw error;}finally{await closeLoopResources([closeDesktop,closeBusiness,closeStageHost,closeStageWorkflow],projectionFailure);}
    }

    mark('scenario-body-complete');
  }catch(error){bodyFailure={error};throw error;}
  finally{
    // The actual host/server/fixture work must drain while this case still owns
    // the shared clock/profile mocks, even when an independent close rejects.
    await closeLoopResources([...closes,...restores],bodyFailure);mark('scenario-finally-complete');
  }
}
function runActualLoopControllerScenario(mode:typeof scenarios[number],ctx:TestContext){
  const scenario=actualLoopControllerScenario(mode,ctx.signal);
  const settledOutcome=scenario.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
  ctx.onTestFinished(async()=>{
    const outcome=await settledOutcome;
    if(ctx.signal.aborted&&outcome.failed&&outcome.error!==ctx.signal.reason)throw outcome.error;
  });
  return scenario;
}
// Fixed CI execution windows retain every original fresh read and assertion.
// Single/full/output chains use 45s/180s/450s runner bounds. Product/SDK expiry
// and the independent 10s finished hook stay unchanged; no performance claim.
for(const mode of scenarios)
  it.for([mode])('executes and recovers the original Loop verification through the signed controller: %s',
    {timeout:mode==='terminal'||mode==='lost-dispatch'||mode==='publication-lost-ack'?45000:mode==='output-consumer'?450000:180000},runActualLoopControllerScenario);
