import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
const fault = vi.hoisted(() => ({ directorySync: false, finalIndex: false, authorityRename: false, authorityPostRename: false }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, renameSync(from: import('node:fs').PathLike, to: import('node:fs').PathLike) {
    if (fault.authorityRename && String(to).endsWith('/authority.json')) throw new Error('synthetic authority rename failure');
    fs.renameSync(from, to);
    if (fault.authorityPostRename && String(to).endsWith('/authority.json')) fault.directorySync = true;
    if (fault.finalIndex && /[a-f0-9-]{36}\.json$/.test(String(to))
      && JSON.parse(fs.readFileSync(to, 'utf8')).ref?.executionState === 'terminal') fault.directorySync = true;
  }, fsyncSync(fd: number) {
    if (fault.directorySync && fs.fstatSync(fd).isDirectory()) { console.error('MOCK_THROW_STACK', new Error('directory sync unsupported').stack?.split('\n').slice(1,9).join(' | ')); throw Object.assign(new Error('directory sync unsupported'), { code: 'ENOTSUP' }); }
    return fs.fsyncSync(fd);
  } };
});
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner, describeObservationSource } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
import { SQLiteSessionStore } from '../../../src/ai/runtime/session-store/sqlite-store.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';

const cleanups: Array<() => void> = [];
afterEach(() => { fault.directorySync = false; fault.finalIndex = false; fault.authorityRename = false; fault.authorityPostRename = false; for (const clean of cleanups.splice(0).reverse()) clean(); });
function root() { const value = mkdtempSync(join(tmpdir(), 'solpi-durability-')); cleanups.push(() => rmSync(value, { recursive: true, force: true })); return value; }
function protectedSnapshot() {
  const session = new AgentSessionState();
  session.addProtectedObservationReferences([{ authorityId: '00000000-0000-4000-8000-000000000000', profileId: 'p', sourceSessionId: session.exportSnapshot().sessionId,
    ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, observationId: 'observation', contentHash: 'a'.repeat(64), revision: 1, policyId: 'p', policyRevision: 1 }]);
  return session.exportSnapshot();
}
describe('protected observation durability qualification', () => {
  it.each([['revoke', 'before-rename'], ['replace', 'before-rename'], ['revoke', 'after-rename'], ['replace', 'after-rename']] as const)('quarantines failed %s policy persistence %s and requires the recovered floor', (operation, timing) => {
    const directory = root(); const options = { profileRoot: directory, profileId: 'p', redactor: { version: 'v1', redact: (text: string) => text } };
    const claims = { sessionId: 's', ownerAgentId: 'a', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/messages' };
    const policy = { version: 1 as const, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'source', sourceDescriptors: ['source'], expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] };
    let service = createObservationService(options); cleanups.push(() => service.dispose());
    const caller = service.bindCaller({ ...claims, requestSource: 'agent' }); const user = service.bindCaller({ ...claims, requestSource: 'user' });
    service.setArchivePolicy({ requestSource: 'user', caller: user, policy });
    const capture = service.begin({ requestSource: 'agent', caller, invocationId: 'old', toolName: 'read', sourceAdapterId: 'source', sourceDescriptor: 'source' });
    service.append({ requestSource: 'agent', caller, capture, text: 'synthetic old body' });
    const ref = service.finalize({ requestSource: 'agent', caller, capture, executionState: 'terminal', outcome: 'success' });
    const page = service.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    const onRevoke = vi.fn(); service.transportPort.onRevoke(onRevoke);
    fault.authorityRename = timing === 'before-rename'; fault.authorityPostRename = timing === 'after-rename';
    expect(() => operation === 'revoke' ? service.revokePolicy({ requestSource: 'user', caller: user, policyId: 'p' }) : service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { ...policy, revision: 2 } })).toThrow();
    expect(onRevoke).toHaveBeenCalled(); expect(() => service.transportPort.validate(page.dependencies, destination.url)).toThrow();
    fault.authorityRename = false; fault.authorityPostRename = false; fault.directorySync = false;
    expect(() => service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { ...policy, revision: 3 } })).toThrow('quarantined');
    service.dispose(); service = createObservationService(options);
    const nextUser = service.bindCaller({ ...claims, requestSource: 'user' }); const nextCaller = service.bindCaller({ ...claims, requestSource: 'agent' });
    expect(() => service.setArchivePolicy({ requestSource: 'user', caller: nextUser, policy })).toThrow('stale_policy');
    if (timing === 'after-rename') expect(() => service.setArchivePolicy({ requestSource: 'user', caller: nextUser, policy: { ...policy, revision: 2 } })).toThrow('stale_policy');
    service.setArchivePolicy({ requestSource: 'user', caller: nextUser, policy: { ...policy, revision: timing === 'after-rename' ? 3 : 2 } });
    expect(() => service.read({ caller: nextCaller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow('unavailable');
    const freshCapture = service.begin({ requestSource: 'agent', caller: nextCaller, invocationId: 'fresh', toolName: 'read', sourceAdapterId: 'source', sourceDescriptor: 'source' });
    service.append({ requestSource: 'agent', caller: nextCaller, capture: freshCapture, text: 'fresh explicitly authorized body' });
    const fresh = service.finalize({ requestSource: 'agent', caller: nextCaller, capture: freshCapture, executionState: 'terminal', outcome: 'success' });
    expect(service.read({ caller: nextCaller, id: fresh.id, offset: 0, maxBytes: 64, destination }).content).toBe('fresh explicitly authorized body');
  });
  it('recovers an initial authority temporary file after real SIGKILL before rename', () => {
    const directory = root();
    const moduleUrl = pathToFileURL(resolve('src/runtime/sol-pi/observation-service.ts')).href;
    const script = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => { if (String(to).endsWith('/authority.json')) process.kill(process.pid, 'SIGKILL'); return rename(from, to); };
      syncBuiltinESMExports();
      const { createObservationService } = await import(${JSON.stringify(moduleUrl)});
      createObservationService({ profileRoot: ${JSON.stringify(directory)}, profileId: 'p', redactor: { version: 'v1', redact: text => text } });`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 10000 });
    expect(child.signal).toBe('SIGKILL');
    expect(readdirSync(join(directory, 'observations')).some(name => name.endsWith('.tmp'))).toBe(true);
    const service = createObservationService({ profileRoot: directory, profileId: 'p', redactor: { version: 'v1', redact: text => text } });
    cleanups.push(() => service.dispose());
    expect(readdirSync(join(directory, 'observations')).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('does not resurrect a failed final-index commit after rename, restart and fresh authorization', () => {
    const directory = root();
    const options = { profileRoot: directory, profileId: 'p', redactor: { version: 'v1', redact: (text: string) => text } };
    const claims = { sessionId: 's', ownerAgentId: 'a', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/messages' };
    const policy = { version: 1 as const, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'native.read.v1', sourceDescriptors: ['source'],
      expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] };
    let service = createObservationService(options); cleanups.push(() => service.dispose());
    const agent = service.bindCaller({ ...claims, requestSource: 'agent' }); const user = service.bindCaller({ ...claims, requestSource: 'user' });
    service.setArchivePolicy({ requestSource: 'user', caller: user, policy });
    const capture = service.begin({ requestSource: 'agent', caller: agent, invocationId: 'i', toolName: 'read', sourceAdapterId: 'native.read.v1', sourceDescriptor: 'source' });
    service.append({ requestSource: 'agent', caller: agent, capture, text: 'UNCONFIRMED_BODY' });
    const id = readdirSync(join(directory, 'observations')).find(name => /^[a-f0-9-]{36}\.json$/.test(name))!.slice(0, -5);
    fault.finalIndex = true;
    expect(() => service.finalize({ requestSource: 'agent', caller: agent, capture, executionState: 'terminal', outcome: 'success' })).toThrow('archive_unavailable');
    fault.finalIndex = false; fault.directorySync = false; service.dispose();
    service = createObservationService(options);
    const restored = service.bindCaller({ ...claims, requestSource: 'agent' }); const freshUser = service.bindCaller({ ...claims, requestSource: 'user' });
    service.setArchivePolicy({ requestSource: 'user', caller: freshUser, policy: { ...policy, revision: 2 } });
    expect(() => service.read({ caller: restored, id, offset: 0, maxBytes: 64, destination })).toThrow();
    expect(() => service.getReferenceMetadata(restored, id)).toThrow();
    service.dispose(); service = createObservationService(options);
    const secondAgent = service.bindCaller({ ...claims, requestSource: 'agent' });
    const secondUser = service.bindCaller({ ...claims, requestSource: 'user' });
    service.setArchivePolicy({ requestSource: 'user', caller: secondUser, policy: { ...policy, revision: 2 } });
    expect(() => service.read({ caller: secondAgent, id, offset: 0, maxBytes: 64, destination })).toThrow();
    expect(() => service.getReferenceMetadata(secondAgent, id)).toThrow();
  });
  it('propagates unsupported directory flush instead of accepting a protected session barrier', async () => {
    const store = new FileSessionStore(root()); fault.directorySync = true;
    await expect(store.save(protectedSnapshot())).rejects.toThrow('directory sync unsupported');
  });
  it('keeps ordinary session persistence compatibility when directory flush is unsupported', async () => {
    const store = new FileSessionStore(root()); fault.directorySync = true;
    await expect(store.save(new AgentSessionState().exportSnapshot())).resolves.toBeUndefined();
  });
  it('refuses Windows protected persistence without qualified directory synchronization', async () => {
    const store = new FileSessionStore(root(), (path, text, options) => writeFileAtomicallySync(path, text, { ...options, platform: 'win32' }));
    await expect(store.save(protectedSnapshot())).rejects.toThrow(/directory.*sync|durability|unsupported/i);
  });
  it('does not start an observation authority if the initial durable directory flush fails', () => {
    fault.directorySync = true;
    expect(() => {
      const service = createObservationService({ profileRoot: root(), profileId: 'p', redactor: { version: 'v1', redact: text => text } });
      cleanups.push(() => service.dispose());
    }).toThrow('directory sync unsupported');
  });
  it('a real owner never publishes captured body when a required publication flush fails', async () => {
    const directory = root(); const file = join(directory, 'material.txt'); writeFileSync(file, 'MUST_NOT_BE_PUBLISHED');
    const session = new AgentSessionState(); const sessionId = session.exportSnapshot().sessionId;
    const service = createObservationService({ profileRoot: join(directory, 'profile'), profileId: 'p', redactor: { version: 'v1', redact: text => text } }); cleanups.push(() => service.dispose());
    const claims = { sessionId, ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const caller = service.bindCaller({ ...claims, requestSource: 'agent' }); const user = service.bindCaller({ ...claims, requestSource: 'user' });
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/messages' };
    service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'native.read.v1',
      sourceDescriptors: [describeObservationSource({ toolName: 'read', source: { filePath: file, offset: 1 } })], expiresAt: Date.now() + 60000,
      localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
    const store = new FileSessionStore(join(directory, 'sessions'));
    const owner = createObservationSessionOwner({ service, caller, session, destination, capacityProfile: testOnlyCapacity(destination.url, destination.model), persist: snapshot => store.save(snapshot) }); cleanups.push(() => owner.dispose());
    const legacy = await createReadTool({ cwd: directory }).execute({ file_path: file }, { ...mcpTestContext(new AbortController().signal), observationCollector: owner.collectorFor('read') });
    fault.directorySync = true;
    const result = await owner.projectToolResult('read', legacy);
    expect(result).not.toContain('MUST_NOT_BE_PUBLISHED'); expect(result).toContain('unavailable');
    expect(() => owner.prepareProviderDisclosure()).toThrow();
  });

  it('rejects the SQLite protected barrier when its directory flush fails without erasing the committed closure', async () => {
    const store = new SQLiteSessionStore(join(root(), 'new', 'sessions.db')); cleanups.push(() => store.dispose());
    const snapshot = protectedSnapshot(); fault.directorySync = true;
    await expect(store.save(snapshot)).rejects.toThrow('directory sync unsupported');
    expect((await store.load(snapshot.sessionId))?.protectedObservationClosure).toEqual(snapshot.protectedObservationClosure);
  });
  it('keeps ordinary SQLite saves unchanged when strict directory flush is unavailable', async () => {
    const store = new SQLiteSessionStore(join(root(), 'sessions.db')); cleanups.push(() => store.dispose()); fault.directorySync = true;
    await expect(store.save(new AgentSessionState().exportSnapshot())).resolves.toBeUndefined();
  });
  it('requires the SQLite barrier for a sticky old closure even if the incoming snapshot omits it', async () => {
    const store = new SQLiteSessionStore(join(root(), 'sessions.db')); cleanups.push(() => store.dispose()); const snapshot = protectedSnapshot();
    await store.save(snapshot); fault.directorySync = true;
    await expect(store.save({ ...snapshot, protectedObservationClosure: undefined })).rejects.toThrow('directory sync unsupported');
    expect((await store.load(snapshot.sessionId))?.protectedObservationClosure).toEqual(snapshot.protectedObservationClosure);
  });

});
