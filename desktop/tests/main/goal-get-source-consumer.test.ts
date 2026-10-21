// @vitest-environment node
// Ordinary real source binding and public read only; protected/native business qualification stays OPEN.
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-get-source', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { DesktopGoalCoordinator, type DesktopGoalProjection } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { goalGetFixture, originalServiceDelegate, goalState } from '../support/goal-get-fixture.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';

it('original whole getter reads actual ordinary SQLite state through its unchanged Services expression, observer and registrar', async () => {
  // Do not enter installed account-generation/controller SDK from this ordinary fixture.
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('goal_get_real_source_fixture_platform_NOT_READY');
  const installation = process.platform === 'darwin' ? '/Library/Application Support/xiaok-verification' : '/var/lib/xiaok-verification';
  if (existsSync(installation)) throw Error('goal_get_real_source_fixture_protected_route_NOT_READY');
  const root = mkdtempSync(join(tmpdir(), 'goal-get-real-')), file = join(root, 'goals.db');
  const store = new SqliteGoalStore(file);
  const forbidden = async (): Promise<never> => { throw Error('goal_get_must_not_start_task_host'); };
  const coordinator = new DesktopGoalCoordinator({ store, taskHost: { prepareTask: forbidden, startTask: forbidden, cancelTask: forbidden }, instanceId: 'ordinary-query-fixture' });
  let f: Awaited<ReturnType<typeof goalGetFixture>> | undefined;
  try {
    resetIpcSchemaRegistryForTests();
    f = await goalGetFixture(originalServiceDelegate(coordinator));
    expect(await f.invoke()).toBeNull();
    // Own historical SQLite fixture; never GoalService.create/commit/nativeProjection/journal.put.
    const seed = new DatabaseSync(file);
    try {
      const state = goalState();
      seed.prepare('insert into goals(goal_id,session_id,revision,epoch,state_json,created_at,updated_at) values (?,?,?,?,?,?,?)')
        .run(state.goalId, state.sessionId, state.revision, state.epoch, JSON.stringify(state), state.createdAt, state.updatedAt);
      seed.prepare('insert into goal_sessions(session_id,current_goal_id,updated_at) values (?,?,?)').run('thread', 'goal', 1000);
    } finally { seed.close(); }
    const stateBefore = (await store.load('thread'))!.state;
    const actual = await f.invoke();
    expect(actual).toEqual({ state: stateBefore, activation: 'disarmed', currentCompletion: { kind: 'ordinary' } });
    exerciseOriginalChatConsumers(actual as DesktopGoalProjection);
    expect((await store.load('thread'))!.state).toEqual(stateBefore);
    coordinator.stopAccepting();
    await expect(f.invoke()).rejects.toThrow('goal_coordinator_closed');
    expect(f.gate.outstanding).toBe(0);
  } finally {
    if (f) await f.close();
    coordinator.stopAccepting();
    expect(await coordinator.drainShutdown(1500)).toBe(true);
    store.close(); rmSync(root, { recursive: true, force: true });
  }
});
function exerciseOriginalChatConsumers(row: DesktopGoalProjection): void {
  // This is original consumer-source execution; not a mounted Chat/full UI acceptance.
  const source = readFileSync(new URL('../../renderer/src/components/ChatShell.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('ChatShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let apply: ts.ArrowFunction | undefined;
  const callbacks: ts.ArrowFunction[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'applyGoal' && n.initializer && ts.isCallExpression(n.initializer)) {
      const first = n.initializer.arguments[0]; if (first && ts.isArrowFunction(first)) apply = first;
    }
    if (ts.isCallExpression(n) && n.expression.getText(ast) === 'desktop.getGoal(taskId).then') {
      const first = n.arguments[0]; if (first && ts.isArrowFunction(first)) callbacks.push(first);
    }
    ts.forEachChild(n, visit);
  }; visit(ast);
  if (!apply || callbacks.length !== 2) throw Error('original_goal_get_chat_consumer_population_changed');
  const js = (node: ts.Node) => ts.transpileModule(`return (${node.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const states: unknown[] = [];
  let current: unknown = null;
  const setGoal = (update: (previous: unknown) => unknown) => { current = update(current); states.push(current); };
  const consume = compileFunction(js(apply), ['setGoal'])(setGoal) as (value: unknown) => void;
  consume(row); expect(current).toEqual(row);
  const newer = { ...row, state: { ...row.state, revision: 2 } };
  consume(newer); consume(row); expect(current).toEqual(newer);
  let live = true;
  const initial = compileFunction(js(callbacks[0]!), ['initialCurrent', 'goalReadGeneration', 'applyGoal'])(() => live, 0, consume) as (value: unknown) => void;
  initial(newer); live = false; const count = states.length; initial(null); expect(states).toHaveLength(count);
  const scope = {}, attempt = {}, scopeRef = { current: scope }, attemptRef = { current: attempt };
  const refresh = compileFunction(js(callbacks[1]!), ['live', 'liveRenderScope', 'renderScope', 'generation', 'goalReadGeneration', 'goalAttemptRef', 'attempt', 'applyGoal'])
    (true, scopeRef, scope, 1, 1, attemptRef, attempt, consume) as (value: unknown) => void;
  refresh(newer); const after = states.length; attemptRef.current = {}; refresh(null); expect(states).toHaveLength(after);
}
