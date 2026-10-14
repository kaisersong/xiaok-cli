// R35 owner-copy SOURCE fixture. Ports represent public transport DATA only, NOT prepared tasks/SDK authority.
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { createDesktopServices } from '../../electron/desktop-services.js';
type DesktopServices = ReturnType<typeof createDesktopServices>;
import type { DesktopGoalMutationResult } from '../../electron/preload-api.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { createGoalState } from '../../../src/runtime/goal/reducer.js';
import { actualQueryAuthorizers } from './goal-native-query-fixture.js';
export const METHODS = ['create', 'resume', 'replace'] as const;
export type Method = typeof METHODS[number];
export type Input = Parameters<DesktopServices['createGoal']>[0] | Parameters<DesktopServices['resumeGoal']>[0];
export type Reply = DesktopGoalMutationResult;
export type Producer = (input: Input) => Promise<Reply>;
export const NativePromise = Promise;
export const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const turn = () => new NativePromise<void>(resolve => setImmediate(resolve));
export function payload(method: Method): Input {
  return method === 'resume' ? { threadId: 'thread', requestId: REQUEST_ID, turnLimit: 3 }
    : { threadId: 'thread', requestId: REQUEST_ID, objective: 'Original input', completionCriterion: 'Answer', expectedEvidenceKinds: ['answer'], turnLimit: 3 };
}
// Existing parser input data only. Does not enroll owner, authorize workflow or issue a review.
export function definitionData() {
  return { version: 1, obligations: [{ obligationId: 'criteria', predicateId: 'content', predicateVersion: '1', semantics: 'current-subject',
    recipe: { kind: 'artifact-content', checks: [{ id: 'content', path: 'result.txt', sha256: 'a'.repeat(64), structure: 'utf8' }] } }] };
}
export function publicReply(method: Method, requestId: string | null = REQUEST_ID): Reply {
  const state = createGoalState({ sessionId: 'thread', objective: 'Transport DATA, not a TaskHost success', expectedEvidenceKinds: ['answer'], now: 100 });
  return { goal: { state, activation: 'armed', currentCompletion: { kind: 'ordinary' } }, preparedTask: {
    attachmentId: 'transport-data-only', attachmentSource: { kind: 'request', requestId }, threadId: 'thread', taskId: 'transport-data-only',
    executionScope: { kind: 'goal_turn', origin: method === 'resume' ? 'continuation' : 'user', goalId: state.goalId, epoch: state.epoch, goalTurnId: 'transport-data-only', threadId: 'thread' },
    goalRef: { goalId: state.goalId, revision: state.revision }, expiresAt: 1000,
  } };
}
export async function fixture(overrides: Partial<Record<Method, Producer>> = {}, omitFiner = false) {
  const root = mkdtempSync(join(tmpdir(), 'goal-task-transport-'));
  const frame = { url: process.env['XIAOK_DESKTOP_DEV_SERVER'] ?? pathToFileURL(resolve('dist/renderer/index.html')).href };
  const target = Object.assign(new EventEmitter(), { id: 91, mainFrame: frame, destroyed: false, isDestroyed() { return this.destroyed; }, send() { throw Error('FORBIDDEN_BUSINESS_EVENT'); } });
  const recorder = Object.assign(new EventEmitter(), { id: 92, mainFrame: frame, isDestroyed: () => false });
  const window = { webContents: target, isDestroyed: () => false };
  const calls: Array<{ method: Method; input: Input; receiver: unknown }> = [];
  const dispatch = (method: Method, input: Input, receiver: unknown) => { calls.push({ method, input, receiver }); const producer = overrides[method]; return producer ? producer(input) : NativePromise.resolve(publicReply(method, input.requestId ?? null)); };
  const services = { multiAgent: undefined, getDataRoot: () => root,
    createGoal(input: Parameters<DesktopServices['createGoal']>[0]) { return dispatch('create', input, this); },
    resumeGoal(input: Parameters<DesktopServices['resumeGoal']>[0]) { return dispatch('resume', input, this); },
    replaceGoal(input: Parameters<DesktopServices['replaceGoal']>[0]) { return dispatch('replace', input, this); },
  };
  const auth = actualQueryAuthorizers(window, { ownsWebContents: (sender: unknown) => sender === recorder }, services);
  const gate = new DesktopShutdownGate(), handlers = new Map<string, IpcHandlerListener>(), cleanup: Array<() => void> = [];
  const registrar = new ShutdownAwareIpcMain({ handle: (channel, handler) => handlers.set(channel, handler) }, gate, auth.coarse);
  try { await registerDesktopIpc(registrar, window as never, services as never, { multiAgentAuthorize: omitFiner ? undefined : auth.finer, registerLifetimeDisposer: fn => cleanup.push(fn) }); }
  catch (error) {
    const failures: unknown[] = [error];
    gate.close();
    let drained = false;
    try { drained = await gate.drain(1500); } catch (failure) { failures.push(failure); }
    finally { for (const fn of cleanup.splice(0)) { try { fn(); } catch (failure) { failures.push(failure); } } }
    if (drained) { try { rmSync(root, { recursive: true, force: true }); } catch (failure) { failures.push(failure); } }
    else failures.push(Object.assign(Error('ordinary_transport_setup_drain_incomplete'), { ownRoot: root, outstanding: gate.describeOutstanding() }));
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, 'ordinary_transport_setup_cleanup_failed: ' + root);
  }
  const event = { sender: target, senderFrame: frame };
  const invoke = (method: Method, args: unknown[] = [payload(method)], source: unknown = event) => handlers.get('desktop:goal:' + method)!(source as never, ...args) as Promise<Reply>;
  const close = async () => {
    gate.close();
    let drained = false;
    const failures: unknown[] = [];
    try { drained = await gate.drain(1500); } catch (error) { failures.push(error); }
    finally { for (const fn of cleanup.splice(0)) { try { fn(); } catch (error) { failures.push(error); } } }
    if (!drained) {
      // Keep own evidence/root while accepted work is genuinely unresolved. Never release its token.
      failures.push(Object.assign(Error('ordinary_transport_drain_incomplete'), { ownRoot: root, outstanding: gate.describeOutstanding() }));
    } else {
      try { rmSync(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'ordinary_transport_cleanup_failed: ' + root);
  };
  return { invoke, calls, services, event, frame, target, recorder, gate, close };
}
