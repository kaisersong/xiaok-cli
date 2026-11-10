// @vitest-environment node
import { expect, it } from 'vitest';
import * as launch from '../../electron/dsh-draft-root-source.js';
it('exposes separate pure retirement and physical SDK fate readers without accepting a copied launch', () => {
    expect(typeof launch.sealOriginalMainDshDraftLaunch).toBe('function');
    expect(typeof launch.readOriginalMainDshDraftLaunchBinding).toBe('function');
    expect(typeof launch.readOriginalMainDshDraftLaunchPhysicalFate).toBe('function');
    let getters = 0;
    const fake = new Proxy({}, { get() { getters++; throw Error('get'); }, ownKeys() { getters++; return []; }, getOwnPropertyDescriptor() { getters++; throw Error('descriptor'); } });
    expect(() => launch.sealOriginalMainDshDraftLaunch(fake, fake, fake, fake, fake, fake)).toThrow('DSH_DRAFT_ORIGINAL_LAUNCH_REQUIRED');
    expect(() => launch.readOriginalMainDshDraftLaunchPhysicalFate(fake, fake, fake, fake, fake, fake)).toThrow('DSH_DRAFT_ORIGINAL_LAUNCH_REQUIRED');
    expect(() => launch.readOriginalMainDshDraftLaunchBinding(fake, fake, fake, fake, fake, fake)).toThrow('DSH_DRAFT_ORIGINAL_LAUNCH_REQUIRED');
    expect(getters).toBe(0);
});
it('caches close before any cleanup and keeps foreign preflight rejection outside the Native lane', async () => {
    const [{ DesktopMultiAgentStore }, { createMainDshBudgetAuthoritySource }, { createMainDshBusinessSource }, { mkdtempSync, rmSync }, { tmpdir }, { join }] = await Promise.all([import('../../electron/desktop-multi-agent-store.js'), import('../../electron/main-dsh-budget-authority-source.js'), import('../../electron/main-dsh-business-source.js'), import('node:fs'), import('node:os'), import('node:path')]);
    const root = mkdtempSync(join(tmpdir(), 'draft-launch-source-')), realm = { resolve() { throw Error('no Native'); } }, user = { resolve() { throw Error('no user'); } }, runtime = {};
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'), { dshAdmissionSource: realm, dshUserControlSource: user }), budget = createMainDshBudgetAuthoritySource({ realm, userSource: user });
    budget.bindStore(store);
    const business = createMainDshBusinessSource({ realm, runtime, budgetSource: budget });
    business.bindStore(store);
    const source = launch.createMainDshDraftLaunchSource({ realm, store, runtime, budgetSource: budget, businessSource: business });
    let getters = 0;
    const fake = new Proxy({}, { get() { getters++; throw Error('get'); }, ownKeys() { getters++; return []; } });
    try {
        await expect((async () => source.open(fake, fake))()).rejects.toThrow();
        expect(getters).toBe(0);
        const first = source.close();
        expect(source.close()).toBe(first);
        await first;
        expect(() => source.open(fake, fake)).toThrow('DSH_DRAFT_LAUNCH_CLOSED');
    }
    finally {
        await source.close();
        await business.close();
        await budget.drain();
        store.close();
        rmSync(root, { recursive: true, force: true });
    }
});
