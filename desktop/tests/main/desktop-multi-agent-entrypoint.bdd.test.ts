// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import {registerDesktopIpc} from '../../electron/ipc.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import type { Message } from '../../../src/types.js';
import * as kbStoreModule from '../../electron/kb-store-sqlite.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// Source-mode tests only: use the real fixed compiled Worker without adding a
// production TypeScript fallback or replacing native messages/exit semantics.
const pathExpansion=vi.hoisted(()=>({path:'',wait:undefined as undefined|(()=>Promise<void>)}));
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,stat:async(...args:Parameters<typeof actual.stat>)=>{const result=await actual.stat(...args);if(String(args[0])===pathExpansion.path)await pathExpansion.wait?.();return result;}};});
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/queue-permission-ipc-fixture'},BrowserWindow:{getAllWindows:()=>[],fromWebContents:()=>undefined},clipboard:{read:vi.fn()},dialog:{showOpenDialog:vi.fn()},shell:{openExternal:vi.fn(),openPath:vi.fn(),showItemInFolder:vi.fn()}}));
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

describe('BDD: actual createDesktopServices local task entrypoint', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); vi.unstubAllEnvs(); });
  function setup(runner?: Parameters<typeof createDesktopServices>[0]['runner']) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-entry-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    const createKbStore = kbStoreModule.createKbStoreSqlite;
    vi.spyOn(kbStoreModule, 'createKbStoreSqlite').mockImplementation(() => createKbStore(join(root, 'knowledge.sqlite')));
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }) } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), kswarmService, runner, workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [] });
    cleanup.push(() => services.disposeMultiAgent());
    expect(kbStoreModule.createKbStoreSqlite).toHaveBeenCalledWith(join(root, 'knowledge.sqlite'));
    return { root, services };
  }

  it.each(['running', 'completed'] as const)('U2 Given report_progress with all steps %s, Then the existing Task surface receives the real progress event and completion guidance stays in model context', async status => {
    const { services } = setup(); await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    let calls = 0; let modelResult = '';
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages) {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++calls === 1) yield { type: 'tool_use', id: 'progress', name: 'report_progress', input: { steps: [{ id: 'verify', label: 'EXISTING_TASK_PANEL', status }] } };
      else {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === 'progress');
        if (result?.type === 'tool_result') modelResult = String(result.content);
        yield { type: 'text', delta: 'The progress report is displayed.' };
      }
    });
    const task = await services.createTask({ prompt: 'Report progress and reply briefly.', materials: [], context: { threadId: 'progress-thread' } });
    await vi.waitFor(async () => expect((await services.recoverTask(task.taskId)).snapshot.status).toBe('completed'));
    const snapshot = (await services.recoverTask(task.taskId)).snapshot;
    expect(snapshot.events.filter(event => event.type === 'progress_plan_reported')).toEqual([
      expect.objectContaining({ type: 'progress_plan_reported', steps: [{ id: 'verify', label: 'EXISTING_TASK_PANEL', status }] }),
    ]);
    expect(modelResult).not.toContain('_validated');
    if (status === 'completed') expect(modelResult).toContain('确认是否所有要求的交付物都已生成');
    else expect(modelResult).not.toContain('所有步骤已标记完成');
  });

  it('A1/A18/A31 Given the default Desktop factory, When createTask requests delegation, Then the real default provider loop spawns a Desktop child, exchanges messages and exposes its main-owned snapshot', async () => {
    const { root, services } = setup(); await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    const initialBoundary = services.multiAgent!; await initialBoundary.ready;
    initialBoundary.service.registerThread({ threadId: 'thread', profileId: initialBoundary.profileId, workspaceId: initialBoundary.workspaceId, cwd: root });
    const initialAccess = initialBoundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: initialBoundary.profileId, workspaceId: initialBoundary.workspaceId });
    const groupChanges: unknown[] = [];
    const unsubscribe = initialBoundary.service.subscribe(initialAccess, event => { if (event.channel === 'group_changed') groupChanges.push(event); }); cleanup.push(unsubscribe);
    let rootTurns = 0; let childTurns = 0; let childId = '';
    const requests: Array<{ child: boolean; messages: Message[]; tools: string[]; system: string }> = [];
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (messages, definitions, system) {
      const child = system?.includes('Assigned Desktop agent:') ?? false;
      requests.push({ child, messages: structuredClone(messages), tools: definitions.map(tool => tool.name), system: system ?? '' });
      // Real K3 chunks carry provenance even for empty reasoning. The substitute
      // transport must preserve that contract, not bypass the production guard.
      yield { type: 'thinking', delta: 'ENTRY_PRIVATE', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (child) {
        if (++childTurns === 1) yield { type: 'tool_use', id: 'child-send', name: 'send_message', input: { target: 'main', message: 'ENTRY_CHILD_READY' } };
        else yield { type: 'text', delta: 'ENTRY_CHILD_DONE' };
      } else if (++rootTurns === 1) yield { type: 'tool_use', id: 'spawn', name: 'spawn_agent', input: { task_name: 'review', message: 'entry child', fork_context: true } };
      else if (rootTurns === 2) {
        const result = messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === 'spawn');
        if (result?.type !== 'tool_result') throw new Error('missing real spawn result');
        childId = JSON.parse(String(result.content)).targetAgentId;
        yield { type: 'tool_use', id: 'wait', name: 'wait_agent', input: { targets: [childId], timeout_ms: 1000 } };
      } else yield { type: 'text', delta: 'ENTRY_ROOT_DONE' };
    });
    const created = await services.createTask({ prompt: 'Delegate one bounded review and summarize it.', materials: [], context: { threadId: 'thread' } });
    await vi.waitFor(async () => {
      const snapshot = (await services.recoverTask(created.taskId)).snapshot;
      expect(snapshot.status, JSON.stringify(snapshot.salvage)).toBe('completed');
    });
    expect(childTurns).toBe(2); expect(childId).toBeTruthy();
    const boundary = services.multiAgent!; await boundary.ready;
    const access = boundary.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
    const snapshot = boundary.service.getSnapshot({ access });
    expect(snapshot.root).toMatchObject({ sourceTaskId: created.taskId, status: 'completed' });
    expect(snapshot.agents.find(agent => agent.id === childId)).toMatchObject({ status: 'completed', executionActive: false });
    expect(snapshot.group?.threadId).toBe('thread'); expect(boundary.cwd).toBe(root);
    expect(groupChanges).toEqual([expect.objectContaining({ threadId: 'thread', oldGroupId: null, newGroupId: snapshot.group!.groupId, threadRevision: snapshot.threadRevision })]);
    expect(JSON.stringify(requests.filter(request => !request.child).at(-1)?.messages)).toContain('ENTRY_CHILD_READY');
    expect(requests[0].tools).toContain('spawn_agent');
    for (const child of [false, true]) {
      const actualPrompt = requests.find(request => request.child === child)!.system;
      expect(actualPrompt).toContain('Desktop autonomous delegation');
      expect(actualPrompt).not.toContain('用户已经授权你使用所有工具');
      expect(actualPrompt).toContain('拒绝后不得改用其他工具');
      expect(actualPrompt).toContain('read_material');
      expect(actualPrompt).toContain('one cheap inventory');
      expect(actualPrompt).toContain('No interactive question transport is bound');
      expect(actualPrompt).toContain('An empty answer, cancellation or timeout is not approval');
      expect(actualPrompt).not.toContain('CLI autonomous delegation');
    }
    const toolSearch = await services.executeTool('tool_search', { query: 'select:spawn_agent,send_message,wait_agent' });
    expect(JSON.stringify(toolSearch)).not.toContain('"name":"spawn_agent"');
  });

  it('canonical stable input uses the real MA root reservation and does not create a second root on retry',async()=>{
    const {services}=setup();await services.saveModelConfig({providerId:'kimi',apiKey:'fixture'});
    const {service,actor}=services.continuity.port(),c=service.createConversation(actor,{operationId:'input-thread'});
    let requests=0;vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){requests++;yield {type:'thinking',delta:'',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};yield {type:'text',delta:'INPUT_ROOT_DONE'};});
    const input={inputId:'actual-ma-input',prompt:'Reply briefly.',materials:[],context:{threadId:c.id}},task=await services.createTask(input,{requestSource:'user',actorId:actor.actorId});
    await vi.waitFor(()=>expect(service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get(input.inputId)?.status).toBe('completed'));
    const before=requests,retry=await services.createTask(input,{requestSource:'user',actorId:actor.actorId});expect(retry.taskId).toBe(task.taskId);expect(requests).toBe(before);
    const row=service.store.db.prepare('SELECT task_id,source_epoch FROM conversation_inputs WHERE input_id=?').get(input.inputId),snapshot=(await services.recoverTask(task.taskId)).snapshot;
    expect(snapshot.sessionId).toBe(row?.source_epoch);expect(snapshot.multiAgentPreparation).toBeTruthy();expect(snapshot.inputPreparation?.inputId).toBe(input.inputId);expect(service.listMessages(actor,c.id).filter(m=>m.role==='user')).toHaveLength(1);
  });

  it('A41 Given an unknown injected TaskRunner, When the same local API starts it, Then it stays ordinary and never receives a multi-agent context or creates a group', async () => {
    const calls: number[] = [];
    const { services } = setup(async function (...args) {
      calls.push(args.length);
      await args[0].emitRuntimeEvent({ type: 'receipt_emitted', sessionId: args[0].sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', note: 'ordinary' });
    });
    const created = await services.createTask({ prompt: 'ordinary', materials: [], context: { threadId: 'thread' } });
    await vi.waitFor(async () => expect((await services.recoverTask(created.taskId)).snapshot.status).toBe('completed'));
    expect(calls).toEqual([1]); expect(services.multiAgent).toBeNull();
  });

  it('A7 Given a real stdio MCP connection, When its catalog changes or disconnects, Then the actual Desktop registry drops old tools and a stale catalog failure cannot erase its new generation', async () => {
    const { root, services } = setup(async () => {});
    const plugin = join(root, 'plugins', 'fixture'); mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', mcpServers: [{ name: 'fixture-server', type: 'stdio',
      // This fixture implements 2024 JSON-RPC, not the modern negotiation probe.
      command: process.execPath, protocol: { mode: 'legacy' }, args: [join(process.cwd(), '..', 'tests', 'support', 'mcp-stdio-server.js')], env: { XIAOK_TEST_MCP_MUTABLE_CATALOG: '1' } }] }));
    const bounded = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>;
      try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`MCP step stalled: ${label}`)), 1000); })]); }
      finally { clearTimeout(timer!); }
    };
    const registration = await bounded(services.registerMcpTools(), 'initial registration'); cleanup.push(() => registration.dispose());
    const names = () => services.getToolDefinitions().map(tool => tool.name);
    expect(names()).toContain('mcp__fixture-server__search');
    await bounded(services.executeTool('mcp__fixture-server__search', { q: '__race__' }), 'race invocation');
    await vi.waitFor(() => expect(names()).toContain('mcp__fixture-server__fresh'));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(names()).toContain('mcp__fixture-server__fresh'); expect(names()).not.toContain('mcp__fixture-server__search');
    await bounded(services.executeTool('mcp__fixture-server__fresh', { q: '__remove__' }), 'remove invocation');
    await vi.waitFor(() => expect(names()).not.toContain('mcp__fixture-server__fresh'));
    registration.dispose();
    const again = await bounded(services.registerMcpTools(), 'second registration'); cleanup.push(() => again.dispose());
    await bounded(services.executeTool('mcp__fixture-server__search', { q: '__disconnect__' }), 'disconnect invocation');
    await vi.waitFor(() => expect(names()).not.toContain('mcp__fixture-server__search'));
    expect(names()).toContain('read');
    expect(services.continuity.port().service.store.db.prepare("SELECT count(DISTINCT task_id) AS n FROM unproven_effects WHERE task_id LIKE 'task_manual_tool_%'").get()!.n).toBe(3);
  });
  it('freezes enqueue permission before actual file import and never revives it after revoke and regrant',async()=>{
    const {root,services}=setup();await services.saveModelConfig({providerId:'kimi',apiKey:'fixture'});const boundary=services.multiAgent!;await boundary.ready;const p=services.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'fresh-no-group'}),actor={requestSource:'user' as const,actorId:p.actor.actorId};
    const access=boundary.service.createWorkspaceUserAccess({...actor,profileId:boundary.profileId,workspaceId:boundary.workspaceId});
    const change=async(executionAllowed:boolean)=>{const current=boundary.service.getExecutionAuthorization();return boundary.service.setExecutionAuthorization({access,requestSource:'user',operationId:`exec-auth:${current.bootId}:${current.permissionRevision}:queue-test-${executionAllowed}`,expectedPermissionRevision:current.permissionRevision,executionAllowed,confirm:true});};
    const path=join(root,'input.txt');writeFileSync(path,'real copied source');let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),original=MaterialRegistry.prototype.importMaterial;let held=false;const hook=vi.spyOn(MaterialRegistry.prototype,'importMaterial').mockImplementation(async function(input){const record=await original.call(this,input);if(!held){held=true;entered();await gate;}return record;});let requests=0;vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){requests++;yield {type:'thinking',delta:'',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};yield {type:'text',delta:'answer'};});
    try{const enqueue=services.inputQueue!.enqueue({inputId:'old-permission',conversationId:c.id,prompt:'old work',filePaths:[path]},actor);await ready;await change(false);await change(true);release();const accepted=await enqueue;expect(accepted.accepted).toBe(true);await vi.waitFor(()=>expect((services.inputQueue as any).drains.size).toBe(0));expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('old-permission')?.status).toBe('pending');expect(requests).toBe(0);expect((await services.inputQueue!.list({conversationId:c.id},actor)).pauseReason).toBe('execution_authorization_changed');await services.inputQueue!.cancel({conversationId:c.id,inputId:'old-permission'},actor);await services.inputQueue!.enqueue({inputId:'new-permission',conversationId:c.id,prompt:'new work'},actor);await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('new-permission')?.status).toBe('completed'));expect(requests).toBeGreaterThan(0);}finally{release();hook.mockRestore();}
  });

  it.each(['enqueue','createTaskWithFiles'] as const)('freezes the actual %s IPC permission before directory expansion awaits',async mode=>{
    const {root,services}=setup();const boundary=services.multiAgent!;await boundary.ready;const p=services.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'ipc-fresh'}),actor={requestSource:'user' as const,actorId:p.actor.actorId},access=boundary.service.createWorkspaceUserAccess({...actor,profileId:boundary.profileId,workspaceId:boundary.workspaceId});
    const handlers=new Map<string,any>();await registerDesktopIpc({handle:(name:string,handler:any)=>handlers.set(name,handler)} as never,{once:vi.fn(),isDestroyed:()=>false,webContents:{id:1,send:vi.fn()}} as never,services,{multiAgentAuthorize:()=>({actorId:actor.actorId})});
    const path=join(root,'ipc-input.txt');writeFileSync(path,'source');let entered!:()=>void,release!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);pathExpansion.path=path;pathExpansion.wait=async()=>{entered();await gate;};
    const invoke=handlers.get(mode==='enqueue'?'desktop:inputs:enqueue':'desktop:createTaskWithFiles')({sender:{id:1,isDestroyed:()=>false}},{inputId:'ipc-old',prompt:'old IPC work',filePaths:[path],...(mode==='enqueue'?{conversationId:c.id}:{context:{threadId:c.id}})});const outcome=Promise.resolve(invoke).then(value=>({value}),error=>({error}));try{await ready;for(const executionAllowed of [false,true]){const current=boundary.service.getExecutionAuthorization();await boundary.service.setExecutionAuthorization({access,requestSource:'user',operationId:`exec-auth:${current.bootId}:${current.permissionRevision}:ipc-${mode}-${executionAllowed}`,expectedPermissionRevision:current.permissionRevision,executionAllowed,confirm:true});}release();const result=await outcome;if(mode==='enqueue')expect(result).toMatchObject({value:{accepted:true}});else expect(String((result as any).error)).toContain('input_execution_authority_changed');await vi.waitFor(()=>expect((services.inputQueue as any).drains.size).toBe(0));expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('ipc-old')?.status).toBe('pending');const view=await services.inputQueue!.list({conversationId:c.id},actor);expect(view.pauseReason).toBe('execution_authorization_changed');await services.inputQueue!.cancel({conversationId:c.id,inputId:'ipc-old'},actor);}finally{release();pathExpansion.path='';pathExpansion.wait=undefined;await outcome;}
  });

  it('rejects an old queue diagnostic view after actual workspace permission changes at egress',async()=>{
    const {services}=setup();await services.saveModelConfig({providerId:'kimi',apiKey:'fixture'});const boundary=services.multiAgent!;await boundary.ready;const p=services.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'view-permission'}),actor={requestSource:'user' as const,actorId:p.actor.actorId};let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){entered();await gate;yield {type:'thinking',delta:'',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};yield {type:'text',delta:'answer'};});try{await services.createTask({inputId:'held',prompt:'hold current SDK work',materials:[],context:{threadId:c.id}},actor);await ready;await services.inputQueue!.enqueue({inputId:'future',conversationId:c.id,prompt:'pending work'},actor);const view=await services.inputQueue!.list({conversationId:c.id},actor);expect(view.pauseReason).toBeNull();const access=boundary.service.createWorkspaceUserAccess({...actor,profileId:boundary.profileId,workspaceId:boundary.workspaceId}),current=boundary.service.getExecutionAuthorization();await boundary.service.setExecutionAuthorization({access,requestSource:'user',operationId:`exec-auth:${current.bootId}:${current.permissionRevision}:view-revoke`,expectedPermissionRevision:current.permissionRevision,executionAllowed:false,confirm:true});expect(()=>services.inputQueue!.assertReply(view,actor)).toThrow('input_queue_changed');expect((await services.inputQueue!.list({conversationId:c.id},actor)).pauseReason).toBe('execution_authorization_changed');await services.inputQueue!.cancel({conversationId:c.id,inputId:'future'},actor);}finally{release();await vi.waitFor(()=>expect((services.inputQueue as any).drains.size).toBe(0));}
  });

  it.each([false,true])('actual MA original cleanup determines never-started disposition when compensation failure is %s',async compensationFailure=>{
    const {services}=setup();await services.saveModelConfig({providerId:'kimi',apiKey:'fixture'});await services.multiAgent!.ready;const p=services.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'ma-failed-prepare'}),actor={requestSource:'user' as const,actorId:p.actor.actorId};const read=(InProcessTaskRuntimeHost.prototype as any).resolveContextHistory;let failed=false;vi.spyOn(InProcessTaskRuntimeHost.prototype as any,'resolveContextHistory').mockImplementation(async function(this:any,...args:any[]){if(!failed){failed=true;throw new Error('actual root history preflight failed');}return read.apply(this,args);});const put=DesktopMultiAgentStore.prototype.putRootBinding;const fault=compensationFailure?vi.spyOn(DesktopMultiAgentStore.prototype,'putRootBinding').mockImplementation(function(binding,control){if(binding.phase==='abandoned')throw new Error('actual compensation persistence failed');return put.call(this,binding,control);}):undefined;
    await services.inputQueue!.enqueue({inputId:'ma-preflight-failed',conversationId:c.id,prompt:'accepted but never started'},actor);await vi.waitFor(()=>expect((services.inputQueue as any).drains.size).toBe(0));expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('ma-preflight-failed')?.status).toBe(compensationFailure?'unknown':'failed_not_started');expect(p.service.store.db.prepare('SELECT 1 FROM source_settlements').get()).toBeUndefined();fault?.mockRestore();if(!compensationFailure){vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){yield {type:'thinking',delta:'',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};yield {type:'text',delta:'AFTER_FAILED_PREPARE'};});await services.inputQueue!.enqueue({inputId:'after-failure',conversationId:c.id,prompt:'new explicit input'},actor);await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('after-failure')?.status).toBe('completed'));}
  });
  it('actual MA setup failure before admission leaves accepted input pending and cancellable',async()=>{
    const {services}=setup();await services.multiAgent!.ready;const p=services.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'ma-before-claim'}),actor={requestSource:'user' as const,actorId:p.actor.actorId};const fault=vi.spyOn(DesktopMultiAgentStore.prototype,'createGroup').mockImplementationOnce(()=>{throw new Error('actual setup store failure');});await services.inputQueue!.enqueue({inputId:'not-claimed',conversationId:c.id,prompt:'pending original'},actor);await vi.waitFor(()=>expect((services.inputQueue as any).drains.size).toBe(0));expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('not-claimed')?.status).toBe('pending');fault.mockRestore();await services.inputQueue!.cancel({conversationId:c.id,inputId:'not-claimed'},actor);expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('not-claimed')?.status).toBe('cancelled');
  });

});
