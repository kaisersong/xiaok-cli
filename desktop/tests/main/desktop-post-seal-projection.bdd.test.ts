// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { MultiAgentProjection } from '../../renderer/src/lib/multi-agent-projection.js';
import { createPostSealHarness, bounded, deferred, type PostSealHarness, type DeliveryReportFixture } from '../fixtures/desktop-post-seal-harness.js';

describe('R4 actual SQLite delivery events through the existing renderer projection', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  async function setup() {
    const tail = deferred(); const f = await createPostSealHarness({ runnerTail: () => tail.promise });
    cleanup.push(() => f.close()); cleanup.push(() => tail.resolve());
    const id = await f.start(); await bounded(f.rootSealed.promise);
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'reader', threadId: 'post-seal-thread', profileId: 'profile', workspaceId: 'workspace' });
    const read = () => f.service.getSnapshot({ access, groupId: f.groupId });
    const binding = f.store.getRootBinding(id)!;
    const report: DeliveryReportFixture = { source: { sourceTaskId: id, groupId: f.groupId, rootTurnId: binding.rootTurnId,
      preparationId: binding.preparationId, bootId: binding.bootId, rootEpoch: binding.rootEpoch }, delivery: {
      version: 1, revision: 2, status: 'failed', stage: 'settle', verification: 'failed', hostSettlement: 'committed', readerCleanup: 'settled', storeCleanup: 'settled',
      startedAt: 1, deadlineAt: 100, decisionAt: 99, finishedAt: 101, hostTerminalStatus: 'failed',
      guardFailure: { code: 'delivery_timeout', stage: 'snapshot', needsExplicitFollowup: true },
    } };
    return { f, read, report };
  }
  function append(f: PostSealHarness, report: DeliveryReportFixture) {
    // Fixture persistence creates event input, not a replacement reducer or
    // a permission bypass claim. Authority behavior is tested separately.
    return f.store.appendEvent(f.groupId, { kind: 'delivery' as never, agentId: `root_${f.groupId}`, turnId: report.source.rootTurnId, payload: { ...report } });
  }

  it('D9 replay/live duplicates preserve execution completed + delivery failed as separate facts', async () => {
    const { f, read, report } = await setup(); const projection = new MultiAgentProjection('post-seal-thread', 's');
    const initial = read(); projection.install(initial); projection.replay(f.store.readEvents(f.groupId, 0));
    const event = append(f, report);
    projection.receive({ subscriptionId: 's', envelope: event }); projection.replay([event, event]);
    expect(projection.view().root).toMatchObject({ status: 'completed', hostDeliveryStatus: 'failed',
      guardFailure: { code: 'delivery_timeout' }, hostDeliveryCleanupPending: false });
    expect(projection.view().agents.find(agent => agent.id === f.childId)?.status).toBe('running');
    expect(projection.details(`root_${f.groupId}`).filter(item => item.eventId === event.eventId)).toHaveLength(1);
    const reconnected = new MultiAgentProjection('post-seal-thread', 'new-subscription');
    reconnected.install(initial); reconnected.replay(f.store.readEvents(f.groupId, 0));
    expect(reconnected.view().root).toEqual(projection.view().root);
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(4096);
  });

  it('D8/D9 late A event belongs in A timeline and cannot replace prepared B root fields', async () => {
    const { f, read, report } = await setup();
    const b = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'User next root', materials: [] });
    const initial = read(); const projection = new MultiAgentProjection('post-seal-thread', 's'); projection.install(initial); projection.replay(f.store.readEvents(f.groupId, 0));
    const before = structuredClone(projection.view().root);
    const event = append(f, report); projection.receive({ subscriptionId: 's', envelope: event });
    expect(projection.view().root).toEqual(before);
    expect(projection.view().root?.sourceTaskId).toBe(b.taskId);
    expect(projection.details(`root_${f.groupId}`).at(-1)).toMatchObject({ payload: { source: { sourceTaskId: report.source.sourceTaskId } } });
  });

  it.each(['sourceTaskId', 'rootTurnId', 'rootEpoch', 'groupId', 'bootId'] as const)('D8/D9 %s mismatch stays in history without changing current execution or delivery', async key => {
    const { f, read, report } = await setup();
    const projection = new MultiAgentProjection('post-seal-thread', 's'); projection.install(read()); projection.replay(f.store.readEvents(f.groupId, 0));
    const before = structuredClone(projection.view().root);
    Object.assign(report.source, { [key]: key === 'rootEpoch' ? report.source.rootEpoch + 1 : 'another-owner' });
    const event = append(f, report); projection.receive({ subscriptionId: 's', envelope: event });
    expect(projection.view().root).toEqual(before);
    expect(projection.details(`root_${f.groupId}`).at(-1)?.eventId).toBe(event.eventId);
  });

  it('D9 unknown cleanup is independent of execution resources, and a new source snapshot clears the old delivery projection', async () => {
    const { f, read, report } = await setup(); const initial = read();
    const projection = new MultiAgentProjection('post-seal-thread', 's'); projection.install(initial); projection.replay(f.store.readEvents(f.groupId, 0));
    Object.assign(report.delivery, { status: 'unknown', hostSettlement: 'unknown', readerCleanup: 'pending' });
    delete report.delivery.hostTerminalStatus; delete report.delivery.finishedAt;
    const event = append(f, report); projection.receive({ subscriptionId: 's', envelope: event });
    expect.soft(projection.view().root).toMatchObject({ status: 'completed', hostDeliveryStatus: 'unknown', hostDeliveryCleanupPending: true });
    expect(projection.view().root?.resourcesReleased).toBe(initial.root?.resourcesReleased);
    expect(projection.view().root?.executionActive).toBe(initial.root?.executionActive);
    const b = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Next explicit user root', materials: [] });
    projection.install(read());
    expect(projection.view().root).toMatchObject({ sourceTaskId: b.taskId, status: 'pending' });
    expect(projection.view().root?.hostDeliveryStatus).toBeUndefined();
    expect(projection.view().root?.guardFailure).toBeUndefined();
    expect(projection.view().root?.hostDeliveryCleanupPending).toBeUndefined();
  });
});
