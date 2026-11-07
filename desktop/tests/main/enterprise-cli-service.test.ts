// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnterpriseCliConnectorService } from '../../electron/enterprise-cli-service.js';
class Child extends EventEmitter {
 stdout = new PassThrough(); stderr = new PassThrough(); kill = vi.fn(() => true);
 close(code = 0, out = '', err = '') { this.stdout.write(out); this.stderr.write(err); this.emit('close', code); }
}
const fixtures: ReturnType<typeof fixture>[] = [];
function fixture(provider: 'dingtalk' | 'feishu' | 'wecom' = 'dingtalk', installed = true) {
 const children: Child[] = []; let available = installed;
 const runtime = { supported: () => true, find: vi.fn(() => available ? { binaryPath: 'managed-native', binDir: 'bin', version: '1.0.0' } : null), configurePath: vi.fn(), install: vi.fn(async () => { available = true; return { binaryPath: 'managed-native', binDir: 'bin', version: '1.0.0' }; }) };
 const spawn = vi.fn(() => { const child = new Child(); children.push(child); return child as any; }); const openExternal = vi.fn(async (_url: string) => {});
 const service = new EnterpriseCliConnectorService(provider, { runtime: runtime as any, spawn: spawn as any, openExternal, now: () => Date.parse('2026-11-05T08:00:00Z') });
 const f = { service, children, runtime, spawn, openExternal }; fixtures.push(f); return f;
}
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) { for (const child of f.children) child.close(1); await f.service.dispose().catch(() => {}); } });
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
describe('enterprise connector Main owner', () => {
 it('inspects an uninstalled connector without downloading or spawning', () => { const f = fixture('dingtalk', false); expect(f.service.getState()).toMatchObject({ phase: 'notInstalled', installed: false }); expect(f.runtime.install).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled(); });
 it.each(['agent','scheduler',undefined] as const)('rejects %s before install or login', async source => { const f = fixture(); await expect(f.service.control('install', source)).rejects.toThrow(/forbidden/); await expect(f.service.control('login', source)).rejects.toThrow(/forbidden/); expect(f.runtime.install).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled(); });
 it('installs only after a user click, then checks without automatically logging in', async () => { const f = fixture('wecom', false); await f.service.control('install','user'); await flush(); expect(f.runtime.install).toHaveBeenCalledOnce(); expect(f.spawn.mock.calls[0][1]).toEqual(['auth','show']); f.children[0].close(0,'Status: unauthorized\n'); await flush(); expect(f.service.getState().phase).toBe('signedOut'); expect(f.openExternal).not.toHaveBeenCalled(); });
 it('uses the read-only DingTalk contract and projects identity without token data', async () => { const f = fixture(); await f.service.control('check','user'); expect(f.spawn.mock.calls[0][1]).toEqual(['auth','status','--readonly','--format','json']); f.children[0].close(0,JSON.stringify({success:true,authenticated:true,user_id:'u',user_name:'张三',corp_id:'c',corp_name:'公司',expires_at:'2026-11-05T10:00:00Z',access_token:'secret'})); await flush(); expect(f.service.getState()).toMatchObject({phase:'connected',connection:{name:'张三',openId:'u',orgId:'c'}}); expect(JSON.stringify(f.service.getState())).not.toContain('secret'); });
 it('does not treat an inconclusive DingTalk snapshot as signed out', async () => { const f = fixture(); await f.service.control('check','user'); f.children[0].close(0,JSON.stringify({success:true,authenticated:false,reason:'local_state_unreadable'})); await flush(); expect(f.service.getState().phase).toBe('failed'); });
 it('does not treat a Feishu bot-only configuration as personal sign-in', async () => { const f = fixture('feishu'); await f.service.control('check','user'); f.children[0].close(0,JSON.stringify({appId:'cli_app',identity:'bot',identities:{user:{available:false},bot:{available:true}}})); await flush(); expect(f.service.getState().phase).toBe('signedOut'); });
 it('marks missing Feishu config separately and only then permits application setup', async () => { const f = fixture('feishu'); await expect(f.service.control('setup','user')).rejects.toThrow(); await f.service.control('check','user'); f.children[0].close(3,'',JSON.stringify({ok:false,error:{type:'config',subtype:'missing_config'}})); await flush(); expect(f.service.getState().phase).toBe('needsSetup'); await f.service.control('setup','user'); expect(f.spawn.mock.calls[1][1]).toEqual(['config','init','--new','--brand','feishu']); f.children[1].close(1); });
 it('requires explicit WeCom authorization and describes its bot identity', async () => { const f = fixture('wecom'); await f.service.control('check','user'); f.children[0].close(0,'Status: unauthorized\n'); await flush(); expect(f.service.getState().phase).toBe('signedOut'); await f.service.control('check','user'); f.children[1].close(0,'Status: authorized\nBot ID: bot-123\n'); await flush(); expect(f.service.getState()).toMatchObject({phase:'connected',connection:{identityType:'bot',openId:'bot-123'}}); });
 it('opens one official WeCom QR page, cancels only its child, and ignores late success', async () => { const f = fixture('wecom'); await f.service.control('login','user'); expect(f.spawn.mock.calls[0][1]).toEqual(['auth','init','--noninteractive','--no-browser']); f.children[0].stdout.write('https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=ABC123\n'); await flush(); expect(f.openExternal).toHaveBeenCalledOnce(); expect(JSON.stringify(f.service.getState())).not.toContain('ABC123'); const cancel = f.service.control('cancel','user'); await flush(); expect(f.children[0].kill).toHaveBeenCalledWith('SIGTERM'); f.children[0].close(0); await cancel; expect(f.service.getState().phase).toBe('cancelled'); expect(f.spawn).toHaveBeenCalledOnce(); });
 it('requests only Feishu message/calendar/contact scopes and verifies identity after explicit login', async () => {
  const f = fixture('feishu'); await f.service.control('login','user'); await flush();
  expect(f.spawn.mock.calls[0][1]).toEqual(['auth','login','--domain','im,calendar,contact','--json']);
  f.children[0].stdout.write('{"verification_uri_complete":"https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=TEST_FLOW&user_code=ABC123"}\n'); await flush(); expect(f.openExternal).toHaveBeenCalledOnce();
  f.children[0].close(0); await flush(); expect(f.spawn.mock.calls[1][1]).toEqual(['auth','status','--json']);
  f.children[1].close(0, JSON.stringify({appId:'app-one',identities:{user:{available:true,openId:'user-one',userName:'Alice',expiresAt:'2026-11-05T10:00:00Z',accessToken:'secret'}}})); await flush();
  expect(f.service.getState()).toMatchObject({phase:'connected',connection:{name:'Alice',connectedAt:'2026-11-05T08:00:00.000Z'}}); expect(JSON.stringify(f.service.getState())).not.toContain('secret');
 });
 it('retains ownership when stop is unconfirmed and ignores late browser completion', async () => {
  vi.useFakeTimers(); const f = fixture('wecom'); let resolveOpen!:()=>void; f.openExternal.mockImplementation(()=>new Promise<void>(resolve=>{resolveOpen=resolve;}));
  await f.service.control('login','user'); await flush(); f.children[0].stdout.write('https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=ABC123\n'); await flush();
  const cancel=f.service.control('cancel','user'); const pending=expect(cancel).rejects.toThrow('stop_pending');
  await vi.advanceTimersByTimeAsync(5000); await pending; expect(f.service.getState().phase).toBe('stopPending');
  await f.service.control('login','user'); expect(f.spawn).toHaveBeenCalledOnce(); resolveOpen(); await flush(); expect(f.service.getState().phase).toBe('stopPending');
  f.children[0].close(0); await flush(); expect(f.service.getState().phase).toBe('cancelled');
 });
 it('times out an owned child and never releases it until close', async () => {
  vi.useFakeTimers(); const f=fixture('wecom'); await f.service.control('login','user'); await flush(); await vi.advanceTimersByTimeAsync(301000);
  expect(f.children[0].kill).toHaveBeenCalledWith('SIGKILL'); f.children[0].close(0); await flush(); expect(f.service.getState().phase).toBe('timedOut');
 });
 it('waits for a real stream delimiter before opening a complete authorization code', async () => {
  const f=fixture('wecom'); await f.service.control('login','user'); await flush();
  f.children[0].stdout.write('https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=ABC'); await flush(); expect(f.openExternal).not.toHaveBeenCalled();
  f.children[0].stdout.write('123\n'); await flush(); expect(f.openExternal).toHaveBeenCalledExactlyOnceWith('https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=ABC123'); f.children[0].close(1);
 });
 it('does not open off-origin browser links', async () => { const f = fixture('wecom'); await f.service.control('login','user'); f.children[0].stdout.write('https://evil.example/ai/qc/gen?scode=SECRET\n'); await flush(); expect(f.openExternal).not.toHaveBeenCalled(); f.children[0].close(1); });
});
