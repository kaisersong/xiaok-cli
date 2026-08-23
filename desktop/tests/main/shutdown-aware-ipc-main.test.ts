import { describe, expect, it } from 'vitest';
import {
  DesktopShutdownGate,
  ShutdownAwareIpcMain,
  ShuttingDownError,
  type IpcHandlerListener,
  type RawIpcMainLike,
} from '../../electron/shutdown-aware-ipc-main.js';

class FakeIpcMain implements RawIpcMainLike {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`no handler: ${channel}`);
    return Promise.resolve(handler({}, ...args));
  }
}

describe('DesktopShutdownGate (design §5.5)', () => {
  it('hands out tokens while open and refuses after close', () => {
    const gate = new DesktopShutdownGate();
    const token = gate.acquire('ipc', 'desktop:getState');
    expect(gate.outstanding).toBe(1);

    gate.close();

    expect(() => gate.acquire('ipc', 'desktop:createTask')).toThrow(ShuttingDownError);
    token.release();
    expect(gate.outstanding).toBe(0);
  });

  it('release is idempotent', () => {
    const gate = new DesktopShutdownGate();
    const token = gate.acquire('task_execution', 'task-1');
    token.release();
    token.release();
    expect(gate.outstanding).toBe(0);
  });

  it('drain resolves as soon as the last token is released', async () => {
    const gate = new DesktopShutdownGate();
    const token = gate.acquire('task_execution', 'task-1');
    const drained = gate.drain(5_000);
    setTimeout(() => token.release(), 5);

    await expect(drained).resolves.toBe(true);
  });

  it('drain reports false when a token outlives the deadline', async () => {
    const gate = new DesktopShutdownGate();
    const token = gate.acquire('task_execution', 'long-running');

    await expect(gate.drain(20)).resolves.toBe(false);
    expect(gate.describeOutstanding()).toEqual(['task_execution:long-running']);
    token.release();
  });

  it('groups outstanding tokens by kind for shutdown diagnostics', () => {
    const gate = new DesktopShutdownGate();
    gate.acquire('ipc', 'a');
    gate.acquire('task_execution', 'b');
    gate.acquire('task_execution', 'c');

    expect(gate.outstandingByKind()).toEqual({ ipc: 1, task_execution: 2 });
  });
});

describe('ShutdownAwareIpcMain (design R17-03, R18-01, R19-01)', () => {
  it('takes and releases a gate token around every invoke, reads included', async () => {
    const raw = new FakeIpcMain();
    const gate = new DesktopShutdownGate();
    const wrapper = new ShutdownAwareIpcMain(raw, gate);
    let observedDuringCall = -1;
    wrapper.handle('desktop:readOnlyQuery', async () => {
      observedDuringCall = gate.outstanding;
      return 'ok';
    });

    await expect(raw.invoke('desktop:readOnlyQuery')).resolves.toBe('ok');

    expect(observedDuringCall).toBe(1);
    expect(gate.outstanding).toBe(0);
  });

  it('releases the token even when the handler throws', async () => {
    const raw = new FakeIpcMain();
    const gate = new DesktopShutdownGate();
    const wrapper = new ShutdownAwareIpcMain(raw, gate);
    wrapper.handle('desktop:boom', async () => { throw new Error('handler failed'); });

    await expect(raw.invoke('desktop:boom')).rejects.toThrow('handler failed');
    expect(gate.outstanding).toBe(0);
  });

  it('rejects new invokes with shutting_down once the gate is closed', async () => {
    const raw = new FakeIpcMain();
    const gate = new DesktopShutdownGate();
    const wrapper = new ShutdownAwareIpcMain(raw, gate);
    wrapper.handle('desktop:createTask', async () => 'created');

    gate.close();

    await expect(raw.invoke('desktop:createTask')).rejects.toThrow(ShuttingDownError);
  });

  it('refuses duplicate channel registration', () => {
    const wrapper = new ShutdownAwareIpcMain(new FakeIpcMain(), new DesktopShutdownGate());
    wrapper.handle('desktop:same', async () => 1);

    expect(() => wrapper.handle('desktop:same', async () => 2)).toThrow(/duplicate ipc channel/);
  });

  it('enumerates registered channels so a contract test can prove coverage', () => {
    const wrapper = new ShutdownAwareIpcMain(new FakeIpcMain(), new DesktopShutdownGate());
    const listener: IpcHandlerListener = async () => null;
    wrapper.handle('kswarm:proxy:get', listener);
    wrapper.handle('kswarm:proxy:post', listener);
    wrapper.handle('desktop:getState', listener);

    expect(wrapper.registeredChannels()).toEqual([
      'desktop:getState', 'kswarm:proxy:get', 'kswarm:proxy:post',
    ]);
  });

  it('is the only surface a registrar needs: registrars never see raw ipcMain', async () => {
    const raw = new FakeIpcMain();
    const gate = new DesktopShutdownGate();
    const wrapper = new ShutdownAwareIpcMain(raw, gate);

    // Mimics registerDesktopIpc / registerKSwarmProxy / setIpcMainImpl, which
    // only receive the narrow registrar type.
    const registerLikeProduction = (registrar: { handle: (c: string, l: IpcHandlerListener) => void }) => {
      registrar.handle('desktop:fromRegistrar', async () => 'via-registrar');
    };
    registerLikeProduction(wrapper);

    await expect(raw.invoke('desktop:fromRegistrar')).resolves.toBe('via-registrar');
    expect(gate.outstanding).toBe(0);
  });
});
