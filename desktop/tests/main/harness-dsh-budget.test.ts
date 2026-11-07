// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import * as service from '../../electron/harness-optimization-service.js';
import { parseDshInput } from '../../electron/harness-dsh-budget-data.mjs';
import { createDshBudgetTransaction } from '../../electron/harness-dsh-budget-ledger.mjs';
const roots: string[] = [], hosts: any[] = [];
const actor = Object.freeze({
    requestSource: 'user', principalId: 'fixture'
}), hash = 'a'.repeat(64);
// Captured from the production Hash.update input before the intrinsic fix;
// this fixture is an actual command preimage, not a second canonical encoder.
const largeAccountPreimage = '["dsh-budget-command-v1",[["input",[["accountId","account"],["costLimitMicros",1000],["currency","USD"],["scale",6],["tokenLimit",2000],["validUntil",1793966500000]]],["purpose","open"]]]';
let now = Date.UTC(2026, 10, 6, 12);
async function open(root = mkdtempSync(join(tmpdir(), 'dsh-budget-')), resolverMode?: 'bound_async') {
    if (!roots.includes(root))
        roots.push(root);
    const proofs = new WeakMap<object, any>(), manifests = new Map<string, any>();
    let clockFault: 'throw' | 'nan' | undefined;
    let clockHook: (() => void) | undefined, resolverBodies = 0;
    let hook: ((purpose: string, view: any) => any) | undefined;
    const resolve = (proof: object, purpose: string) => {
        const value = proofs.get(proof);
        if (!value || value.purpose !== purpose)
            return null;
        return hook ? hook(purpose, value.view) : value.view;
    };
    const source = Object.freeze({ resolve: resolverMode === 'bound_async' ? (async function (proof: object, purpose: string) { resolverBodies++; return resolve(proof, purpose); }).bind(null) : resolve });
    const host = await service.createHarnessOptimizationRuntime({
        dataRoot: root, profileId: 'profile', workspaceId: 'workspace', authorizeUser: (ctx: unknown) => ctx === actor, manifestLookup: (id: string) => manifests.get(id), now: () => {
            clockHook?.();
            if (clockFault === 'throw')
                throw Error('clock-unavailable');
            return clockFault === 'nan' ? NaN : now;
        }, dshBudgetAuthoritySource: source
    } as any);
    hosts.push(host);
    const issue = (purpose: string, input: any, requestSource = 'scheduler') => {
        const proof = Object.freeze({});
        proofs.set(proof, {
            purpose, view: {
                requestSource, actor: requestSource === 'user' ? actor : null, profileId: 'profile', workspaceId: 'workspace', tenantId: 'tenant', mandateId: 'mandate', mandateRevision: 1, authorizationEpoch: 1, authorityHash: hash, commandDigest: (service as any).dshBudgetCommandDigest(purpose, input), assertCurrent() {
                }
            }
        });
        return proof;
    };
    return {
        host, root, issue, manifests, resolverBodyCount: () => resolverBodies, setClockHook: (value: typeof clockHook) => { clockHook = value; }, setClockFault: (value: typeof clockFault) => {
            clockFault = value;
        }, setSourceHook: (value: typeof hook) => {
            hook = value;
        }
    };
}
const account = () => ({
    accountId: 'account', tokenLimit: 1000, costLimitMicros: 1000, currency: 'USD', scale: 6, validUntil: now + 100000
});
const reserve = (operationKey = 'operation', sequence = 1) => ({
    accountId: 'account', operation: {
        operationKey, purpose: 'assessment', inputId: 'input', evidenceHash: hash, semanticHash: hash, threadHash: hash, workId: null, maxAttempts: 2, deadline: now + 50000
    }, attempt: {
        attemptId: operationKey + sequence, sequence, bodyHash: hash, providerId: 'provider', modelId: 'model', modelProfileId: 'model_readonly_v1', pricingHash: hash, pricingKnown: true, maxInputTokens: 200, maxOutputTokens: 200, maxTokens: 400, maxCostMicros: 600, toolRounds: 0
    }
});
const attempt = (operationKey = 'operation', sequence = 1) => ({
    accountId: 'account', operationKey, sequence, attemptId: operationKey + sequence, bodyHash: hash
});
async function invoke(f: any, method: string, purpose: string, input: any, source = 'scheduler') {
    return f.host.dsh[method](input, f.issue(purpose, input, source));
}
afterEach(async () => {
    for (const h of hosts.splice(0)) {
        try {
            await h.dispose();
        }
        catch (error) {
            expect(String(error)).toMatch(/dsh_budget_source_(failed|unconfirmed)/);
        }
    }
    for (const p of roots.splice(0))
        rmSync(p, {
            recursive: true, force: true, maxRetries: 5
        });
    now = Date.UTC(2026, 10, 6, 12);
});
describe.skipIf(process.platform !== 'darwin')('DSH same original budget owner', () => {
    it('keeps the original request Promise after the final Source callback', async () => {
        const f = await open();
        const NativePromise = Promise, original = Object.getOwnPropertyDescriptor(globalThis, 'Promise')!;
        const ownerState = await f.host.api.read();
        let callbacks = 0, replacements = 0;
        function ReplacementPromise() {
            replacements++;
            return NativePromise.resolve({ result: { fakeResponse: true }, ownerState });
        }
        f.setSourceHook((_purpose, view) => ({ ...view, assertCurrent() {
            if (++callbacks === 3)
                Object.defineProperty(globalThis, 'Promise', { ...original, value: ReplacementPromise });
        } }));
        let result: any;
        try {
            result = await invoke(f, 'openAccount', 'open', account(), 'user');
        } finally {
            Object.defineProperty(globalThis, 'Promise', original);
        }
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        let version: unknown;
        try { version = db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value; }
        finally { db.close(); }
        console.info('DSH_REQUEST_PROMISE_FACTS', JSON.stringify({ replacements, version, fakeResponse: result?.fakeResponse === true }));
        expect(replacements).toBe(0);
        expect(version).toBe('2');
        expect(result.account.account_id).toBe('account');
    });
    it('uses the original worker post method without a later prototype getter', async () => {
        const f = await open();
        const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')!;
        let getters = 0, closing: Promise<void> | undefined;
        Object.defineProperty(Worker.prototype, 'postMessage', {
            configurable: true,
            get() {
                getters++;
                closing = f.host.dispose();
                return descriptor.value;
            },
        });
        try {
            const result = await invoke(f, 'openAccount', 'open', account(), 'user')
                .then(value => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' }));
            console.info('DSH_WORKER_POST_LOOKUP_FACTS', JSON.stringify({ getters, status: result.status }));
            expect(getters).toBe(0);
            expect(result.status).toBe('fulfilled');
        }
        finally {
            Object.defineProperty(Worker.prototype, 'postMessage', descriptor);
            if (closing)
                await closing;
        }
    });
    for (const source of ['scheduler', 'user'] as const)
        it('retains an invalid returned actor child for ' + source, async () => {
            const f = await open();
            await invoke(f, 'openAccount', 'open', account(), 'user');
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            f.setSourceHook((_purpose, view) => ({ ...view, actor: held }));
            const operation = source === 'scheduler'
                ? invoke(f, 'reserveAttempt', 'reserve', reserve())
                : invoke(f, 'status', 'read', { accountId: 'account' }, 'user');
            const outcome = await operation.then(() => 'accepted', () => 'rejected');
            let closed = false;
            const closing = f.host.dispose().then(() => { closed = true; }, () => { closed = true; });
            try {
                await new Promise(resolve => setTimeout(resolve, 25));
                console.info('DSH_RETURNED_ACTOR_FACTS', JSON.stringify({ source, outcome, closed }));
                expect(outcome).toBe('rejected');
                expect(closed).toBe(false);
            }
            finally {
                release();
                await closing;
            }
        });
    for (const point of ['second_current', 'clock_dispose', 'clock_revoke'] as const)
        it('does not post a new account after Source reentry at ' + point, async () => {
            const f = await open();
            let checks = 0, revoked = false, closing: Promise<void> | undefined;
            f.setSourceHook((_purpose, view) => ({ ...view, assertCurrent() { if (revoked)
                    throw Error('fixture-revoked'); if (point === 'second_current' && ++checks === 2)
                    closing = f.host.dispose(); } }));
            if (point !== 'second_current')
                f.setClockHook(() => { if (point === 'clock_dispose')
                    closing = f.host.dispose();
                else
                    revoked = true; });
            const outcome = await Promise.allSettled([invoke(f, 'openAccount', 'open', account(), 'user')]);
            if (closing)
                await closing.catch(() => { });
            const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
            let version: unknown;
            try {
                version = db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value;
            }
            finally {
                db.close();
            }
            console.info('DSH_REENTRANT_POST_FACTS', JSON.stringify({ point, outcome: outcome[0].status, version }));
            expect(outcome[0].status).toBe('rejected');
            expect(version).toBe('1');
        });
    it('keeps the original owner locked when resolve disposes then throws a held SDK child', async () => {
        const f = await open();
        let release!: () => void, closed = false, closing!: Promise<unknown>;
        const held = new Promise<void>(resolve => { release = resolve; }), error = Error('resolve-after-dispose', { cause: held });
        f.setSourceHook(() => { closing = f.host.dispose().then(() => { closed = true; }, () => { closed = true; }); throw error; });
        await expect(invoke(f, 'openAccount', 'open', account(), 'user')).rejects.toBe(error);
        await new Promise(resolve => setTimeout(resolve, 25));
        const early = closed, other = await open(f.root), contender = (await other.host.api.read()).status;
        release();
        await closing;
        console.info('DSH_REENTRANT_DISPOSE_FACTS', JSON.stringify({ early, contender }));
        expect(early).toBe(false);
        expect(contender).toBe('unavailable');
    });
    it('rejects a bound async resolver without executing its body', async () => {
        const f = await open(undefined, 'bound_async');
        await expect(invoke(f, 'openAccount', 'open', account(), 'user')).rejects.toThrow();
        expect(f.resolverBodyCount()).toBe(0);
    });
    it('rejects a bound async guard without executing its body', async () => {
        const f = await open();
        let bodies = 0;
        const guard = (async function () { bodies++; }).bind(null);
        f.setSourceHook((_purpose, view) => ({ ...view, assertCurrent: guard }));
        await expect(invoke(f, 'openAccount', 'open', account(), 'user')).rejects.toThrow();
        expect(bodies).toBe(0);
    });
    it('keeps original schema1 owner healthy after a rejected first expired migration', async () => {
        let f = await open();
        const owner = (await f.host.api.read()).ownerId;
        await expect(invoke(f, 'openAccount', 'open', {
            ...account(), validUntil: now - 1
        }, 'user')).rejects.toThrow('dsh_budget_expired');
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value).toBe('1');
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dsh_budget_%'").all()).toEqual([]);
        }
        finally {
            db.close();
        }
        expect(await f.host.api.read()).toMatchObject({
            status: 'ready', ownerId: owner
        });
        const [closed] = await Promise.allSettled([f.host.dispose()]);
        hosts.splice(hosts.indexOf(f.host), 1);
        expect(closed.status).toBe('fulfilled');
        f = await open(f.root);
        expect(await f.host.api.read()).toMatchObject({
            status: 'ready', ownerId: owner
        });
    });
    it('does not let a late Hash.digest hook change an original Source command binding', async () => {
        const f = await open(), small = account(), large = {
            ...small, tokenLimit: 2000
        };
        const target = (service as any).dshBudgetCommandDigest('open', large);
        expect(target).toBe('2ddb21328a589e15b9a522a0cbdee8260417fc08e4d463344b51187ee2210ebb');
        const proto = Object.getPrototypeOf(createHash('sha256')), old = Object.getOwnPropertyDescriptor(proto, 'digest')!;
        let calls = 0, outcome: PromiseSettledResult<unknown>;
        try {
            Object.defineProperty(proto, 'digest', {
                ...old, value() {
                    calls++;
                    return target;
                }
            });
            const proof = f.issue('open', small, 'user');
            [outcome] = await Promise.allSettled([f.host.dsh.openAccount(large, proof)]);
        }
        finally {
            Object.defineProperty(proto, 'digest', old);
        }
        console.info('DSH_LATE_HASH_DIGEST_FACTS', JSON.stringify({
            calls, status: outcome!.status, acceptedTokenLimit: outcome!.status === 'fulfilled' ? (outcome!.value as any).account.token_limit : null
        }));
        expect(outcome!.status).toBe('rejected');
        expect(calls).toBe(0);
    });
    it('does not let a late Hash.update hook replace a signed command preimage', async () => {
        const f = await open(), small = account(), large = {
            ...small, tokenLimit: 2000
        };
        const proto = Object.getPrototypeOf(createHash('sha256')), old = Object.getOwnPropertyDescriptor(proto, 'update')!;
        let calls = 0, outcome: PromiseSettledResult<unknown>;
        try {
            Object.defineProperty(proto, 'update', {
                ...old, value(_data: unknown, ...args: unknown[]) {
                    calls++;
                    return Reflect.apply(old.value, this, [largeAccountPreimage, ...args]);
                }
            });
            const proof = f.issue('open', small, 'user');
            [outcome] = await Promise.allSettled([f.host.dsh.openAccount(large, proof)]);
        }
        finally {
            Object.defineProperty(proto, 'update', old);
        }
        console.info('DSH_LATE_HASH_UPDATE_FACTS', JSON.stringify({
            calls, status: outcome!.status, acceptedTokenLimit: outcome!.status === 'fulfilled' ? (outcome!.value as any).account.token_limit : null
        }));
        expect(outcome!.status).toBe('rejected');
        expect(calls).toBe(0);
    });
    it('does not let late Array.toJSON substitute a production command preimage', async () => {
        const f = await open(), small = account(), large = {
            ...small, tokenLimit: 2000
        }, replacement = JSON.parse(largeAccountPreimage);
        const old = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
        let calls = 0, outcome: PromiseSettledResult<unknown>;
        try {
            Object.defineProperty(Array.prototype, 'toJSON', {
                configurable: true, value: function (this: unknown[]) {
                    calls++;
                    return this[0] === 'dsh-budget-command-v1' ? replacement : this;
                }
            });
            const proof = f.issue('open', small, 'user');
            [outcome] = await Promise.allSettled([f.host.dsh.openAccount(large, proof)]);
        }
        finally {
            if (old)
                Object.defineProperty(Array.prototype, 'toJSON', old);
            else
                Reflect.deleteProperty(Array.prototype, 'toJSON');
        }
        console.info('DSH_LATE_ARRAY_JSON_FACTS', JSON.stringify({
            calls, status: outcome!.status, acceptedTokenLimit: outcome!.status === 'fulfilled' ? (outcome!.value as any).account.token_limit : null
        }));
        expect(outcome!.status).toBe('rejected');
        expect(calls).toBe(0);
    });
    it('does not consult a late iterator while validating the Source authority fields', async () => {
        const f = await open(), input = account(), old = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
        let calls = 0;
        try {
            Object.defineProperty(Array.prototype, Symbol.iterator, {
                ...old, value: function (this: unknown[]) {
                    if (this.length === 4 && this[0] === 'profileId' && this[1] === 'workspaceId') {
                        calls++;
                        return {
                            next() {
                                return {
                                    done: true
                                };
                            }
                        };
                    }
                    return Reflect.apply(old.value, this, []);
                }
            });
            await invoke(f, 'openAccount', 'open', input, 'user');
        }
        finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, old);
        }
        console.info('DSH_LATE_AUTH_ITERATOR_FACTS', JSON.stringify({
            calls
        }));
        expect(calls).toBe(0);
    });
    it('does not consult a late base-field iterator when parsing an owned marker', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        const old = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
        let calls = 0, result: any;
        try {
            Object.defineProperty(Array.prototype, Symbol.iterator, {
                ...old, value: function (this: unknown[]) {
                    if (this.length === 4 && this[0] === 'accountId' && this[1] === 'operationKey') {
                        calls++;
                        return {
                            next() {
                                return {
                                    done: true
                                };
                            }
                        };
                    }
                    return Reflect.apply(old.value, this, []);
                }
            });
            result = await invoke(f, 'markPreSend', 'marker', attempt());
        }
        finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, old);
        }
        expect(result.attempts[0].state).toBe('pre_send');
        expect(calls).toBe(0);
    });
    it('exposes a closed DSH facade and does not migrate on an unauthenticated call', async () => {
        const f = await open();
        expect(f.host.dsh).toBeTypeOf('object');
        await expect(f.host.dsh.openAccount(account(), {})).rejects.toThrow('dsh_actor_forbidden');
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value).toBe('1');
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dsh_budget_%'").all()).toEqual([]);
        }
        finally {
            db.close();
        }
    });
    it('uses the original worker to reserve, mark and settle exact integer tokens and money', async () => {
        const f = await open();
        expect(f.host.dsh).toBeTypeOf('object');
        await invoke(f, 'openAccount', 'open', account(), 'user');
        const r = reserve();
        await invoke(f, 'reserveAttempt', 'reserve', r);
        await invoke(f, 'markPreSend', 'marker', attempt());
        await invoke(f, 'markSent', 'sent', attempt());
        const settlement = {
            ...attempt(), actualTokens: 150, actualCostMicros: 250, usageReceiptHash: hash
        };
        delete (settlement as any).bodyHash;
        await invoke(f, 'settleAttempt', 'settle', settlement);
        const status = await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user');
        expect(status.account).toMatchObject({
            spent_tokens: 150, spent_cost: 250, held_tokens: 0, held_cost: 0
        });
        expect(status.attempts[0].state).toBe('settled');
    });
    it('serializes concurrent attempts against one original account balance', async () => {
        const f = await open();
        expect(f.host.dsh).toBeTypeOf('object');
        await invoke(f, 'openAccount', 'open', account(), 'user');
        const rows = await Promise.allSettled([invoke(f, 'reserveAttempt', 'reserve', reserve('a')), invoke(f, 'reserveAttempt', 'reserve', reserve('b'))]);
        expect(rows.map(x => x.status).sort()).toEqual(['fulfilled', 'rejected']);
        const status = await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user');
        expect(status.account.held_cost).toBe(600);
        expect(status.attempts).toHaveLength(1);
    });
    it('retains marked unknown usage through actual owner shutdown and cold reopen', async () => {
        let f = await open();
        expect(f.host.dsh).toBeTypeOf('object');
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await invoke(f, 'markPreSend', 'marker', attempt());
        await f.host.dispose();
        f = await open(f.root);
        const status = await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user');
        expect(status.account).toMatchObject({
            held_tokens: 400, held_cost: 600, spent_tokens: 0, spent_cost: 0
        });
        expect(status.attempts[0].state).toBe('unknown');
    });
    for (const unknown of [false, true])
        it('waits actual Source error held Promise with unknown=' + unknown, async () => {
            const f = await open();
            await invoke(f, 'openAccount', 'open', account(), 'user');
            let release!: (value?: unknown) => void;
            const held = new Promise(resolve => {
                release = resolve;
            }), error = Error('original-source-error');
            Object.defineProperty(error, Symbol('child'), {
                value: held
            });
            let getterCalls = 0;
            if (unknown)
                Object.defineProperty(error, 'unknown', {
                    get() {
                        getterCalls++;
                        return null;
                    }
                });
            f.setSourceHook(() => {
                throw error;
            });
            await expect(invoke(f, 'status', 'read', {
                accountId: 'account'
            }, 'user')).rejects.toBe(error);
            let closed = false, closeError: unknown;
            const closing = f.host.dispose().then(() => {
                closed = true;
            }, error => {
                closeError = error;
                closed = true;
            });
            await new Promise(resolve => setTimeout(resolve, 25));
            const closedBeforeRelease = closed;
            release();
            await closing;
            expect(closedBeforeRelease).toBe(false);
            expect(getterCalls).toBe(0);
            expect(closeError).toMatchObject({
                message: unknown ? 'dsh_budget_source_unconfirmed' : 'dsh_budget_source_failed'
            });
        });
    it('denies agent, foreign context, copied context and tampered command before DDL', async () => {
        const f = await open(), other = await open();
        let gets = 0;
        const evil = Object.defineProperty({}, 'accountId', {
            get() {
                gets++;
                return 'account';
            }
        });
        await expect(f.host.dsh.openAccount(evil, {})).rejects.toThrow('dsh_actor_forbidden');
        await expect(f.host.dsh.openAccount(account(), other.issue('open', account(), 'user'))).rejects.toThrow('dsh_actor_forbidden');
        const proof = f.issue('open', account(), 'user');
        await expect(f.host.dsh.openAccount(account(), {
            ...proof
        })).rejects.toThrow('dsh_actor_forbidden');
        await expect(invoke(f, 'openAccount', 'open', account(), 'agent')).rejects.toThrow('dsh_actor_forbidden');
        await expect(f.host.dsh.openAccount({
            ...account(), tokenLimit: 2000
        }, proof)).rejects.toThrow('dsh_actor_forbidden');
        expect(gets).toBe(0);
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dsh_budget_%'").all()).toEqual([]);
        }
        finally {
            db.close();
        }
    });
    it('rejects unknown pricing, zero money, nonintegers and mismatched token maxima', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        for (const patch of [{
                pricingKnown: false
            }, {
                maxCostMicros: 0
            }, {
                maxCostMicros: 1.1
            }, {
                maxTokens: 401
            }, {
                toolRounds: 1
            }, {
                maxInputTokens: NaN
            }]) {
            const input = reserve();
            Object.assign(input.attempt, patch);
            await expect(f.host.dsh.reserveAttempt(input, {})).rejects.toThrow('dsh_actor_forbidden');
            expect(() => (service as any).dshBudgetCommandDigest('reserve', input)).toThrow('dsh_budget_invalid');
        }
        expect((await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).attempts).toEqual([]);
    });
    it('preserves exact attempt idempotency, rejects conflicts and charges each physical retry', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', {
            ...account(), costLimitMicros: 2000
        }, 'user');
        const r = reserve();
        const first = await invoke(f, 'reserveAttempt', 'reserve', r), again = await invoke(f, 'reserveAttempt', 'reserve', r);
        expect(again.account.revision).toBe(first.account.revision);
        const changed = reserve();
        changed.attempt.bodyHash = 'b'.repeat(64);
        await expect(invoke(f, 'reserveAttempt', 'reserve', changed)).rejects.toThrow('dsh_attempt_conflict');
        await expect(invoke(f, 'reserveAttempt', 'reserve', reserve('operation', 2))).rejects.toThrow('dsh_attempt_order');
        await invoke(f, 'markPreSend', 'marker', attempt());
        const settlement = {
            accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', actualTokens: 100, actualCostMicros: 200, usageReceiptHash: hash
        };
        await invoke(f, 'settleAttempt', 'settle', settlement);
        const againSettle = await invoke(f, 'settleAttempt', 'settle', settlement);
        await expect(invoke(f, 'settleAttempt', 'settle', {
            ...settlement, actualCostMicros: 201
        })).rejects.toThrow('dsh_usage_conflict');
        const next = await invoke(f, 'reserveAttempt', 'reserve', reserve('operation', 2));
        expect(next.account).toMatchObject({
            spent_tokens: 100, spent_cost: 200, held_tokens: 400, held_cost: 600
        });
        expect(next.account.revision).toBe(againSettle.account.revision + 1);
    });
    it('records actual overrun before closing the original account', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await invoke(f, 'markPreSend', 'marker', attempt());
        const result = await invoke(f, 'settleAttempt', 'settle', {
            accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', actualTokens: 1200, actualCostMicros: 1400, usageReceiptHash: hash
        });
        expect(result.account).toMatchObject({
            spent_tokens: 1200, spent_cost: 1400, held_tokens: 0, held_cost: 0, status: 'closed', close_reason: 'overrun'
        });
        await expect(invoke(f, 'reserveAttempt', 'reserve', reserve('next'))).rejects.toThrow('dsh_budget_expired');
    });
    it('does not refund marked unknown usage at deadline and accepts only exact late settlement', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await invoke(f, 'markPreSend', 'marker', attempt());
        const unknown = {
            accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', reason: 'usage_unknown'
        };
        await invoke(f, 'markUnknown', 'unknown', unknown);
        now += 200000;
        expect((await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).account.held_cost).toBe(600);
        await expect(invoke(f, 'reserveAttempt', 'reserve', reserve('next'))).rejects.toThrow('dsh_budget_expired');
        expect((await invoke(f, 'settleAttempt', 'settle', {
            accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', actualTokens: 100, actualCostMicros: 100, usageReceiptHash: hash
        })).account.held_cost).toBe(0);
    });
    it('releases only this unconnected slice prepared attempt on real shutdown', async () => {
        let f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await f.host.dispose();
        f = await open(f.root);
        const s = await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user');
        expect(s.account.held_cost).toBe(0);
        expect(s.attempts[0].state).toBe('not_sent');
        await expect(invoke(f, 'markPreSend', 'marker', attempt())).rejects.toThrow('dsh_attempt_state');
    });
    it('rejects an unexpected schema2 trigger before original recovery writes', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await f.host.dispose();
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            db.exec('CREATE TRIGGER unknown_budget_trigger AFTER INSERT ON dsh_budget_accounts BEGIN SELECT 1; END');
        }
        finally {
            db.close();
        }
        const reopened = await open(f.root);
        expect(await reopened.host.api.read()).toMatchObject({
            status: 'unavailable', reason: 'optimization_store_unavailable'
        });
    });
    it('keeps an actual BEGIN BUSY failure typed unknown and freezes subsequent budget entry', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        db.exec('BEGIN IMMEDIATE');
        try {
            await expect(invoke(f, 'reserveAttempt', 'reserve', reserve())).rejects.toMatchObject({
                message: 'dsh_budget_outcome_unknown', outcomeUnknown: true, stage: 'begin', primaryPresent: true
            });
        }
        finally {
            db.exec('ROLLBACK');
            db.close();
        }
        await expect(invoke(f, 'reserveAttempt', 'reserve', reserve())).rejects.toThrow('optimization_unavailable');
    }, 15000);
    it('rejects the original shared clock reset while a DSH reservation is pending', async () => {
        const f = await open();
        const start = now;
        await invoke(f, 'openAccount', 'open', {
            ...account(), validUntil: now + 900000
        }, 'user');
        const request = reserve();
        request.operation.deadline = now + 800000;
        await invoke(f, 'reserveAttempt', 'reserve', request);
        now += 300000;
        const state = await f.host.api.read();
        f.manifests.set('clock-probe', {
            id: 'clock-probe', ownerId: state.ownerId, profileId: 'profile', workspaceId: 'workspace', behaviorFingerprint: hash, bindingHash: hash, executionKind: 'probe', expiresAt: now + 600000, machineBoundMs: 10000, perRun: {
                tokens: 1000, requests: 1, timeoutMs: 10000
            }, steps: [{
                    id: 'one', bodyHash: hash, tokens: 1000, timeoutMs: 1000
                }]
        });
        await f.host.api.issueResearchIntent({
            manifestId: 'clock-probe'
        }, actor);
        let event: any;
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            event = db.prepare('SELECT * FROM forward_steps ORDER BY afterMark DESC LIMIT 1').get();
        }
        finally {
            db.close();
        }
        const high = now;
        now = start + 10000;
        await expect(f.host.api.resetClockGuard({
            expectedHighWaterMark: high, correctionEventId: event.id
        }, actor)).rejects.toThrow('clock_reset_forbidden');
        expect((await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).account.held_cost).toBe(600);
    });
    it('publishes the DSH clock high-water mark into the original runtime cache', async () => {
        const f = await open();
        now += 10000;
        await invoke(f, 'openAccount', 'open', account(), 'user');
        expect((await f.host.api.read()).highWaterMark).toBe(now);
    });
    it('publishes DSH clock rollback while still permitting owned late settlement', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await invoke(f, 'markPreSend', 'marker', attempt());
        now -= 5000;
        await expect(invoke(f, 'reserveAttempt', 'reserve', reserve('next'))).rejects.toThrow('clock_rollback');
        expect((await f.host.api.read()).dispatchBlocked).toBe(true);
        const result = await invoke(f, 'settleAttempt', 'settle', {
            accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', actualTokens: 100, actualCostMicros: 100, usageReceiptHash: hash
        });
        expect(result.account.held_cost).toBe(0);
    });
    it('retains a Promise revealed by a Source Promise settlement before disposing', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        let finish!: (value: unknown) => void, release!: () => void;
        const first = new Promise(resolve => {
            finish = resolve;
        }), second = new Promise<void>(resolve => {
            release = resolve;
        });
        const error = Error('original');
        Object.defineProperty(error, 'stack', {
            value: first
        });
        f.setSourceHook(() => {
            throw error;
        });
        await expect(invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).rejects.toBe(error);
        let closed = false;
        const closing = f.host.dispose().catch(() => {
        }).then(() => {
            closed = true;
        });
        finish({
            [Symbol('second')]: second
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        const premature = closed;
        release();
        await closing;
        expect(premature).toBe(false);
    });
    it('rejects a corrupt cold balance before prepared recovery can refund it', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        await invoke(f, 'reserveAttempt', 'reserve', reserve());
        await invoke(f, 'markPreSend', 'marker', attempt());
        await f.host.dispose();
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            db.prepare('UPDATE dsh_budget_accounts SET held_cost=0').run();
        }
        finally {
            db.close();
        }
        const reopened = await open(f.root);
        expect(await reopened.host.api.read()).toMatchObject({
            status: 'unavailable'
        });
    });
    it('preserves undefined Source current failure presence and freezes new admission', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        f.setSourceHook((_purpose, view) => ({
            ...view, assertCurrent() {
                throw undefined;
            }
        }));
        let rejected = false, value: unknown = 'not rejected';
        await invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user').then(() => {
        }, error => {
            rejected = true;
            value = error;
        });
        expect(rejected).toBe(true);
        expect(value).toBeUndefined();
        await expect(invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).rejects.toThrow('dsh_budget_source_unconfirmed');
        await expect(f.host.dispose()).rejects.toHaveProperty('cause', undefined);
    });
    it('does not accept a promise returned by Source current and drains its outcome child', async () => {
        const f = await open();
        await invoke(f, 'openAccount', 'open', account(), 'user');
        let release!: () => void;
        const held = new Promise<void>(resolve => {
            release = resolve;
        });
        f.setSourceHook((_purpose, view) => ({
            ...view, assertCurrent() {
                return Promise.resolve({
                    child: held
                });
            }
        }));
        await expect(invoke(f, 'status', 'read', {
            accountId: 'account'
        }, 'user')).rejects.toThrow('dsh_actor_forbidden');
        let closed = false;
        const closing = f.host.dispose().catch(() => {
        }).then(() => {
            closed = true;
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        const early = closed;
        release();
        await closing;
        expect(early).toBe(false);
    });
    it('returns existing immutable facts after expiry without granting a new send', async () => {
        const f = await open(), input = account(), request = reserve();
        await invoke(f, 'openAccount', 'open', input, 'user');
        const reserved = await invoke(f, 'reserveAttempt', 'reserve', request);
        now += 200000;
        expect((await invoke(f, 'openAccount', 'open', input, 'user')).account.revision).toBe(reserved.account.revision);
        expect((await invoke(f, 'reserveAttempt', 'reserve', request)).account.revision).toBe(reserved.account.revision);
        await expect(invoke(f, 'markPreSend', 'marker', attempt())).rejects.toThrow('dsh_budget_expired');
    });
    it('does not accept an outer command after a reentrant current guard faults the same Source', async () => {
        const f = await open();
        let nested = false;
        f.setSourceHook((purpose, view) => ({
            ...view, assertCurrent() {
                if (purpose === 'read')
                    throw Error('nested-source-failed');
                if (!nested) {
                    nested = true;
                    void invoke(f, 'status', 'read', {
                        accountId: 'account'
                    }, 'user').catch(() => {
                    });
                }
            }
        }));
        await expect(invoke(f, 'openAccount', 'open', account(), 'user')).rejects.toThrow('dsh_budget_source_unconfirmed');
        const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
        try {
            expect(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value).toBe('1');
        }
        finally {
            db.close();
        }
    });
});
describe.skipIf(process.platform !== 'darwin')('DSH owned cleanup without a current clock', () => {
    for (const fault of ['throw', 'nan'] as const)
        for (const first of ['read', 'settle'] as const)
            it('cleans owned attempt with ' + first + ' first while current clock is ' + fault, async () => {
                const f = await open();
                await invoke(f, 'openAccount', 'open', account(), 'user');
                await invoke(f, 'reserveAttempt', 'reserve', reserve());
                await invoke(f, 'markPreSend', 'marker', attempt());
                f.setClockFault(fault);
                const unknown = {
                    accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', reason: 'usage_unknown'
                };
                if (first === 'read') {
                    expect((await invoke(f, 'status', 'read', {
                        accountId: 'account'
                    }, 'user')).account.held_cost).toBe(600);
                    await invoke(f, 'markUnknown', 'unknown', unknown);
                }
                await invoke(f, 'settleAttempt', 'settle', {
                    accountId: 'account', operationKey: 'operation', sequence: 1, attemptId: 'operation1', actualTokens: 100, actualCostMicros: 100, usageReceiptHash: hash
                });
                await invoke(f, 'markUnknown', 'unknown', unknown);
                await invoke(f, 'markSent', 'sent', attempt());
                expect((await invoke(f, 'status', 'read', {
                    accountId: 'account'
                }, 'user')).account).toMatchObject({
                    spent_tokens: 100, spent_cost: 100, held_tokens: 0, held_cost: 0
                });
            });
});
describe('DSH original SQLite transaction fate', () => {
    it('keeps successful BEGIN followed by thrown undefined permanently unknown', () => {
        const root = mkdtempSync(join(tmpdir(), 'dsh-begin-fate-'));
        roots.push(root);
        const db = new DatabaseSync(join(root, 'fate.sqlite'));
        let unknown: any;
        const transaction = createDshBudgetTransaction({
            exec(sql: string) {
                const result = db.exec(sql);
                if (sql === 'BEGIN IMMEDIATE')
                    throw undefined;
                return result;
            }
        }, error => {
            unknown = error;
        });
        try {
            expect(() => transaction(() => {
            })).toThrow('dsh_budget_outcome_unknown');
            expect(unknown).toMatchObject({
                stage: 'begin', primaryPresent: true, rollbackErrorPresent: false
            });
            expect(Object.getOwnPropertyDescriptor(unknown, 'cause')?.value).toBeUndefined();
            db.exec('BEGIN IMMEDIATE');
            db.exec('ROLLBACK');
            expect(() => transaction(() => {
            })).toThrow('dsh_budget_outcome_unknown');
        }
        finally {
            db.close();
        }
    });
    it('preserves COMMIT first error and rollback secondary while retaining an actual committed row', () => {
        const root = mkdtempSync(join(tmpdir(), 'dsh-fate-'));
        roots.push(root);
        const db = new DatabaseSync(join(root, 'fate.sqlite'));
        db.exec('CREATE TABLE facts(value INTEGER)');
        const primary = Error('commit-return-lost'), secondary = Error('rollback-failed');
        let unknown: any;
        const transaction = createDshBudgetTransaction({
            exec(sql: string) {
                if (sql === 'COMMIT') {
                    db.exec(sql);
                    throw primary;
                }
                if (sql === 'ROLLBACK')
                    throw secondary;
                return db.exec(sql);
            }
        }, error => {
            unknown = error;
        });
        try {
            expect(() => transaction(() => db.prepare('INSERT INTO facts VALUES(1)').run())).toThrow('dsh_budget_outcome_unknown');
            expect(unknown).toMatchObject({
                cause: primary, rollbackError: secondary, stage: 'commit', outcomeUnknown: true, primaryPresent: true
            });
            expect(db.prepare('SELECT value FROM facts').get()?.value).toBe(1);
            expect(() => transaction(() => {
            })).toThrow('dsh_budget_outcome_unknown');
        }
        finally {
            db.close();
        }
    });
});


describe('DSH numeric canonical zero', () => {
    it.each(['validUntil', 'deadline', 'toolRounds', 'actualTokens', 'actualCostMicros'])('rejects negative zero in original parser: %s', field => {
        let purpose = 'settle';
        let input: any = {accountId:'account',operationKey:'operation',sequence:1,attemptId:'attempt',actualTokens:0,actualCostMicros:0,usageReceiptHash:hash};
        if (field === 'validUntil') {purpose='open';input={...account(),validUntil:-0};}
        else if (field === 'deadline' || field === 'toolRounds') {
            purpose='reserve';input=reserve();
            if (field === 'deadline') input.operation.deadline=-0;
            else input.attempt.toolRounds=-0;
        } else input[field]=-0;
        expect(() => parseDshInput(purpose,input)).toThrow('dsh_budget_invalid');
    });
    it.skipIf(process.platform !== 'darwin').each(['actualTokens','actualCostMicros'])('rejects negative zero through actual original service settle: %s', async field => {
        const f=await open();
        await invoke(f,'openAccount','open',account(),'user');
        await invoke(f,'reserveAttempt','reserve',reserve());
        await invoke(f,'markPreSend','marker',attempt());
        const input:any={accountId:'account',operationKey:'operation',sequence:1,attemptId:'operation1',actualTokens:0,actualCostMicros:0,usageReceiptHash:hash};
        const proof=f.issue('settle',input);
        input[field]=-0;
        await expect(f.host.dsh.settleAttempt(input,proof)).rejects.toThrow('dsh_budget_invalid');
        const still=await invoke(f,'status','read',{accountId:'account'});
        expect(still.attempts[0].state).toBe('pre_send');
        await invoke(f,'settleAttempt','settle',{...input,[field]:0});
        const result=await invoke(f,'status','read',{accountId:'account'});
        expect(result.attempts[0].state).toBe('settled');
        expect(result.account.spent_tokens).toBe(0);
        expect(result.account.spent_cost).toBe(0);
    });
});

it('uses module-born SameValue for canonical zero without rejecting actual zero', () => {
    const input={accountId:'account',operationKey:'operation',sequence:1,attemptId:'attempt',actualTokens:0,actualCostMicros:0,usageReceiptHash:hash};
    expect(parseDshInput('settle',input).actualTokens).toBe(0);
    const original=Object.getOwnPropertyDescriptor(Object,'is')!;
    try {
        Object.defineProperty(Object,'is',{...original,value:()=>false});
        expect(()=>parseDshInput('settle',{...input,actualTokens:-0})).toThrow('dsh_budget_invalid');
    } finally {Object.defineProperty(Object,'is',original);}
});

it('defines original parser data without consulting inherited descriptor getters',()=>{
    const original=Object.getOwnPropertyDescriptor(Object.prototype,'get');let hits=0,result:any;
    Object.defineProperty(Object.prototype,'get',{__proto__:null,configurable:true,get(){hits++;return undefined;}} as PropertyDescriptor);
    try{result=parseDshInput('read',{accountId:'account'});}
    finally{if(original)Object.defineProperty(Object.prototype,'get',original);else delete (Object.prototype as any).get;}
    expect(result.accountId).toBe('account');expect(hits).toBe(0);
});
