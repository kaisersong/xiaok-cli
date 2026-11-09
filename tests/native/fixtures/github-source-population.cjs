'use strict';
// Actual Main IPC/A/runtime/Worker/SQLite; HTTPS responses are controlled data.
const {app, BrowserWindow, ipcMain} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const {syncBuiltinESMExports} = require('node:module');
const {pathToFileURL} = require('node:url');
const {DatabaseSync} = require('node:sqlite');
const assert = require('node:assert/strict');
const [repo, root, mode = 'new'] = process.argv.slice(2);
process.env.XIAOK_CONFIG_DIR = path.join(root, 'config');
fs.mkdirSync(process.env.XIAOK_CONFIG_DIR, {recursive: true, mode: 0o700});
app.setPath('userData', path.join(root, 'electron-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const cleanup = [], requests = [], sockets = new Set();
const facts = {pid: process.pid, productionQualified: false, noModel: true, noNativeNGrant: true};
let rejectLegacyFirstUser = mode === 'legacy';

async function run() {
    await app.whenReady();
    const cert = fs.readFileSync(path.join(repo, 'tests/fixtures/sol-pi-tls/cert.pem'));
    const key = fs.readFileSync(path.join(repo, 'tests/fixtures/sol-pi-tls/key.pem'));
    const server = https.createServer({cert, key}, (request, response) => {
        requests.push(request.url);
        response.setHeader('content-type', 'application/json');
        if (request.url === '/user' && rejectLegacyFirstUser) {
            rejectLegacyFirstUser = false;
            response.statusCode = 401;
            response.end(JSON.stringify({message: 'controlled negative before setup binding'}));
        } else if (request.url === '/user') response.end(JSON.stringify({id: 12, node_id: 'U_12', login: 'person'}));
        else if (request.url === '/repos/octo/demo') response.end(JSON.stringify({id: 123, node_id: 'R_123', name: 'demo', owner: {id: 13, login: 'octo'}}));
        else if (request.url === '/repos/octo/other') response.end(JSON.stringify({id: 124, node_id: 'R_124', name: 'other', owner: {id: 13, login: 'octo'}}));
        else {response.statusCode = 404; response.end('{}');}
    });
    server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
    await new Promise(yes => server.listen(0, '127.0.0.1', yes));
    cleanup.push(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise(yes => server.close(yes));
        assert.equal(sockets.size, 0);
    });
    const origin = `https://127.0.0.1:${server.address().port}`;
    const originalRequest = https.request;
    https.request = function (url, options, callback) {
        assert.equal(url.origin, 'https://api.github.com');
        return originalRequest.call(https, new URL(url.pathname + url.search, origin), {...options, ca: cert}, callback);
    };
    syncBuiltinESMExports();
    const base = pathToFileURL(path.join(repo, 'desktop/dist/main/desktop/electron/'));
    const bootstrap = await import(new URL('main-dsh-bootstrap-authority.js', base));
    const users = await import(new URL('main-dsh-control-source.js', base));
    const sessions = await import(new URL('dsh-github-source-session.js', base));
    const runtimes = await import(new URL('harness-optimization-service.js', base));
    const stores = await import(new URL('desktop-multi-agent-store.js', base));
    const scope = {profileId: 'a'.repeat(64), workspaceId: 'b'.repeat(64)};
    const html = path.join(root, 'index.html'), preload = path.join(root, 'preload.cjs');
    fs.writeFileSync(html, '<!doctype html><body>Actual original Source population</body>');
    fs.writeFileSync(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('population',()=>ipcRenderer.invoke('fixture:population'));\n");
    const window = new BrowserWindow({show: false, webPreferences: {preload, sandbox: true, contextIsolation: true, nodeIntegration: false}});
    cleanup.push(async () => window.destroy());
    const realm = bootstrap.createMainDshBootstrapAuthority();
    const user = users.createMainDshControlSource({window, scope, isTrustedUrl: url => url === pathToFileURL(html).href});
    const population = sessions.createMainGithubSourceConnectionPopulation({scope, realm, userSource: user});
    const legacyOwner = mode === 'legacy' ? sessions.createMainGithubSourceConnectionOwner({scope: {...scope, tenantId: 'tenant-a'}, realm, userSource: user}) : null;
    const createRuntime = source => runtimes.createHarnessOptimizationRuntime({
        dataRoot: path.join(root, 'budget'), ...scope,
        authorizeUser: actor => sessions.isOriginalGithubSourcePopulationBudgetActor(population, actor) || !!legacyOwner && sessions.isOriginalGithubSourceBudgetActor(legacyOwner, actor),
        manifestLookup: () => undefined,
        dshSourceReadAuthoritySource: source,
    });
    let runtime = await createRuntime(legacyOwner?.sourceReadAuthoritySource ?? population.sourceReadAuthoritySource);
    cleanup.push(async () => {await population.close(); if (legacyOwner) await legacyOwner.close(); await runtime.dispose(); user.seal(); await user.drain(); realm.seal();});
    const store = new stores.DesktopMultiAgentStore(path.join(root, 'groups.sqlite'), {dshAdmissionSource: realm, dshUserControlSource: user});
    realm.bindStore(store); user.bindStore(store); population.bindStore(store);
    if (legacyOwner) {legacyOwner.bindStore(store); legacyOwner.bindRuntime(runtime);}
    else population.bindRuntime(runtime);
    store.claimBootOwnership();
    const port = stores.readOriginalDshAdmissionPort(store, realm);
    cleanup.push(async () => {await port.waitKnown(); store.close();});
    port.initialize(realm.openBootstrap('initialize'), {requestSource: 'user'});
    port.upgradeAdmission(realm.openBootstrap('migrate_admission'), {requestSource: 'user'});
    assert.deepEqual(population.getStatuses(), []);
    ipcMain.handle('fixture:population', async event => {
        const enrollment = user.open(event, 'enroll_authority', {schemaVersion: 1, expectedDomainRevision: 0, ownerDomainIds: []}, 'user');
        try {assert.equal(port.enrollAuthority(enrollment.proof, {requestSource: 'user', bodyHash: enrollment.bodyHash, bootstrapAuthority: realm}).ok, true);}
        finally {enrollment.release();}
        const control = body => {
            const frame = user.open(event, 'policy_control', body, 'user');
            try {assert.equal(port.applyControl(frame.proof, {requestSource: 'user', bodyHash: frame.bodyHash, bootstrapAuthority: realm}).ok, true);}
            finally {frame.release();}
        };
        control({control: {kind: 'mode', identity: {kind: 'global'}, mode: 'observe', epoch: 1}, expectedRevision: 0});
        const owners = [], connected = [];
        let legacyHistory;
        for (const index of [0, 1]) {
            const tenantId = mode === 'same-tenant' || index === 0 ? 'tenant-a' : 'tenant-b';
            const suffix = tenantId + (mode === 'same-tenant' ? ':' + index : '');
            for (const identity of [{kind: 'tenant', tenantId}, {kind: 'workspace', tenantId, workspaceId: scope.workspaceId}])
                if (mode !== 'same-tenant' || index === 0) control({control: {kind: 'mode', identity, mode: 'observe', epoch: 1}, expectedRevision: 0});
            const setup = {schemaVersion: 1, setupId: 'setup-' + suffix, tenantId, candidateRepository: {owner: 'octo', repo: mode === 'same-tenant' && index === 1 ? 'other' : 'demo'}, mode: 'observe', accountId: 'source-account-' + suffix, minimumIntervalMs: 1000, selection: {kind: 'label_ids', match: 'all', labelIds: ['7']}, issueRefs: []};
            control({control: {kind: 'source_setup', setup}, expectedRevision: 0});
            const frame = user.open(event, 'policy_control', {control: {kind: 'source_setup', setup}, expectedRevision: 1}, 'user');
            try {
                const proof = realm.openGithubSourceSetup({setupId: setup.setupId, bodyHash: frame.bodyHash, candidateRepository: setup.candidateRepository, expectedConfigurationRevision: 1}, {userControlProof: frame.proof});
                if (legacyOwner && tenantId === 'tenant-a') {
                    const context = legacyOwner.openSetupContext(proof, 'original-legacy-scan');
                    await assert.rejects(legacyOwner.getSession().connect({operationId: 'original-legacy-connect', secret: 'isolated-token', expectedConfigurationRevision: 1}, context));
                    await legacyOwner.close();
                    await runtime.dispose();
                    const priorDb = new DatabaseSync(path.join(root, 'budget/harness-optimization.sqlite'), {readOnly: true});
                    try {
                        legacyHistory = priorDb.prepare('SELECT * FROM dsh_budget_source_identity_history').all();
                        assert.equal(legacyHistory.length, 1);
                        assert.equal(priorDb.prepare('SELECT spent_requests,held_requests,uncertain FROM dsh_budget_source_scans').get().spent_requests, 1);
                    } finally {priorDb.close();}
                    runtime = await createRuntime(population.sourceReadAuthoritySource);
                    population.bindRuntime(runtime);
                }
                const owner = population.readSetupOwner(proof);
                assert.equal(population.readSetupOwner(proof), owner);
                owners.push(owner);
                const context = owner.openSetupContext(proof, 'scan-' + suffix);
                connected.push(await owner.getSession().connect({operationId: 'connect-' + suffix, secret: 'isolated-token', expectedConfigurationRevision: 1}, context));
            } finally {frame.release();}
        }
        assert.notEqual(owners[0], owners[1]);
        if (mode === 'same-tenant') {
            const ids = new Set();
            for (const status of connected) {
                const proof = realm.openGithubSourceRead({bindingId: status.sourceBindingId, configurationRevision: 1});
                const view = stores.readOriginalDshGithubReadAuthority(realm, store, realm, proof, 'source_binding');
                const owner = population.readBindingOwner(proof);
                const context = owner.openBindingContext(proof, 'read:' + status.sourceBindingId);
                const result = await owner.getSession().read({schemaVersion: 1, kind: 'repository', boundRepository: view.repository}, context);
                assert.equal(result.status, 200);
                assert.equal(owner.getSession().getStatus().repositoryId, view.repository.repositoryId);
                ids.add(status.sourceBindingId);
            }
            facts.distinctBindingsRead = ids.size;
        }
        let traps = 0;
        const fake = new Proxy({}, {get() {traps++; throw Error('foreign-get');}, ownKeys() {traps++; return [];}});
        assert.throws(() => population.readSetupOwner(fake));
        assert.equal(traps, 0);
        facts.tenants = population.getStatuses().map(row => row.tenantId).sort();
        facts.requests = requests.length;
        facts.paths = requests;
        const db = new DatabaseSync(path.join(root, 'budget/harness-optimization.sqlite'), {readOnly: true});
        try {
            const accounts = db.prepare('SELECT * FROM dsh_budget_source_accounts').all();
            facts.spentRequests = db.prepare('SELECT sum(spent_requests) AS spent FROM dsh_budget_source_scans').get().spent;
            facts.distinctLedgerOwners = new Set(accounts.map(row => row.owner_id)).size;
            assert.equal(accounts.length, mode === 'same-tenant' ? 4 : 2);
            assert.equal(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get().value, '9');
            const setups = accounts.filter(row => row.identity_kind === 'source_setup');
            assert.deepEqual(setups.map(row => JSON.parse(row.identity_json).tenantId).sort(), mode === 'same-tenant' ? ['tenant-a', 'tenant-a'] : ['tenant-a', 'tenant-b']);
            for (const row of setups) assert.equal(JSON.parse(row.identity_json).identityVersion, 2);
            if (legacyOwner) {
                const old = db.prepare('SELECT * FROM dsh_budget_source_identity_history WHERE account_id=? AND revision=1').all('source-account-tenant-a');
                assert.deepEqual(old, legacyHistory);
                assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dsh_budget_source_tenant_transitions').get().count, 1);
                facts.legacyHistoryPreserved = true;
            }
        } finally {db.close();}
        await population.close();
        await runtime.api.read();
        facts.runtimeSurvivedPopulationClose = true;
        return true;
    });
    cleanup.push(async () => ipcMain.removeHandler('fixture:population'));
    await window.loadFile(html);
    await window.webContents.executeJavaScript('window.population()');
    facts.ok = true;
}

run().catch(error => {facts.error = String(error); facts.stack = error?.stack; process.exitCode = 1;}).then(async () => {
    for (let i = cleanup.length - 1; i >= 0; i--) {
        try {await cleanup[i]();} catch (error) {facts.cleanupError = String(error); process.exitCode = 1;}
    }
    fs.writeFileSync(path.join(root, 'facts.json'), JSON.stringify(facts));
    console.log(JSON.stringify(facts));
    app.exit(process.exitCode || 0);
});
