// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { authorizationFixture, authorizationRequest, deferred } from '../fixtures/multi-agent-authorization.js';

describe('W8 actual file admission retains the same execution revision across material IO', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });

  it.each([true, false].flatMap(withThread => ['unchanged', 'revoke', 'regrant', 'dispose'].map(action => ({ withThread, action }))))(
    'actual nonempty import with thread=$withThread and $action cannot mint new authority for an old submission', async ({ withThread, action }) => {
      const f = await authorizationFixture(cleanup), imported = deferred(), releaseImport = deferred(), releaseModel = deferred();
      const source = join(f.root, 'user-material.txt'), effect = join(f.root, 'file-submission-effect.txt');
      writeFileSync(source, 'Real customer material copied by the production MaterialRegistry.');
      let importedPath = '', importCalls = 0, modelCalls = 0, taskId: string | undefined;
      const originalImport = MaterialRegistry.prototype.importMaterial;
      vi.spyOn(MaterialRegistry.prototype, 'importMaterial').mockImplementation(async function(this: MaterialRegistry, input) {
        const record = await originalImport.call(this, input);
        if (input.sourcePath === source) {
          importedPath = record.workspacePath; importCalls++; imported.resolve();
          // The original realpath/stat/copy/hash/index persistence completed.
          // Pause only the real async return to its existing factory caller.
          await releaseImport.promise;
        }
        return record;
      });
      vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
        yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
        if (++modelCalls === 1) yield { type: 'tool_use', id: 'actual-file-write', name: 'write', input: { file_path: effect, content: 'ORIGINAL_USER_FILE_SUBMISSION' } };
        else { await releaseModel.promise; yield { type: 'text', delta: 'done' }; }
      });
      const prepared = vi.spyOn(InProcessTaskRuntimeHost.prototype, 'prepareTask');
      cleanup.push(async () => {
        releaseImport.resolve();
        if (taskId) await f.services.cancelTask(taskId);
        releaseModel.resolve();
      });

      const captured = await f.getAuthorization();
      const result = f.services.createTaskWithFiles({ prompt: 'Use the attached material and write the requested receipt.', filePaths: [source],
        ...(withThread ? { context: { threadId: 'file-admission-thread' } } : {}),
      }).then(value => { taskId = value.taskId; return { value }; }, error => ({ error }));
      await imported.promise;
      expect(importCalls).toBe(1); expect(importedPath).not.toBe(source);
      expect(readFileSync(importedPath, 'utf8')).toBe(readFileSync(source, 'utf8'));
      expect(prepared).not.toHaveBeenCalled(); expect(modelCalls).toBe(0); expect(existsSync(effect)).toBe(false);
      if (action === 'revoke' || action === 'regrant') {
        await f.setAuthorization(authorizationRequest(captured, false, 'revoke-during-file-import'));
        if (action === 'regrant') {
          await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'grant-after-file-import'));
          expect((await f.getAuthorization()).permissionRevision).toBeGreaterThan(captured.permissionRevision);
        }
      } else if (action === 'dispose') await f.services.disposeMultiAgent();
      releaseImport.resolve(); const settled = await result;
      if ('value' in settled) await vi.waitFor(() => expect(existsSync(effect)).toBe(true));
      if (action === 'unchanged') {
        expect(settled).toHaveProperty('value.taskId'); expect(prepared).toHaveBeenCalledOnce();
        expect(modelCalls).toBeGreaterThan(0); expect(readFileSync(effect, 'utf8')).toBe('ORIGINAL_USER_FILE_SUBMISSION');
      } else {
        expect.soft(settled).toHaveProperty('error');
        expect.soft(prepared).not.toHaveBeenCalled(); expect.soft(modelCalls).toBe(0); expect.soft(existsSync(effect)).toBe(false);
      }
    },
  );

  it.each([false, true])('plain Chat without thread captures before actual thread registration IO (regrant=%s)', async regrant => {
    const f = await authorizationFixture(cleanup), registered = deferred(), releaseRegistration = deferred(), releaseModel = deferred();
    const effect = join(f.root, 'unthreaded-submission-effect.txt');
    let taskId: string | undefined, modelCalls = 0, registeredThread = '';
    const originalRegistration = f.boundary.service.registerThreadWithOwnership.bind(f.boundary.service);
    vi.spyOn(f.boundary.service, 'registerThreadWithOwnership').mockImplementation(async (binding, source) => {
      await originalRegistration(binding, source);
      registeredThread = binding.threadId; registered.resolve(); await releaseRegistration.promise;
    });
    const prepare = vi.spyOn(InProcessTaskRuntimeHost.prototype, 'prepareTask');
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++modelCalls === 1) yield { type: 'tool_use', id: 'unthreaded-write', name: 'write', input: { file_path: effect, content: 'UNTHREADED_USER_SUBMISSION' } };
      else { await releaseModel.promise; yield { type: 'text', delta: 'done' }; }
    });
    cleanup.push(async () => {
      releaseRegistration.resolve(); if (taskId) await f.services.cancelTask(taskId); releaseModel.resolve();
    });
    const before = await f.getAuthorization();
    const result = f.services.createTask({ prompt: 'Write the requested receipt.', materials: [] })
      .then(value => { taskId = value.taskId; return { value }; }, error => ({ error }));
    await registered.promise;
    expect(registeredThread).toMatch(/^local_/); expect(f.store.getThread(registeredThread)).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled(); expect(modelCalls).toBe(0);
    if (regrant) {
      await f.setAuthorization(authorizationRequest(before, false, 'revoke-during-thread-registration'));
      await f.setAuthorization(authorizationRequest(await f.getAuthorization(), true, 'grant-after-thread-registration'));
    }
    releaseRegistration.resolve(); const settled = await result;
    if ('value' in settled) await vi.waitFor(() => expect(existsSync(effect)).toBe(true));
    if (regrant) {
      expect.soft(settled).toHaveProperty('error'); expect.soft(prepare).not.toHaveBeenCalled();
      expect.soft(modelCalls).toBe(0); expect.soft(existsSync(effect)).toBe(false);
    } else {
      expect(settled).toHaveProperty('value.taskId'); expect(prepare).toHaveBeenCalledOnce();
      expect(readFileSync(effect, 'utf8')).toBe('UNTHREADED_USER_SUBMISSION');
    }
  });
});
