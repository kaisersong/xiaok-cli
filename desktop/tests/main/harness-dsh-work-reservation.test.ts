// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {dshDigest} from '../../electron/harness-dsh-budget-data.mjs';
import * as service from '../../electron/harness-optimization-service.js';
const roots:string[]=[],hosts:any[]=[];
const now=Date.UTC(2026,10,6,12),hash='a'.repeat(64);
async function fixture(root=mkdtempSync(join(tmpdir(),'dsh-work-escrow-')),scope={profileId:'profile',workspaceId:'workspace'},fixtureNow=now) {
    if(!roots.includes(root))roots.push(root);
    const actor=Object.freeze({requestSource:'user',principalId:'fixture'}),proofs=new WeakMap<object,any>();
    let mandateRevision=1,authorizationEpoch=1;
    let hook:((purpose:string,value:any)=>any)|undefined;
    const source=Object.freeze({resolve(proof:object,purpose:string){const row=proofs.get(proof);return row?.purpose===purpose?(hook?hook(purpose,row.value):row.value):null;}});
    const sourceProofs=new WeakMap<object,any>();
    const readSource=Object.freeze({resolve(proof:object,purpose:string){const row=sourceProofs.get(proof);return row?.purpose===purpose?row.value:null;}});
    const runtime=await service.createHarnessOptimizationRuntime({dataRoot:root,profileId:scope.profileId,workspaceId:scope.workspaceId,authorizeUser:x=>x===actor,manifestLookup:()=>undefined,now:()=>fixtureNow,dshBudgetAuthoritySource:source,dshSourceReadAuthoritySource:readSource} as any);
    hosts.push(runtime);
    const issue=(purpose:string,input:any,requestSource='scheduler')=>{const proof=Object.freeze({});proofs.set(proof,{purpose,value:{requestSource,actor:requestSource==='user'?actor:null,profileId:scope.profileId,workspaceId:scope.workspaceId,tenantId:'tenant',mandateId:'mandate',mandateRevision,authorizationEpoch,authorityHash:hash,commandDigest:service.dshBudgetCommandDigest(purpose,input),assertCurrent(){}}});return proof;};
    const account={accountId:'account',tokenLimit:5000,costLimitMicros:5000,currency:'USD',scale:6,validUntil:fixtureNow+100000};
    await runtime.dsh.openAccount(account,issue('open',account,'user'));
    const port:any=service.readOriginalDshBudgetPort(runtime,source);
    const policy={accountId:'account',maxActiveWorks:1,maxDraftRequestsPerWork:2};
    const fund=(bindingId='binding')=>({accountId:'account',bindingId,generation:1,scope:{profileId:scope.profileId,workspaceId:scope.workspaceId},thread:{tenantId:'tenant',workspaceId:scope.workspaceId,sourceBindingId:'source',provider:'github',repositoryId:'repository',kind:'issue',threadId:'thread'},initialTokens:1000,initialCostMicros:2000,deadline:fixtureNow+50000,command:{operationKey:'command.'+bindingId,semanticPayloadHash:hash,assessmentRef:'assessment',purpose:'draft_admission'}});
    const sql=(query:string)=>{const db=new DatabaseSync(join(root,'harness-optimization.sqlite'));try{return db.prepare(query).all();}finally{db.close();}};
    const sourcePort:any=(service as any).readOriginalDshSourceReadPort(runtime,readSource);
    const sourceIssue=(input:any)=>{const proof=Object.freeze({});sourceProofs.set(proof,{purpose:'source_read_scan',value:{requestSource:'scheduler',actor:null,profileId:scope.profileId,workspaceId:scope.workspaceId,accountId:'source-account',identity:{kind:'source_binding',sourceBindingId:'source',configurationRevision:1,credentialEpoch:1,providerAccountId:'provider',repositoryId:'repository'},commandDigest:(service as any).dshSourceReadCommandDigest('source_read_scan',input),assertCurrent(){},assertLocal(){}}});return proof;};
    return {runtime,port,source,issue,policy,fund,root,sql,sourcePort,sourceIssue,changeMandateRevision:(value:number)=>{mandateRevision=value;authorizationEpoch=value;},changeAuthorizationEpoch:(value:number)=>{authorizationEpoch=value;},hook:(value:typeof hook)=>{hook=value;}};
}
afterEach(async()=>{for(const h of hosts.splice(0))await h.dispose();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:5});});
describe.skipIf(process.platform!=='darwin')('original funded work escrow',()=>{
    it('funds actual original account and stable binding once without a second balance owner',async()=>{
        const f=await fixture();
        expect(typeof f.port.configureWorkPolicy).toBe('function');
        await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
        const input=f.fund();
        const receipt=await f.port.reserveDraftAdmission(input,f.issue('work_reserve',input));
        const view=(service as any).readOriginalDshDraftAdmission(f.port,receipt);
        expect(view.disposition).toBe('newly_reserved');
        expect(view.attestation.issuer_domain).toBe('account');
        expect(view.reservation.account_id).toBe('account');
        expect(view.ownerId).not.toBe('account');
        const repeated=await f.port.reserveDraftAdmission(input,f.issue('work_reserve',input));
        expect((service as any).readOriginalDshDraftAdmission(f.port,repeated).disposition).toBe('existing');
        expect(f.sql('SELECT held_tokens,held_cost FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:1000,held_cost:2000});
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_work_reservations')[0]?.count).toBe(1);
        const next=f.fund('second');
        await expect(f.port.reserveDraftAdmission(next,f.issue('work_reserve',next))).rejects.toThrow('dsh_work_slots_exhausted');
    });
    it('does not create a funded work without a genuine configured policy',async()=>{
        const f=await fixture();
        expect(typeof f.port.reserveDraftAdmission).toBe('function');
        const input=f.fund();
        await expect(f.port.reserveDraftAdmission(input,f.issue('work_reserve',input))).rejects.toThrow('dsh_work_policy_required');
    });
});

const api=service as any;
async function funded(f:any) {
    await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
    const input=f.fund(),proof=f.issue('work_reserve',input),receipt=await f.port.reserveDraftAdmission(input,proof),view=api.readOriginalDshDraftAdmission(f.port,receipt);
    return {input,proof,receipt,view};
}
async function bound(f:any) {
    const accepted=await funded(f),at=accepted.view.attestation;
    const input={accountId:'account',reservationId:accepted.view.reservation.reservation_id,attestationId:at.attestation_id,operationKey:at.operation_key,semanticPayloadHash:at.semantic_payload_hash,commandId:'actual-controlled-b-receipt',result:'applied',ownerWorkId:'work'};
    await f.port.bindDraftWork(input,f.issue('work_bind',input));return accepted;
}
function draft(operationKey='draft',sequence=1,purpose='draft') {
    return {accountId:'account',operation:{operationKey,purpose,inputId:'input.'+operationKey,evidenceHash:hash,semanticHash:hash,threadHash:hash,workId:purpose==='draft'?'work':null,maxAttempts:3,deadline:now+40000},attempt:{attemptId:operationKey+'.'+sequence,sequence,bodyHash:hash,providerId:'provider',modelId:'model',modelProfileId:'model_text_only_v1',pricingHash:hash,pricingKnown:true,maxInputTokens:100,maxOutputTokens:100,maxTokens:200,maxCostMicros:400,toolRounds:0}};
}
async function invoke(f:any,method:string,purpose:string,input:any) {return f.runtime.dsh[method](input,f.issue(purpose,input));}
async function settle(f:any,input:any,tokens=50,cost=75) {
    const marker={accountId:'account',operationKey:input.operation.operationKey,sequence:input.attempt.sequence,attemptId:input.attempt.attemptId,bodyHash:input.attempt.bodyHash};
    await invoke(f,'markPreSend','marker',marker);
    const usage={accountId:marker.accountId,operationKey:marker.operationKey,sequence:marker.sequence,attemptId:marker.attemptId,actualTokens:tokens,actualCostMicros:cost,usageReceiptHash:hash};
    await invoke(f,'settleAttempt','settle',usage);
}
describe.skipIf(process.platform!=='darwin')('original work accounting and sibling boundaries',()=>{
    it('shares original draft allocation and exact settlement without double debit',async()=>{
        const f=await fixture();await bound(f);const input=draft();
        await invoke(f,'reserveAttempt','reserve',input);
        expect(f.sql('SELECT held_tokens,held_cost FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:1000,held_cost:2000});
        expect(f.sql('SELECT available_tokens,held_tokens,charged_requests,next_sequence FROM dsh_budget_work_heads')[0]).toMatchObject({available_tokens:800,held_tokens:200,charged_requests:1,next_sequence:2});
        await invoke(f,'reserveAttempt','reserve',input);
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_work_attempts')[0]?.count).toBe(1);
        await settle(f,input);
        expect(f.sql('SELECT available_tokens,held_tokens,spent_tokens,available_cost,spent_cost FROM dsh_budget_work_heads')[0]).toMatchObject({available_tokens:950,held_tokens:0,spent_tokens:50,available_cost:1925,spent_cost:75});
        expect(f.sql('SELECT held_tokens,spent_tokens,held_cost,spent_cost FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:950,spent_tokens:50,held_cost:1925,spent_cost:75});
    });
    it('counts different operations/retries against one work and preserves legal workless assessment',async()=>{
        const f=await fixture();await bound(f);
        for(const op of ['one','two']){const input=draft(op);await invoke(f,'reserveAttempt','reserve',input);await settle(f,input);}
        const third=draft('third');await expect(invoke(f,'reserveAttempt','reserve',third)).rejects.toThrow('dsh_work_draft_requests_exhausted');
        const workless=draft('assessment',1,'assessment');await invoke(f,'reserveAttempt','reserve',workless);
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_work_attempts')[0]?.count).toBe(2);
        expect(f.sql('SELECT held_tokens,spent_tokens FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:1100,spent_tokens:100});
    });
    it('does not let the old draft sibling escape its required original parent',async()=>{
        const f=await fixture();await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
        const input=draft();await expect(invoke(f,'reserveAttempt','reserve',input)).rejects.toThrow('dsh_work_reservation_required');
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_attempts')[0]?.count).toBe(0);
    });
    it('issues only a first normal-COMMIT oneuse exact tuple and never a DTO/replay grant',async()=>{
        const f=await fixture(),a=await funded(f);let traps=0;
        const fake=new Proxy({},{get(){traps++;},ownKeys(){traps++;return [];}});
        expect(()=>api.readOriginalDshDraftAdmission(f.port,fake)).toThrow('dsh_budget_work_receipt_required');
        expect(()=>api.takeOriginalDshDraftAdmission(f.port,{},a.receipt)).toThrow('dsh_budget_work_receipt_required');
        expect(traps).toBe(0);
        const data=api.takeOriginalDshDraftAdmission(f.port,a.proof,a.receipt);
        expect(data).toMatchObject({issuerDomain:'account',purpose:'draft_admission',state:'reserved'});
        api.assertOriginalDshDraftAdmissionCurrent(f.port,a.proof,a.receipt);
        expect(()=>api.takeOriginalDshDraftAdmission(f.port,a.proof,a.receipt)).toThrow('dsh_budget_admission_unavailable');
        const repeatProof=f.issue('work_reserve',a.input),repeat=await f.port.reserveDraftAdmission(a.input,repeatProof);
        expect(()=>api.takeOriginalDshDraftAdmission(f.port,repeatProof,repeat)).toThrow('dsh_budget_admission_unavailable');
        expect(()=>api.assertOriginalDshDraftAdmissionCurrent(f.port,a.proof,a.receipt)).toThrow('dsh_budget_admission_unavailable');
    });
    it.each(['prepared','pre_send'])('cold %s keeps funded slot and account credit; no grant remint',async state=>{
        const f=await fixture();await bound(f);const input=draft();await invoke(f,'reserveAttempt','reserve',input);
        if(state==='pre_send'){const marker={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash};await invoke(f,'markPreSend','marker',marker);}
        await f.runtime.dispose();
        const reopened=await fixture(f.root);
        expect(reopened.sql('SELECT held_tokens,held_cost FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:1000,held_cost:2000});
        expect(reopened.sql('SELECT state,available_tokens,held_tokens,charged_requests FROM dsh_budget_work_heads')[0]).toMatchObject({state:'unknown',available_tokens:state==='prepared'?1000:800,held_tokens:state==='prepared'?0:200,charged_requests:state==='prepared'?0:1});
        const replay=reopened.fund(),proof=reopened.issue('work_reserve',replay),receipt=await reopened.port.reserveDraftAdmission(replay,proof);
        expect(()=>api.takeOriginalDshDraftAdmission(reopened.port,proof,receipt)).toThrow('dsh_budget_admission_unavailable');
        const next=reopened.fund('later');await expect(reopened.port.reserveDraftAdmission(next,reopened.issue('work_reserve',next))).rejects.toThrow('dsh_work_slots_exhausted');
    });
    it('records actual overrun beyond parent funds and closes effects without losing true usage',async()=>{
        const f=await fixture();await bound(f);const input=draft();await invoke(f,'reserveAttempt','reserve',input);await settle(f,input,1200,2500);
        expect(f.sql('SELECT status,spent_tokens,held_tokens,spent_cost,held_cost FROM dsh_budget_accounts')[0]).toMatchObject({status:'closed',spent_tokens:1200,held_tokens:0,spent_cost:2500,held_cost:0});
        expect(f.sql('SELECT state,spent_tokens,overrun_tokens,spent_cost,overrun_cost FROM dsh_budget_work_heads')[0]).toMatchObject({state:'closing',spent_tokens:1200,overrun_tokens:200,spent_cost:2500,overrun_cost:500});
    });
    it('actual writer floor denies missing/NULL/undefined/zero and accepts only fixed integer one',async()=>{
        const f=await fixture(),db=new DatabaseSync(join(f.root,'harness-optimization.sqlite'));
        const old=db.prepare('UPDATE dsh_budget_accounts SET revision=revision WHERE account_id=?');
        try {
            await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
            expect(()=>old.run('account')).toThrow(/xiaok_harness_dsh_budget_v3/);
            for(const value of [null,undefined,0]){db.function('xiaok_harness_dsh_budget_v3',()=>value);expect(()=>old.run('account')).toThrow('dsh_writer_required');}
            db.function('xiaok_harness_dsh_budget_v3',()=>1);expect(()=>old.run('account')).not.toThrow();
            expect(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value).toBe('3');
        }finally{db.close();}
    });
});

describe.skipIf(process.platform!=='darwin')('original work terminal and delivery frontier',()=>{
    it('releases escrow and slot only with exact original receipt and usage graph',async()=>{
        const f=await fixture(),a=await bound(f),input=draft();await invoke(f,'reserveAttempt','reserve',input);await settle(f,input);
        const id=a.view.reservation.reservation_id;
        const receipts=f.sql('SELECT * FROM dsh_budget_command_receipts ORDER BY attestation_id');
        const usage=f.sql('SELECT a.* FROM dsh_budget_work_attempts e JOIN dsh_budget_attempts a USING(account_id,operation_key,attempt_sequence) ORDER BY e.work_sequence');
        const closure={accountId:'account',reservationId:id,closureId:'closure',ownerWorkId:'work',commandReceiptsHash:dshDigest('dsh-budget-work-command-receipts-v1',receipts),usageHash:dshDigest('dsh-budget-work-usage-v1',usage)};
        const wrong={...closure,usageHash:'f'.repeat(64)};
        await expect(f.port.closeWork(wrong,f.issue('work_close',wrong))).rejects.toThrow('dsh_work_outcome_unknown');
        expect(f.sql('SELECT held_tokens FROM dsh_budget_accounts')[0]?.held_tokens).toBe(950);
        await f.port.closeWork(closure,f.issue('work_close',closure));
        await f.port.closeWork(closure,f.issue('work_close',closure));
        expect(f.sql('SELECT state,released_tokens,spent_tokens FROM dsh_budget_work_heads')[0]).toMatchObject({state:'closed',released_tokens:950,spent_tokens:50});
        expect(f.sql('SELECT held_tokens,spent_tokens FROM dsh_budget_accounts')[0]).toMatchObject({held_tokens:0,spent_tokens:50});
        const next=f.fund('next');await f.port.reserveDraftAdmission(next,f.issue('work_reserve',next));
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_work_reservations')[0]?.count).toBe(2);
    });
    it('does not infer no-effect from a missing B receipt',async()=>{
        const f=await fixture(),a=await funded(f),id=a.view.reservation.reservation_id;
        const closure={accountId:'account',reservationId:id,closureId:'missing-b',ownerWorkId:null,commandReceiptsHash:dshDigest('dsh-budget-work-command-receipts-v1',[]),usageHash:dshDigest('dsh-budget-work-usage-v1',[])};
        await expect(f.port.closeWork(closure,f.issue('work_close',closure))).rejects.toThrow('dsh_work_outcome_unknown');
        expect(f.sql('SELECT held_tokens FROM dsh_budget_accounts')[0]?.held_tokens).toBe(1000);
    });
    it('keeps normal COMMIT truth but withdraws a receipt on final Source disposal',async()=>{
        const f=await fixture();await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
        let checks=0,closing:Promise<void>|undefined;
        f.hook((purpose,value)=>purpose==='work_reserve'?{...value,assertCurrent(){if(++checks===5)closing=f.runtime.dispose();}}:value);
        const input=f.fund();await expect(f.port.reserveDraftAdmission(input,f.issue('work_reserve',input))).rejects.toThrow('optimization_unavailable');
        expect(checks).toBe(5);await closing;
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_work_reservations')[0]?.count).toBe(1);
        expect(f.sql('SELECT held_tokens FROM dsh_budget_accounts')[0]?.held_tokens).toBe(1000);
    });
    it('rejects stale capability after synchronous Source reentry reserves another account mutation',async()=>{
        const f=await fixture(),a=await funded(f);let nested:Promise<any>|undefined,checks=0;
        // The mint Source's captured guard remains the original object; use a
        // fresh command to capture a real callback that reenters on take.
        const input=f.fund();input.command={...input.command,operationKey:'another-command'};
        f.hook((purpose,value)=>purpose==='work_reserve'?{...value,assertCurrent(){if(++checks===6){const attempt=draft('workless',1,'assessment');nested=invoke(f,'reserveAttempt','reserve',attempt);}}}:value);
        const proof=f.issue('work_reserve',input),receipt=await f.port.reserveDraftAdmission(input,proof);
        expect(()=>api.takeOriginalDshDraftAdmission(f.port,proof,receipt)).toThrow('dsh_budget_admission_unavailable');
        await nested;
        expect(checks).toBe(6);
        expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_attempts')[0]?.count).toBe(1);
        expect(a.view.disposition).toBe('newly_reserved');
    });
});

it.skipIf(process.platform!=='darwin')('feeds actual original B SQLite with a real funded private budget and binds its actual receipt',async()=>{
    const {originalBudgetB}=await import('../fixtures/budget-original-b.mjs');
    const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},f=await fixture(undefined,scope);
    const thread={...f.fund().thread,threadId:'123'};
    let originalProof:object|undefined;
    const budgetSource={resolve(cap:object){const data=api.takeOriginalDshDraftAdmission(f.port,originalProof,cap);return {data,assertCurrent(){api.assertOriginalDshDraftAdmissionCurrent(f.port,originalProof,cap);}};}};
    const b=await originalBudgetB(scope,thread,budgetSource);
    try {
        await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
        const command=b.command(),input={...f.fund(),thread,command:{operationKey:command.operationKey,semanticPayloadHash:command.semanticPayloadHash,assessmentRef:command.assessmentRef,purpose:'draft_admission'}};
        originalProof=f.issue('work_reserve',input);const cap=await f.port.reserveDraftAdmission(input,originalProof);
        const view=api.readOriginalDshDraftAdmission(f.port,cap),actual=b.command(view.data.reservationId),applied=b.apply(actual,cap);
        expect(applied.ok,JSON.stringify(applied)).toBe(true);expect(applied.receipt.result).toBe('applied');
        expect(b.hub.getProject(applied.receipt.ownerWorkId).dispatchPolicy).toBe('draft_only_no_business_dispatch');expect(b.effects).toEqual([]);
        const bind={accountId:'account',reservationId:view.data.reservationId,attestationId:view.attestation.attestation_id,operationKey:actual.operationKey,semanticPayloadHash:actual.semanticPayloadHash,commandId:actual.commandId,result:applied.receipt.result,ownerWorkId:applied.receipt.ownerWorkId};
        await f.port.bindDraftWork(bind,f.issue('work_bind',bind));
        expect(f.sql('SELECT owner_work_id,state FROM dsh_budget_work_heads')[0]).toMatchObject({owner_work_id:applied.receipt.ownerWorkId,state:'bound'});
        console.log('ORIGINAL_B_BUDGET_FACTS',JSON.stringify({ownerWorkId:applied.receipt.ownerWorkId,budgetOwnerId:view.ownerId,accountId:view.data.issuerDomain,originalBProject:true,controlledSourceNotNativeMain:true,executionCalls:b.effects.length}));
    }finally{b.close();}
});

it.skipIf(process.platform!=='darwin')('permanently books conservative cost with explicit immutable basis and unknown actual invoice',async()=>{
    const f=await fixture();await bound(f);const input=draft();await invoke(f,'reserveAttempt','reserve',input);
    const marker={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash};await invoke(f,'markPreSend','marker',marker);
    expect(typeof (f.runtime.dsh as any).settleConservative).toBe('function');
    const usage={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash};
    await invoke(f,'settleConservative','settle_conservative',usage);
    const query={accountId:'account'},observed=await f.port.observe(query,f.issue('read',query)),status=api.readOriginalDshBudgetObservation(f.port,observed).status;
    expect(status.attempts[0]).toMatchObject({state:'settled',actual_tokens:50,actual_cost:null,cost_basis:'conservative_upper_bound'});
    expect(status.costAccountingReceipts).toEqual([{accountId:'account',operationKey:'draft',attemptId:'draft.1',sequence:1,basis:'conservative_upper_bound',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash,settlementRevision:1}]);
    expect(status.account).toMatchObject({spent_cost:75,held_cost:1925,spent_tokens:50,held_tokens:950});
    await invoke(f,'settleConservative','settle_conservative',usage);
    const conflict={...usage,chargedCostUpperBoundMicros:74};await expect(invoke(f,'settleConservative','settle_conservative',conflict)).rejects.toThrow('dsh_usage_conflict');
    expect(f.sql('SELECT COUNT(*) AS count FROM dsh_budget_cost_accounting_receipts')[0]?.count).toBe(1);
});


it.skipIf(process.platform!=='darwin')('keeps immutable conservative accounting on cold read and denies changing it through exact settle', async()=>{
    const f=await fixture();await bound(f);const input=draft();await invoke(f,'reserveAttempt','reserve',input);
    const marker={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash};
    await invoke(f,'markPreSend','marker',marker);
    const usage={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash};
    await invoke(f,'settleConservative','settle_conservative',usage);
    await f.runtime.dispose();
    const cold=await fixture(f.root),query={accountId:'account'};
    const receipt=await cold.port.observe(query,cold.issue('read',query));
    const status=api.readOriginalDshBudgetObservation(cold.port,receipt).status;
    expect(status.costAccountingReceipts).toHaveLength(1);
    expect(status.attempts[0]).toMatchObject({actual_tokens:50,actual_cost:null,cost_basis:'conservative_upper_bound'});
    const exact={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,actualCostMicros:75,usageReceiptHash:hash};
    await expect(invoke(cold,'settleAttempt','settle',exact)).rejects.toThrow('dsh_usage_basis_conflict');
    expect(cold.sql('SELECT spent_cost,held_cost FROM dsh_budget_accounts')[0]).toMatchObject({spent_cost:75,held_cost:1925});
    const db=new DatabaseSync(join(f.root,'harness-optimization.sqlite'));
    try {
        expect(()=>db.prepare('UPDATE dsh_budget_accounts SET revision=revision').run()).toThrow(/xiaok_harness_dsh_budget_v/);
        for(const value of [null,undefined,0]){
            for(const version of [3,5])db.function('xiaok_harness_dsh_budget_v'+version,()=>version===3?1:value);
            expect(()=>db.prepare('UPDATE dsh_budget_accounts SET revision=revision').run()).toThrow('dsh_writer_required');
        }
    } finally {db.close();}
});

it.skipIf(process.platform!=='darwin').each(['before','after'])('preserves same worker source resource accounting added %s conservative migration',async(order)=>{
    const f=await fixture();await bound(f);
    const scan={accountId:'source-account',scanId:'scan'};
    if(order==='before')await f.sourcePort.openScan(scan,f.sourceIssue(scan));
    const input=draft();await invoke(f,'reserveAttempt','reserve',input);
    await invoke(f,'markPreSend','marker',{accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash});
    await invoke(f,'settleConservative','settle_conservative',{accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash});
    if(order==='after')await f.sourcePort.openScan(scan,f.sourceIssue(scan));
    expect(f.sql("SELECT value FROM metadata WHERE key='schemaVersion'")[0]?.value).toBe('5');
    expect(f.sql('SELECT COUNT(*) AS n FROM dsh_budget_source_scans')[0]?.n).toBe(1);
    const query={accountId:'account'},receipt=await f.port.observe(query,f.issue('read',query));
    expect(api.readOriginalDshBudgetObservation(f.port,receipt).status.costAccountingReceipts).toHaveLength(1);
});

it.skipIf(process.platform!=='darwin')('asserts original funded reservation current without consuming its later oneuse send',async()=>{
    const f=await fixture(),a=await funded(f);
    expect(api.assertOriginalDshDraftAdmissionReserved).toBeTypeOf('function');
    api.assertOriginalDshDraftAdmissionReserved(f.port,a.proof,a.receipt);
    expect(()=>api.assertOriginalDshDraftAdmissionReserved(f.port,{},a.receipt)).toThrow();
    const view=api.takeOriginalDshDraftAdmission(f.port,a.proof,a.receipt);
    expect(view.reservationId).toBe(a.view.data.reservationId);
    expect(()=>api.assertOriginalDshDraftAdmissionReserved(f.port,a.proof,a.receipt)).toThrow('dsh_budget_admission_unavailable');
});


it.skipIf(process.platform!=='darwin')('revises the same original Mandate account without resetting actual spent or minting a new account',async()=>{
    const f=await fixture(),input=draft('assessment',1,'assessment');
    await invoke(f,'reserveAttempt','reserve',input);await settle(f,input,50,75);
    f.changeMandateRevision(2);
    const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
    const result:any=await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
    expect(result.account).toMatchObject({mandate_revision:2,token_limit:6000,cost_limit:7000,spent_tokens:50,spent_cost:75,held_tokens:0,held_cost:0});
    expect(f.sql('SELECT COUNT(*) AS n FROM dsh_budget_accounts')[0]?.n).toBe(1);
    expect(f.sql('SELECT COUNT(*) AS n FROM dsh_budget_account_revisions')[0]?.n).toBe(1);
    await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
    expect(f.sql('SELECT COUNT(*) AS n FROM dsh_budget_account_revisions')[0]?.n).toBe(1);
    await expect(f.runtime.dsh.openAccount({...config,accountId:'replacement'},f.issue('open',{...config,accountId:'replacement'},'user'))).rejects.toThrow('dsh_account_conflict');
});

it.skipIf(process.platform!=='darwin').each(['prepared','pre_send','funded','closed'])('does not use account revision to wash %s budget or work',async(mode)=>{
    const f=await fixture();
    if(mode==='funded')await funded(f);
    else {
        const input=draft('held',1,'assessment');await invoke(f,'reserveAttempt','reserve',input);
        if(mode==='pre_send')await invoke(f,'markPreSend','marker',{accountId:'account',operationKey:'held',sequence:1,attemptId:'held.1',bodyHash:hash});
        if(mode==='closed')await settle(f,input,6000,8000);
    }
    const before=f.sql('SELECT * FROM dsh_budget_accounts')[0];
    f.changeMandateRevision(2);
    const config={accountId:'account',tokenLimit:10000,costLimitMicros:10000,currency:'USD',scale:6,validUntil:now+120000};
    await expect(f.runtime.dsh.openAccount(config,f.issue('open',config,'user'))).rejects.toThrow('dsh_account_revision_busy');
    expect(f.sql('SELECT * FROM dsh_budget_accounts')[0]).toEqual(before);
    expect(f.sql("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='dsh_budget_account_revisions'")[0]?.n).toBe(0);
});
it.skipIf(process.platform!=='darwin')('keeps account revision immutable cold history and all old writers behind the new original floor',async()=>{
    const f=await fixture(),input=draft('usage',1,'assessment');
    await invoke(f,'reserveAttempt','reserve',input);await settle(f,input,50,75);
    const db=new DatabaseSync(join(f.root,'harness-optimization.sqlite'));
    const held=db.prepare('UPDATE dsh_budget_accounts SET revision=revision WHERE account_id=?');
    try {
        for(const version of [3,4,5,6,7])db.function('xiaok_harness_dsh_budget_v'+version,()=>1);
        f.changeMandateRevision(2);
        const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
        await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
        expect(()=>held.run('account')).toThrow(/xiaok_harness_dsh_budget_v8/);
        for(const value of [null,undefined,0]){
            db.function('xiaok_harness_dsh_budget_v8',()=>value);
            expect(()=>held.run('account')).toThrow('dsh_writer_required');
        }
        db.function('xiaok_harness_dsh_budget_v8',()=>1);expect(()=>held.run('account')).not.toThrow();
        expect(()=>db.prepare('UPDATE dsh_budget_account_epochs SET authorization_epoch=authorization_epoch').run()).toThrow('dsh_immutable_record');
        const history=f.sql('SELECT * FROM dsh_budget_account_revisions');
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({previous_mandate_revision:1,next_mandate_revision:2,spent_tokens:50,spent_cost:75});
        await f.runtime.dispose();
        const cold=await service.createHarnessOptimizationRuntime({dataRoot:f.root,profileId:'profile',workspaceId:'workspace',authorizeUser:()=>false,manifestLookup:()=>undefined,now:()=>now,dshBudgetAuthoritySource:f.source});
        hosts.push(cold);
        const port=service.readOriginalDshBudgetPort(cold,f.source),query={accountId:'account'};
        const observation=await port.observe(query,f.issue('read',query));
        expect(service.readOriginalDshBudgetObservation(port,observation).status.account).toMatchObject({mandate_revision:2,spent_tokens:50,spent_cost:75});
        expect(f.sql('SELECT * FROM dsh_budget_account_revisions')).toEqual(history);
    }finally{db.close();}
});
it.skipIf(process.platform!=='darwin')('never lowers revised totals below actual spent or accepts an unchanged epoch for a new account revision',async()=>{
    const f=await fixture(),input=draft('usage',1,'assessment');
    await invoke(f,'reserveAttempt','reserve',input);await settle(f,input,50,75);f.changeMandateRevision(2);
    const config={accountId:'account',tokenLimit:10,costLimitMicros:10,currency:'USD',scale:6,validUntil:now+120000};
    await expect(f.runtime.dsh.openAccount(config,f.issue('open',config,'user'))).rejects.toThrow('dsh_account_revision_limits');
    f.hook((purpose,value)=>purpose==='open'?{...value,authorizationEpoch:1}:value);
    const larger={...config,tokenLimit:6000,costLimitMicros:7000};
    await expect(f.runtime.dsh.openAccount(larger,f.issue('open',larger,'user'))).rejects.toThrow('dsh_account_forbidden');
    expect(f.sql('SELECT mandate_revision,spent_tokens,spent_cost FROM dsh_budget_accounts')[0]).toMatchObject({mandate_revision:1,spent_tokens:50,spent_cost:75});
});

it.skipIf(process.platform!=='darwin')('keeps original model and Source resource siblings usable under revised schema eight',async()=>{
    const f=await fixture();f.changeMandateRevision(2);
    const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
    await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
    const scan={accountId:'source-account',scanId:'after-revision'};
    await f.sourcePort.openScan(scan,f.sourceIssue(scan));
    const input=draft('fresh-assessment',1,'assessment');
    await invoke(f,'reserveAttempt','reserve',input);
    await invoke(f,'markPreSend','marker',{accountId:'account',operationKey:'fresh-assessment',sequence:1,attemptId:'fresh-assessment.1',bodyHash:hash});
    await invoke(f,'settleConservative','settle_conservative',{accountId:'account',operationKey:'fresh-assessment',sequence:1,attemptId:'fresh-assessment.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash});
    const query={accountId:'account'},receipt=await f.port.observe(query,f.issue('read',query));
    expect(service.readOriginalDshBudgetObservation(f.port,receipt).status).toMatchObject({account:{spent_tokens:50,spent_cost:75,mandate_revision:2},costAccountingReceipts:[{basis:'conservative_upper_bound'}]});
    expect(f.sql("SELECT value FROM metadata WHERE key='schemaVersion'")[0]?.value).toBe('8');
});

it.skipIf(process.platform!=='darwin')('preserves a pre-upgrade closed work immutable usage receipt during account revision',async()=>{
    const f=await fixture(),a=await bound(f),input=draft();
    await invoke(f,'reserveAttempt','reserve',input);await settle(f,input);
    const receipts=f.sql('SELECT * FROM dsh_budget_command_receipts ORDER BY attestation_id');
    const usage=f.sql('SELECT a.* FROM dsh_budget_work_attempts e JOIN dsh_budget_attempts a USING(account_id,operation_key,attempt_sequence) ORDER BY e.work_sequence');
    const closure={accountId:'account',reservationId:a.view.reservation.reservation_id,closureId:'before-migration',ownerWorkId:'work',commandReceiptsHash:dshDigest('dsh-budget-work-command-receipts-v1',receipts),usageHash:dshDigest('dsh-budget-work-usage-v1',usage)};
    await f.port.closeWork(closure,f.issue('work_close',closure));
    const immutable=f.sql('SELECT * FROM dsh_budget_work_closures');
    f.changeMandateRevision(2);
    const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
    await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
    expect(f.sql('SELECT * FROM dsh_budget_work_closures')).toEqual(immutable);
});

it.skipIf(process.platform!=='darwin')('separates current original observation from passive historical budget data',async()=>{
    const f=await fixture(),query={accountId:'account'},receipt=await f.port.observe(query,f.issue('read',query));
    expect(api.assertOriginalDshBudgetObservationCurrent).toBeTypeOf('function');
    api.assertOriginalDshBudgetObservationCurrent(f.port,receipt);
    await invoke(f,'reserveAttempt','reserve',draft('changed',1,'assessment'));
    expect(()=>api.assertOriginalDshBudgetObservationCurrent(f.port,receipt)).toThrow('dsh_budget_observation_unavailable');
    expect(api.readOriginalDshBudgetObservation(f.port,receipt).status.account.held_tokens).toBe(0);
    let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('trap');}});
    expect(()=>api.assertOriginalDshBudgetObservationCurrent(f.port,proxy)).toThrow();expect(traps).toBe(0);
});

it.skipIf(process.platform!=='darwin')('never revives an observation delivered before an already-pending original account mutation',async()=>{
    const f=await fixture(),query={accountId:'account'};
    let checks=0,observing:Promise<object>|undefined;
    f.hook((purpose,value)=>purpose==='reserve'?{...value,assertCurrent(){
        if(++checks===2)observing=f.port.observe(query,f.issue('read',query));
    }}:value);
    await invoke(f,'reserveAttempt','reserve',draft('later-write',1,'assessment'));
    expect(observing).toBeTruthy();
    const receipt=await observing!;
    expect(service.readOriginalDshBudgetObservation(f.port,receipt).status.account.held_tokens).toBe(0);
    expect(f.sql('SELECT held_tokens FROM dsh_budget_accounts')[0]?.held_tokens).toBe(200);
    expect(()=>api.assertOriginalDshBudgetObservationCurrent(f.port,receipt)).toThrow('dsh_budget_observation_unavailable');
});
it.skipIf(process.platform!=='darwin')('rejects an unconsumed assertion if its Source synchronously consumes the exact original cap',async()=>{
    const f=await fixture();await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
    let armed=false,taken:unknown,receipt:object,proof:object;
    f.hook((purpose,value)=>purpose==='work_reserve'?{...value,assertCurrent(){
        if(armed){armed=false;taken=service.takeOriginalDshDraftAdmission(f.port,proof,receipt);}
    }}:value);
    const input=f.fund();proof=f.issue('work_reserve',input);receipt=await f.port.reserveDraftAdmission(input,proof);
    armed=true;
    expect(()=>service.assertOriginalDshDraftAdmissionReserved(f.port,proof,receipt)).toThrow('dsh_budget_admission_unavailable');
    expect(taken).toBeTruthy();
    service.assertOriginalDshDraftAdmissionCurrent(f.port,proof,receipt);
});
it.skipIf(process.platform!=='darwin')('checks the original observation unchanged cut without reentering its Source in SQL phase',async()=>{
    const f=await fixture(),query={accountId:'account'};
    let calls=0,sqlPhase=false;
    f.hook((purpose,value)=>purpose==='read'?{...value,assertCurrent(){calls++;if(sqlPhase)throw Error('original-a-transaction-busy');}}:value);
    const receipt=await f.port.observe(query,f.issue('read',query));
    service.assertOriginalDshBudgetObservationCurrent(f.port,receipt);
    expect(api.assertOriginalDshBudgetObservationUnchanged).toBeTypeOf('function');
    const before=calls;sqlPhase=true;
    api.assertOriginalDshBudgetObservationUnchanged(f.port,receipt);
    expect(calls).toBe(before);
    sqlPhase=false;
    await invoke(f,'reserveAttempt','reserve',draft('cut-mutation',1,'assessment'));
    expect(()=>api.assertOriginalDshBudgetObservationUnchanged(f.port,receipt)).toThrow('dsh_budget_observation_unavailable');
    let traps=0;const copied=new Proxy({},{get(){traps++;throw Error('trap');},getOwnPropertyDescriptor(){traps++;throw Error('trap');}});
    expect(()=>api.assertOriginalDshBudgetObservationUnchanged(f.port,copied)).toThrow();expect(traps).toBe(0);
});
it.skipIf(process.platform!=='darwin')('checks the exact unconsumed work cut without Source reentry in SQL phase',async()=>{
    const f=await fixture();await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
    let calls=0,sqlPhase=false;
    f.hook((purpose,value)=>purpose==='work_reserve'?{...value,assertCurrent(){calls++;if(sqlPhase)throw Error('original-a-transaction-busy');}}:value);
    const input=f.fund(),proof=f.issue('work_reserve',input),receipt=await f.port.reserveDraftAdmission(input,proof);
    service.assertOriginalDshDraftAdmissionReserved(f.port,proof,receipt);
    expect(api.assertOriginalDshDraftAdmissionUnchanged).toBeTypeOf('function');
    const before=calls;sqlPhase=true;
    api.assertOriginalDshDraftAdmissionUnchanged(f.port,proof,receipt);expect(calls).toBe(before);
    expect(()=>api.assertOriginalDshDraftAdmissionUnchanged(f.port,{},receipt)).toThrow();
    sqlPhase=false;service.takeOriginalDshDraftAdmission(f.port,proof,receipt);
    expect(()=>api.assertOriginalDshDraftAdmissionUnchanged(f.port,proof,receipt)).toThrow('dsh_budget_admission_unavailable');
});
it.skipIf(process.platform!=='darwin')('keeps the captured original Source local lifetime in the observation SQL cut',async()=>{
    const f=await fixture(),query={accountId:'account'};let sealed=false;
    f.hook((purpose,value)=>purpose==='read'?{...value,assertLocal(){if(sealed)throw Error('original-source-sealed');}}:value);
    const receipt=await f.port.observe(query,f.issue('read',query));
    api.assertOriginalDshBudgetObservationUnchanged(f.port,receipt);sealed=true;
    expect(()=>api.assertOriginalDshBudgetObservationUnchanged(f.port,receipt)).toThrow('original-source-sealed');
});
it.skipIf(process.platform!=='darwin')('uses an own descriptor shell for the original Source authority projection',async()=>{
    const f=await fixture(),query={accountId:'account'},original=Object.getOwnPropertyDescriptor(Object.prototype,'get');
    let armed=true,hits=0,failure:unknown,present=false;
    f.hook((purpose,value)=>purpose==='read'?{...value,assertCurrent(){if(armed){armed=false;Object.defineProperty(Object.prototype,'get',{__proto__:null,configurable:true,get(){hits++;return undefined;}} as PropertyDescriptor);}}}:value);
    try{await f.port.observe(query,f.issue('read',query));}catch(error){present=true;failure=error;}
    finally{if(original)Object.defineProperty(Object.prototype,'get',original);else delete (Object.prototype as any).get;}
    expect(hits).toBe(0);expect(present,String(failure)).toBe(false);
});
it.skipIf(process.platform!=='darwin')('synchronizes only scheduler policy and observes original SQL work capacity without a fund',async()=>{
    const f=await fixture(),query={accountId:'account'};
    expect(service.readOriginalDshBudgetObservation(f.port,await f.port.observe(query,f.issue('read',query))).status.workCapacity).toBeNull();
    expect(f.port.syncWorkPolicy).toBeTypeOf('function');
    await expect(f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy))).rejects.toThrow('dsh_actor_forbidden');
    await expect(f.port.syncWorkPolicy(f.policy,f.issue('work_policy_sync',f.policy,'user'))).rejects.toThrow('dsh_actor_forbidden');
    await f.port.syncWorkPolicy(f.policy,f.issue('work_policy_sync',f.policy));
    const capacity=async()=>service.readOriginalDshBudgetObservation(f.port,await f.port.observe(query,f.issue('read',query))).status.workCapacity;
    expect(await capacity()).toEqual({maxActiveWorks:1,maxDraftRequestsPerWork:2,activeWorks:0});
    expect(f.sql('SELECT COUNT(*) AS n FROM dsh_budget_work_reservations')[0]?.n).toBe(0);
    const input=f.fund();await f.port.reserveDraftAdmission(input,f.issue('work_reserve',input));
    expect(await capacity()).toEqual({maxActiveWorks:1,maxDraftRequestsPerWork:2,activeWorks:1});
});
it.skipIf(process.platform!=='darwin')('reads and cold-books only actual original work facts without reminting its grant',async()=>{
    const f=await fixture();await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
    expect(f.port.observeWork).toBeTypeOf('function');
    const input=f.fund(),proof=f.issue('work_reserve',input),receipt=await f.port.reserveDraftAdmission(input,proof),fund=service.readOriginalDshDraftAdmission(f.port,receipt);
    const query={accountId:'account',bindingId:input.bindingId,generation:1,operationKey:input.command.operationKey,semanticPayloadHash:input.command.semanticPayloadHash,purpose:'draft_admission'};
    const first=await f.port.observeWork(query,f.issue('work_read',query));
    const read=(service as any).readOriginalDshBudgetWorkSnapshot;
    expect(read(f.port,first).reservation.reservation_id).toBe(fund.reservation.reservation_id);
    await f.runtime.dispose();hosts.splice(hosts.indexOf(f.runtime),1);
    const next=await fixture(f.root),snapshot=await next.port.observeWork(query,next.issue('work_read',query)),view=read(next.port,snapshot);
    expect(view.head.state).toBe('unknown');
    const bind={accountId:'account',reservationId:view.reservation.reservation_id,attestationId:view.attestation.attestation_id,operationKey:query.operationKey,semanticPayloadHash:query.semanticPayloadHash,commandId:'actual-b-command',result:'applied',ownerWorkId:'actual-b-work'};
    await next.port.bindDraftWork(bind,next.issue('work_bind',bind));
    const audited=read(next.port,await next.port.observeWork(query,next.issue('work_read',query)));
    expect(audited.head).toMatchObject({state:'unknown',owner_work_id:'actual-b-work'});expect(audited.commandReceipt.result).toBe('applied');
    expect(audited.status.account.held_tokens).toBe(1000);
    const replay=await next.port.reserveDraftAdmission(input,next.issue('work_reserve',input));expect(service.readOriginalDshDraftAdmission(next.port,replay).disposition).toBe('existing');
    expect(()=>service.takeOriginalDshDraftAdmission(next.port,{},replay)).toThrow();
});
it.skipIf(process.platform!=='darwin')('records the original observeWork raw promise metadata at its SDK boundary',async()=>{
    const f=await fixture(),query={accountId:'account',bindingId:'binding',generation:1,operationKey:'command.binding',semanticPayloadHash:hash,purpose:'draft_admission'};
    const raw=f.port.observeWork(query,f.issue('work_read',query));
    const ctor=Object.getOwnPropertyDescriptor(raw,'constructor');
    console.log('ORIGINAL_WORK_READ_RAW',JSON.stringify({ownConstructor:!!ctor,exactIntrinsic:!!ctor&&Object.hasOwn(ctor,'value')&&ctor.value===Promise}));
    const value=await raw;expect((service as any).readOriginalDshBudgetWorkSnapshot(f.port,value).state).toBe('not_observed');
});

describe.skipIf(process.platform!=='darwin')('original settled draft usage proof',()=>{
 it('finalizes only original booked settled work and preserves exact immutable receipt on reopen',async()=>{
  const f=await fixture(),a=await bound(f);
  const prepare={...a.input,command:{operationKey:'draft',semanticPayloadHash:hash,assessmentRef:'assessment-draft',purpose:'draft_prepare'}};
  const r=await f.port.reserveDraftAdmission(prepare,f.issue('work_reserve',prepare)),view=api.readOriginalDshDraftAdmission(f.port,r);
  const book={accountId:'account',reservationId:view.reservation.reservation_id,attestationId:view.attestation.attestation_id,operationKey:'draft',semanticPayloadHash:hash,commandId:'actual-b-slot',result:'applied',ownerWorkId:'work'};
  await f.port.bindDraftWork(book,f.issue('work_bind',book));
  const request=draft();await invoke(f,'reserveAttempt','reserve',request);
  expect(typeof f.port.finalizeDraftUsage).toBe('function');
  const input={accountId:'account',reservationId:view.reservation.reservation_id,bindingId:'binding',ownerWorkId:'work',operationKey:'draft',semanticPayloadHash:hash,inputManifestHash:hash,attemptId:'draft.1'};
  await expect(f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input))).rejects.toThrow('dsh_draft_usage_unconfirmed');
  await settle(f,request);
  const receipt=await f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input)),proof=api.readOriginalDshBudgetCommitProof(f.port,receipt);
  expect(proof.issuerDomain).toBe('account');expect(proof.proof).toMatchObject({ownerWorkId:'work',bindingId:'binding',inputManifestHash:hash,operationKey:'draft',chargedBasis:'actual'});
  expect(proof.proof.budgetOwnerId).not.toBe('account');api.assertOriginalDshBudgetCommitProofCurrent(f.port,receipt);
  expect(()=>api.readOriginalDshBudgetCommitProof(f.port,{})).toThrow('dsh_budget_commit_proof_required');
  const again=await f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input));expect(api.readOriginalDshBudgetCommitProof(f.port,again)).toEqual(proof);
  await expect(f.port.finalizeDraftUsage({...input,inputManifestHash:'b'.repeat(64)},f.issue('draft_finalize',{...input,inputManifestHash:'b'.repeat(64)}))).rejects.toThrow('dsh_draft_usage_conflict');
  await f.runtime.dispose();const cold=await fixture(f.root),history=await cold.port.finalizeDraftUsage(input,cold.issue('draft_finalize',input));
  expect(api.readOriginalDshBudgetCommitProof(cold.port,history)).toEqual(proof);
  expect(()=>api.assertOriginalDshBudgetCommitProofCurrent(cold.port,history)).toThrow('dsh_budget_commit_unavailable');
 });
});

async function finalizeFixture(){
 const f=await fixture(),a=await bound(f),prepare={...a.input,command:{operationKey:'draft',semanticPayloadHash:hash,assessmentRef:'assessment-draft',purpose:'draft_prepare'}};
 const cap=await f.port.reserveDraftAdmission(prepare,f.issue('work_reserve',prepare)),view=api.readOriginalDshDraftAdmission(f.port,cap);
 const book={accountId:'account',reservationId:view.reservation.reservation_id,attestationId:view.attestation.attestation_id,operationKey:'draft',semanticPayloadHash:hash,commandId:'actual-b-slot',result:'applied',ownerWorkId:'work'};
 await f.port.bindDraftWork(book,f.issue('work_bind',book));
 const request=draft();await invoke(f,'reserveAttempt','reserve',request);
 const input={accountId:'account',reservationId:view.reservation.reservation_id,bindingId:'binding',ownerWorkId:'work',operationKey:'draft',semanticPayloadHash:hash,inputManifestHash:hash,attemptId:'draft.1'};
 return {f,request,input};
}
it.skipIf(process.platform!=='darwin')('requires settled siblings and retains explicit conservative charge provenance',async()=>{
 const {f,request,input}=await finalizeFixture(),sibling=draft('sibling');await invoke(f,'reserveAttempt','reserve',sibling);
 const marker={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash};await invoke(f,'markPreSend','marker',marker);
 await invoke(f,'settleConservative','settle_conservative',{accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash});
 await expect(f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input))).rejects.toThrow('dsh_draft_usage_unconfirmed');
 await settle(f,sibling);
 const receipt=await f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input));
 expect(api.readOriginalDshBudgetCommitProof(f.port,receipt).proof.chargedBasis).toBe('conservative_upper_bound');
 expect(f.sql("SELECT actual_cost,cost_basis FROM dsh_budget_attempts WHERE attempt_id='draft.1'")[0]).toMatchObject({actual_cost:null,cost_basis:'conservative_upper_bound'});
 let traps=0;const fake=new Proxy({},{get(){traps++;},ownKeys(){traps++;return [];}});
 expect(()=>api.readOriginalDshBudgetCommitProof(f.port,fake)).toThrow('dsh_budget_commit_proof_required');
 expect(traps).toBe(0);
 const next=draft('draft',2);await expect(invoke(f,'reserveAttempt','reserve',next)).rejects.toThrow('dsh_draft_usage_finalized');
});
it.skipIf(process.platform!=='darwin')('upgrades the original writer floor and refuses held older and null writers for final usage',async()=>{
 const {f,request,input}=await finalizeFixture();await settle(f,request);
 const db=new DatabaseSync(join(f.root,'harness-optimization.sqlite'));
 for(const version of [3,4,5,6])db.function('xiaok_harness_dsh_budget_v'+version,()=>1);
 const old=db.prepare("UPDATE dsh_budget_accounts SET revision=revision WHERE account_id='account'");
 try{
  await f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input));
  expect(()=>old.run()).toThrow(/xiaok_harness_dsh_budget_v7/);
  for(const value of [null,undefined,0]){db.function('xiaok_harness_dsh_budget_v7',()=>value);expect(()=>old.run()).toThrow('dsh_writer_required');}
  db.function('xiaok_harness_dsh_budget_v7',()=>1);expect(()=>old.run()).not.toThrow();
  expect(db.prepare("SELECT value FROM metadata WHERE key='schemaVersion'").get()?.value).toBe('7');
  expect(()=>db.prepare("DELETE FROM dsh_budget_draft_usage_receipts").run()).toThrow('dsh_immutable_record');
 }finally{db.close();}
});

it.skipIf(process.platform!=='darwin')('commits the actual original B draft with the same original worker finalized usage proof',async()=>{
 const {originalBudgetB}=await import('../fixtures/budget-original-b.mjs');
 const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},time=Date.now(),f=await fixture(undefined,scope,time),thread={...f.fund().thread,threadId:'123'};
 const reserveProofs=new WeakMap<object,object>(),commitCaps=new WeakSet<object>();
 const budgetSource={resolve(cap:object){
  if(commitCaps.has(cap)){const data=api.readOriginalDshBudgetCommitProof(f.port,cap);return {data,assertCurrent(){api.assertOriginalDshBudgetCommitProofCurrent(f.port,cap);}};}
  const proof=reserveProofs.get(cap),data=api.takeOriginalDshDraftAdmission(f.port,proof,cap);return {data,assertCurrent(){api.assertOriginalDshDraftAdmissionCurrent(f.port,proof,cap);}};
 }};
 const b=await originalBudgetB(scope,thread,budgetSource,{admission:true});
 try{
  await f.port.configureWorkPolicy(f.policy,f.issue('work_policy',f.policy,'user'));
  const initial=b.command(),fund={...f.fund(),thread,command:{operationKey:initial.operationKey,semanticPayloadHash:initial.semanticPayloadHash,assessmentRef:initial.assessmentRef,purpose:'draft_admission'}},proof=f.issue('work_reserve',fund),cap=await f.port.reserveDraftAdmission(fund,proof);reserveProofs.set(cap,proof);
  const view=api.readOriginalDshDraftAdmission(f.port,cap),command=b.command(view.data.reservationId),created=b.apply(command,cap);expect(created.ok,JSON.stringify(created)).toBe(true);
  const book=(at:any,cmd:any,result:any)=>({accountId:'account',reservationId:view.data.reservationId,attestationId:at.attestation_id,operationKey:cmd.operationKey,semanticPayloadHash:cmd.semanticPayloadHash,commandId:cmd.commandId,result:'applied',ownerWorkId:result.receipt.ownerWorkId});
  const firstBook=book(view.attestation,command,created);await f.port.bindDraftWork(firstBook,f.issue('work_bind',firstBook));
  const lookup={scope,thread,bindingId:'binding',generation:1,ownerWorkId:created.receipt.ownerWorkId};
  const work=b.hub.readDshWork(b.issue('read',lookup)),guard=work.work.guard;
  const authority=b.command(view.data.reservationId,{commandId:'actual-budget-slot',action:'prepare_draft',targetWorkId:created.receipt.ownerWorkId,expectedOwnerVersion:1,inputSetRevision:1,workGuard:{scopeKey:guard.scopeKey,epoch:guard.epoch,revision:guard.revision}});
  const prepareFund={...fund,command:{operationKey:authority.operationKey,semanticPayloadHash:authority.semanticPayloadHash,assessmentRef:authority.assessmentRef,purpose:'draft_prepare'}},prepareProof=f.issue('work_reserve',prepareFund),prepareCap=await f.port.reserveDraftAdmission(prepareFund,prepareProof);reserveProofs.set(prepareCap,prepareProof);
  const prepareView=api.readOriginalDshDraftAdmission(f.port,prepareCap),prepared=b.hub.prepareDshDraftSlot(b.issue('slot',authority,prepareCap),{requestSource:'scheduler'});expect(prepared.ok,JSON.stringify(prepared)).toBe(true);
  const secondBook=book(prepareView.attestation,authority,prepared);await f.port.bindDraftWork(secondBook,f.issue('work_bind',secondBook));
  const slot=b.hub.readDshDraftSlot(b.issue('read',{...lookup,draftCommitKey:prepared.slot.id}));expect(slot.ok).toBe(true);
  const request=draft(authority.operationKey);request.operation.workId=created.receipt.ownerWorkId;request.operation.deadline=time+40000;
  await invoke(f,'reserveAttempt','reserve',request);await settle(f,request);
  const finalInput={accountId:'account',reservationId:view.data.reservationId,bindingId:'binding',ownerWorkId:created.receipt.ownerWorkId,operationKey:authority.operationKey,semanticPayloadHash:authority.semanticPayloadHash,inputManifestHash:slot.inputManifest.manifestHash,attemptId:request.attempt.attemptId};
  const commitCap=await f.port.finalizeDraftUsage(finalInput,f.issue('draft_finalize',finalInput));commitCaps.add(commitCap);const final=api.readOriginalDshBudgetCommitProof(f.port,commitCap);
  const codec=await b.module('dsh-draft-data.js'),text='Actual worker-paid original B draft.';
  const candidate={schemaVersion:1,scope,thread,bindingId:'binding',generation:1,ownerWorkId:created.receipt.ownerWorkId,draftCommitKey:prepared.slot.id,artifactId:prepared.slot.artifactId,draftInvocationId:prepared.slot.draftInvocationId,attemptId:'actual-worker-b-commit',expectedOwnerVersion:prepared.receipt.ownerVersion,authority,manifest:slot.inputManifest,budgetCommitProof:final.proof,content:{kind:'dsh_model_text_v1',text,contentHash:codec.dshDraftContentHash(text)}};Object.assign(candidate,codec.dshDraftHashes(candidate));
  expect(b.hub.stageDshDraft(b.issue('draft_stage',candidate,commitCap),{requestSource:'scheduler'})).toMatchObject({ok:true,result:'staged'});
  expect(b.hub.commitDshDraft(b.issue('draft_commit',candidate,commitCap),{requestSource:'scheduler'})).toMatchObject({ok:true,result:'committed'});
  expect(b.hub.readDshDraft(b.issue('read',{...lookup,draftCommitKey:prepared.slot.id}))).toMatchObject({ok:true,draft:{state:'committed',currentDraftValid:true}});
  expect(f.sql('SELECT spent_tokens,spent_cost FROM dsh_budget_accounts')[0]).toMatchObject({spent_tokens:50,spent_cost:75});expect(b.effects).toEqual([]);
  console.log('ORIGINAL_PAID_DRAFT_FACTS',JSON.stringify({originalB:true,originalWorker:true,originalLedger:true,modelSdk:false,NativeHostGrant:false,proofId:final.proof.proofId}));
 }finally{b.close();}
});
it.skipIf(process.platform!=='darwin')('keeps finalized SQL truth without delivering a capability when the final original Source disposes',async()=>{
 const {f,request,input}=await finalizeFixture();await settle(f,request);
 const cause=Error('actual-final-usage-source-revoked');let closing:Promise<void>|undefined,hits=0;
 f.hook((purpose,value)=>purpose==='draft_finalize'?{...value,assertCurrent(){
  if(f.sql("SELECT name FROM sqlite_master WHERE name='dsh_budget_draft_usage_receipts'").length&&f.sql('SELECT * FROM dsh_budget_draft_usage_receipts').length){hits++;closing=f.runtime.dispose();throw cause;}
 }}:value);
 await expect(f.port.finalizeDraftUsage(input,f.issue('draft_finalize',input))).rejects.toBe(cause);
 expect(hits).toBe(1);await expect(closing).rejects.toMatchObject({message:'dsh_budget_source_failed',cause});hosts.splice(hosts.indexOf(f.runtime),1);
 expect(f.sql('SELECT * FROM dsh_budget_draft_usage_receipts')).toHaveLength(1);
 expect(f.sql('SELECT spent_tokens,spent_cost FROM dsh_budget_accounts')[0]).toMatchObject({spent_tokens:50,spent_cost:75});
});
it.skipIf(process.platform!=='darwin').each([Error('actual-usage-commit-wrapper'),undefined])('holds actual committed usage when the Native COMMIT wrapper reports %s',async(primary)=>{
 const {f,request,input}=await finalizeFixture();await settle(f,request);
 // Exact original committed database bytes in an isolated Native fault fixture;
 // not an injected SDK failure in the worker thread or a product recovery.
 const faultPath=join(f.root,'usage-fault.sqlite'),snapshot=new DatabaseSync(join(f.root,'harness-optimization.sqlite'));try{snapshot.prepare('VACUUM INTO ?').run(faultPath);}finally{snapshot.close();}await f.runtime.dispose();
 const {createDshBudgetLedger,createDshBudgetTransaction}=await import('../../electron/harness-dsh-budget-ledger.mjs');
 const db=new DatabaseSync(faultPath);
 for(const version of [3,4,5,6,7])db.function('xiaok_harness_dsh_budget_v'+version,()=>1);
 const ownerId=db.prepare("SELECT value FROM metadata WHERE key='ownerId'").get()!.value;
 const unknown:unknown[]=[];let armed=true;
 const transaction=createDshBudgetTransaction({exec(sql:string){db.exec(sql);if(sql==='COMMIT'&&armed){armed=false;throw primary;}}},(error:unknown)=>unknown.push(error));
 const ledger=createDshBudgetLedger({db,transaction,ownerId,profileId:'profile',workspaceId:'workspace'});
 const authority={requestSource:'scheduler',profileId:'profile',workspaceId:'workspace',tenantId:'tenant',mandateId:'mandate',mandateRevision:1,authorizationEpoch:1,authorityHash:hash,commandDigest:service.dshBudgetCommandDigest('draft_finalize',input)};
 try{
  expect(()=>ledger.execute('draft_finalize',{input,authority,now})).toThrow('dsh_budget_outcome_unknown');
  expect(unknown).toHaveLength(1);expect((unknown[0] as any).cause).toBe(primary);expect((unknown[0] as any).primaryPresent).toBe(true);
  expect(db.prepare('SELECT * FROM dsh_budget_draft_usage_receipts').all()).toHaveLength(1);
  expect(()=>ledger.execute('draft_finalize',{input,authority,now})).toThrow('dsh_budget_outcome_unknown');
 }finally{db.close();}
});
it.skipIf(process.platform!=='darwin')('uses fixed original draft-attempt and marker methods despite public runtime shadows',async()=>{
 const f=await fixture();await bound(f);const request=draft();
 for(const name of ['reserveDraftAttempt','markPreSend','markSent','markUnknown','settleConservative'])expect(typeof f.port[name]).toBe('function');
 let calls=0;const shadow={...f.runtime.dsh};for(const name of ['reserveAttempt','markPreSend','markSent','markUnknown','settleConservative'])(shadow as any)[name]=()=>{calls++;throw Error('public shadow');};(f.runtime as any).dsh=shadow;
 const cap=await f.port.reserveDraftAttempt(request,f.issue('reserve',request)),view=api.readOriginalDshDraftAttemptReceipt(f.port,cap);expect(view.kind).toBe('draft_attempt_receipt');expect(view.disposition).toBe('newly_reserved');
 const marker={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',bodyHash:hash};await f.port.markPreSend(marker,f.issue('marker',marker));await f.port.markSent(marker,f.issue('sent',marker));
 const usage={accountId:'account',operationKey:'draft',sequence:1,attemptId:'draft.1',actualTokens:50,chargedCostUpperBoundMicros:75,pricingHash:hash,usageReceiptHash:hash};await f.port.settleConservative(usage,f.issue('settle_conservative',usage));
 expect(calls).toBe(0);expect(f.sql('SELECT state FROM dsh_budget_attempts')[0]?.state).toBe('settled');
 const workless=draft('workless-private',1,'assessment');await expect(f.port.reserveDraftAttempt(workless,f.issue('reserve',workless))).rejects.toThrow('dsh_draft_attempt_required');
});
it.skipIf(process.platform!=='darwin')('exposes the original single-cut closure basis and closes only its exact work graph',async()=>{
    const f=await fixture(),missing={accountId:'account',bindingId:'binding',generation:1,operationKey:'command.binding',semanticPayloadHash:hash,purpose:'draft_admission'};
    const absent=service.readOriginalDshBudgetWorkSnapshot(f.port,await f.port.observeWork(missing,f.issue('work_read',missing)));
    expect(absent.closureBasis).toBeNull();
    const accepted=await bound(f);
    const receipt=await f.port.observeWork(missing,f.issue('work_read',missing)),view=service.readOriginalDshBudgetWorkSnapshot(f.port,receipt);
    expect(view.closureBasis).toEqual({commandReceiptsHash:expect.stringMatching(/^[a-f0-9]{64}$/),usageHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
    const close={accountId:'account',reservationId:accepted.view.reservation.reservation_id,ownerWorkId:'work',closureId:'actual-closed-component',...view.closureBasis!};
    await expect(f.port.closeWork({...close,usageHash:'0'.repeat(64)},f.issue('work_close',{...close,usageHash:'0'.repeat(64)}))).rejects.toThrow('dsh_work_outcome_unknown');
    await f.port.closeWork(close,f.issue('work_close',close));
    const ended=service.readOriginalDshBudgetWorkSnapshot(f.port,await f.port.observeWork(missing,f.issue('work_read',missing)));
    expect(ended.head?.state).toBe('closed');expect(ended.status.workCapacity?.activeWorks).toBe(0);expect(ended.closureBasis).toEqual(view.closureBasis);
});

it.skipIf(process.platform!=='darwin')('advances the actual original Mandate account authorization epoch without resetting booked usage',async()=>{
 const f=await fixture(),input=draft('epoch-usage',1,'assessment');
 await invoke(f,'reserveAttempt','reserve',input);await settle(f,input,50,75);
 f.changeMandateRevision(2);f.changeAuthorizationEpoch(2);
 const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
 await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
 const query={accountId:'account'},view=service.readOriginalDshBudgetObservation(f.port,await f.port.observe(query,f.issue('read',query)));
 expect(view.status.account).toMatchObject({mandate_revision:2,authorization_epoch:2,spent_tokens:50,spent_cost:75});
 expect(f.sql("SELECT value FROM metadata WHERE key='schemaVersion'")[0]?.value).toBe('8');
});


it.skipIf(process.platform!=='darwin')('migrates the actual legacy schema six receipt bytes without rewriting their audit hashes',async()=>{
 const fs=await import('node:fs'),root=mkdtempSync(join(tmpdir(),'dsh-epoch-legacy-'));roots.push(root);
 const path=join(root,'legacy.sqlite');fs.copyFileSync(join(import.meta.dirname,'../fixtures/original-schema6-account/harness-optimization.sqlite'),path);
 const {createDshBudgetLedger,createDshBudgetTransaction}=await import('../../electron/harness-dsh-budget-ledger.mjs');
 const db=new DatabaseSync(path);for(const version of [3,4,5,6,7,8])db.function('xiaok_harness_dsh_budget_v'+version,()=>1);
 const ownerId=db.prepare("SELECT value FROM metadata WHERE key='ownerId'").get()!.value;
 const ledger=createDshBudgetLedger({db,transaction:createDshBudgetTransaction(db,()=>{}),ownerId,profileId:'profile',workspaceId:'workspace'});
 try{
  ledger.schema('6');ledger.graph();const old=db.prepare('SELECT * FROM dsh_budget_account_revisions ORDER BY ordinal').all();expect(old).toHaveLength(1);
  const input={accountId:'account',tokenLimit:7000,costLimitMicros:8000,currency:'USD',scale:6,validUntil:now+150000};
  const authority={requestSource:'user',profileId:'profile',workspaceId:'workspace',tenantId:'tenant',mandateId:'mandate',mandateRevision:3,authorizationEpoch:2,authorityHash:hash,commandDigest:service.dshBudgetCommandDigest('open',input)};
  ledger.execute('open',{input,authority,now});ledger.schema('8');ledger.graph();
  const history=db.prepare('SELECT * FROM dsh_budget_account_revisions ORDER BY ordinal').all();expect(history[0]).toEqual(old[0]);expect(history).toHaveLength(2);
  expect(db.prepare('SELECT * FROM dsh_budget_account_epochs ORDER BY ordinal').all()).toMatchObject([{kind:'anchor',authorization_epoch:1,mandate_revision:2},{kind:'revision',authorization_epoch:2,mandate_revision:3}]);
  expect(db.prepare('SELECT authorization_epoch,spent_tokens,spent_cost FROM dsh_budget_accounts').get()).toMatchObject({authorization_epoch:2,spent_tokens:50,spent_cost:75});
 }finally{db.close();}
});
it.skipIf(process.platform!=='darwin')('rejects skipped or same-revision epoch replacement and preserves original immutable epoch history on reopen',async()=>{
 const f=await fixture();f.changeMandateRevision(2);f.changeAuthorizationEpoch(3);
 const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
 await expect(f.runtime.dsh.openAccount(config,f.issue('open',config,'user'))).rejects.toThrow('dsh_account_forbidden');
 f.changeAuthorizationEpoch(2);await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
 const history=f.sql('SELECT * FROM dsh_budget_account_epochs ORDER BY ordinal');expect(history).toHaveLength(2);
 f.changeAuthorizationEpoch(3);await expect(f.runtime.dsh.openAccount(config,f.issue('open',config,'user'))).rejects.toThrow('dsh_account_forbidden');
 f.changeAuthorizationEpoch(2);await f.runtime.dispose();hosts.splice(hosts.indexOf(f.runtime),1);
 const cold=await service.createHarnessOptimizationRuntime({dataRoot:f.root,profileId:'profile',workspaceId:'workspace',authorizeUser:()=>false,manifestLookup:()=>undefined,now:()=>now,dshBudgetAuthoritySource:f.source});hosts.push(cold);
 const port=service.readOriginalDshBudgetPort(cold,f.source),query={accountId:'account'},view=service.readOriginalDshBudgetObservation(port,await port.observe(query,f.issue('read',query)));
 expect(view.status.account.authorization_epoch).toBe(2);expect(f.sql('SELECT * FROM dsh_budget_account_epochs ORDER BY ordinal')).toEqual(history);
});

it.skipIf(process.platform!=='darwin')('anchors a second original account without reissuing the first Mandate identity',async()=>{
 const f=await fixture();f.changeMandateRevision(2);
 const config={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};await f.runtime.dsh.openAccount(config,f.issue('open',config,'user'));
 f.hook((_purpose,value)=>({...value,mandateId:'second-mandate',mandateRevision:1,authorizationEpoch:5}));
 const second={...config,accountId:'second-account'};await f.runtime.dsh.openAccount(second,f.issue('open',second,'user'));
 expect(f.sql('SELECT account_id,authorization_epoch FROM dsh_budget_accounts ORDER BY account_id')).toMatchObject([{account_id:'account',authorization_epoch:2},{account_id:'second-account',authorization_epoch:5}]);
 expect(f.sql("SELECT * FROM dsh_budget_account_epochs WHERE account_id='second-account'")).toMatchObject([{kind:'anchor',ordinal:0,authorization_epoch:5}]);
});
it.skipIf(process.platform!=='darwin').each([Error('actual-epoch-commit-wrapper'),undefined])('retains committed epoch/account truth when the actual COMMIT wrapper reports %s',async primary=>{
 const f=await fixture(),snapshot=new DatabaseSync(join(f.root,'harness-optimization.sqlite')),path=join(f.root,'epoch-fault.sqlite');try{snapshot.prepare('VACUUM INTO ?').run(path);}finally{snapshot.close();}
 const {createDshBudgetLedger,createDshBudgetTransaction}=await import('../../electron/harness-dsh-budget-ledger.mjs');
 const db=new DatabaseSync(path);for(const version of [3,4,5,6,7,8])db.function('xiaok_harness_dsh_budget_v'+version,()=>1);
 const ownerId=db.prepare("SELECT value FROM metadata WHERE key='ownerId'").get()!.value;let armed=true;const failures:any[]=[];
 const transaction=createDshBudgetTransaction({exec(sql:string){db.exec(sql);if(sql==='COMMIT'&&armed){armed=false;throw primary;}}},(error:any)=>failures.push(error));
 const ledger=createDshBudgetLedger({db,transaction,ownerId,profileId:'profile',workspaceId:'workspace'}),input={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
 const authority={requestSource:'user',profileId:'profile',workspaceId:'workspace',tenantId:'tenant',mandateId:'mandate',mandateRevision:2,authorizationEpoch:2,authorityHash:hash,commandDigest:service.dshBudgetCommandDigest('open',input)};
 try{
  expect(()=>ledger.execute('open',{input,authority,now})).toThrow('dsh_budget_outcome_unknown');expect(failures).toHaveLength(1);expect(failures[0].primaryPresent).toBe(true);expect(failures[0].cause).toBe(primary);
  expect(db.prepare('SELECT authorization_epoch,mandate_revision FROM dsh_budget_accounts').get()).toMatchObject({authorization_epoch:2,mandate_revision:2});expect(db.prepare('SELECT * FROM dsh_budget_account_epochs').all()).toHaveLength(2);
  expect(()=>ledger.execute('open',{input,authority,now})).toThrow('dsh_budget_outcome_unknown');
 }finally{db.close();}
});
it.skipIf(process.platform!=='darwin').each([Error('actual-epoch-last-source'),undefined])('keeps epoch SQL truth without a positive return on final Source failure %s',async cause=>{
 const f=await fixture();f.changeMandateRevision(2);let hits=0;
 f.hook((purpose,value)=>purpose==='open'?{...value,assertCurrent(){if(f.sql('SELECT authorization_epoch FROM dsh_budget_accounts')[0]?.authorization_epoch===2){hits++;throw cause;}}}:value);
 const input={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
 await expect(f.runtime.dsh.openAccount(input,f.issue('open',input,'user'))).rejects.toBe(cause);expect(hits).toBeGreaterThan(0);
 expect(f.sql('SELECT authorization_epoch,mandate_revision FROM dsh_budget_accounts')[0]).toMatchObject({authorization_epoch:2,mandate_revision:2});
 await expect(f.runtime.dispose()).rejects.toMatchObject({message:'dsh_budget_source_failed',cause});hosts.splice(hosts.indexOf(f.runtime),1);
});

it.skipIf(process.platform!=='darwin')('does not migrate an unknown cold work into a fresh account epoch',async()=>{
 const f=await fixture();await bound(f);await f.runtime.dispose();hosts.splice(hosts.indexOf(f.runtime),1);
 const next=await fixture(f.root),before=next.sql('SELECT * FROM dsh_budget_accounts')[0];expect(next.sql('SELECT state FROM dsh_budget_work_heads')[0]?.state).toBe('unknown');
 next.changeMandateRevision(2);
 const input={accountId:'account',tokenLimit:6000,costLimitMicros:7000,currency:'USD',scale:6,validUntil:now+120000};
 await expect(next.runtime.dsh.openAccount(input,next.issue('open',input,'user'))).rejects.toThrow('dsh_account_revision_busy');
 expect(next.sql('SELECT * FROM dsh_budget_accounts')[0]).toEqual(before);
 expect(next.sql("SELECT name FROM sqlite_master WHERE name='dsh_budget_account_epochs'")).toHaveLength(0);
});
