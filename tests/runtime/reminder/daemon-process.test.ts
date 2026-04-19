import { mkdirSync, rmSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { queryXiaokDaemonStatus, stopXiaokDaemon } from '../../../src/runtime/daemon/control.js';
import { ReminderClientService } from '../../../src/runtime/reminder/client.js';
import { resolveReminderDaemonSocketPath } from '../../../src/runtime/reminder/ipc.js';
import { waitFor } from '../../support/wait-for.js';

function canSpawnChildProcesses(): boolean {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'pipe',
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

async function waitForAsync(
  assertion: () => Promise<void>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'waitForAsync timed out'));
}

describe('reminder daemon real process', () => {
  const tempDirs: string[] = [];
  const children: ChildProcess[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && !child.killed) {
        child.kill();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;

  itIfCanSpawn('delivers a reminder end-to-end through a real xiaok daemon process', async () => {
    const workspaceRoot = join(tmpdir(), `xiaok-reminder-daemon-process-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const socketPath = resolveReminderDaemonSocketPath(`process-${Date.now()}`);
    const cliEntry = join(process.cwd(), '.test-dist', 'src', 'index.js');
    const received: string[] = [];
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.xiaok', 'state'), { recursive: true });

    const child = spawn(process.execPath, [cliEntry, 'daemon', 'serve', '--socket', socketPath], {
      cwd: process.cwd(),
      stdio: 'ignore',
      windowsHide: true,
    });
    children.push(child);

    await waitForAsync(async () => {
      const status = await queryXiaokDaemonStatus(socketPath);
      expect(status).toMatchObject({
        running: true,
        activeClients: 0,
        activeSessions: 0,
        serviceNames: ['reminder'],
      });
    }, {
      timeoutMs: 5_000,
      intervalMs: 100,
    });

    const client = new ReminderClientService({
      workspaceRoot,
      socketPath,
      sessionId: 'sess_real_process',
      creatorUserId: 'user_real_process',
      defaultTimeZone: 'Asia/Shanghai',
      autoStart: false,
    });

    try {
      await client.start();
      client.registerInChatSink('sess_real_process', (message) => {
        received.push(message);
      });

      const created = await client.createStructured({
        sessionId: 'sess_real_process',
        creatorUserId: 'user_real_process',
        content: '跨进程提醒',
        scheduleAt: new Date(Date.now() + 1_000).toISOString(),
        timezone: 'Asia/Shanghai',
      });

      expect(created).toMatchObject({
        ok: true,
      });

      await waitForAsync(async () => {
        expect(received).toEqual(['提醒：跨进程提醒']);
        const status = await queryXiaokDaemonStatus(socketPath);
        expect(status).toMatchObject({
          running: true,
          activeClients: 1,
          activeSessions: 1,
          serviceNames: ['reminder'],
        });
      }, {
        timeoutMs: 8_000,
        intervalMs: 100,
      });
    } finally {
      await client.dispose();
      await stopXiaokDaemon(socketPath);
      await waitFor(() => {
        expect(child.exitCode).not.toBeNull();
      }, {
        timeoutMs: 5_000,
        intervalMs: 100,
      });
    }
  }, 15_000);
});
