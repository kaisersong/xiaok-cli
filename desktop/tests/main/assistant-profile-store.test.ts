import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantService } from '../../electron/assistant-service.js';
import {
  ASSISTANT_EVENING_LOOP_ID,
  ASSISTANT_MORNING_LOOP_ID,
  DEFAULT_PERSONAL_ASSISTANT_ID,
} from '../../electron/assistant-types.js';
import { LoopStore } from '../../electron/loop-store.js';
import { TimedActionService } from '../../electron/timed-action-service.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('AssistantService bootstrap', () => {
  let rootDir: string;
  let loopStore: LoopStore;
  let timedActionStore: TimedActionStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-assistant-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    loopStore = new LoopStore(join(rootDir, 'loop-evidence.sqlite'));
    timedActionStore = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
  });

  afterEach(() => {
    loopStore.close();
    timedActionStore.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates one needs-consent profile with two paused stable built-in loops and schedules', () => {
    const service = new AssistantService({
      loopStore,
      timedActionService: new TimedActionService(timedActionStore, { now: () => 1_000 }),
      now: () => 1_000,
    });

    const first = service.bootstrap();
    const second = service.bootstrap();

    expect(first).toEqual(second);
    expect(first.profile).toMatchObject({
      id: DEFAULT_PERSONAL_ASSISTANT_ID,
      status: 'needs_consent',
      timeZone: expect.any(String),
    });
    expect(loopStore.getLoopDefinition(ASSISTANT_EVENING_LOOP_ID)?.status).toBe('paused');
    expect(loopStore.getLoopDefinition(ASSISTANT_MORNING_LOOP_ID)?.status).toBe('paused');
    const schedules = timedActionStore.listActions({ includeInactive: true });
    expect(schedules).toHaveLength(2);
    expect(schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'assistant:default-personal-assistant:evening',
        status: 'paused',
        source: 'system',
        ownerKind: 'assistant',
        ownerId: DEFAULT_PERSONAL_ASSISTANT_ID,
        executor: { kind: 'loop', loopId: ASSISTANT_EVENING_LOOP_ID },
      }),
      expect.objectContaining({
        id: 'assistant:default-personal-assistant:morning',
        status: 'paused',
        source: 'system',
        ownerKind: 'assistant',
        ownerId: DEFAULT_PERSONAL_ASSISTANT_ID,
        executor: { kind: 'loop', loopId: ASSISTANT_MORNING_LOOP_ID },
      }),
    ]));
  });

  it('projects an active profile to both loops and schedules without creating duplicates', () => {
    const timedActionService = new TimedActionService(timedActionStore, { now: () => 1_000 });
    const service = new AssistantService({ loopStore, timedActionService, now: () => 1_000 });
    service.bootstrap();

    service.setStatus('active');
    service.bootstrap();

    expect(loopStore.getAssistantProfile(DEFAULT_PERSONAL_ASSISTANT_ID)?.status).toBe('active');
    expect(loopStore.getLoopDefinition(ASSISTANT_EVENING_LOOP_ID)?.status).toBe('active');
    expect(loopStore.getLoopDefinition(ASSISTANT_MORNING_LOOP_ID)?.status).toBe('active');
    expect(timedActionStore.listActions({ includeInactive: true })).toHaveLength(2);
    expect(timedActionStore.listActions({ includeInactive: true }).every(action => action.status === 'active')).toBe(true);
  });
});
