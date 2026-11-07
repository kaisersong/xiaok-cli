import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexNativeService } from '../../electron/codex-native-service';

class Client {
  threadId = 'native-thread'; activeTurnId: string | null = null; sequence = 0;
  constructor(readonly options: any) {}
  async connect() {} async create() { return { thread: { id: this.threadId } }; }
  async resume(id: string) { this.threadId = id; }
  async start() { this.activeTurnId = `turn-${++this.sequence}`; this.emit('turn/started', { turn: { id: this.activeTurnId } }); }
  async steer() {} async interrupt() { this.emit('turn/completed', { turn: { id: this.activeTurnId, status: 'interrupted' } }); this.activeTurnId = null; }
  async close() {}
  emit(method: string, params: any) { this.options.onEvent({ method, params: { threadId: this.threadId, turnId: this.activeTurnId, ...params } }); }
  request(id: number) { return this.options.onApproval({ id, method: 'item/commandExecution/requestApproval', params: { threadId: this.threadId, turnId: this.activeTurnId, command: `echo ${id}` } }); }
}
const user = { requestSource: 'user' as const, actorId: 'inventory-user' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup(timeout = 60_000) {
  const dir = mkdtempSync(join(tmpdir(), 'native-inventory-')); const clients: Client[] = [];
  const service = new CodexNativeService({ dbPath: join(dir, 'native.sqlite'), profileId: user.actorId, approvalTimeoutMs: timeout, createClient: options => { const c = new Client(options); clients.push(c); return c as any; } });
  cleanups.push(async () => { await service.dispose(); rmSync(dir, { recursive: true, force: true }); });
  const session = await service.create(user, dir); await service.send(user, session.id, 'original task');
  return { service, clients, id: session.id };
}
describe('original Native pending approval inventory', () => {
  it('reads the complete original collection and answering one leaves the other', async () => {
    const s = await setup(); const first = s.clients[0].request(1); const second = s.clients[0].request(2);
    const frame = s.service.readApprovalInventory(user, s.id);
    expect(frame.questions).toHaveLength(2); expect(new Set(frame.questions.map(q => q.token)).size).toBe(2);
    expect(frame.questions.map(q => q.description)).toEqual(expect.arrayContaining([expect.stringContaining('echo 1'), expect.stringContaining('echo 2')]));
    s.service.assertApprovalInventoryCurrent(user, frame);
    const firstQuestion=frame.questions.find(q=>q.description.includes('echo 1'))!; const secondQuestion=frame.questions.find(q=>q.description.includes('echo 2'))!;
    await s.service.decide(user, s.id, firstQuestion.token, 'allow'); expect(await first).toEqual({ decision: 'accept' });
    expect(() => s.service.assertApprovalInventoryCurrent(user, frame)).toThrow(/inventory/);
    const remaining = s.service.readApprovalInventory(user, s.id); expect(remaining.questions.map(q => q.token)).toEqual([secondQuestion.token]);
    await s.service.decide(user, s.id, remaining.questions[0].token, 'deny'); expect(await second).toEqual({ decision: 'decline' });
    expect(s.service.readApprovalInventory(user, s.id).questions).toEqual([]);
  });
  it('keeps the same question digest through unrelated message output and denies cloned frames', async () => {
    const s = await setup(); const pending = s.clients[0].request(1); const frame = s.service.readApprovalInventory(user, s.id);
    s.clients[0].emit('item/agentMessage/delta', { itemId: 'message', delta: 'unrelated heartbeat output' });
    expect(s.service.readApprovalInventory(user, s.id).digest).toBe(frame.digest);
    s.service.assertApprovalInventoryCurrent(user, frame);
    expect(() => s.service.assertApprovalInventoryCurrent(user, structuredClone(frame))).toThrow(/inventory/);
    expect(Object.isFrozen(frame)).toBe(true); expect(Object.isFrozen(frame.questions)).toBe(true); expect(Object.isFrozen(frame.questions[0])).toBe(true);
    expect(() => { (frame.questions[0] as any).description = 'changed'; }).toThrow();
    await s.service.interrupt(user, s.id); await pending;
  });
  it('rejects a frame at another original owner and denies non-user or foreign actors', async () => {
    const s = await setup(); const other = await setup(); const frame = s.service.readApprovalInventory(user, s.id);
    expect(() => other.service.assertApprovalInventoryCurrent(user, frame)).toThrow(/inventory/);
    for (const actor of [{ ...user, requestSource: 'agent' }, { ...user, requestSource: 'scheduler' }, { ...user, actorId: 'foreign' }]) {
      expect(() => s.service.readApprovalInventory(actor as any, s.id)).toThrow(/denied/);
      expect(() => s.service.assertApprovalInventoryCurrent(actor as any, frame)).toThrow(/denied/);
    }
  });
  it('never calls a disconnected or stopped owner an empty authoritative collection', async () => {
    const s = await setup(); const frame = s.service.readApprovalInventory(user, s.id);
    await s.service.disconnect(user, s.id);
    expect(() => s.service.readApprovalInventory(user, s.id)).toThrow(/inventory/);
    expect(() => s.service.assertApprovalInventoryCurrent(user, frame)).toThrow(/inventory/);
    await s.service.send(user, s.id, 'new actual turn'); expect(s.clients).toHaveLength(2);
    expect(() => s.service.assertApprovalInventoryCurrent(user, frame)).toThrow(/inventory/);
    s.service.beginShutdown(); expect(() => s.service.readApprovalInventory(user, s.id)).toThrow(/inventory/);
  });
  it('rejects the old inventory after actual timeout without reconnecting or manufacturing a new owner', async () => {
    const s = await setup(25); const pending = s.clients[0].request(1); const frame = s.service.readApprovalInventory(user, s.id);
    expect(await pending).toEqual({ decision: 'decline' });
    expect(() => s.service.assertApprovalInventoryCurrent(user, frame)).toThrow(/inventory/);
    expect(s.service.readApprovalInventory(user, s.id).questions).toEqual([]); expect(s.clients).toHaveLength(1);
  });
  it('fails closed on over-budget complete collection instead of returning the first page', async () => {
    const s = await setup(); const pending = Array.from({ length: 33 }, (_, i) => s.clients[0].request(i));
    expect(() => s.service.readApprovalInventory(user, s.id)).toThrow(/inventory/);
    expect(s.service.get(user, s.id).approvals).toHaveLength(33);
    await s.service.interrupt(user, s.id); await Promise.all(pending); expect(s.clients).toHaveLength(1);
  });
});

it('refuses to attach a new task to an already active turn without queueing or steering it', async () => {
 const s=await setup();const before=s.service.get(user,s.id);let minted=false;
 await expect(s.service.sendTaskTurn(user,s.id,'must be an independent task',()=>{minted=true;})).rejects.toThrow(/busy/);
 expect(s.service.get(user,s.id).messages).toEqual(before.messages);expect(s.service.get(user,s.id).queued).toBe(0);expect(s.clients[0].sequence).toBe(1);expect(minted).toBe(false);
});

it('mints a private actual-turn binding before start ACK and invalidates it at actual turn exit', async () => {
 const s=await setup();await s.service.interrupt(user,s.id);const client=s.clients[0];let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);const original=client.start.bind(client);let binding: any;
 client.start=async()=>{await original();entered();await held;};
 const sending=s.service.sendTaskTurn(user,s.id,'new owned turn',proof=>{binding=proof;});
 try{
  await ready;expect(binding).toBeTruthy();s.service.assertTaskTurnCurrent(user,binding);
  expect(()=>s.service.assertTaskTurnCurrent(user,structuredClone(binding))).toThrow(/turn/);
  const other=await setup();expect(()=>other.service.assertTaskTurnCurrent(user,binding)).toThrow(/turn/);
  expect(()=>s.service.assertTaskTurnCurrent({...user,actorId:'foreign'},binding)).toThrow(/denied/);
  const pending=client.request(8);const frame=s.service.readApprovalInventory(user,s.id);expect(frame.questions).toHaveLength(1);
  await s.service.decide(user,s.id,frame.questions[0].token,'deny');expect(await pending).toEqual({decision:'decline'});
  release();await sending;await s.service.interrupt(user,s.id);
  expect(()=>s.service.assertTaskTurnCurrent(user,binding)).toThrow(/turn/);
 }finally{release();await sending;}
});

it('does not reactivate an old inventory when a later actual turn reuses the same id',async()=>{
 const s=await setup();const frame=s.service.readApprovalInventory(user,s.id);const client=s.clients[0];const turnId=client.activeTurnId;
 client.emit('turn/completed',{turn:{id:turnId,status:'completed'}});client.activeTurnId=turnId;client.emit('turn/started',{turn:{id:turnId}});
 expect(s.service.readApprovalInventory(user,s.id).generation).toBeGreaterThan(frame.generation);
 expect(()=>s.service.assertApprovalInventoryCurrent(user,frame)).toThrow(/inventory/);
});

it('does not revive an old complete inventory after an unobserved add-and-resolve cycle',async()=>{
 const s=await setup();const first=s.clients[0].request(1);const initial=s.service.readApprovalInventory(user,s.id);
 const second=s.clients[0].request(2);const added=s.service.readApprovalInventory(user,s.id);const token=added.questions.find(q=>q.description.includes('echo 2'))!.token;
 await s.service.decide(user,s.id,token,'deny');expect(await second).toEqual({decision:'decline'});
 const current=s.service.readApprovalInventory(user,s.id);expect(current.questions).toEqual(initial.questions);
 expect(()=>s.service.assertApprovalInventoryCurrent(user,initial)).toThrow(/inventory/);
 expect(current.digest).not.toBe(initial.digest);
 await s.service.interrupt(user,s.id);await first;
});

it('revalidates the original deadline after synchronous SQLite work and before the real decision',async()=>{
 const s=await setup();const pending=s.clients[0].request(1);let resolved=false;void pending.then(()=>{resolved=true;});
 const frame=s.service.readApprovalInventory(user,s.id);const database=(s.service as any).db;let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  database.function('native_approval_clock_jump',()=>{now=frame.questions[0].expiresAt+1;return 0;});
  database.exec('CREATE TRIGGER inventory_deadline_fault BEFORE INSERT ON codex_native_sessions BEGIN SELECT native_approval_clock_jump(); END');
  await expect(s.service.decide(user,s.id,frame.questions[0].token,'allow')).rejects.toThrow(/expired/);await Promise.resolve();
  expect(resolved).toBe(false);expect(s.service.get(user,s.id).approvals.map(q=>q.token)).toEqual([frame.questions[0].token]);
 }finally{clock.mockRestore();database.exec('DROP TRIGGER IF EXISTS inventory_deadline_fault');await s.service.interrupt(user,s.id);await pending;}
});
