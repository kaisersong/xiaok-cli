import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { parseObservationPolicyFile, prepareObservationConfig, createProductObservationOwner, describeProductObservationPolicy } from '../../../src/runtime/sol-pi/product-bootstrap.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
import { createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
const environmentRoot = join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
const qualifiedHost = (() => { if (process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(join(environmentRoot, 'manifest.json'))) return false; try { const Database = createRequire(import.meta.url)('better-sqlite3'); new Database(':memory:').close(); return true; } catch { return false; } })();
const cleanup: Array<() => void> = [];
afterEach(() => { try { for (const close of cleanup.splice(0).reverse()) close(); } finally { vi.useRealTimers(); } });
function freshSession() { const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: randomUUID() }); return session; }
function fixture() {
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'solpi-product-'))); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
 const file = join(root, 'material.txt'); writeFileSync(file, 'secret-long and secret token.a+b');
 const policyFile = join(root, 'policy.json'); const dto = { version: 1, environmentId: 'deepseek-recipe-0.1.1', model: 'deepseek-flash', destination: { provider: 'deepseek', url: 'https://api.deepseek.com/chat/completions' }, localPersistence: true, allowUnclassifiedText: true, allowModelDisclosure: true, allowIncomplete: false, expiresAt: Date.now() + 60000, readFileScopes: [{ filePath: file, startLine: 1 }], bashSources: [] };
 writeFileSync(policyFile, JSON.stringify(dto)); return { root, file, policyFile, dto };
}
describe('explicit host product observation bootstrap', () => {
 it.skipIf(!qualifiedHost).each([1, 2])('runs product child depth %s through actual named executor and SDK before publishing return closure', async depth => {
  const f = fixture();
  writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, ordinaryChildren: { enabled: true, maxDepth: depth, maxChildren: depth, expiresAt: f.dto.expiresAt, nativeTools: ['read'] } }));
  const store = new FileSessionStore(join(f.root, 'sessions')), session = freshSession();
  const active = await createProductObservationOwner({ policy: parseObservationPolicyFile(f.policyFile), session, profileRoot: join(f.root, 'profile'), environmentRoot,
    credentialSecrets: ['secret-long'], persist: snapshot => store.save(snapshot), permissionManager: new PermissionManager({ mode: 'auto' }) }); cleanup.push(() => active.dispose());
  const { ToolRegistry } = await import('../../../src/ai/tools/index.js');
  const { OpenAIAdapter } = await import('../../../src/ai/adapters/openai.js');
  const { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } = await import('../../../src/ai/providers/model-harness-profile.js');
  const { withObservationExecutionOwner } = await import('../../../src/runtime/sol-pi/observation-execution-scope.js');
  const { createProductObservationSubagentTool } = await import('../../../src/runtime/sol-pi/product-subagent-tool.js');
  let calls = 0;
  const raw = vi.fn(async () => {
    calls++;
    const delta = depth === 2 && calls === 1 ? { tool_calls: [{ index: 0, id: 'nested-child', type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ prompt: 'Read the material in a nested child.' }) } }] } : calls === depth ? { tool_calls: [{ index: 0, id: 'child-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ file_path: f.file }) } }] } : { content: 'derived child conclusion' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: calls <= depth ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }); vi.stubGlobal('fetch', raw); cleanup.push(() => vi.unstubAllGlobals());
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'deepseek', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://api.deepseek.com', wireModel: 'deepseek-flash', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}) }) });
  const sourceRegistry = new ToolRegistry({ autoMode: true }, [createReadTool({ cwd: f.root })]); cleanup.push(() => sourceRegistry.dispose());
  const completed = vi.fn();
  const tool = createProductObservationSubagentTool({ product: active, parentOwner: active.owner, sourceRegistry, adapter: () => adapter, cwd: f.root, persist: snapshot => store.save(snapshot), buildSystemPrompt: async () => 'Read the authorized material.', onCompleted: completed });
  const result = await withObservationExecutionOwner(active.owner, () => tool.execute({ prompt: 'read material' }));
  expect(result).toBe('derived child conclusion'); expect(calls).toBe(depth * 2); expect(completed).toHaveBeenCalledTimes(depth);
  expect(session.getProtectedObservationClosure()?.observations).toHaveLength(1);
  expect(() => active.owner.prepareProviderDisclosure()).toThrow();
 }, 30000);

 it.skipIf(!qualifiedHost).each(['cli', 'desktop-managed'] as const)('creates a real host-approved %s child plan with one profile ledger and narrowed native capture policy', async surface => {
  const f = fixture();
  writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, ordinaryChildren: { enabled: true, maxDepth: 1, maxChildren: 1, expiresAt: f.dto.expiresAt, nativeTools: ['read'] } }));
  const store = new FileSessionStore(join(f.root, 'sessions')), session = freshSession();
  const active = await createProductObservationOwner({ policy: parseObservationPolicyFile(f.policyFile), session, profileRoot: join(f.root, 'profile'), environmentRoot,
    credentialSecrets: ['secret-long'], persist: snapshot => store.save(snapshot), permissionManager: new PermissionManager({ mode: 'auto' }) }); cleanup.push(() => active.dispose());
  const { ToolRegistry } = await import('../../../src/ai/tools/index.js');
  const { consumeDelegatedObservationExecutionPlan } = await import('../../../src/runtime/sol-pi/delegated-session-owner.js');
  const childSession = freshSession(), read = createReadTool({ cwd: f.root });
  const registry = new ToolRegistry({ autoMode: true }, [read]); cleanup.push(() => registry.dispose());
  expect(() => (active as any).createChildExecutionPlan({ session: freshSession(), persist: (snapshot: any) => store.save(snapshot), surface: 'arbitrary-provider' })).toThrow();
  if (surface === 'desktop-managed') registry.registerTool({ definition: { name: 'send_message', description: 'ceiling fixture only, not Desktop delivery', inputSchema: { type: 'object', properties: {} } }, permission: 'safe', execute: async () => 'fixture' });
  const installation={dispose:vi.fn(async()=>{}),bindRegistry:vi.fn(async()=>{})};
  const installChildExecution=vi.fn(async(input:{session:AgentSessionState;registry:InstanceType<typeof ToolRegistry>})=>{
    expect(input.session).toBe(childSession);expect(input.registry).toBe(registry);return installation;
  });
  const plan = active.createChildExecutionPlan({ session: childSession, persist: snapshot => store.save(snapshot), surface, installChildExecution });
  const child = await consumeDelegatedObservationExecutionPlan(plan, registry); cleanup.push(() => child.owner.dispose());
  expect(installChildExecution).toHaveBeenCalledOnce();expect(child.execution).toBeDefined();
  await child.execution!.bindRegistry(registry);expect(installation.bindRegistry).toHaveBeenCalledWith(registry);
  const result = await read.execute({ file_path: f.file }, mcpTestContext(new AbortController().signal, { observationCollector: child.owner.collectorFor('child-read') }));
  const projection = await child.owner.projectToolResult('child-read', result);
  expect(projection).toContain('[REDACTED]'); expect(projection).not.toContain('secret-long');
  expect(childSession.getProtectedObservationClosure()?.observations[0].sourceSessionId).toBe(childSession.exportSnapshot().sessionId);
  expect(readdirSync(join(f.root, 'profile', 'counters'))).toHaveLength(1);
  expect(() => (active as any).createChildExecutionPlan({ session: freshSession(), persist: (snapshot: any) => store.save(snapshot) })).toThrow();
  const publication = await (active as any).prepareMessagePublication({ sourceOwner: child.owner, recipientOwner: active.owner,
    operationId: 'desktop-turn:message-1', text: 'derived child message', assertCurrent() {} });
  expect((await store.load(session.exportSnapshot().sessionId))?.protectedObservationClosure?.observations).toHaveLength(1);
  const journal = vi.fn((text: string) => text);
  expect(publication.commit('desktop-turn:message-1', 'derived child message', journal)).toBe('derived child message');
  expect(journal).toHaveBeenCalledOnce();
  active.revoke();
  await expect((active as any).prepareMessagePublication({ sourceOwner: child.owner, recipientOwner: active.owner,
    operationId: 'desktop-turn:message-2', text: 'after revoke', assertCurrent() {} })).rejects.toThrow();
 }, 30000);

 it('requires explicit bounded ordinary child consent and freezes the native tool ceiling', () => {
  const f = fixture();
  expect((describeProductObservationPolicy(parseObservationPolicyFile(f.policyFile)) as any).ordinaryChildren).toBeUndefined();
  const ordinaryChildren = { enabled: true, maxDepth: 2, maxChildren: 3, expiresAt: f.dto.expiresAt, nativeTools: ['read'] };
  writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, ordinaryChildren }));
  const description = describeProductObservationPolicy(parseObservationPolicyFile(f.policyFile)) as any;
  expect(description.ordinaryChildren).toEqual(ordinaryChildren);
  expect(Object.isFrozen(description.ordinaryChildren.nativeTools)).toBe(true);
  for (const change of [{ maxDepth: 9 }, { nativeTools: ['mcp_arbitrary'] }, { expiresAt: f.dto.expiresAt + 1 }, { automaticApproval: true }]) {
   writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, ordinaryChildren: { ...ordinaryChildren, ...change } }));
   expect(() => parseObservationPolicyFile(f.policyFile)).toThrow();
  }
 });

 it('requires explicit bounded semantic pricing and describes added model-call consent', () => {
  const f = fixture();
  expect(describeProductObservationPolicy(parseObservationPolicyFile(f.policyFile)).semanticCompaction).toBeUndefined();
  const semanticCompaction = { version: 1, mode: 'mechanism-experiment', currency: 'USD', maxCalls: 2, maxCostUnits: 50000000, maxOutputTokens: 2048, expiresAt: f.dto.expiresAt,
   pricing: { source: 'https://api-docs.deepseek.com/quick_start/pricing', model: 'deepseek-flash', inputMissUnitsPerMillion: 300000000, inputHitUnitsPerMillion: 6000000, outputUnitsPerMillion: 1200000000, validUntil: f.dto.expiresAt } };
  writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, semanticCompaction }));
  const policy = parseObservationPolicyFile(f.policyFile);
  const description = describeProductObservationPolicy(policy);
  expect(description.semanticCompaction).toMatchObject({ mode: 'mechanism-experiment', maxCalls: 2, maxCostUnits: 50000000 });
  expect(Object.isFrozen(description.semanticCompaction)).toBe(true);
  expect(Object.isFrozen(description.semanticCompaction!.pricing)).toBe(true);
  expect(() => describeProductObservationPolicy(JSON.parse(JSON.stringify(policy)))).toThrow();
  writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, semanticCompaction: { ...semanticCompaction, approved: true } }));
  expect(() => parseObservationPolicyFile(f.policyFile)).toThrow();
 });
 it('requires a real durable execution owner for an explicitly enabled semantic policy',async()=>{
  const f=fixture();const expiresAt=f.dto.expiresAt;
  writeFileSync(f.policyFile,JSON.stringify({...f.dto,semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:1024,expiresAt,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiresAt}}}));
  const work=createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session:freshSession(),profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],persist:async()=>{},permissionManager:new PermissionManager({mode:'auto'})}).then(result=>{cleanup.push(()=>result.dispose());return result;});
  await expect(work).rejects.toThrow('SEMANTIC_PERSISTENCE_REQUIRED');
 });
 it.skipIf(!qualifiedHost)('expires an in-flight disclosure and reports revoked without another request', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const f = fixture(), policy = parseObservationPolicyFile(f.policyFile), session = freshSession();
  const store = new FileSessionStore(join(f.root, 'sessions'));
  const active = await createProductObservationOwner({ policy, session, profileRoot: join(f.root, 'profile'), environmentRoot,
    credentialSecrets: [], persist: snapshot => store.save(snapshot), permissionManager: new PermissionManager({ mode: 'auto' }) }); cleanup.push(() => active.dispose());
  const native = await createReadTool({ cwd: f.root }).execute({ file_path: f.file }, mcpTestContext(new AbortController().signal, { observationCollector: active.owner.collectorFor('expiry-read') }));
  await active.owner.projectToolResult('expiry-read', native);
  const context = active.owner.prepareProviderDisclosure()!; let signal: AbortSignal | undefined;
  const response = await createProviderDisclosureFetch(context, async (_url, init) => { signal = init!.signal!; return new Response(new ReadableStream()); })('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hello' }] }) });
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(60001);
  expect(signal?.aborted).toBe(true); expect(active.getStatus().revoked).toBe(true);
  await response.body?.cancel().catch(() => {});
 }, 20000);

 it('rejects unknown executable paths, duplicate keys, incomplete consent and expired input', () => {
  const f = fixture();
  for (const change of [{ pythonExecutable: '/tmp/project' }, { allowUnclassifiedText: false }, { allowIncomplete: true }, { expiresAt: Date.now() - 1 }]) {
   writeFileSync(f.policyFile, JSON.stringify({ ...f.dto, ...change })); expect(() => parseObservationPolicyFile(f.policyFile)).toThrow();
  }
  writeFileSync(f.policyFile, JSON.stringify(f.dto).replace('"version":1', '"version":1,"version":1')); expect(() => parseObservationPolicyFile(f.policyFile)).toThrow();
 });
 it('changes only current wire model in memory and binds exact configured destination', () => {
  const f = fixture(), policy = parseObservationPolicyFile(f.policyFile);
  const config: any = { schemaVersion: 2, defaultProvider: 'deepseek', defaultModelId: 'current', providers: { deepseek: { type: 'first_party', protocol: 'openai_legacy', baseUrl: 'https://api.deepseek.com', apiKey: 'secret' } }, models: { current: { provider: 'deepseek', model: 'old-alias', label: 'Current' } }, defaultMode: 'interactive' };
  const original = structuredClone(config), prepared = prepareObservationConfig(config, policy); expect(config).toEqual(original); expect(prepared.models.current.model).toBe('deepseek-flash');
  expect(prepareObservationConfig({ ...config, providers: { deepseek: { ...config.providers.deepseek, type: 'custom' } } }, policy).models.current.model).toBe('deepseek-flash');
  expect(() => prepareObservationConfig({ ...config, providers: { deepseek: { ...config.providers.deepseek, baseUrl: 'https://other.example' } } }, policy)).toThrow();
 });
 it('describes the immutable parsed grant without rereading policy or exposing deployment paths', () => {
  const f = fixture(), policy = parseObservationPolicyFile(f.policyFile);
  writeFileSync(f.policyFile, '{}'); const description = describeProductObservationPolicy(policy);
  expect(description.readFileScopes[0].filePath).toBe(f.file); expect(Object.isFrozen(description.readFileScopes[0])).toBe(true);
  expect(description).not.toHaveProperty('environmentRoot'); expect(description).not.toHaveProperty('credentialSecrets');
 });
 it('rejects unbranded policies and Windows activation before any environment or native work', async () => {
  const f = fixture(); expect(() => prepareObservationConfig({} as never, f.dto as never)).toThrow();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
   Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
   await expect(createProductObservationOwner({} as never)).rejects.toThrow('PLATFORM_NOT_READY');
  } finally { Object.defineProperty(process, 'platform', platform); }
 });
 it.skipIf(!qualifiedHost)('uses official capacity, real archive redaction and synchronous permission revocation (requires registered macOS arm64 recipe and SQLite)', async () => {
  const f = fixture(), policy = parseObservationPolicyFile(f.policyFile), session = freshSession(), permissionManager = new PermissionManager({ mode: 'auto' });
  const store = new FileSessionStore(join(f.root, 'sessions'));
  const active = await createProductObservationOwner({ policy, session, profileRoot: join(f.root, 'profile'), environmentRoot: join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'), credentialSecrets: ['secret', 'secret-long', 'token.a+b'], persist: snapshot => store.save(snapshot), permissionManager }); cleanup.push(() => active.dispose());
  expect((active as any).getStatus()).toMatchObject({ revoked: false, ownerMode: 'active' });
  const native = await createReadTool({ cwd: f.root }).execute({ file_path: f.file }, mcpTestContext(new AbortController().signal, { observationCollector: active.owner.collectorFor('read') }));
  const text = await active.owner.projectToolResult('read', native); expect(text).not.toContain('secret'); expect(text).not.toContain('-long'); expect(text).not.toContain('token.a+b');
  const body = readdirSync(join(f.root, 'profile/observations')).find(name => name.endsWith('.body'))!;
  const archived = readFileSync(join(f.root, 'profile/observations', body), 'utf8'); expect(archived).not.toContain('secret'); expect(archived).not.toContain('token.a+b'); expect(archived).toContain('[REDACTED]');
  expect(JSON.stringify(active.summary)).not.toContain('secret');
  const context = active.owner.prepareProviderDisclosure()!; expect(context).toBeDefined(); let transportSignal: AbortSignal | undefined;
  const response = await createProviderDisclosureFetch(context, async (_url, init) => { transportSignal = init!.signal!; return new Response(new ReadableStream()); })('https://api.deepseek.com/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hello' }] }) });
  permissionManager.setMode('plan'); expect(transportSignal?.aborted).toBe(true); await response.body?.cancel().catch(() => {});
  expect((active as any).getStatus().revoked).toBe(true);
  expect(() => active.owner.prepareProviderDisclosure()).toThrow();
  active.dispose();
  const retained = JSON.parse(readFileSync(join(f.root, 'profile/observations', body.replace('.body', '.json')), 'utf8'));
  expect(retained.endedAt).toEqual(expect.any(Number));
  expect(retained.pins).toEqual([`session:${session.exportSnapshot().sessionId}`]);
  expect(existsSync(join(f.root, 'profile/observations', body))).toBe(true);
  expect((active as any).getStatus()).toMatchObject({ revoked: true, disposed: true });
  const next = await createProductObservationOwner({ policy, session: freshSession(), profileRoot: join(f.root, 'profile'), environmentRoot: join(homedir(), '.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'), credentialSecrets: [], persist: snapshot => store.save(snapshot), permissionManager }); cleanup.push(() => next.dispose());
  expect((next.summary as any).storageBudget.reservedBytes).toBe((8 + 34) * 1024 * 1024);
  expect(readdirSync(join(f.root, 'profile', 'counters'))).toHaveLength(2);
  const secondRead = await createReadTool({ cwd: f.root }).execute({ file_path: f.file }, mcpTestContext(new AbortController().signal, { observationCollector: next.owner.collectorFor('read-next') }));
  await next.owner.projectToolResult('read-next', secondRead); expect(next.owner.prepareProviderDisclosure()).toBeDefined();
  next.owner.stopNewCapture(); expect((next as any).getStatus()).toMatchObject({ revoked: false, ownerMode: 'recall-only' });
  next.revoke(); next.revoke(); expect(() => next.owner.prepareProviderDisclosure()).toThrow();
 }, 20000);
});

it('accepts only the explicit compound experiment and never treats it as tool permission',()=>{
 const f=fixture();
 expect(describeProductObservationPolicy(parseObservationPolicyFile(f.policyFile)).compoundExecution).toBeUndefined();
 writeFileSync(f.policyFile,JSON.stringify({...f.dto,compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const policy=parseObservationPolicyFile(f.policyFile);
 expect(describeProductObservationPolicy(policy).compoundExecution).toEqual({version:1,mode:'mechanism-experiment'});
 expect(Object.isFrozen(describeProductObservationPolicy(policy).compoundExecution)).toBe(true);
 for(const value of [{version:1,mode:'automatic'},{version:1,mode:'mechanism-experiment',allowBash:true},true]){
  writeFileSync(f.policyFile,JSON.stringify({...f.dto,compoundExecution:value}));expect(()=>parseObservationPolicyFile(f.policyFile)).toThrow();
 }
});
it.skipIf(!qualifiedHost)('creates one durable compound authority and aborts execution synchronously on policy revoke',async()=>{
 const f=fixture();writeFileSync(f.policyFile,JSON.stringify({...f.dto,compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const session=freshSession(),storeRoot=join(f.root,'sessions'),store=new FileSessionStore(storeRoot);
 const active=await createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session,profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),executionPersistence:{store,root:storeRoot},permissionManager:new PermissionManager({mode:'auto'})});
 try{expect(active.summary.storageBudget.reservedBytes).toBe((4+34+1+1)*1024*1024);expect(active.semanticCompactionOwner).toBeUndefined();expect(active.executionAuthority).toBeDefined();expect(active.executionSignal.aborted).toBe(false);active.revoke();expect(active.executionSignal.aborted).toBe(true);}finally{await active.dispose();}
});

it.skipIf(!qualifiedHost)('reserves an existing execution domain even when a new policy has no compound mechanism',async()=>{
 const f=fixture(),profileRoot=join(f.root,'profile');mkdirSync(join(profileRoot,'compound-domains'),{recursive:true,mode:0o700});
 const session=freshSession(),store=new FileSessionStore(join(f.root,'sessions'));
 const active=await createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session,profileRoot,environmentRoot,credentialSecrets:[],persist:value=>store.save(value),permissionManager:new PermissionManager({mode:'auto'})});
 try{expect(active.summary.storageBudget.reservedBytes).toBe((4+34+1)*1024*1024);}finally{await active.dispose();}
});
it.skipIf(!qualifiedHost)('keeps the actual canonical alias pool reserved for a later ordinary observation policy',async()=>{
 const f=fixture(),canonical=join(f.root,'compound-sessions'),old=new FileSessionStore(canonical),oldSession=freshSession();
 const {createSessionExecutionAuthority,createSessionExecutionContext}=await import('../../../src/ai/runtime/session-store/execution-authority.js');
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 const authority=createSessionExecutionAuthority({root:canonical,sessionIdentity:oldSession.exportSnapshot().sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'old',scopeId:'alias'})});
 const lease=await authority.acquire({invocationId:'alias',kind:'recovery'});
 try{
  await old.compareAndSave({nextSnapshot:oldSession.exportSnapshot(),expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  await old.registerSessionAlias({aliasId:'alias',holderRoot:f.root,holderId:'task',targetSessionId:oldSession.exportSnapshot().sessionId,domainInitializationId:'domain',domainGeneration:1,requestSource:'user',lease});
 }finally{await lease.releaseAfterDrain();authority.dispose();}
 const session=freshSession(),store=new FileSessionStore(join(f.root,'sessions'));
 const active=await createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session,profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),permissionManager:new PermissionManager({mode:'auto'})});
 try{expect(active.summary.storageBudget.reservedBytes).toBe((4+34+1)*1024*1024);}finally{await active.dispose();}
});
it.skipIf(!qualifiedHost).each(['terminal','unknown'] as const)('permanently closes a product root before the next fresh task: %s',async mode=>{
 const f=fixture();writeFileSync(f.policyFile,JSON.stringify({...f.dto,compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const {resolveCompoundHostStorage}=await import('../../../src/runtime/sol-pi/compound-host-storage.js');
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 const layout=resolveCompoundHostStorage({configRoot:f.root}),store=new FileSessionStore(layout.canonicalRoot);
 const start=async(session:AgentSessionState)=>createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session,profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),compoundStorage:layout,
  executionPersistence:{store,root:layout.canonicalRoot,initialize:async(snapshot,lease)=>{await store.compareAndSave({nextSnapshot:snapshot,expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});}},permissionManager:new PermissionManager({mode:'auto'})});
 const session=freshSession(),first=await start(session);
 if(mode==='unknown'){
  const {createCompoundOperationLedger}=await import('../../../src/runtime/sol-pi/compound-operation.js');
  const {createOrGetDirectOperation,advanceDirectOperation}=await import('../../../src/runtime/sol-pi/compound-direct-operation.js');
  const created=createOrGetDirectOperation(createCompoundOperationLedger(),{dispatch:{sessionIdentity:session.exportSnapshot().sessionId,hostProviderInvocationId:'provider',originalToolUseId:'write'},inputHash:'a'.repeat(64),toolName:'write',ownerId:'owner',requestSource:'agent',scopeId:'scope',permissionGeneration:1});
  const started=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:'b'.repeat(64)}),unknown=advanceDirectOperation(started,created.operation.id,{stage:'outcome_unknown',outcome:'unknown'});
  const lease=await first.executionAuthority!.acquire({invocationId:'record-unknown',kind:'recovery'});
  try{const current=(await store.load(session.exportSnapshot().sessionId))!;await store.compareAndSave({nextSnapshot:{...current,compoundOperations:unknown},expectedStoreRevision:current.storeRevision!,expectedHistoryDigest:current.historyDigest!,lease});}finally{await lease.releaseAfterDrain();}
  await expect(first.dispose()).rejects.toThrow(/unsettled/);
  expect(JSON.parse(readFileSync(join(f.root,'profile','compound-domains','index.json'),'utf8')).state).toBe('retiring');
  await expect(start(freshSession()).then(owner=>{cleanup.push(()=>owner.dispose());return owner;})).rejects.toThrow(/domain/);
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0].stage).toBe('outcome_unknown');
 }else{
  await first.dispose();expect(first.getStatus()).toMatchObject({disposed:true,revoked:true});
  const next=await start(freshSession());try{expect(next.compoundDomain!.getBinding()).toMatchObject({generation:2,state:'active'});expect(()=>first.compoundDomain!.assertCurrent()).toThrow();}finally{await next.dispose();}
  expect(JSON.parse(readFileSync(join(f.root,'profile','compound-domains','index.json'),'utf8')).state).toBe('retired');
 }
},20000);
it.skipIf(!qualifiedHost)('claims the actual host canonical domain before a fresh execution snapshot is initialized',async()=>{
 const f=fixture();writeFileSync(f.policyFile,JSON.stringify({...f.dto,compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const {resolveCompoundHostStorage}=await import('../../../src/runtime/sol-pi/compound-host-storage.js');
 const {computeSessionHistoryDigest}=await import('../../../src/ai/runtime/session-store/store.js');
 const layout=resolveCompoundHostStorage({configRoot:f.root}),store=new FileSessionStore(layout.canonicalRoot),session=freshSession();let initialized=false;
 const active=await createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session,profileRoot:join(f.root,'profile'),environmentRoot,credentialSecrets:[],persist:value=>store.save(value),compoundStorage:layout,
  executionPersistence:{store,root:layout.canonicalRoot,initialize:async(snapshot,lease)=>{
   expect(existsSync(join(f.root,'profile','compound-domains','index.json'))).toBe(true);initialized=true;
   await store.compareAndSave({nextSnapshot:snapshot,expectedStoreRevision:0,expectedHistoryDigest:computeSessionHistoryDigest({messages:[]}),lease});
  }},permissionManager:new PermissionManager({mode:'auto'})});
 try{
  expect(initialized).toBe(true);expect(active.compoundDomain?.getBinding().storeRoot).toBe(layout.canonicalRoot);
  const {ToolRegistry,buildToolList}=await import('../../../src/ai/tools/index.js');
  const {installProductCompoundCoordinator}=await import('../../../src/runtime/sol-pi/product-compound-coordinator.js');
  const base=new ToolRegistry({autoMode:true},buildToolList(undefined,{cwd:f.root}).filter(tool=>tool.definition.name==='write'));
  const registry=base.forkForCompoundObservation([],['write']);const coordinator=await installProductCompoundCoordinator({product:active,session,store,root:layout.canonicalRoot,registry});
  const context={taskId:'canonical-task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'before'};
  try{
   await registry.executeTool('write',{file_path:f.file,content:'before retirement'},context);
   const lease=await active.executionAuthority!.acquire({invocationId:'retire',kind:'recovery'});
   try{active.compoundDomain!.beginRetirement(lease);}finally{await lease.releaseAfterDrain();}
   const result=await registry.executeTool('write',{file_path:f.file,content:'escaped retiring'}, {...context,toolInvocationId:'after'}).catch(error=>String(error));
   expect(readFileSync(f.file,'utf8')).toBe('before retirement');expect(result).toContain('compound_domain_retiring');
  }finally{await coordinator?.dispose();registry.dispose();base.dispose();}
 }
 finally{await active.dispose();}
 expect(JSON.parse(readFileSync(join(f.root,'profile','compound-domains','owner-state.json'),'utf8')).cleanShutdown).toBe(true);
});
it.skipIf(!qualifiedHost)('refuses a new 65th counter owner but can reopen an existing legacy owner',async()=>{
 const f=fixture(),profileRoot=join(f.root,'profile'),session=freshSession();const start=(s:AgentSessionState)=>createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session:s,profileRoot,environmentRoot,credentialSecrets:[],persist:async()=>{},permissionManager:new PermissionManager({mode:'auto'})});
 const first=await start(session);await first.dispose();const existing=readdirSync(join(profileRoot,'counters'))[0];
 for(let i=0;i<64;i++)mkdirSync(join(profileRoot,'counters',i.toString(16).padStart(64,'0')),{recursive:true});
 expect(readdirSync(join(profileRoot,'counters'))).toHaveLength(65);
 await expect(start(freshSession()).then(owner=>{cleanup.push(()=>owner.dispose());return owner;})).rejects.toThrow('COUNTER_QUOTA');expect(readdirSync(join(profileRoot,'counters'))).toHaveLength(65);
 const resumed=freshSession();resumed.restoreSnapshot({...resumed.exportSnapshot(),sessionId:session.exportSnapshot().sessionId});const owner=await start(resumed);await owner.dispose();expect(readdirSync(join(profileRoot,'counters'))).toContain(existing);expect(readdirSync(join(profileRoot,'counters'))).toHaveLength(65);
},30000);
it.skipIf(!qualifiedHost)('rechecks actual counter inventory after the profile lock, before creating a new counter',async()=>{
 const f=fixture(),profileRoot=join(f.root,'profile');mkdirSync(join(profileRoot,'counters'),{recursive:true,mode:0o700});for(let i=0;i<63;i++)mkdirSync(join(profileRoot,'counters',i.toString(16).padStart(64,'0')));
 const module=await import('../../../src/runtime/sol-pi/reference-lifecycle.js'),Original=module.ReferenceDeletionReceiptStore;
 const spy=vi.spyOn(module,'ReferenceDeletionReceiptStore').mockImplementation(function(root:string){mkdirSync(join(root,'counters','f'.repeat(64)));return new Original(root);});
 try{await expect(createProductObservationOwner({policy:parseObservationPolicyFile(f.policyFile),session:freshSession(),profileRoot,environmentRoot,credentialSecrets:[],persist:async()=>{},permissionManager:new PermissionManager({mode:'auto'})}).then(owner=>{cleanup.push(()=>owner.dispose());return owner;})).rejects.toThrow('COUNTER_INVENTORY_CHANGED');expect(readdirSync(join(profileRoot,'counters'))).toHaveLength(64);}finally{spy.mockRestore();}
},30000);
