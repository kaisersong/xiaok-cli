// @vitest-environment node
import {expect, it} from 'vitest';
import * as sessions from '../../electron/dsh-github-source-session.js';

type Population = {
    sourceReadAuthoritySource: {resolve(proof: unknown, purpose: string): unknown};
    bindStore(store: object): void;
    bindRuntime(runtime: object): void;
    readSetupOwner(proof: object): object;
    readBindingOwner(proof: object): object;
    getStatuses(): readonly unknown[];
    stopAccepting(): void;
    abortAllActive(): void;
    disconnectUser(proof: object, bodyHash: string, bindingId: string): Promise<void>;
    close(): Promise<void>;
};
type PopulationApi = {
    createMainGithubSourceConnectionPopulation(options: unknown): Population;
    readOriginalMainGithubSourceConnectionPopulation(population: unknown, realm: unknown, store: unknown, userSource: unknown, runtime: unknown): Population;
    isOriginalGithubSourcePopulationBudgetActor(population: unknown, actor: unknown): boolean;
};
const api = sessions as unknown as PopulationApi;

it('exports a fixed constructor SourceRead population instead of a caller tenant resolver', () => {
    expect(typeof api.createMainGithubSourceConnectionPopulation).toBe('function');
    expect(typeof api.readOriginalMainGithubSourceConnectionPopulation).toBe('function');
    expect(typeof api.isOriginalGithubSourcePopulationBudgetActor).toBe('function');
});

it('admits no default tenant, callback factory, foreign proof or actor before original binding', async () => {
    let traps = 0;
    const fake = new Proxy({}, {get() {traps++; throw Error('get');}, ownKeys() {traps++; return [];}});
    const scope = {profileId: 'actual-profile', workspaceId: 'actual-workspace'};
    expect(() => api.createMainGithubSourceConnectionPopulation({scope: {...scope, tenantId: 'caller-default'}, realm: {}, userSource: {}})).toThrow();
    expect(() => api.createMainGithubSourceConnectionPopulation({scope, realm: {}, userSource: {}, factory() {traps++;}})).toThrow();
    const realm = {}, userSource = {};
    const population = api.createMainGithubSourceConnectionPopulation({scope, realm, userSource});
    try {
        expect(Object.isFrozen(population.sourceReadAuthoritySource)).toBe(true);
        expect(() => population.readSetupOwner(fake)).toThrow();
        expect(() => population.readBindingOwner(fake)).toThrow();
        expect(() => population.sourceReadAuthoritySource.resolve(fake, 'source_read_scan')).toThrow();
        expect(() => population.sourceReadAuthoritySource.resolve(fake, 'source_read_settle')).toThrow();
        expect(api.isOriginalGithubSourcePopulationBudgetActor(population, fake)).toBe(false);
        expect(() => api.readOriginalMainGithubSourceConnectionPopulation(population, realm, fake, userSource, fake)).toThrow();
        expect(traps).toBe(0);
    } finally {await population.close();}
    expect(() => population.readSetupOwner({})).toThrow();
});

it('keeps passive status and negative close local without manufacturing a tenant or runtime', async () => {
    const population = api.createMainGithubSourceConnectionPopulation({
        scope: {profileId: 'original-profile', workspaceId: 'original-workspace'},
        realm: {},
        userSource: {},
    });
    let traps = 0;
    const foreign = new Proxy({}, {get() {traps++; throw Error('get');}});
    expect(population.getStatuses()).toEqual([]);
    expect(Object.isFrozen(population.getStatuses())).toBe(true);
    await expect(population.disconnectUser(foreign, 'untrusted-body', 'untrusted-binding')).rejects.toThrow();
    expect(traps).toBe(0);
    population.abortAllActive();
    population.stopAccepting();
    expect(() => population.bindRuntime({})).toThrow();
    expect(() => population.bindStore({})).toThrow();
    expect(() => population.readBindingOwner({})).toThrow();
    const first = population.close();
    expect(population.close()).toBe(first);
    await first;
    expect(population.getStatuses()).toEqual([]);
});
