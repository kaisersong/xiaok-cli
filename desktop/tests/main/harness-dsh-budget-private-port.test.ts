// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as service from '../../electron/harness-optimization-service.js';
const hosts: any[] = [], roots: string[] = [];
const now = Date.UTC(2026, 10, 6, 12), hash = 'a'.repeat(64);
async function fixture(root = mkdtempSync(join(tmpdir(), 'dsh-private-budget-')), withSource = true) {
    if (!roots.includes(root)) {
        roots.push(root);
    }
    const actor = Object.freeze({
        requestSource: 'user', principalId: 'fixture'
    });
    const proofs = new WeakMap<object, {
        purpose: string;
        view: unknown;
    }>();
    let sourceHook: ((purpose: string, view: any) => unknown) | undefined;
    const source = Object.freeze({
        resolve(proof: object, purpose: string) {
            const row = proofs.get(proof);
            if (!row || row.purpose !== purpose) {
                return null;
            }
            return sourceHook ? sourceHook(purpose, row.view) : row.view;
        }
    });
    const runtime = await service.createHarnessOptimizationRuntime({
        dataRoot: root, profileId: 'profile', workspaceId: 'workspace', authorizeUser: value => value === actor, manifestLookup: () => undefined, now: () => now, ...(withSource ? {
            dshBudgetAuthoritySource: source
        } : {})
    });
    hosts.push(runtime);
    function issue(purpose: string, input: unknown, requestSource = 'scheduler') {
        const proof = Object.freeze({});
        proofs.set(proof, {
            purpose, view: {
                requestSource, actor: requestSource === 'user' ? actor : null, profileId: 'profile', workspaceId: 'workspace', tenantId: 'tenant', mandateId: 'mandate', mandateRevision: 1, authorizationEpoch: 1, authorityHash: hash, commandDigest: service.dshBudgetCommandDigest(purpose, input), assertCurrent() {
                }
            }
        });
        return proof;
    }
    const account = {
        accountId: 'account', tokenLimit: 2000, costLimitMicros: 2000, currency: 'USD', scale: 6, validUntil: now + 100000
    };
    if (withSource) {
        await runtime.dsh.openAccount(account, issue('open', account, 'user'));
    }
    const input = (purpose = 'assessment', sequence = 1) => ({
        accountId: 'account', operation: {
            operationKey: 'operation.' + purpose, purpose, inputId: 'input', evidenceHash: hash, semanticHash: hash, threadHash: hash, workId: null, maxAttempts: 2, deadline: now + 50000
        }, attempt: {
            attemptId: 'attempt.' + purpose + '.' + sequence, sequence, bodyHash: hash, providerId: 'provider', modelId: 'model', modelProfileId: 'model_text_only_v1', pricingHash: hash, pricingKnown: true, maxInputTokens: 100, maxOutputTokens: 100, maxTokens: 200, maxCostMicros: 400, toolRounds: 0
        }
    });
    return {
        runtime, source, root, issue, input, hook: (next: typeof sourceHook) => {
            sourceHook = next;
        }
    };
}
const api = service as any;
it('returns only the original runtime disposal after the public method is replaced, including after disposal',async()=>{
 const f=await fixture(),originalDispose=f.runtime.dispose;
 let fakeCalls=0,proxyReads=0;
 const read=(service as unknown as {readOriginalDshBudgetRuntimeDisposal(runtime:unknown,source:unknown):{dispose():Promise<void>}}).readOriginalDshBudgetRuntimeDisposal;
 f.runtime.dispose=async()=>{fakeCalls++;throw Error('replacement disposal');};
 try{
  expect(()=>read({...f.runtime},f.source)).toThrow();
  expect(()=>read(f.runtime,{})).toThrow();
  expect(()=>read(new Proxy({}, {get(){proxyReads++;return null;}}),f.source)).toThrow();
  const lifetime=read(f.runtime,f.source),first=lifetime.dispose();
  expect(lifetime.dispose()).toBe(first);await first;
  expect(read(f.runtime,f.source).dispose()).toBe(first);
  expect(fakeCalls).toBe(0);expect(proxyReads).toBe(0);
 }finally{f.runtime.dispose=originalDispose;}
});
afterEach(async () => {
    for (const runtime of hosts.splice(0)) {
        try {
            await runtime.dispose();
        }
        catch (error) {
            expect(String(error)).toMatch(/dsh_budget_source_(failed|unconfirmed)/);
        }
    }
    for (const root of roots.splice(0)) {
        rmSync(root, {
            recursive: true, force: true, maxRetries: 5
        });
    }
});
describe.skipIf(process.platform !== 'darwin')('original budget private runtime port', () => {
    it('observes actual worker/account graph through original membership, never public status shape', async () => {
        const f = await fixture();
        expect(typeof api.readOriginalDshBudgetPort).toBe('function');
        const port = api.readOriginalDshBudgetPort(f.runtime, f.source);
        const query = {
            accountId: 'account'
        }, observation = await port.observe(query, f.issue('read', query));
        expect(Object.keys(observation)).toEqual([]);
        const view = api.readOriginalDshBudgetObservation(port, observation);
        expect(view.status.account.account_id).toBe('account');
        expect(view.status.account.owner_id).toBe(view.ownerId);
        expect(view.status.account.currency).toBe('USD');
        expect(view.status.account.scale).toBe(6);
        expect(Object.isFrozen(view)).toBe(true);
        const publicStatus = await f.runtime.dsh.status(query, f.issue('read', query));
        expect(() => api.readOriginalDshBudgetObservation(port, publicStatus)).toThrow('dsh_budget_observation_required');
    });
    it('receipts are born from the actual workless reserve transaction and exact replay does not hold twice', async () => {
        const f = await fixture();
        expect(typeof api.readOriginalDshBudgetPort).toBe('function');
        const port = api.readOriginalDshBudgetPort(f.runtime, f.source), input = f.input();
        const receipt = await port.reserveAttempt(input, f.issue('reserve', input));
        const view = api.readOriginalDshBudgetAttemptReceipt(port, receipt);
        expect(view.disposition).toBe('newly_reserved');
        expect(view.status.attempts[0].state).toBe('prepared');
        expect(view.status.operations[0].purpose).toBe('assessment');
        expect(view.status.operations[0].work_id).toBeNull();
        const repeat = await port.reserveAttempt(input, f.issue('reserve', input));
        expect(api.readOriginalDshBudgetAttemptReceipt(port, repeat).disposition).toBe('existing');
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare('SELECT COUNT(*) AS count FROM dsh_budget_attempts').get()?.count).toBe(1);
            expect(db.prepare('SELECT held_tokens FROM dsh_budget_accounts').get()?.held_tokens).toBe(200);
        }
        finally {
            db.close();
        }
        expect(() => api.readOriginalDshBudgetObservation(port, receipt)).toThrow('dsh_budget_observation_required');
        await f.runtime.dispose();
        expect(api.readOriginalDshBudgetAttemptReceipt(port, receipt).attemptId).toBe(input.attempt.attemptId);
        await expect(port.reserveAttempt(f.input('preview'), f.issue('reserve', f.input('preview')))).rejects.toThrow('optimization_unavailable');
    });
    it('rejects copied/Proxy/foreign runtime, Source and receipts before getters', async () => {
        const f = await fixture(), other = await fixture();
        expect(typeof api.readOriginalDshBudgetPort).toBe('function');
        let hits = 0;
        const fake = new Proxy({}, {
            get() {
                hits++;
                return undefined;
            }, ownKeys() {
                hits++;
                return [];
            }
        });
        expect(() => api.readOriginalDshBudgetPort(fake, f.source)).toThrow('dsh_budget_runtime_required');
        expect(() => api.readOriginalDshBudgetPort({
            ...f.runtime
        }, f.source)).toThrow('dsh_budget_runtime_required');
        expect(() => api.readOriginalDshBudgetPort(f.runtime, other.source)).toThrow('dsh_budget_runtime_required');
        const port = api.readOriginalDshBudgetPort(f.runtime, f.source), otherPort = api.readOriginalDshBudgetPort(other.runtime, other.source);
        const query = {
            accountId: 'account'
        }, observation = await port.observe(query, f.issue('read', query));
        expect(() => api.readOriginalDshBudgetObservation(otherPort, observation)).toThrow('dsh_budget_observation_required');
        expect(() => api.readOriginalDshBudgetObservation(port, fake)).toThrow('dsh_budget_observation_required');
        expect(hits).toBe(0);
    });
});
it.skipIf(process.platform !== 'darwin')('private reserve preserves a known budget denial without poisoning later observation', async () => {
    const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source), input = f.input();
    input.attempt.maxInputTokens = 2000;
    input.attempt.maxTokens = 2100;
    await expect(port.reserveAttempt(input, f.issue('reserve', input))).rejects.toThrow('dsh_budget_insufficient');
    const query = {
        accountId: 'account'
    };
    let observed = false;
    try {
        const handle = await port.observe(query, f.issue('read', query));
        observed = api.readOriginalDshBudgetObservation(port, handle).status.attempts.length === 0;
    }
    catch {
    }
    expect(observed).toBe(true);
});
describe.skipIf(process.platform !== 'darwin')('private budget receipt lifetime and original SQL', () => {
    it('a runtime without the constructor Source cannot gain a private port', async () => {
        const f = await fixture(undefined, false);
        expect(() => api.readOriginalDshBudgetPort(f.runtime, f.source)).toThrow('dsh_budget_runtime_required');
        expect(() => api.readOriginalDshBudgetPort(f.runtime, undefined)).toThrow('dsh_budget_runtime_required');
    });
    it('pins the original methods even if the public facade is replaced', async () => {
        const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source);
        let calls = 0;
        (f.runtime as any).dsh = {
            status() {
                calls++;
                return {};
            }, reserveAttempt() {
                calls++;
                return {};
            }
        };
        const input = f.input('preview'), receipt = await port.reserveAttempt(input, f.issue('reserve', input));
        const view = api.readOriginalDshBudgetAttemptReceipt(port, receipt);
        expect(view.status.operations[0].purpose).toBe('preview');
        expect(view.status.operations[0].work_id).toBeNull();
        expect(calls).toBe(0);
    });
    it('rejects a work draft in the workless port without new attempt rows', async () => {
        const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source), input = f.input('draft');
        (input.operation as any).workId = 'actual-work';
        await expect(port.reserveAttempt(input, f.issue('reserve', input))).rejects.toThrow('dsh_workless_attempt_required');
        const query = {
            accountId: 'account'
        }, handle = await port.observe(query, f.issue('read', query));
        expect(api.readOriginalDshBudgetObservation(port, handle).status.attempts.length).toBe(0);
    });
    it('checks the opaque Source member before inspecting a forged input', async () => {
        const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source);
        let hits = 0;
        const input = new Proxy({}, {
            get() {
                hits++;
                return undefined;
            }, ownKeys() {
                hits++;
                return [];
            }
        });
        await expect(port.observe(input, Object.freeze({}))).rejects.toThrow('dsh_actor_forbidden');
        expect(hits).toBe(0);
    });
    it('reopen reads actual not_sent recovery and never remints a new reservation from exact old history', async () => {
        const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source), input = f.input();
        const old = await port.reserveAttempt(input, f.issue('reserve', input));
        await f.runtime.dispose();
        const reopened = await fixture(f.root), newPort = api.readOriginalDshBudgetPort(reopened.runtime, reopened.source);
        expect(() => api.readOriginalDshBudgetAttemptReceipt(newPort, old)).toThrow('dsh_budget_attempt_receipt_required');
        const handle = await newPort.reserveAttempt(input, reopened.issue('reserve', input));
        const view = api.readOriginalDshBudgetAttemptReceipt(newPort, handle);
        expect(view.disposition).toBe('existing');
        expect(view.status.attempts[0].state).toBe('not_sent');
        expect(view.status.account.held_tokens).toBe(0);
        expect(api.readOriginalDshBudgetAttemptReceipt(port, old).status.attempts[0].state).toBe('prepared');
    });
    for (const method of ['observe', 'reserveAttempt'] as const) {
        it(method + ' retains an original Source error and both known child tails before closing the owner', async () => {
            const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source);
            let release1!: () => void, release2!: () => void;
            const held1 = new Promise<void>(resolve => {
                release1 = resolve;
            }), held2 = new Promise<void>(resolve => {
                release2 = resolve;
            });
            const original = Error('original-private-source');
            Object.defineProperty(original, 'nested', {
                value: held1
            });
            Object.defineProperty(original, Symbol('sdk-sidecar'), {
                value: held2
            });
            f.hook(() => {
                throw original;
            });
            const input = method === 'observe' ? {
                accountId: 'account'
            } : f.input(), purpose = method === 'observe' ? 'read' : 'reserve';
            let caught: unknown;
            try {
                await port[method](input, f.issue(purpose, input));
            }
            catch (error) {
                caught = error;
            }
            expect(caught).toBe(original);
            let closed = false;
            const closing = f.runtime.dispose().then(() => {
                closed = true;
            }, () => {
                closed = true;
            });
            try {
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(closed).toBe(false);
                release1();
                await new Promise(resolve => setTimeout(resolve, 20));
                expect(closed).toBe(false);
            }
            finally {
                release1();
                release2();
                await closing;
            }
        });
    }
    it('normal close at the final private receipt delivery prevents the cap and still finishes known cleanup', async () => {
        const f = await fixture(), port = api.readOriginalDshBudgetPort(f.runtime, f.source), input = f.input();
        let currents = 0, closing: Promise<void> | undefined;
        f.hook((purpose, view) => purpose === 'reserve' ? {
            ...view, assertCurrent() {
                currents++;
                if (currents === 5) {
                    closing = f.runtime.dispose();
                }
            }
        } : view);
        await expect(port.reserveAttempt(input, f.issue('reserve', input))).rejects.toThrow('optimization_unavailable');
        expect(currents).toBe(5);
        let closeFailed = false;
        try {
            await closing;
        }
        catch {
            closeFailed = true;
        }
        expect(closeFailed).toBe(false);
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare('SELECT COUNT(*) AS count FROM dsh_budget_attempts').get()?.count).toBe(1);
        }
        finally {
            db.close();
        }
    });
});

it.skipIf(process.platform !== 'darwin')('fixed runtime binding pins original owner and Source, while historical receipt is not a live gate',async()=>{
    const f=await fixture();
    const binding=api.readOriginalDshBudgetRuntimeBinding(f.runtime,f.source),query={accountId:'account'};
    const receipt=await binding.port.observe(query,f.issue('read',query));
    const view=api.readOriginalDshBudgetObservation(binding.port,receipt);
    expect(binding.ownerId).toBe(view.ownerId);
    expect(binding.port).toBe(api.readOriginalDshBudgetPort(f.runtime,f.source));
    expect(binding).toMatchObject({profileId:'profile',workspaceId:'workspace'});
    binding.assertCurrent();binding.assertLocal();
    let traps=0;const fake=new Proxy({},{get(){traps++;},ownKeys(){traps++;return [];}});
    expect(()=>api.readOriginalDshBudgetRuntimeBinding(fake,f.source)).toThrow('dsh_budget_runtime_required');
    expect(()=>api.readOriginalDshBudgetRuntimeBinding(f.runtime,{})).toThrow('dsh_budget_runtime_required');
    expect(traps).toBe(0);
    await f.runtime.dispose();
    expect(()=>binding.assertLocal()).toThrow('optimization_unavailable');
    expect(api.readOriginalDshBudgetObservation(binding.port,receipt).ownerId).toBe(view.ownerId);
});
