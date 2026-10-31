import { fork } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ConversationActivityStore } from '../../../src/runtime/conversation-activity/store.js';

type Reply = { kind: string; claimed?: boolean; message?: string; errcode?: number; value?: unknown };
function worker(file: string) {
  const child = fork(fileURLToPath(new URL('./fixtures/store-owner-claim-entry.js', import.meta.url)), [file],
    { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  let stderr = '', ended = false, failure: Error | undefined;
  child.stderr!.on('data', data => { stderr = (stderr + data).slice(-4096); });
  const queued: Reply[] = [];
  let waiter: { resolve(value: Reply): void; reject(error: Error): void } | undefined;
  child.on('message', value => { const reply = value as Reply; if (waiter) { const current = waiter; waiter = undefined; current.resolve(reply); } else queued.push(reply); });
  child.on('error', error => { failure = error; waiter?.reject(error); waiter = undefined; });
  const closed = new Promise<void>(resolve => child.once('close', () => { ended = true; waiter?.reject(Error(`worker exited: ${stderr}`)); waiter = undefined; resolve(); }));
  async function next(): Promise<Reply> {
    if (queued.length) return queued.shift()!;
    if (failure) throw failure;
    if (ended) throw Error(`worker exited: ${stderr}`);
    let timer: ReturnType<typeof setTimeout>;
    try { return await new Promise<Reply>((resolve, reject) => {
      timer = setTimeout(() => { waiter = undefined; reject(Error(`worker deadline: ${stderr}`)); }, 5000);
      waiter = { resolve, reject };
    }); } finally { clearTimeout(timer!); }
  }
  async function send(command: string) {
    await new Promise<void>((resolve, reject) => {
      if (!child.connected) { reject(Error('worker channel closed')); return; }
      try { child.send(command, error => error ? reject(error) : resolve()); } catch (error) { reject(error); }
    });
  }
  async function waitClosed() {
    let timer: ReturnType<typeof setTimeout>;
    try { await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`worker close deadline: ${stderr}`)), 5000); })]); }
    finally { clearTimeout(timer!); }
  }
  async function request(command: string) { await send(command); return next(); }
  return { next, request, async release() { await send('release'); await waitClosed(); },
    async close() { if (!ended) child.kill('SIGKILL'); await waitClosed(); } };
}
function temporary() { return realpathSync(mkdtempSync(join(tmpdir(), 'activity-native-claim-'))); }

it('elects exactly one native owner in repeated cold two-process races', async () => {
  const failures: unknown[] = [];
  for (let round = 0; round < 32; round++) {
    const root = temporary(), file = join(root, 'activity.sqlite'), workers: ReturnType<typeof worker>[] = [];
    try {
      workers.push(worker(file)); workers.push(worker(file));
      expect(await Promise.all(workers.map(w => w.next()))).toEqual([{ kind: 'ready' }, { kind: 'ready' }]);
      const replies = await Promise.all(workers.map(w => w.request('claim')));
      // Neither process exits until both outcomes are observed; a failed constructor
      // must release its own handles without relying on process exit.
      if (replies.filter(r => r.claimed).length !== 1) failures.push({ round, replies });
      for (const reply of replies.filter(r => !r.claimed)) expect(reply).toMatchObject({ message: 'conversation_activity_owner_held', errcode: 5 });
      const winner = replies.findIndex(r => r.claimed);
      if (winner >= 0) {
        await workers[winner].release();
        // The failed claimant remains alive: successful reacquisition proves its
        // constructor cleanup did not leave a lock until process exit.
        const replacement = new ConversationActivityStore(file);
        replacement.close();
      }
    } finally { await Promise.all(workers.map(w => w.close())); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  }
  expect(failures).toEqual([]);
}, 30_000);

it('rejects hot contenders, preserves the live writer and readonly reader, and reacquires after exit', async () => {
  const root = temporary(), file = join(root, 'activity.sqlite');
  let owner: ReturnType<typeof worker> | undefined;
  try {
    owner = worker(file);
    await owner.next(); expect(await owner.request('claim')).toMatchObject({ claimed: true });
    const before = readdirSync(root).sort();
    const reader = new ConversationActivityStore(file, { readOnly: true });
    try {
      expect(readdirSync(root).sort()).toEqual(before);
      expect(reader.getAssociation('op')).toBeNull();
      expect(() => reader.prepareAssociation({ operationId: 'bad', creationIdempotencyKey: 'bad', origin: { profileId: 'p', threadId: 't', workspaceId: 'w', actorId: 'a' } })).toThrow('conversation_activity_readonly');
      const elapsed: number[] = [];
      for (let i = 0; i < 8; i++) {
        const start = performance.now();
        expect(() => new ConversationActivityStore(file)).toThrow('conversation_activity_owner_held');
        elapsed.push(performance.now() - start);
      }
      console.info('native hot-owner rejection milliseconds', elapsed);
      expect(await owner.request('write')).toMatchObject({ kind: 'write', value: { operationId: 'op' } });
      expect(reader.getAssociation('op')).toMatchObject({ operationId: 'op' });
    } finally { reader.close(); }
    await owner.close();
    const next = new ConversationActivityStore(file);
    try { expect(next.getAssociation('op')).toMatchObject({ operationId: 'op' }); } finally { next.close(); }
  } finally { await owner?.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});

it('fails closed on a corrupt owner database before initializing the business database', () => {
  const root = temporary(), file = join(root, 'activity.sqlite');
  try {
    writeFileSync(`${file}.owner.sqlite`, Buffer.alloc(4096, 97), { mode: 0o600 });
    let caught: unknown;
    try { new ConversationActivityStore(file); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ message: 'conversation_activity_owner_held', cause: { errcode: 26 } });
    expect(statSync(file).size).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});
