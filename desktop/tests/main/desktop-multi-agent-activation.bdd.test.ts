// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiAgentCoordinator, type ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';

const caller = { requestSource: 'agent' as const, callerId: 'main' };
describe('BDD: shared coordinator externally activated turns', () => {
  const coordinators: MultiAgentCoordinator[] = [];
  afterEach(async () => { for (const coordinator of coordinators.splice(0)) await coordinator.dispose(); });
  function setup(maxResidentAgents = 9) {
    const coordinator = new MultiAgentCoordinator({ executionMode: 'externally_activated', maxResidentAgents, closeSettlementTimeoutMs: 5 });
    coordinators.push(coordinator);
    const session: ManagedAgentSession = { run: vi.fn(async () => 'done'), suspend: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    const factory = vi.fn(async () => session);
    return { coordinator, session, factory };
  }
  it('A19/A41 Given externally activated mode, When two prepares reserve the remaining slots, Then no factory/run executes and runtimeResident remains false', async () => {
    const { coordinator, factory, session } = setup(3);
    const a = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: factory });
    const b = coordinator.prepareSpawn({ ...caller, taskName: 'b', message: 'two', createSession: factory });
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled(); expect(session.run).not.toHaveBeenCalled();
    expect(coordinator.listAgents(caller).filter(agent => agent.id !== 'main')).toEqual([
      expect.objectContaining({ id: a.agentId, preparedReservation: true, runtimeResident: false, executionActive: false }),
      expect.objectContaining({ id: b.agentId, preparedReservation: true, runtimeResident: false, executionActive: false }),
    ]);
    expect(() => coordinator.prepareSpawn({ ...caller, taskName: 'c', message: 'three', createSession: factory })).toThrow(/capacity/);
  });
  it('A32 Given a prepared name, When a duplicate prepares or another handle rolls back, Then canonical ownership cannot be stolen', () => {
    const { coordinator, factory } = setup();
    const a = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: factory });
    expect(() => coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'duplicate', createSession: factory })).toThrow(/exists/);
    coordinator.rollbackPrepared(a);
    const next = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'new operation', createSession: factory });
    coordinator.rollbackPrepared(a);
    expect(next.agentId).not.toBe(a.agentId);
    expect(() => coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'still duplicate', createSession: factory })).toThrow(/exists/);
    expect(coordinator.listAgents(caller).find(agent => agent.id === a.agentId)).toMatchObject({ status: 'closed', resourcesReleased: true, preparedReservation: false });
  });
  it('A31 Given activation has synchronously installed its execution handle, When cancel arrives before its first microtask, Then factory stays uncalled and settlement remains observable', async () => {
    const { coordinator, factory } = setup();
    const prepared = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: factory });
    const execution = coordinator.activatePreparedTurn(prepared);
    expect(coordinator.listAgents(caller).find(agent => agent.id === prepared.agentId)?.executionActive).toBe(true);
    coordinator.interruptAgent({ ...caller, target: prepared.agentId });
    await execution.settled;
    expect(factory).not.toHaveBeenCalled();
    expect(coordinator.listAgents(caller).find(agent => agent.id === prepared.agentId)).toMatchObject({ status: 'interrupted', executionActive: false });
  });
  it('A31 Given factory initialization is in flight, When the upstream lifetime aborts, Then the exact factory signal aborts without a fake release', async () => {
    const { coordinator } = setup();
    const controller = new AbortController();
    let finish!: (session: ManagedAgentSession) => void;
    let factorySignal!: AbortSignal;
    const prepared = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: async (_identity, signal) => {
      factorySignal = signal;
      return new Promise(resolve => { finish = resolve; });
    } });
    const execution = coordinator.activatePreparedTurn(prepared, { signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort();
    expect(factorySignal.aborted).toBe(true);
    const close = await coordinator.closeAgent({ ...caller, target: prepared.agentId });
    expect(close).toMatchObject({ resourcesReleased: false, cleanupPending: true });
    finish({ run: vi.fn(), dispose: vi.fn(async () => {}) });
    await execution.settled;
  });
  it('A32 Given a suspended completed child, When followup is prepared, Then turn increments only once and activation alone resumes its history-bearing session', async () => {
    const { coordinator, factory, session } = setup();
    const first = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: factory });
    await coordinator.activatePreparedTurn(first).settled;
    const next = coordinator.prepareFollowup({ ...caller, target: first.agentId, message: 'two' });
    expect(next.expectedTurn).toBe(2);
    expect(session.run).toHaveBeenCalledTimes(1);
    await coordinator.activatePreparedTurn(next).settled;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(session.run).toHaveBeenCalledTimes(2);
    expect(coordinator.listAgents(caller).find(agent => agent.id === first.agentId)?.turn).toBe(2);
  });
  it('A19 Given external mode, When a caller tries legacy automatic spawn/followup, Then the applied barrier cannot be bypassed', async () => {
    const { coordinator, factory } = setup();
    await expect(coordinator.spawn({ ...caller, taskName: 'a', message: 'one', createSession: factory })).rejects.toThrow(/external|prepare/);
    expect(() => coordinator.followupTask({ ...caller, target: 'main', message: 'two' })).toThrow(/external|prepare/);
    expect(factory).not.toHaveBeenCalled();
  });
  it('A15 Given an activated resource owner, When rollback is attempted, Then no live reservation or execution is released', async () => {
    const { coordinator, factory } = setup();
    const prepared = coordinator.prepareSpawn({ ...caller, taskName: 'a', message: 'one', createSession: factory });
    const execution = coordinator.activatePreparedTurn(prepared);
    expect(() => coordinator.rollbackPrepared(prepared)).toThrow(/activated|live/);
    await execution.settled;
    expect(coordinator.listAgents(caller).find(agent => agent.id === prepared.agentId)?.status).toBe('completed');
  });
});
