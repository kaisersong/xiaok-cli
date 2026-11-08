// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YzjCliAuthService } from '../../electron/yzj-cli-auth-service.js';

class Child extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); pid = 123;
  kill = vi.fn(() => true);
  close(code = 0, output = '', error = '') { this.stdout.write(output); this.stderr.write(error); this.emit('close', code); }
}
const services: YzjCliAuthService[] = [];
const directories: string[] = [];
function historyFile() { const dir = mkdtempSync(join(tmpdir(), 'xiaok-yzj-history-')); directories.push(dir); return join(dir, 'connection.json'); }
afterEach(async () => { vi.useRealTimers(); for (const service of services.splice(0)) await service.dispose().catch(() => {}); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
function fixture(options: { now?: () => number; connectionHistoryPath?: string } = {}) {
  const children: Child[] = [];
  const spawn = vi.fn(() => { const child = new Child(); children.push(child); return child as any; });
  const openExternal = vi.fn(async (_url: string) => {});
  const service = new YzjCliAuthService({ spawn: spawn as any, resolveBinary: () => 'managed path/yzj-cli.exe', openExternal, ...options });
  services.push(service); return { service, children, spawn, openExternal };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }

describe('Desktop browser login owner', () => {
  const at = '2026-11-05T08:00:00.000Z';
  const identity = { name: '张三', department: '产品部', openId: 'user-one', orgId: 'org-one', expiresAt: '2026-11-05T18:00:00+08:00', tokenStatus: 'needs_refresh', accessToken: 'secret-canary', refreshToken: 'refresh-canary' };
  const envelope = (data = identity) => JSON.stringify({ success: true, identity: 'user', data, accessToken: 'outer-secret' });
  it('projects allowlisted identity and token metadata, while ordinary checks never invent a connection time', async () => {
    const path = historyFile(); const f = fixture({ now: () => Date.parse(at), connectionHistoryPath: path });
    await f.service.control('check', 'user'); f.children[0].close(0, envelope());
    expect(f.service.getState()).toMatchObject({ phase: 'authenticated', connection: { name: '张三', department: '产品部', openId: 'user-one', orgId: 'org-one', expiresAt: '2026-11-05T10:00:00.000Z', tokenStatus: 'needs_refresh', checkedAt: at } });
    expect(f.service.getState().connection?.connectedAt).toBeUndefined(); expect(existsSync(path)).toBe(false);
    expect(JSON.stringify(f.service.getState())).not.toMatch(/secret|refreshToken|accessToken/);
    const copy = f.service.getState(); copy.connection!.name = 'mutated'; expect(f.service.getState().connection?.name).toBe('张三');
    await f.service.control('check', 'user'); expect(f.service.getState().connection).toBeUndefined(); f.children[1].close(3);
    expect(f.service.getState()).toMatchObject({ phase: 'signedOut' }); expect(f.service.getState().connection).toBeUndefined();
  });
  it('records a verified Desktop login across restarts but does not reuse its time for another account or organization', async () => {
    const path = historyFile(); let now = Date.parse(at); const f = fixture({ now: () => now, connectionHistoryPath: path });
    await f.service.control('login', 'user'); f.children[0].close(0); f.children[1].close(0, envelope());
    expect(f.service.getState().connection?.connectedAt).toBe(at);
    const stored = readFileSync(path, 'utf8'); expect(stored).not.toMatch(/user-one|org-one|张三|secret|Token/);
    now += 60000;
    const restarted = fixture({ now: () => now, connectionHistoryPath: path });
    await restarted.service.control('check', 'user'); restarted.children[0].close(0, envelope());
    expect(restarted.service.getState().connection).toMatchObject({ connectedAt: at, checkedAt: new Date(now).toISOString() });
    for (const data of [{ ...identity, openId: 'other-user' }, { ...identity, orgId: 'other-org' }]) {
      await restarted.service.control('check', 'user'); restarted.children.at(-1)!.close(0, envelope(data));
      expect(restarted.service.getState().connection?.connectedAt).toBeUndefined();
    }
  });
  it('persists the first connection when the entire history parent directory is missing', async () => {
    const path = join(historyFile(), 'connectors', 'connection.json'); const f = fixture({ now: () => Date.parse(at), connectionHistoryPath: path });
    await f.service.control('login', 'user'); f.children[0].close(0); f.children[1].close(0, envelope());
    expect(existsSync(path)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const restarted = fixture({ connectionHistoryPath: path }); await restarted.service.control('check', 'user'); restarted.children[0].close(0, envelope());
    expect(restarted.service.getState().connection?.connectedAt).toBe(at);
  });
  it('does not conflate account keys with ambiguous concatenations', async () => {
    const path = historyFile(); const f = fixture({ connectionHistoryPath: path });
    await f.service.control('login', 'user'); f.children[0].close(0); f.children[1].close(0, envelope({ ...identity, orgId: 'ab', openId: 'c' }));
    const next = fixture({ connectionHistoryPath: path }); await next.service.control('check', 'user'); next.children[0].close(0, envelope({ ...identity, orgId: 'a', openId: 'bc' }));
    expect(next.service.getState().connection?.connectedAt).toBeUndefined();
  });
  it('omits invalid fields and dates, and tolerates corrupt history without reading CLI credentials', async () => {
    const path = historyFile(); writeFileSync(path, '{bad-json'); const f = fixture({ connectionHistoryPath: path });
    await f.service.control('check', 'user'); f.children[0].close(0, envelope({ ...identity, name: 'bad\nname', department: 'x'.repeat(301), expiresAt: 'never', tokenStatus: 'surprise' }));
    const info = f.service.getState().connection;
    expect(info?.name).toBeUndefined(); expect(info?.department).toBeUndefined(); expect(info?.expiresAt).toBeUndefined(); expect(info?.tokenStatus).toBeUndefined(); expect(info?.connectedAt).toBeUndefined();
    expect(f.service.getState().phase).toBe('authenticated');
  });
  it('rejects invalid calendar dates and oversized history without claiming a connection time', async () => {
    const path = historyFile(); writeFileSync(path, 'x'.repeat(4097)); const f = fixture({ connectionHistoryPath: path });
    await f.service.control('check', 'user'); f.children[0].close(0, envelope({ ...identity, expiresAt: '2026-02-30T10:00:00Z' }));
    expect(f.service.getState().connection?.expiresAt).toBeUndefined(); expect(f.service.getState().connection?.connectedAt).toBeUndefined();
  });
  it('does not record a failed post-login identity probe, and tolerates unwritable history', async () => {
    const path = historyFile(); const f = fixture({ connectionHistoryPath: path });
    await f.service.control('login', 'user'); f.children[0].close(0); f.children[1].close(4);
    expect(existsSync(path)).toBe(false); expect(f.service.getState().connection).toBeUndefined();
    writeFileSync(path, 'parent is a file'); const next = fixture({ now: () => Date.parse(at), connectionHistoryPath: join(path, 'connection.json') });
    await next.service.control('login', 'user'); next.children[0].close(0); next.children[1].close(0, envelope());
    expect(next.service.getState()).toMatchObject({ phase: 'authenticated', connection: { connectedAt: at } });
  });

  it.each(['agent', 'scheduler', undefined] as const)('rejects non-user source %s before any child is created', async source => {
    const f = fixture(); await expect(f.service.control('login', source)).rejects.toThrow(/forbidden/); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('does not auto-login; device-mode argv leaves the only browser opener to Desktop Main', async () => {
    const f = fixture(); expect(f.service.getState().phase).toBe('idle'); expect(f.spawn).not.toHaveBeenCalled();
    expect((await f.service.control('login', 'user')).phase).toBe('opening');
    expect(f.spawn).toHaveBeenCalledWith('managed path/yzj-cli.exe', ['auth', 'login', '--device'], expect.objectContaining({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] }));
    await f.service.control('login', 'user'); expect(f.spawn).toHaveBeenCalledTimes(1);
    f.children[0].close(3);
  });
  it('opens the official CLI-generated authorization URL once without exposing its code', async () => {
    const f = fixture(); await f.service.control('login', 'user');
    f.children[0].stderr.write('请打开 https://www.yunzhijia.com/developers/cli/device-');
    f.children[0].stderr.write('auth.html?code=ABC123XYZ\n'); await flush();
    expect(f.openExternal).toHaveBeenCalledOnce(); expect(f.service.getState().phase).toBe('waiting');
    f.children[0].stdout.write('https://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ\n'); await flush();
    expect(f.openExternal).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.service.getState())).not.toContain('ABC123XYZ');
    f.children[0].close(3);
  });
  it.each([
    'https://evil.example/developers/cli/device-auth.html?code=ABC123XYZ',
    'https://www.yunzhijia.com@evil.example/developers/cli/device-auth.html?code=ABC123XYZ',
    'https://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ&redirect=https://evil.example',
    'http://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ',
  ])('does not open an invalid authorization target %s', async url => {
    const f = fixture(); await f.service.control('login', 'user'); f.children[0].stdout.write(url + '\n'); await flush();
    expect(f.openExternal).not.toHaveBeenCalled(); f.children[0].close(3);
  });
  it('does not restore waiting if browser-open completion arrives after cancellation', async () => {
    const f = fixture(); let opened!: () => void; f.openExternal.mockReturnValue(new Promise<void>(resolve => { opened = resolve; }));
    await f.service.control('login', 'user'); f.children[0].stdout.write('https://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ\n');
    const cancelled = f.service.control('cancel', 'user'); await flush(); f.children[0].close(0); await cancelled;
    opened(); await flush(); expect(f.service.getState().phase).toBe('cancelled');
  });
  it('verifies whoami after login success before reporting authenticated and never projects raw credentials', async () => {
    const f = fixture(); await f.service.control('login', 'user'); f.children[0].close(0);
    expect(f.service.getState().phase).toBe('checking'); expect(f.spawn.mock.calls[1][1]).toEqual(['whoami']);
    f.children[1].close(0, JSON.stringify({ success: true, data: { accessToken: 'secret-canary' } }));
    expect(f.service.getState().phase).toBe('authenticated'); expect(JSON.stringify(f.service.getState())).not.toContain('secret-canary');
  });
  it.each([['3','signedOut'],['4','failed'],['11','failed']] as const)('maps check exit %s to %s', async (code, phase) => {
    const f = fixture(); await f.service.control('check', 'user'); f.children[0].close(Number(code)); expect(f.service.getState().phase).toBe(phase);
  });
  it('distinguishes post-login verification failures from signed-out state', async () => {
    const f = fixture(); await f.service.control('login', 'user'); f.children[0].close(0); f.children[1].close(4);
    expect(f.service.getState().phase).toBe('verificationFailed');
  });
  it('rejects malformed success output instead of claiming authenticated', async () => {
    const f = fixture(); await f.service.control('check', 'user'); f.children[0].close(0, 'not-json'); expect(f.service.getState().phase).toBe('failed');
  });
  it('waits for close on cancel and ignores a late successful login without starting verification', async () => {
    const f = fixture(); await f.service.control('login', 'user'); const cancelled = f.service.control('cancel', 'user'); await flush();
    expect(f.service.getState().phase).toBe('cancelling'); expect(f.children[0].kill).toHaveBeenCalledWith('SIGTERM');
    f.children[0].stdout.write('https://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ\n');
    expect(f.openExternal).not.toHaveBeenCalled();
    f.children[0].close(0); expect((await cancelled).phase).toBe('cancelled'); expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it('stops its login child when opening the browser fails and never projects the raw error', async () => {
    const f = fixture(); f.openExternal.mockRejectedValue(Error('secret-code'));
    await f.service.control('login', 'user'); f.children[0].stderr.write('https://www.yunzhijia.com/developers/cli/device-auth.html?code=ABC123XYZ\n'); await flush();
    expect(f.service.getState().phase).toBe('cancelling'); f.children[0].close(0);
    expect(f.service.getState().phase).toBe('failed'); expect(JSON.stringify(f.service.getState())).not.toContain('secret-code');
  });
  it('reports a timed-out post-login identity check as verificationFailed', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.service.control('login', 'user'); f.children[0].close(0);
    await vi.advanceTimersByTimeAsync(15000); f.children[1].close(0);
    expect(f.service.getState().phase).toBe('verificationFailed');
  });
  it('stops the current identity probe before opening one browser login', async () => {
    const f = fixture(); await f.service.control('check', 'user'); const login = f.service.control('login', 'user'); await flush();
    expect(f.spawn).toHaveBeenCalledTimes(1); f.children[0].close(0, '{"success":true}');
    expect((await login).phase).toBe('opening'); expect(f.spawn).toHaveBeenCalledTimes(2); f.children[1].close(3);
  });
  it('owns a five-minute login timeout and escalates only the owned child', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.service.control('login', 'user');
    await vi.advanceTimersByTimeAsync(299999); expect(f.service.getState().phase).toBe('opening');
    await vi.advanceTimersByTimeAsync(1); expect(f.service.getState().phase).toBe('cancelling');
    await vi.advanceTimersByTimeAsync(1000); expect(f.children[0].kill).toHaveBeenCalledWith('SIGKILL');
    f.children[0].close(0); expect(f.service.getState().phase).toBe('timedOut'); expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it('retains the owner if stopping is unconfirmed, and allows cancel retry after the process closes', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.service.control('login', 'user');
    const stop = f.service.control('cancel', 'user'); const caught = expect(stop).rejects.toThrow('stop_pending');
    await vi.advanceTimersByTimeAsync(5000); await caught;
    await expect(f.service.control('login', 'user')).rejects.toThrow('stop_pending'); expect(f.spawn).toHaveBeenCalledTimes(1);
    f.children[0].close(0); expect(f.service.getState().phase).toBe('cancelled');
  });
  it('disposes its login child and cannot start another child during shutdown', async () => {
    const f = fixture(); await f.service.control('login', 'user'); const disposed = f.service.dispose();
    f.children[0].close(0); await disposed;
    await expect(f.service.control('login', 'user')).rejects.toThrow(/disposed/); expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it('reports a missing bundled binary as unavailable without attempting fallback execution', async () => {
    const spawn = vi.fn(); const service = new YzjCliAuthService({ spawn: spawn as any, resolveBinary: () => { throw Error('missing'); } }); services.push(service);
    expect((await service.control('login', 'user')).phase).toBe('unavailable'); expect(spawn).not.toHaveBeenCalled();
  });
});
