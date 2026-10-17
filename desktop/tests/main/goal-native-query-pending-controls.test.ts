// UNREVIEWED/UNAPPLIED TEST PROPOSAL. Intended destination: desktop/tests/main/.
// Requires owner's approved getter fixture assembly; not an execution ticket.
// Every fork/owner/hash below is scripted journal JSON, never native authority.
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/query-register', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { queryFixture, queryRecord } from '../support/goal-native-query-fixture.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { createPreloadApi } from '../../electron/preload-api.js';
import { goalVerificationRegistration } from '../../../src/runtime/goal/verification-definition.js';
import { goalApplicationBindingHash } from '../../../src/runtime/verification/goal-application-binding.js';
import { goalRegistrationHash, type GoalForkSourceSnapshot } from '../../../src/runtime/verification/owner-enrollment-review.js';
import type { GoalNativeMutation } from '../../../src/runtime/goal/native-mutation-journal.js';
const owned: Array<Awaited<ReturnType<typeof queryFixture>>> = [];
async function fixture() { resetIpcSchemaRegistryForTests(); const f = await queryFixture(); owned.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); for (const f of owned.splice(0)) await f.close(); });

it('reads a complete scripted fork history through original FileJournal/Services/getter/registrar without issuing anything', async () => {
  const f = await fixture(), base = queryRecord('fork-summary');
  const application = { ...base.target, sessionId: 'scripted-source-session', goalId: 'scripted-source-goal' };
  const registration = goalVerificationRegistration(base.definition);
  const snapshot: GoalForkSourceSnapshot = {
    source: { authorityId: 'scripted-history-not-issued', owner: { profileId: 'scripted-profile', ownerKind: 'goal', ownerId: application.goalId },
      sessionId: application.sessionId, applicationHash: goalApplicationBindingHash(application), registrationHash: goalRegistrationHash(registration),
      // Original parser checks format here, NOT existence of a registered source.
      obligationSetHash: 'c'.repeat(64), dependencies: [] }, registration, application,
  };
  const fork: GoalNativeMutation = { ...base, kind: 'fork', previous: null,
    target: { ...base.target, goalId: 'scripted-fork-target' }, forkSource: { stateHash: 'b'.repeat(64), snapshot } };
  f.write([fork]); const bytes = readFileSync(f.file);
  const row = await f.invoke();
  expect(row).toEqual({ id: 'fork-summary', kind: 'fork', status: 'reserved', objective: 'Original query' });
  if (typeof row !== 'object' || row === null) throw Error('query_summary_object_required');
  expect(Object.keys(row).sort()).toEqual(['id', 'kind', 'objective', 'status']);
  expect(row).not.toHaveProperty('forkSource'); expect(row).not.toHaveProperty('definition');
  expect(row).not.toHaveProperty('enrollmentRequestId'); expect(row).not.toHaveProperty('applicationRequestId');
  expect(readFileSync(f.file)).toEqual(bytes); expect(f.forbiddenHostCalls()).toBe(0);
  // Schema read + exact public projection only; NOT real fork/native source proof.
});

it.skipIf(process.platform === 'win32')('real nonregular journal entry is rejected by original bounded loader', async () => {
  const f = await fixture(); mkdirSync(f.file);
  await expect(f.invoke()).rejects.toThrow('goal_native_journal_capacity');
  expect(statSync(f.file).isDirectory()).toBe(true); expect(f.gate.outstanding).toBe(0); expect(f.forbiddenHostCalls()).toBe(0);
});

// A real non-root POSIX process is required. Root/Windows cannot manufacture this
// observation; explicit skip stays a missing platform control, not a green receipt.
it.skipIf(process.platform === 'win32' || !process.geteuid || process.geteuid() === 0)('propagates actual EACCES on its own unreadable journal without altering OS identity', async () => {
  const f = await fixture(); f.write([queryRecord()]); const mode = statSync(f.file).mode & 0o777;
  try {
    chmodSync(f.file, 0o000);
    let actualError: unknown;
    try { await f.invoke(); } catch (error) { actualError = error; }
    expect(actualError).toBeInstanceOf(Error);
    if (typeof actualError !== 'object' || actualError === null || !('code' in actualError)) throw actualError;
    expect(actualError.code).toBe('EACCES'); expect(f.gate.outstanding).toBe(0); expect(f.forbiddenHostCalls()).toBe(0);
  } finally { chmodSync(f.file, mode); }
});

it('rechecks original finer Main authority after an accepted real query before returning its DTO', async () => {
  const f = await fixture(); f.write([queryRecord()]); const bytes = readFileSync(f.file), load = vi.spyOn(f.journal, 'load'), url = f.frame.url;
  const pending = f.invoke();
  expect(load).toHaveBeenCalledOnce(); // Actual synchronous file read already happened.
  queueMicrotask(() => { f.frame.url = 'https://untrusted.invalid/'; });
  try { await expect(pending).rejects.toThrow('goal_native_query_sender_forbidden'); }
  finally { f.frame.url = url; }
  expect(readFileSync(f.file)).toEqual(bytes); expect(f.gate.outstanding).toBe(0); expect(f.forbiddenHostCalls()).toBe(0);
  // Revoked output is not proof the already accepted IO was rolled back.
});

it('original IPC/coordinator shutdown owners join a genuinely in-flight getter Promise', async () => {
  const f = await fixture(); f.write([queryRecord()]); const pending = f.invoke();
  expect(f.gate.outstanding).toBe(1);
  f.gate.close(); f.coordinator.stopAccepting();
  const ipcJoined = f.gate.drain(1500), queryJoined = f.coordinator.drainShutdown(1500);
  expect(f.gate.outstanding).toBe(1);
  expect(await pending).toEqual({ id: 'summary', kind: 'create', status: 'reserved', objective: 'Original query' });
  expect(await ipcJoined).toBe(true); expect(await queryJoined).toBe(true); expect(f.gate.outstanding).toBe(0);
  expect(f.forbiddenHostCalls()).toBe(0);
  // Actual async JS settlement; synchronous journal IO has already finished.
  // No native resource-release, deliberate held IO, or timeout extension claimed.
});

function actualConsumerBodies() {
  // Original desktop cwd/config is required; no JSDOM import.meta URL file shim.
  const source = readFileSync(resolve('renderer/src/components/ChatShell.tsx'), 'utf8');
  const ast = ts.createSourceFile('ChatShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const chains: ts.CallExpression[] = [], initials: ts.ArrowFunction[] = [], currents: ts.ArrowFunction[] = [], refreshes: ts.ArrowFunction[] = [];
  const queryCall = (n: ts.Node): boolean => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && n.expression.expression.getText(ast) === 'desktop' && n.expression.name.text === 'getGoalNativeMutation'
    && n.arguments.length === 1 && n.arguments[0]?.getText(ast) === 'taskId';
  const thenCall = (n: ts.Node): boolean => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && n.expression.name.text === 'then' && queryCall(n.expression.expression);
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'catch' && thenCall(n.expression.expression)) chains.push(n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      if (n.name.text === 'initialCurrent' && ts.isArrowFunction(n.initializer)) initials.push(n.initializer);
      if (n.name.text === 'refreshGoalNative' && ts.isArrowFunction(n.initializer)) refreshes.push(n.initializer);
      if (n.name.text === 'currentAttempt' && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(ast) === 'useCallback'
        && n.initializer.arguments[0] && ts.isArrowFunction(n.initializer.arguments[0])) currents.push(n.initializer.arguments[0]);
    }
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (chains.length !== 1 || initials.length !== 1 || currents.length !== 1 || refreshes.length !== 1) throw Error('actual_query_consumer_population_changed');
  return { chain: chains[0]!.getText(ast), initial: initials[0]!.getText(ast), current: currents[0]!.getText(ast), refresh: refreshes[0]!.getText(ast) };
}
function body(js: string) { return ts.transpileModule(js, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText; }

it('complete real getter DTO traverses actual TS preload and unmodified ChatShell initial/refresh/current guards', async () => {
  const f = await fixture(); f.write([queryRecord()]);
  const unexpected = () => { throw Error('query_consumer_unexpected_dependency'); };
  const desktop = createPreloadApi({ invoke(channel: string, ...args: unknown[]) {
    if (channel !== 'desktop:goal:getNativeMutation') throw Error('query_consumer_unexpected_channel');
    return f.invoke(structuredClone(args)); // Normal Electron input data transport, not a surrogate query producer.
  }, on: unexpected, removeListener: unexpected, off: unexpected, send: unexpected });
  const real = actualConsumerBodies(), set = vi.fn(), scope: object = {};
  const liveRenderScope: { current: object | null } = { current: scope };
  const attempt = { scope }, goalAttemptRef: { current: { scope: object } | null } = { current: attempt };
  // Only a synthetic display scope/ref environment; original source guards are used.
  const initial = compileFunction(body(`let live=true;const renderScope=liveRenderScope.current;const capturedAttempt=goalAttemptRef.current;
    const initialCurrent=${real.initial};return {run:()=>(${real.chain}),retire:()=>{live=false;}};`),
    ['desktop', 'taskId', 'liveRenderScope', 'goalAttemptRef', 'setGoalNativeMutation'])(desktop, 'thread', liveRenderScope, goalAttemptRef, set) as { run(): Promise<unknown>; retire(): void };
  const current = compileFunction(body(`return (${real.current});`), ['liveRenderScope', 'goalAttemptRef'])(liveRenderScope, goalAttemptRef) as (a: unknown) => boolean;
  const refresh = compileFunction(body(`return (${real.refresh});`), ['getDesktopApi', 'taskId', 'currentAttempt', 'setGoalNativeMutation'])(() => desktop, 'thread', current, set) as (a: unknown) => Promise<void>;
  const expected = { id: 'summary', kind: 'create', status: 'reserved', objective: 'Original query' };
  await initial.run(); expect(set).toHaveBeenLastCalledWith(expected);
  initial.retire(); await initial.run(); expect(set).toHaveBeenCalledTimes(1);
  await refresh(attempt); expect(set).toHaveBeenLastCalledWith(expected); expect(set).toHaveBeenCalledTimes(2);
  goalAttemptRef.current = { scope }; await refresh(attempt); expect(set).toHaveBeenCalledTimes(2);
  liveRenderScope.current = null; await refresh(goalAttemptRef.current); expect(set).toHaveBeenCalledTimes(2);
  unlinkSync(f.file); liveRenderScope.current = scope; await refresh(goalAttemptRef.current); expect(set).toHaveBeenLastCalledWith(null);
  mkdirSync(f.file); await refresh(goalAttemptRef.current); expect(set).toHaveBeenCalledTimes(3);
  expect(f.forbiddenHostCalls()).toBe(0); expect(f.gate.outstanding).toBe(0);
  // Actual source-extracted consumer bodies, NOT mounted React/whole Goal UI acceptance.
});
