// @vitest-environment node
import {describe,it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as service from '../../electron/harness-optimization-service.js';
const roots:string[]=[],hosts:any[]=[];
const baseline=Date.UTC(2026,10,6,12),hash='a'.repeat(64);
async function fixture(root=mkdtempSync(join(tmpdir(),'dsh-source-budget-'))) {
    if(!roots.includes(root))roots.push(root);
    let authorized=true;
    let now=baseline,hook:((purpose:string,value:any)=>any)|undefined;
    const actor=Object.freeze({requestSource:'user',principalId:'fixture'}),proofs=new WeakMap<object,any>();
    const source=Object.freeze({resolve(proof:object,purpose:string){const row=proofs.get(proof);if(!row||row.purpose!==purpose)return null;const value=purpose==='source_read_settle'?{...row.value,reservation:row.reservation}:row.value;return hook?hook(purpose,value):value;}});
    const runtime=await service.createHarnessOptimizationRuntime({dataRoot:root,profileId:'profile',workspaceId:'workspace',authorizeUser:x=>authorized&&x===actor,manifestLookup:()=>undefined,now:()=>now,dshSourceReadAuthoritySource:source} as any);hosts.push(runtime);
    const identity={kind:'source_binding',sourceBindingId:'binding',configurationRevision:1,credentialEpoch:1,providerAccountId:'github-account',repositoryId:'repo'};
    function issue(purpose:string,input:any,id=identity,requestSource='scheduler',reservation?:object,accountId=input.accountId??'source-account') {
        const proof=Object.freeze({});proofs.set(proof,{purpose,reservation,value:{requestSource,actor:requestSource==='user'?actor:null,profileId:'profile',workspaceId:'workspace',accountId,identity:id,commandDigest:(service as any).dshSourceReadCommandDigest(purpose,input),assertCurrent(){},assertLocal(){},...(purpose==='source_read_settle'?{outcome:input}:{})}});return proof;
    }
    const query=(scanId='scan')=>({accountId:'source-account',scanId});
    const request=(attemptId='get1',scanId='scan')=>({accountId:'source-account',scanId,attemptId,requestDigest:hash,responseBytesUpperBound:1048576});
    const sql=(query:string)=>{const db=new DatabaseSync(join(root,'harness-optimization.sqlite'));try{return db.prepare(query).all();}finally{db.close();}};
    return {runtime,source,issue,identity,query,request,root,sql,withdrawUser:()=>{authorized=false;},clock:(value:number)=>{now=value;},hook:(value:typeof hook)=>{hook=value;}};
}
afterEach(async()=>{for(const host of hosts.splice(0))await host.dispose();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:5});});
describe.skipIf(process.platform!=='darwin')('original source read resource budget',()=>{
    it('reserves a genuine zero-model GET resource capability in the original worker/SQLite',async()=>{
        const f=await fixture();expect(typeof(service as any).readOriginalDshSourceReadPort).toBe('function');
        const port=(service as any).readOriginalDshSourceReadPort(f.runtime,f.source),query=f.query();
        await port.openScan(query,f.issue('source_read_scan',query));
        const input=f.request(),proof=f.issue('source_read_reserve',input),cap=await port.reserveRequest(input,proof);
        const view=(service as any).takeOriginalDshSourceReadReservation(port,proof,cap);
        expect(view.disposition).toBe('newly_reserved');
        expect(view.requestDigest).toBe(hash);expect(view.responseBytesUpperBound).toBe(1048576);expect(view.timeoutMs).toBe(30000);
        expect(f.sql('SELECT held_bytes FROM dsh_budget_source_scans')[0]?.held_bytes).toBe(1048576);
        const outcome={actualResponseBytes:123,requestSent:true,physicallyClosed:true,outcome:'known'};
        await port.settleRequest(cap,f.issue('source_read_settle',outcome,undefined,'scheduler',cap));
        expect(f.sql('SELECT spent_bytes,held_bytes,spent_requests FROM dsh_budget_source_scans')[0]).toMatchObject({spent_bytes:123,held_bytes:0,spent_requests:1});
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_accounts')[0]?.count).toBe(0);
    });
    it('supports a separately authenticated user setup identity without fake Binding or Mandate',async()=>{
        const f=await fixture();expect(typeof(service as any).readOriginalDshSourceReadPort).toBe('function');
        const port=(service as any).readOriginalDshSourceReadPort(f.runtime,f.source),query=f.query();
        const setup:any={kind:'source_setup',setupId:'stable-setup',candidateRepository:{owner:'owner',name:'repo'}};
        await port.openScan(query,f.issue('source_read_scan',query,setup,'user'));
        const input=f.request(),proof=f.issue('source_read_reserve',input,setup,'user'),cap=await port.reserveRequest(input,proof);
        expect((service as any).takeOriginalDshSourceReadReservation(port,proof,cap).requestDigest).toBe(hash);
        expect(f.sql('SELECT identity_kind FROM dsh_budget_source_accounts')[0]?.identity_kind).toBe('source_setup');
    });
});

async function opened(f:any) {const port=(service as any).readOriginalDshSourceReadPort(f.runtime,f.source),query=f.query();await port.openScan(query,f.issue('source_read_scan',query));return port;}
async function reserve(f:any,port:any,attemptId='get1',upper=1048576) {const input={...f.request(attemptId),responseBytesUpperBound:upper},proof=f.issue('source_read_reserve',input),cap=await port.reserveRequest(input,proof);return {input,proof,cap};}
async function finish(f:any,port:any,cap:any,actualResponseBytes=0,requestSent=true,physicallyClosed=true,outcome='known') {const input={actualResponseBytes,requestSent,physicallyClosed,outcome};return port.settleRequest(cap,f.issue('source_read_settle',input,undefined,'scheduler',cap));}
describe.skipIf(process.platform!=='darwin')('source resource budget actual boundaries',()=>{
    it('caps physical requests independently of zero token/cost and never gives replay a send',async()=>{
        const f=await fixture(),port=await opened(f);
        for(let i=0;i<64;i++){const a=await reserve(f,port,'get.'+i,1);(service as any).takeOriginalDshSourceReadReservation(port,a.proof,a.cap);await finish(f,port,a.cap,1);}
        const extra=f.request('get.65');await expect(port.reserveRequest(extra,f.issue('source_read_reserve',extra))).rejects.toThrow('dsh_source_budget_exhausted');
        const old={...f.request('get.0'),responseBytesUpperBound:1},proof=f.issue('source_read_reserve',old),cap=await port.reserveRequest(old,proof);
        expect((service as any).readOriginalDshSourceReadReservation(port,cap).disposition).toBe('existing');
        expect(()=>(service as any).takeOriginalDshSourceReadReservation(port,proof,cap)).toThrow('dsh_source_reservation_unavailable');
        expect(f.sql('SELECT spent_requests,spent_bytes FROM dsh_budget_source_scans')[0]).toMatchObject({spent_requests:64,spent_bytes:64});
    });
    it('holds unknown bytes across new scans and cold reopen without a second account escape',async()=>{
        const f=await fixture(),port=await opened(f),a=await reserve(f,port);
        (service as any).takeOriginalDshSourceReadReservation(port,a.proof,a.cap);
        await finish(f,port,a.cap,null,true,false,'unknown');
        expect(f.sql('SELECT held_bytes,uncertain FROM dsh_budget_source_scans')[0]).toMatchObject({held_bytes:1048576,uncertain:1});
        const query=f.query('next');await expect(port.openScan(query,f.issue('source_read_scan',query))).rejects.toThrow('dsh_source_budget_unconfirmed');
        await f.runtime.dispose();const cold=await fixture(f.root),coldPort=(service as any).readOriginalDshSourceReadPort(cold.runtime,cold.source),next=cold.query('cold');
        await expect(coldPort.openScan(next,cold.issue('source_read_scan',next))).rejects.toThrow('dsh_source_budget_unconfirmed');
        expect(cold.sql('SELECT uncertain FROM dsh_budget_source_accounts')[0]?.uncertain).toBe(1);
    });
    it('checks aggregate upper bytes and the scan deadline, not sum of GET elapsed',async()=>{
        const f=await fixture(),port=await opened(f);
        for(let i=0;i<4;i++){const a=await reserve(f,port,'get.'+i);await finish(f,port,a.cap,1048576);}
        const next=f.request('overflow');await expect(port.reserveRequest(next,f.issue('source_read_reserve',next))).rejects.toThrow('dsh_source_budget_exhausted');
        f.clock(baseline+30000);const late={...f.request('late'),responseBytesUpperBound:1};await expect(port.reserveRequest(late,f.issue('source_read_reserve',late))).rejects.toThrow('dsh_source_budget_expired');
    });
    it('does not treat same-scope ordinary DTO/copied/foreign cap as a reservation',async()=>{
        const f=await fixture(),g=await fixture(),port=await opened(f),other=await opened(g),a=await reserve(f,port);let traps=0;
        const proxy=new Proxy({},{get(){traps++;},ownKeys(){traps++;return [];}});
        expect(()=>(service as any).readOriginalDshSourceReadPort(proxy,f.source)).toThrow('dsh_source_budget_runtime_required');
        expect(()=>(service as any).readOriginalDshSourceReadReservation(port,proxy)).toThrow('dsh_source_reservation_required');
        expect(()=>(service as any).takeOriginalDshSourceReadReservation(other,a.proof,a.cap)).toThrow('dsh_source_reservation_required');
        expect(()=>port.settleRequest({...a.cap},{})).toThrow('dsh_source_reservation_required');
        expect(traps).toBe(0);
    });
    it('preserves true known bytes over quoted upper bound and freezes new requests',async()=>{
        const f=await fixture(),port=await opened(f),a=await reserve(f,port,'small',10);await finish(f,port,a.cap,20);
        expect(f.sql('SELECT spent_bytes,held_bytes,uncertain FROM dsh_budget_source_scans')[0]).toMatchObject({spent_bytes:20,held_bytes:0,uncertain:1});
        const next=f.request('no');await expect(port.reserveRequest(next,f.issue('source_read_reserve',next))).rejects.toThrow('dsh_source_budget_unconfirmed');
    });
    it('revoked Source cannot revive a consumed original reservation and keeps thrown known tails',async()=>{
        const f=await fixture(),port=await opened(f),a=await reserve(f,port);let release!:()=>void,closed=false;
        const tail=new Promise<void>(done=>{release=done;}),error=Object.assign(Error('real-source-with-tail'),{nested:tail});
        f.hook((purpose,value)=>purpose==='source_read_reserve'?{...value,assertCurrent(){throw error;}}:value);
        // The already captured reservation guard stays original; a new original
        // request sees the fixed Source failure before any worker mutation.
        const next=f.request('fault');await expect(port.reserveRequest(next,f.issue('source_read_reserve',next))).rejects.toBe(error);
        const closing=f.runtime.dispose().catch(()=>{}).then(()=>{closed=true;});await new Promise(done=>setTimeout(done,20));expect(closed).toBe(false);
        release();await closing;
        expect(()=>(service as any).takeOriginalDshSourceReadReservation(port,a.proof,a.cap)).toThrow();
    });
});

it.skipIf(process.platform!=='darwin')('persists the original clock guard so restoring wall time cannot revive the scan',async()=>{
    const f=await fixture(),port=await opened(f),input=f.request('clock');
    f.clock(baseline-3000);
    await expect(port.reserveRequest(input,f.issue('source_read_reserve',input))).rejects.toThrow('clock_rollback');
    expect(f.sql("SELECT value FROM metadata WHERE key='clockGuard'")[0]?.value).toBe('1');
    f.clock(baseline);
    await expect(port.reserveRequest(input,f.issue('source_read_reserve',input))).rejects.toThrow('clock_rollback');
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_attempts')[0]?.count).toBe(0);
});

it.skipIf(process.platform!=='darwin')('settles an accepted setup SDK fate after new user authorization is withdrawn',async()=>{
    const f=await fixture(),port=(service as any).readOriginalDshSourceReadPort(f.runtime,f.source);
    const identity:any={kind:'source_setup',setupId:'setup',candidateRepository:{owner:'owner',name:'repo'}},query=f.query();
    await port.openScan(query,f.issue('source_read_scan',query,identity,'user'));
    const input=f.request(),proof=f.issue('source_read_reserve',input,identity,'user'),cap=await port.reserveRequest(input,proof);
    (service as any).takeOriginalDshSourceReadReservation(port,proof,cap);
    f.withdrawUser();
    const outcome={actualResponseBytes:23,requestSent:true,physicallyClosed:true,outcome:'known'};
    await port.settleRequest(cap,f.issue('source_read_settle',outcome,identity,'user',cap));
    expect(f.sql('SELECT held_bytes,spent_bytes,spent_requests FROM dsh_budget_source_scans')[0]).toMatchObject({held_bytes:0,spent_bytes:23,spent_requests:1});
    const next=f.request('new');await expect(port.reserveRequest(next,f.issue('source_read_reserve',next,identity,'user'))).rejects.toThrow('dsh_source_authority_required');
});

it.skipIf(process.platform!=='darwin')('advances a known completed source configuration in the same durable account',async()=>{
    const f=await fixture(),port=await opened(f),old=await reserve(f,port);await finish(f,port,old.cap,3);
    const identity={...f.identity,configurationRevision:2},query=f.query('configuration-2');
    await port.openScan(query,f.issue('source_read_scan',query,identity));
    const input={...f.request('configured-get'),scanId:query.scanId},proof=f.issue('source_read_reserve',input,identity),cap=await port.reserveRequest(input,proof);
    expect((service as any).takeOriginalDshSourceReadReservation(port,proof,cap).scanId).toBe(query.scanId);
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_accounts')[0]?.count).toBe(1);
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_identity_history')[0]?.count).toBe(2);
});

it.skipIf(process.platform!=='darwin')('does not apply a second request fate to a different original reservation',async()=>{
    const f=await fixture(),port=await opened(f),first=await reserve(f,port,'one');
    (service as any).takeOriginalDshSourceReadReservation(port,first.proof,first.cap);
    const second=await reserve(f,port,'two');
    (service as any).takeOriginalDshSourceReadReservation(port,second.proof,second.cap);
    const outcome={actualResponseBytes:7,requestSent:true,physicallyClosed:true,outcome:'known'};
    // The fixed Source's original SDK proof belongs to request two. The old
    // envelope had no original cap field with which the budget could verify it.
    const forSecond=f.issue('source_read_settle',outcome,undefined,'scheduler',second.cap);
    await expect(port.settleRequest(first.cap,forSecond)).rejects.toThrow('dsh_source_reservation_required');
    expect(f.sql('SELECT held_requests FROM dsh_budget_source_scans')[0]?.held_requests).toBe(2);
});

it.skipIf(process.platform !== 'darwin')('scopes explicit v2 setup accounts by authenticated tenant in the same original ledger', async () => {
    const f = await fixture();
    const port = service.readOriginalDshSourceReadPort(f.runtime, f.source);
    for (const tenantId of ['tenant-a', 'tenant-b']) {
        const identity: any = {kind: 'source_setup', identityVersion: 2, tenantId, setupId: 'setup-' + tenantId, candidateRepository: {owner: 'owner', name: 'repo'}};
        const input = {accountId: 'account-' + tenantId, scanId: 'scan-' + tenantId};
        await port.openScan(input, f.issue('source_read_scan', input, identity, 'user'));
    }
    const rows = f.sql('SELECT * FROM dsh_budget_source_accounts ORDER BY account_id');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.owner_id)).size).toBe(1);
    expect(new Set(rows.map(row => row.source_key)).size).toBe(2);
    expect(f.sql("SELECT value FROM metadata WHERE key='schemaVersion'")[0]?.value).toBe('9');
    const sameTenant: any = {kind: 'source_setup', identityVersion: 2, tenantId: 'tenant-a', setupId: 'another-setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const extra = {accountId: 'replacement-account', scanId: 'replacement-scan'};
    await expect(port.openScan(extra, f.issue('source_read_scan', extra, sameTenant, 'user'))).rejects.toThrow('dsh_source_account_conflict');
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_accounts')[0]?.count).toBe(2);
});

it.skipIf(process.platform !== 'darwin')('requires explicit legacy reconciliation instead of creating a v2 account over held v1 resources', async () => {
    const f = await fixture();
    const port = service.readOriginalDshSourceReadPort(f.runtime, f.source);
    const legacy: any = {kind: 'source_setup', setupId: 'legacy-setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const query = f.query();
    await port.openScan(query, f.issue('source_read_scan', query, legacy, 'user'));
    const request = f.request();
    await port.reserveRequest(request, f.issue('source_read_reserve', request, legacy, 'user'));
    const before = f.sql('SELECT * FROM dsh_budget_source_accounts');
    const history = f.sql('SELECT * FROM dsh_budget_source_identity_history');
    const v2: any = {...legacy, identityVersion: 2, tenantId: 'tenant-a'};
    const next = {accountId: 'new-account', scanId: 'new-scan'};
    await expect(port.openScan(next, f.issue('source_read_scan', next, v2, 'user'))).rejects.toThrow('dsh_source_legacy_migration_required');
    expect(f.sql('SELECT * FROM dsh_budget_source_accounts')).toEqual(before);
    expect(f.sql('SELECT * FROM dsh_budget_source_identity_history')).toEqual(history);
    expect(f.sql('SELECT held_requests FROM dsh_budget_source_scans')[0]?.held_requests).toBe(1);
});

it.skipIf(process.platform !== 'darwin')('refuses a new legacy account over a tenant-scoped v2 source', async () => {
    const f = await fixture(), port = service.readOriginalDshSourceReadPort(f.runtime, f.source);
    const v2: any = {kind: 'source_setup', identityVersion: 2, tenantId: 'tenant-a', setupId: 'setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const query = f.query();
    await port.openScan(query, f.issue('source_read_scan', query, v2, 'user'));
    const legacy: any = {kind: 'source_setup', setupId: 'legacy-new', candidateRepository: {owner: 'OWNER', name: 'REPO'}};
    const next = {accountId: 'legacy-account', scanId: 'legacy-scan'};
    await expect(port.openScan(next, f.issue('source_read_scan', next, legacy, 'user'))).rejects.toThrow('dsh_source_legacy_migration_required');
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_accounts')[0]?.count).toBe(1);
});

it.skipIf(process.platform !== 'darwin')('guards schema9 writes against old, NULL, undefined and zero writers and reopens the actual v2 graph', async () => {
    const f = await fixture(), port = service.readOriginalDshSourceReadPort(f.runtime, f.source);
    const identity: any = {kind: 'source_setup', identityVersion: 2, tenantId: 'tenant-a', setupId: 'setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const query = f.query();
    await port.openScan(query, f.issue('source_read_scan', query, identity, 'user'));
    const db = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
    try {
        for (const version of [3, 4, 5, 6, 7, 8]) db.function('xiaok_harness_dsh_budget_v' + version, () => 1);
        expect(() => db.prepare('UPDATE dsh_budget_source_accounts SET uncertain=0 WHERE account_id=?').run('source-account')).toThrow();
        let value: number | null | undefined;
        db.function('xiaok_harness_dsh_budget_v9', () => value);
        const oldPrepared = db.prepare('UPDATE dsh_budget_source_accounts SET uncertain=0 WHERE account_id=?');
        for (value of [null, undefined, 0]) expect(() => oldPrepared.run('source-account')).toThrow('dsh_writer_required');
        value = 1;
        expect(oldPrepared.run('source-account').changes).toBe(1);
        expect(db.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type=\'trigger\' AND name LIKE \'dsh_v9_%\'').get()?.count).toBe(57);
    } finally {db.close();}
    const before = f.sql('SELECT * FROM dsh_budget_source_accounts');
    await f.runtime.dispose();
    const cold = await fixture(f.root), coldPort = service.readOriginalDshSourceReadPort(cold.runtime, cold.source);
    await coldPort.openScan(query, cold.issue('source_read_scan', query, identity, 'user'));
    expect(cold.sql('SELECT * FROM dsh_budget_source_accounts')).toEqual(before);
});

it.skipIf(process.platform !== 'darwin')('explicitly migrates the same known legacy account with immutable history and no balance reset', async () => {
    const f = await fixture(), port = service.readOriginalDshSourceReadPort(f.runtime, f.source) as any;
    expect(typeof port.migrateSetup).toBe('function');
    const legacy: any = {kind: 'source_setup', setupId: 'original-setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const query = f.query();
    await port.openScan(query, f.issue('source_read_scan', query, legacy, 'user'));
    const input = f.request(), proof = f.issue('source_read_reserve', input, legacy, 'user');
    const cap = await port.reserveRequest(input, proof);
    service.takeOriginalDshSourceReadReservation(port, proof, cap);
    const outcome = {actualResponseBytes: 19, requestSent: true, physicallyClosed: true, outcome: 'known'};
    await port.settleRequest(cap, f.issue('source_read_settle', outcome, legacy, 'user', cap));
    const before = f.sql('SELECT * FROM dsh_budget_source_identity_history');
    const owner = f.sql('SELECT owner_id FROM dsh_budget_source_accounts')[0]!.owner_id;
    const target: any = {...legacy, identityVersion: 2, tenantId: 'actual-tenant'};
    const migrate = {accountId: 'source-account'};
    await expect(port.migrateSetup(migrate, f.issue('source_read_migrate', migrate, target, 'user'))).rejects.toThrow('dsh_source_migration_busy');
    f.clock(baseline + 30001);
    const receipt = await port.migrateSetup(migrate, f.issue('source_read_migrate', migrate, target, 'user'));
    expect(receipt.disposition).toBe('migrated');
    expect(f.sql('SELECT * FROM dsh_budget_source_identity_history')[0]).toEqual(before[0]);
    expect(f.sql('SELECT owner_id,account_id FROM dsh_budget_source_accounts')[0]).toMatchObject({owner_id: owner, account_id: 'source-account'});
    expect(f.sql('SELECT held_requests,spent_requests,spent_bytes FROM dsh_budget_source_scans')[0]).toMatchObject({held_requests: 0, spent_requests: 1, spent_bytes: 19});
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_accounts')[0]?.count).toBe(1);
    const replay = await port.migrateSetup(migrate, f.issue('source_read_migrate', migrate, target, 'user'));
    expect(replay.transition).toEqual(receipt.transition);
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_source_tenant_transitions')[0]?.count).toBe(1);
    const audit = new DatabaseSync(join(f.root, 'harness-optimization.sqlite'));
    try {
        audit.function('xiaok_harness_dsh_budget_v9', () => 1);
        expect(() => audit.prepare('UPDATE dsh_budget_source_tenant_transitions SET receipt_hash=?').run('a'.repeat(64))).toThrow('dsh_immutable_record');
        expect(() => audit.prepare('DELETE FROM dsh_budget_source_tenant_transitions').run()).toThrow('dsh_immutable_record');
    } finally {audit.close();}
    await f.runtime.dispose();
    const cold = await fixture(f.root), coldPort = service.readOriginalDshSourceReadPort(cold.runtime, cold.source);
    cold.clock(baseline + 30001);
    const next = cold.query('migrated-next');
    await coldPort.openScan(next, cold.issue('source_read_scan', next, target, 'user'));
    expect(cold.sql('SELECT * FROM dsh_budget_source_identity_history')[0]).toEqual(before[0]);
});

it.skipIf(process.platform !== 'darwin')('does not migrate held, unknown or mismatched legacy ownership to a new tenant', async () => {
    const f = await fixture(), port = service.readOriginalDshSourceReadPort(f.runtime, f.source) as any;
    expect(typeof port.migrateSetup).toBe('function');
    const legacy: any = {kind: 'source_setup', setupId: 'original-setup', candidateRepository: {owner: 'owner', name: 'repo'}};
    const query = f.query();
    await port.openScan(query, f.issue('source_read_scan', query, legacy, 'user'));
    const input = f.request();
    await port.reserveRequest(input, f.issue('source_read_reserve', input, legacy, 'user'));
    f.clock(baseline + 30001);
    const migrate = {accountId: 'source-account'}, target: any = {...legacy, identityVersion: 2, tenantId: 'actual-tenant'};
    await expect(port.migrateSetup(migrate, f.issue('source_read_migrate', migrate, target, 'user'))).rejects.toThrow('dsh_source_migration_busy');
    await expect(port.migrateSetup(migrate, f.issue('source_read_migrate', migrate, {...target, setupId: 'different-original-setup'}, 'user'))).rejects.toThrow('dsh_source_account_forbidden');
    expect(f.sql('SELECT held_requests FROM dsh_budget_source_scans')[0]?.held_requests).toBe(1);
    expect(f.sql('SELECT identity_json FROM dsh_budget_source_accounts')[0]?.identity_json).not.toContain('tenantId');
    await f.runtime.dispose();
    const cold = await fixture(f.root), coldPort = service.readOriginalDshSourceReadPort(cold.runtime, cold.source) as any;
    cold.clock(baseline + 30001);
    await expect(coldPort.migrateSetup(migrate, cold.issue('source_read_migrate', migrate, target, 'user'))).rejects.toThrow('dsh_source_migration_busy');
    expect(cold.sql('SELECT held_requests,uncertain FROM dsh_budget_source_scans')[0]).toMatchObject({held_requests: 1, uncertain: 1});
});
