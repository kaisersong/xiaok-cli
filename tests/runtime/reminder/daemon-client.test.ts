import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReminderClientService } from '../../../src/runtime/reminder/client.js';
import { ReminderDaemonServer } from '../../../src/runtime/reminder/daemon.js';
import { resolveReminderDaemonSocketPath } from '../../../src/runtime/reminder/ipc.js';
import { SQLiteReminderStore } from '../../../src/runtime/reminder/store.js';
import { waitFor } from '../../support/wait-for.js';

describe('reminder daemon client', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivers reminders to the matching registered session through the daemon', async () => {
    const workspaceRoot = join(tmpdir(), `xiaok-reminder-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const socketPath = resolveReminderDaemonSocketPath(`deliver-${Date.now()}`);
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.xiaok', 'state'), { recursive: true });
    let now = Date.UTC(2026, 3, 19, 1, 0, 0);
    const received: string[] = [];

    const daemon = new ReminderDaemonServer({
      socketPath,
      now: () => now,
      scanIntervalMs: 60_000,
    });
    await daemon.start();

    const client = new ReminderClientService({
      workspaceRoot,
      socketPath,
      sessionId: 'sess_1',
      creatorUserId: 'user_1',
      defaultTimeZone: 'Asia/Shanghai',
      autoStart: false,
    });
    await client.start();
    client.registerInChatSink('sess_1', (message) => {
      received.push(message);
    });

    const created = await client.createStructured({
      sessionId: 'sess_1',
      creatorUserId: 'user_1',
      content: '发日报',
      scheduleAt: new Date(now + 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    });

    expect(created.ok).toBe(true);

    now += 60_000;
    await daemon.runOnceForWorkspace(workspaceRoot);

    await waitFor(() => {
      expect(received).toEqual(['提醒：发日报']);
    });

    await client.dispose();
    await daemon.stop();
  });

  it('keeps the daemon healthy when a client disconnects and marks the reminder as offline instead of retrying forever', async () => {
    const workspaceRoot = join(tmpdir(), `xiaok-reminder-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const socketPath = resolveReminderDaemonSocketPath(`offline-${Date.now()}`);
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.xiaok', 'state'), { recursive: true });
    let now = Date.UTC(2026, 3, 19, 1, 0, 0);

    const daemon = new ReminderDaemonServer({
      socketPath,
      now: () => now,
      scanIntervalMs: 60_000,
    });
    await daemon.start();

    const client = new ReminderClientService({
      workspaceRoot,
      socketPath,
      sessionId: 'sess_offline',
      creatorUserId: 'user_1',
      defaultTimeZone: 'Asia/Shanghai',
      autoStart: false,
    });
    await client.start();

    const created = await client.createStructured({
      sessionId: 'sess_offline',
      creatorUserId: 'user_1',
      content: '发日报',
      scheduleAt: new Date(now + 60_000).toISOString(),
      timezone: 'Asia/Shanghai',
    });
    expect(created.ok).toBe(true);
    await client.dispose();
    await waitFor(() => {
      expect(daemon.getStatus().activeSessions).toBe(0);
    });

    now += 60_000;
    await daemon.runOnceForWorkspace(workspaceRoot);

    const store = new SQLiteReminderStore(join(workspaceRoot, '.xiaok', 'state', 'reminders.sqlite'));
    try {
      const reminderId = created.ok ? created.reminder.reminderId : 'missing';
      expect(store.getReminder(reminderId)).toMatchObject({
        status: 'failed',
        retryCount: 1,
        lastError: 'target session offline',
      });
      expect(daemon.getStatus()).toMatchObject({
        running: true,
        activeSessions: 0,
      });
    } finally {
      store.dispose();
      await daemon.stop();
    }
  });
});
