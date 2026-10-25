import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createObservationSessionOwner, bindObservationPublicationBarrier, bindCompoundObservationPublisher, createObservationReadTool, describeObservationSource } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
import { createFullSendCounter } from '../../../src/runtime/sol-pi/full-send-counter.js';
import { buildStrictSemanticSnapshot, readSemanticSnapshotCandidate } from '../../../src/runtime/sol-pi/semantic-snapshot.js';

describe('single-authority observation session owner through actual tools and store', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
  function fixture(authorized = true, failPersistence = false, policyId = 'p', capacityReady = true, withCounter = false) {
    const root = mkdtempSync(join(tmpdir(), 'solpi-owner-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'log.txt'); writeFileSync(file, 'x'.repeat(10000) + '\nAUTHORIZED_TAIL');
    const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'owner-session', cwd: root });
    const service = createObservationService({ profileRoot: join(root, 'profile'), profileId: 'p', reservedProfileBytes:withCounter?4*1024*1024:0, redactor: { version: 'test', redact: text => text } });
    cleanup.push(() => service.dispose());
    const claims = { sessionId: 'owner-session', ownerAgentId: 'a', scopeId: 's', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const caller = service.bindCaller({ ...claims, requestSource: 'agent' }); const user = service.bindCaller({ ...claims, requestSource: 'user' });
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/v1/chat/completions' };
    if (authorized) service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: policyId, revision: 1, scopeId: 's',
      sourceAdapterId: 'native.read.v1', sourceDescriptors: [describeObservationSource({ toolName: 'read', source: { filePath: file, offset: 1 } })],
      expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
    const store = new FileSessionStore(join(root, 'sessions'));
    const persist = vi.fn(async snapshot => { if (failPersistence) throw new Error('disk failure'); await store.save(snapshot); });
    const counter = withCounter ? createFullSendCounter({root:join(root,'profile','counters','session'),sessionId:'owner-session'}) : undefined;
    if(counter)cleanup.push(()=>counter.dispose());
    const ownerOptions = { service, caller, session, destination, persist, fullSendCounter:counter, capacityProfile: capacityReady ? testOnlyCapacity(destination.url, destination.model) : undefined };
    const owner = createObservationSessionOwner(ownerOptions); cleanup.push(() => owner.dispose());
    const registry = new ToolRegistry({ autoMode: true }, [createReadTool({ cwd: root }), createObservationReadTool(owner)]); cleanup.push(() => registry.dispose());
    async function runRead() {
      const context = { ...mcpTestContext(new AbortController().signal), observationCollector: owner.collectorFor('read-1') };
      const legacy = await registry.executeTool('read', { file_path: file, max_chars: 80 }, context);
      return owner.projectToolResult('read-1', legacy);
    }
    return { root, file, session, service, caller, user, owner, ownerOptions, registry, store, destination, persist, runRead, counter };
  }
  it('awaits a fixed host publication barrier after durable canonical save and before returning text', async () => {
    const f=fixture(); let release!:()=>void, entered!:()=>void;
    const reached=new Promise<void>(resolve=>{entered=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const barrier=vi.fn(async facts=>{
      expect(facts.sessionId).toBe('owner-session');
      expect((await f.store.load(facts.sessionId))!.protectedObservationClosure).toEqual(facts.closure);
      expect(Object.keys(facts).sort()).toEqual(['closure','sessionId']);
      entered(); await gate;
    });
    bindObservationPublicationBarrier(f.owner,barrier);
    expect(()=>bindObservationPublicationBarrier(f.owner,barrier)).toThrow();
    expect(()=>bindObservationPublicationBarrier({} as any,barrier)).toThrow();
    let returned=false;const pending=f.runRead().then(value=>{returned=true;return value;});
    await reached;expect(returned).toBe(false);release();
    expect(await pending).toContain('[observation ');expect(barrier).toHaveBeenCalledTimes(1);
  });
  it('failed host publication permanently prevents disclosure while retaining actual native facts and durable closure', async () => {
    const f=fixture();bindObservationPublicationBarrier(f.owner,async()=>{throw Error('alias journal failed');});
    expect(await f.runRead()).toContain('observation unavailable');
    expect(f.session.getProtectedObservationClosure()!.observations).toHaveLength(1);
    expect((await f.store.load('owner-session'))!.protectedObservationClosure).toEqual(f.session.getProtectedObservationClosure());
    expect(()=>f.owner.prepareProviderDisclosure()).toThrow(/AUTHORIZATION_UNAVAILABLE/);
  });
  it('refuses installing a publication barrier after text has already been published', async () => {
    const f=fixture();await f.runRead();expect(()=>bindObservationPublicationBarrier(f.owner,async()=>{})).toThrow();
  });
  it('actual registry privately publishes native archive under the existing lease without opening a sibling writer window',async()=>{
    const f=fixture();const root=join(f.root,'sessions'),sessionIdentity=f.session.exportSnapshot().sessionId;
    await f.store.save(f.session.exportSnapshot());
    const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
    cleanup.push(()=>authority.dispose());
    const unsubscribe=f.store.onCommit(snapshot=>{if(snapshot.sessionId===sessionIdentity)f.session.updatePersistenceFacts(snapshot);});cleanup.push(unsubscribe);
    const barrier=vi.fn(async facts=>{
      expect((await f.store.load(sessionIdentity))!.protectedObservationClosure).toEqual(facts.closure);
      const alias={...new AgentSessionState().exportSnapshot(),sessionId:'alias-session',protectedObservationClosure:facts.closure};
      await f.store.save(alias);
    });
    bindObservationPublicationBarrier(f.owner,barrier);
    const issue=bindCompoundObservationPublisher({owner:f.owner,store:f.store,root});
    let duplicateProject!:(native:string)=>Promise<string>,siblingAcquired=false;
    let sibling:Promise<void>|undefined;
    const ordinaryProjection=vi.fn(async()=>{throw Error('ordinary projection must not run');});
    const registry=new ToolRegistry({autoMode:true,compoundExecution:{execute:async request=>{
      const prepared=await request.native.prepare(request.name,{...request.input});if(prepared.kind!=='prepared')throw Error(prepared.message);
      const lease=await authority.acquire({invocationId:'real-effect',kind:'direct-mutation'});
      try{
        sibling=authority.acquire({invocationId:'next-effect',kind:'direct-mutation'}).then(async next=>{siblingAcquired=true;await next.releaseAfterDrain();});
        duplicateProject=issue('scoped-read',lease);
        const result=await request.native.execute(prepared.invocation,duplicateProject);
        expect(siblingAcquired).toBe(false);
        const durable=(await f.store.load(sessionIdentity))!;
        expect(durable.protectedObservationClosure).toEqual(f.session.getProtectedObservationClosure());
        await expect(f.store.save(durable)).rejects.toThrow(/locked/);
        return result;
      }finally{await lease.releaseAfterDrain();}
    }}},[createReadTool({cwd:f.root})]);cleanup.push(()=>registry.dispose());
    const result=await registry.executeTool('read',{file_path:f.file,max_chars:80},{...mcpTestContext(new AbortController().signal),
      observationCollector:f.owner.collectorFor('scoped-read'),projectObservationResult:ordinaryProjection});
    expect(result).toContain('[observation ');expect(result).not.toContain('unavailable');expect(ordinaryProjection).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();expect(barrier).toHaveBeenCalledTimes(1);await sibling;expect(siblingAcquired).toBe(true);
    await expect(duplicateProject('replay')).rejects.toThrow('compound_publication_consumed');
  });
  it('same-lease publication CAS failure closes owner before any next provider preparation',async()=>{
    const f=fixture();const root=join(f.root,'sessions'),sessionIdentity=f.session.exportSnapshot().sessionId;
    await f.store.save(f.session.exportSnapshot());
    const authority=createSessionExecutionAuthority({root,sessionIdentity,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());
    const native=await f.registry.executeTool('read',{file_path:f.file,max_chars:80},{...mcpTestContext(new AbortController().signal),observationCollector:f.owner.collectorFor('failed-publication')});
    const lease=await authority.acquire({invocationId:'failure',kind:'direct-mutation'});
    try{
      const projector=bindCompoundObservationPublisher({owner:f.owner,store:f.store,root})('failed-publication',lease);
      vi.spyOn(f.store,'compareAndSave').mockRejectedValueOnce(Error('disk durability failed'));
      expect(await projector(native)).toContain('observation unavailable');
      expect((await f.store.load(sessionIdentity))!.protectedObservationClosure).toBeUndefined();
      await expect(f.owner.prepareRequest({logicalInvocationId:'next-sdk',messages:[],tools:[],systemPrompt:''})).rejects.toThrow();
      await expect(projector(native)).rejects.toThrow('compound_publication_consumed');
    }finally{await lease.releaseAfterDrain();}
  });
  it('semantic anchors preserve unknown facts and policy suffix, replacing only confirmed native archive views',async()=>{
    const f=fixture(true,false,'p',true,true);
    const id='semantic-read';
    const content=await f.registry.executeTool('read',{file_path:f.file,max_chars:80},{...mcpTestContext(new AbortController().signal),observationCollector:f.owner.collectorFor(id),projectObservationResult:value=>f.owner.projectToolResult(id,value),observationProvenance:()=>f.owner.getResultProvenance(id)});
    f.owner.finalizeToolResult(id,content);
    const messages:any[]=[{role:'user',content:[{type:'text',text:'Keep the exact goal and permissions.'}]},{role:'assistant',content:[{type:'tool_use',id,name:'read',input:{file_path:f.file}}]},{role:'user',content:[{type:'tool_result',tool_use_id:id,content},{type:'text',text:'correction'}]},{role:'assistant',content:[{type:'text',text:'Unstructured pending issue: preserve verbatim.'}]}];
    expect(f.owner.prepareSemanticAnchors(messages)).toEqual(messages);
    const observationId=f.session.getProtectedObservationClosure()!.observations[0].observationId;
    for(let i=0;i<2;i++){const attempt={logicalInvocationId:`sent-${i}`,serializedBody:'{}',observationIds:[observationId]};f.counter!.prepare(attempt);f.counter!.confirm(attempt);}
    const anchors=f.owner.prepareSemanticAnchors(messages);
    expect(anchors[0]).toEqual(messages[0]);expect(anchors[1]).toEqual(messages[1]);expect(anchors[3]).toEqual(messages[3]);
    expect(anchors[2].content[1]).toEqual(messages[2].content[1]);
    expect((anchors[2].content[0] as any).content).toContain(`[observation_read id=${observationId}]`);
    expect((anchors[2].content[0] as any).content).not.toContain('xxxxxxxx');
    f.session.replaceMessages(messages);
    const sourceSnapshot=f.session.exportSnapshot(),plan=f.session.planCompaction(0);
    const result=buildStrictSemanticSnapshot({sourceSnapshot,plan,summaryText:'Derived short summary.',observationOwner:f.owner,measureInputTokens:items=>Buffer.byteLength(JSON.stringify(items))});
    expect(result.status).toBe('compacted');
    if(result.status==='compacted'){
      expect(result.snapshot.messages.slice(0,-1)).toEqual(anchors);
      expect(result.snapshot.protectedObservationClosure).toEqual(sourceSnapshot.protectedObservationClosure);
      expect(result.snapshot.messages.at(-1)!.role).toBe('assistant');
      expect(result.anchorDigest).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(buildStrictSemanticSnapshot({sourceSnapshot,plan,summaryText:'x'.repeat(60000),observationOwner:f.owner,measureInputTokens:items=>Buffer.byteLength(JSON.stringify(items))}).status).toBe('no_gain');
    expect(f.session.exportSnapshot()).toEqual(sourceSnapshot);
    f.service.revokeCaller({requestSource:'user',caller:f.user,target:f.caller});
    expect(()=>f.owner.prepareSemanticAnchors(messages)).toThrow();
    if(result.status==='compacted')expect(()=>readSemanticSnapshotCandidate(result)).toThrow();
  });
  it('stops new archives and P1-B but keeps existing live recall and sticky closure', async () => {
    const f = fixture(); await f.runRead();
    const closure = f.session.getProtectedObservationClosure()!;
    f.owner.stopNewCapture(); expect(f.owner.getMode()).toBe('recall-only');
    const begin = vi.spyOn(f.service, 'begin');
    const legacy = await f.registry.executeTool('read', { file_path: f.file, max_chars: 80 }, {
      ...mcpTestContext(new AbortController().signal), observationCollector: f.owner.collectorFor('after-stop'),
      projectObservationResult: value => f.owner.projectToolResult('after-stop', value),
    });
    expect(begin).not.toHaveBeenCalled(); expect(legacy).toContain('xxxx'); expect(legacy).not.toContain('observation unavailable');
    const prepared = await f.owner.prepareRequest({ logicalInvocationId: 'stopped', messages: [], tools: f.registry.getToolDefinitions(), systemPrompt: '' });
    expect(prepared.projectionStatus).toBe('skipped'); expect(prepared.providerDisclosure).toBeDefined();
    expect(f.owner.getProjectionDiagnostics().reasons.recall_only).toBe(1);
    expect(await f.owner.read(closure.observations[0].observationId, 9500, 1024)).toContain('AUTHORIZED_TAIL');
    expect(f.session.getProtectedObservationClosure()).toEqual(closure); expect(f.owner.hasDependencies()).toBe(true);
  });
  it('rejects a service terminal revision in the live owner without poisoning ordinary session saves', async () => {
    const f = fixture(); await f.runRead();
    const previous = f.session.getProtectedObservationClosure()!.observations[0];
    const revised = f.service.reviseTerminal({ requestSource: 'agent', caller: f.caller, id: previous.observationId, outcome: 'error' });
    expect(revised.revision).toBeGreaterThan(previous.revision);
    const persisted = f.persist.mock.calls.length;
    await expect(f.owner.read(previous.observationId, 0, 64)).rejects.toThrow('SOL_PI_OBSERVATION_REVISION_CHANGED');
    expect(f.persist).toHaveBeenCalledTimes(persisted);
    await expect(f.store.save(f.session.exportSnapshot())).resolves.not.toThrow();
    await expect(f.store.save(f.session.exportSnapshot())).resolves.not.toThrow();
    expect(f.session.getProtectedObservationClosure()!.observations[0]).toEqual(previous);
  });
  it('records only live native finalization and invalidates it on in-place restore', async () => {
    const f = fixture();
    const context = { ...mcpTestContext(new AbortController().signal), observationCollector: f.owner.collectorFor('native-final'),
      projectObservationResult: (value: string) => f.owner.projectToolResult('native-final', value),
      observationProvenance: () => f.owner.getResultProvenance('native-final') };
    const result = await f.registry.executeTool('read', { file_path: f.file, max_chars: 80 }, context);
    expect(f.owner.getFinalizedToolResult('native-final')).toBeUndefined();
    expect(f.owner.finalizeToolResult('native-final', result)).toBeDefined();
    expect(f.owner.getFinalizedToolResult('native-final')).toBeDefined();
    expect(f.owner.getResultProvenance('recall-id')).toBeUndefined();
    f.session.restoreSnapshot(f.session.exportSnapshot());
    expect(f.owner.getFinalizedToolResult('native-final')).toBeUndefined();
  });
  it('capacity metadata and denied capture do not create projection provenance', async () => {
    for (const f of [fixture(false), fixture(true, false, 'p', false)]) {
      await f.runRead(); expect(f.owner.getResultProvenance('read-1')).toBeUndefined();
      expect(f.owner.finalizeToolResult('read-1', 'metadata')).toBeUndefined();
    }
  });
  it('unknown capacity publishes metadata only and never adds protected text/closure', async () => {
    const f = fixture(true, false, 'p', false); const result = await f.runRead();
    expect(result).toContain('capacity_not_ready'); expect(result).toContain('outcome=success');
    expect(result).not.toContain('xxxx'); expect(f.session.getProtectedObservationClosure()).toBeUndefined();
    expect(f.persist).not.toHaveBeenCalled(); expect(f.owner.prepareProviderDisclosure()).toBeUndefined();
  });
  it('losing capacity after disclosure does not erase the sticky closure or permit another request', async () => {
    const f = fixture(); await f.runRead(); const closure = f.session.getProtectedObservationClosure();
    f.ownerOptions.capacityProfile = undefined;
    expect(() => f.owner.prepareProviderDisclosure()).toThrow(/CAPACITY/);
    expect(f.session.getProtectedObservationClosure()).toEqual(closure); expect(f.owner.hasDependencies()).toBe(true);
  });
  it('persists sticky identity before publishing preview and recalls real pre-cap tail', async () => {
    const f = fixture(); const preview = await f.runRead();
    expect(preview).toContain('observation'); expect(preview).not.toContain('AUTHORIZED_TAIL');
    expect(f.persist).toHaveBeenCalledOnce();
    const closure = f.session.getProtectedObservationClosure()!;
    expect(JSON.parse(readFileSync(join(f.root, 'sessions', 'owner-session.json'), 'utf8')).protectedObservationClosure).toEqual(closure);
    const id = closure.observations[0].observationId;
    const page = await f.registry.executeTool('observation_read', { id, offset: 9500, maxBytes: 1024 });
    expect(page).toContain('AUTHORIZED_TAIL'); expect(f.owner.hasDependencies()).toBe(true);
  });
  it('default deny cannot reveal raw legacy output or issue disclosure capability', async () => {
    const f = fixture(false); const result = await f.runRead();
    expect(result).not.toContain('xxxx'); expect(result).toContain('unavailable');
    expect(f.persist).not.toHaveBeenCalled(); expect(f.owner.prepareProviderDisclosure()).toBeUndefined();
  });
  it.each(['begin', 'finalize'] as const)('keeps native failure facts when archive %s fails', async method => {
    const f = fixture();
    vi.spyOn(f.service, method).mockImplementation(() => { throw new Error('private archive failure'); });
    const legacy = await bashTool.execute({ command: 'printf PRIVATE_BODY; exit 2', workdir: f.root }, {
      ...mcpTestContext(new AbortController().signal), observationCollector: f.owner.collectorFor('failed-bash'),
    });
    const result = await f.owner.projectToolResult('failed-bash', legacy);
    expect(result).toMatch(/^Error: /); expect(result).toContain('execution=terminal'); expect(result).toContain('outcome=error');
    expect(result).not.toContain('PRIVATE_BODY'); expect(result).not.toContain('private archive failure');
    expect(f.owner.prepareProviderDisclosure()).toBeUndefined();
  });
  it('a failed durable barrier never publishes the newly authorized text', async () => {
    const f = fixture(true, true); const result = await f.runRead();
    expect(result).not.toContain('xxxx'); expect(result).toContain('unavailable');
    expect(() => f.owner.prepareProviderDisclosure()).toThrow();
  });
  it('read then clear rejects the actual fetch even after a context was prepared', async () => {
    const f = fixture(); await f.runRead(); const context = f.owner.prepareProviderDisclosure()!;
    const id = f.session.getProtectedObservationClosure()!.observations[0].observationId;
    f.service.clear({ requestSource: 'user', caller: f.user, id });
    const raw = vi.fn(async () => new Response('ok'));
    await expect(createProviderDisclosureFetch(context, raw)(f.destination.url, { method: 'POST', body: JSON.stringify({ model: 'model', content: 'protected' }) })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
  });
  it('same-object restore and another owner cannot resume the protected history', async () => {
    const f = fixture(); await f.runRead();
    f.owner.assertSession(f.session);
    f.session.restoreSnapshot(f.session.exportSnapshot());
    expect(() => f.owner.assertSession(f.session)).toThrow(/RESTORE|REAUTH/);
    expect(() => createObservationSessionOwner({ service: f.service, caller: f.caller, session: f.session, destination: f.destination, persist: f.persist })).toThrow(/RESTORE|REAUTH/);
  });
  it('rejects a duplicate invocation before another native tool can execute', async () => {
    const f = fixture(); await f.runRead();
    expect(() => f.owner.collectorFor('read-1')).toThrow(/DUPLICATE/);
  });
  it('a graph metadata rejection cannot make a second disclosure skip durability', async () => {
    const f = fixture(true, false, 'policy\ninvalid-for-session');
    expect(await f.runRead()).not.toContain('xxxx');
    expect(await f.owner.projectToolResult('read-1', 'legacy')).not.toContain('xxxx');
    expect(f.persist).not.toHaveBeenCalled();
    expect(() => f.owner.prepareProviderDisclosure()).toThrow();
  });
  it('a prepared context cannot omit a subsequently published observation', async () => {
    const f = fixture(); await f.runRead(); const previous = f.owner.prepareProviderDisclosure()!;
    const context = { ...mcpTestContext(new AbortController().signal), observationCollector: f.owner.collectorFor('read-2') };
    const legacy = await f.registry.executeTool('read', { file_path: f.file, max_chars: 80 }, context);
    await f.owner.projectToolResult('read-2', legacy);
    expect(f.owner.ownsDisclosure(previous)).toBe(false);
    const raw = vi.fn(async () => new Response('ok'));
    await expect(createProviderDisclosureFetch(previous, raw)(f.destination.url, { method: 'POST', body: JSON.stringify({ model: 'model', content: 'A and B' }) })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
  });
  it('projects native body before observers while preserving independently sourced hook policy text', async () => {
    const f = fixture(false); const observed = vi.fn();
    const registry = new ToolRegistry({ autoMode: true, onToolObserved: observed, hooksRunner: {
      runHooks: async () => ({ ok: true }), runPreHooks: async () => ({ ok: true, additionalContext: 'POLICY_STOP_PUBLICATION' }),
      runPostHooks: async () => ['POST_POLICY_WARNING'],
    } as never }, [createReadTool({ cwd: f.root })]); cleanup.push(() => registry.dispose());
    const result = await registry.executeTool('read', { file_path: f.file, max_chars: 80 }, {
      ...mcpTestContext(new AbortController().signal), observationCollector: f.owner.collectorFor('hook-read'),
      projectObservationResult: (result: string) => f.owner.projectToolResult('hook-read', result),
    });
    expect(result).toContain('POLICY_STOP_PUBLICATION'); expect(result).toContain('POST_POLICY_WARNING');
    expect(result).not.toContain('xxxx');
    expect(JSON.stringify(observed.mock.calls)).not.toContain('xxxx');
  });
});
