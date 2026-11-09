// @vitest-environment node
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasOriginalMainSdkBridgeInstallation } from '../../../src/runtime/verification/original-main-sdk-bridge.js';
import { RoomWorkspaceLocalStore } from '../../electron/room-workspace-local.js';
import { createRoomWorkspaceRuntime } from '../../electron/room-workspace-runtime.js';
import { createRoomWorkspaceRecovery } from '../../electron/room-workspace-recovery.js';

const birth = vi.hoisted(() => {
  const fs = process.getBuiltinModule('fs');
  const path = process.getBuiltinModule('path');
  const os = process.getBuiltinModule('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'room-native-recovery-'));
  const config = path.join(root, 'config');
  fs.mkdirSync(config, { mode: 0o700 });
  process.env.XIAOK_CONFIG_DIR = config;
  return { root };
});
// This only selects the actual installed-profile rejection branch. It never
// grants Native authority or supplies an OS terminal proof.
vi.mock(
  '../../../src/runtime/verification/original-main-sdk-bridge.js',
  async (original) => ({
    ...(await original<object>()),
    hasOriginalMainSdkBridgeInstallation: () => true,
  }),
);
const close: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (close.length) await close.pop()!();
});
afterAll(() => rmSync(birth.root, { recursive: true, force: true }));

function escaped() {
  expect(hasOriginalMainSdkBridgeInstallation()).toBe(true);
  const id = 'own-descendant-' + crypto.randomUUID();
  const dir = join(birth.root, id);
  mkdirSync(dir);
  const file = join(dir, 'child.json');
  const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(id)}],
      {detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    fs.writeFileSync(${JSON.stringify(file)},JSON.stringify({pid:child.pid,nonce:${JSON.stringify(id)}}));child.unref();`;
  const parent = spawnSync(process.execPath, ['-e', script], {
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  expect(parent.status, parent.stderr).toBe(0);
  const child = JSON.parse(readFileSync(file, 'utf8')) as {
    pid: number;
    nonce: string;
  };
  const command = () =>
    spawnSync('/bin/ps', ['-p', String(child.pid), '-o', 'command='], {
      encoding: 'utf8',
    }).stdout;
  expect(command()).toContain(id);
  expect(() => process.kill(parent.pid, 0)).toThrow();
  expect(() => process.kill(-parent.pid, 0)).toThrow();
  close.push(async () => {
    if (command().includes(id)) process.kill(child.pid, 'SIGTERM');
    let exited = false;
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(child.pid, 0);
      } catch (raw) {
        if ((raw as NodeJS.ErrnoException).code === 'ESRCH') {
          exited = true;
          break;
        }
        throw raw;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    console.log(
      JSON.stringify({
        ownerPid: parent.pid,
        ownerReaped: true,
        descendantPid: child.pid,
        nonce: id,
        ownDescendantExited: exited,
      }),
    );
    expect(exited).toBe(true);
  });
  return { dir, ownerPid: parent.pid, childPid: child.pid };
}

it('installed external recovery does not promote owner/group ESRCH while its detached descendant is live', async () => {
  const own = escaped();
  const store = new RoomWorkspaceLocalStore(join(own.dir, 'local.sqlite'));
  close.push(() => store.close());
  store.saveRecord('external-discussion-operation', 'escaped', {
    operationId: 'escaped',
    roomId: 'r',
    sourceMessageId: 'm',
    logicalAgentId: 'a',
    contextScope: { kind: 'room_only' },
    ownerPid: own.ownerPid,
    pid: own.ownerPid,
    processGroupId: own.ownerPid,
    processStartIdentity: 'original-owner-birth',
    phase: 'running',
    claimToken: 'wake',
  });
  const request = vi.fn(async () => ({
    ok: true,
    wake: {
      roomId: 'r',
      roomMessageId: 'm',
      logicalAgentId: 'a',
      contextScope: { kind: 'room_only' },
      wakeStatus: 'completed',
    },
  }));
  const runtime = createRoomWorkspaceRuntime({
    store,
    broker: { get: vi.fn(), request },
    wake: { claimWake: vi.fn(), completeWake: vi.fn() },
    isMutationOwner: () => true,
    ensureProtocol: async () => {},
    execute: vi.fn(),
  } as never);
  try {
    expect(await runtime.recoverExternalDiscussions()).toEqual({
      completed: 0,
      abandoned: 0,
      pending: 1,
    });
    expect(request).not.toHaveBeenCalled();
    expect(
      store.getRecord('external-discussion-operation', 'escaped'),
    ).toMatchObject({ phase: 'running' });
    process.kill(own.childPid, 0);
  } finally {
    await runtime.shutdown();
  }
});

it.each(['physical-claim', 'admission-request'])(
  'installed %s recovery cannot turn owner ESRCH into a terminal proof',
  async (kind) => {
    const own = escaped();
    const store = new RoomWorkspaceLocalStore(join(own.dir, 'local.sqlite'));
    close.push(() => store.close());
    const claim = {
      roomId: 'r',
      claimId: 'c',
      executorInstanceId: 'x',
      hostIncarnation: 1,
      originHostId: 'h',
      runId: 'run',
      logicalAgentId: 'a',
      contextScope: { kind: 'room_only' },
      executionState: 'running',
    };
    if (kind === 'physical-claim')
      store.saveRecord(kind, 'c', {
        claim,
        ownerPid: own.ownerPid,
        kind: 'in-process-tracked',
        released: false,
      });
    else
      store.saveRecord(kind, 'q', {
        requestKey: 'q',
        roomId: 'r',
        ownerPid: own.ownerPid,
        state: 'requesting',
        request: {
          runId: 'run',
          executorInstanceId: 'x',
          logicalAgentId: 'a',
          contextScope: { kind: 'room_only' },
        },
      });
    const request = vi.fn(async (_room, action, input) => ({
      ok: true,
      claim:
        action === 'release' ? { ...input, executionState: 'released' } : claim,
    }));
    const recovery = createRoomWorkspaceRecovery({
      store,
      broker: { request } as never,
      isMutationOwner: () => true,
      flushOutbox: async () => {},
    });
    try {
      expect(await recovery.recoverRoom('r')).toEqual({
        released: 0,
        committed: 0,
        pending: 1,
      });
      expect(request).not.toHaveBeenCalled();
      process.kill(own.childPid, 0);
    } finally {
      await recovery.stop();
    }
  },
);
