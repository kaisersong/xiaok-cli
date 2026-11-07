import {ACCOUNT_EPOCH_PROFILE,ACCOUNT_EPOCH_SQL,createDshAccountEpochHistory} from './harness-dsh-account-epoch.mjs';
import {DRAFT_USAGE_PROFILE,DRAFT_USAGE_SQL,createDshDraftUsage} from './harness-dsh-draft-usage.mjs';
import {ACCOUNT_REVISION_PROFILE,ACCOUNT_REVISION_SQL} from './harness-dsh-account-revision.mjs';
import {CONSERVATIVE_PROFILE,CONSERVATIVE_SQL,CONSERVATIVE_SOURCE_GUARDS,conservativeDshSchema} from './harness-dsh-budget-conservative.mjs';
import {SOURCE_SCHEMA_SQL,SOURCE_READ_PROFILE,SOURCE_TENANT_SQL,SOURCE_TENANT_PROFILE,createSourceReadBudget,parseSourceReadInput,parseSourceIdentity,dshSourceReadCommandDigest} from './harness-dsh-source-read-budget.mjs';
import {WORK_SCHEMA_SQL,WORK_ESCROW_PROFILE,createDshWorkEscrow} from './harness-dsh-work-escrow.mjs';
import { dshFail as fail, dshAdd as add, dshInteger, dshId, dshHash, dshDigest, parseDshInput, parseDshAuthority, checkDshSource, dshBudgetCommandDigest, dshRecord } from './harness-dsh-budget-data.mjs';
const normalized = sql => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
export function createDshBudgetTransaction(db, onUnknown) {
    let poisoned = false;
    return function transaction(action) {
        if (poisoned)
            fail('dsh_budget_outcome_unknown');
        let phase = 'begin', begun = false;
        try {
            db.exec('BEGIN IMMEDIATE');
            begun = true;
            phase = 'body';
            const result = action();
            phase = 'commit';
            db.exec('COMMIT');
            begun = false;
            return result;
        }
        catch (primary) {
            const stage = phase;
            let secondary, secondaryPresent = false;
            try {
                if (begun || stage === 'begin')
                    db.exec('ROLLBACK');
            }
            catch (error) {
                secondaryPresent = true;
                secondary = error;
            }
            const code = primary && typeof primary === 'object' ? Object.getOwnPropertyDescriptor(primary, 'code')?.value : undefined;
            if (stage === 'begin' || stage === 'commit' || secondaryPresent || (typeof code === 'string' && code.startsWith('ERR_SQLITE'))) {
                poisoned = true;
                const error = Error('dsh_budget_outcome_unknown', {
                    cause: primary
                });
                error.outcomeUnknown = true;
                error.stage = stage;
                error.primaryPresent = true;
                error.rollbackErrorPresent = secondaryPresent;
                if (secondaryPresent)
                    error.rollbackError = secondary;
                onUnknown(error);
                throw error;
            }
            throw primary;
        }
    };
}
function schemaRows(sql) {
    // Trusted module DDL only; trigger CASE END is not a statement boundary.
    const pieces=sql.split(/(?=CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER) )/),out=[];
    for(let i=0;i<pieces.length;i++) {
        const text=pieces[i].trim().replace(/;+$/,'').trim();
        if(!text)continue;
        const match=/^CREATE (TABLE|(?:UNIQUE )?INDEX|TRIGGER) (\w+)/.exec(text);
        if(!match)fail('dsh_schema_invalid');
        out.push({type:match[1]==='UNIQUE INDEX'?'index':match[1].toLowerCase(),name:match[2],sql:normalized(text)});
    }
    return out;
}
export function createDshBudgetLedger({ db, transaction, ownerId, profileId, workspaceId }) {
    const one = (sql, ...args) => db.prepare(sql).get(...args), all = (sql, ...args) => db.prepare(sql).all(...args), run = (sql, ...args) => db.prepare(sql).run(...args);
    const meta = key => one('SELECT value FROM metadata WHERE key=?', key)?.value;
    const put = (key, value) => run('UPDATE metadata SET value=? WHERE key=?', String(value), key);
    let schema2 = false, schema3 = false, schema4=false,schema5=false,schema6=false,schema7=false,schema8=false,schema9=false;
    const sourceRead=createSourceReadBudget({one,all,run,ownerId,profileId,workspaceId,hasTenantSchema:()=>schema9});
    const work=createDshWorkEscrow({one,all,run,ownerId,profileId,workspaceId,pending,bump,accountingAttempt,isFinalized:(id,op)=>schema7&&one('SELECT 1 FROM dsh_budget_draft_usage_receipts WHERE reservation_id=? AND operation_key=?',id,op)});
    const draftUsage=createDshDraftUsage({one,all,run,ownerId});
    const accountEpoch=createDshAccountEpochHistory({one,all,run});
    function schema(version) {
        if (version !== '1' && version !== '2' && version !== '3' && version !== '4' && version !== '5' && version !== '6' && version !== '7' && version !== '8' && version !== '9')
            fail('dsh_schema_invalid');
        const baseVersion=version==='6'||version==='7'||version==='8'||version==='9'?'5':version;
        const expected = schemaRows(ORIGINAL_SCHEMA_SQL + (baseVersion !== '1' ? ';' + (baseVersion==='5'?conservativeDshSchema(DSH_SCHEMA_SQL):DSH_SCHEMA_SQL) : '')+(baseVersion==='3'||baseVersion==='4'||baseVersion==='5'?';'+WORK_SCHEMA_SQL:'')+((baseVersion==='4'||baseVersion==='5'&&meta('dshSourceProfile')===SOURCE_READ_PROFILE)?';'+SOURCE_SCHEMA_SQL:'')+(baseVersion==='5'?';'+CONSERVATIVE_SQL+(meta('dshSourceProfile')===SOURCE_READ_PROFILE?CONSERVATIVE_SOURCE_GUARDS:''):'')+(version==='6'||version==='7'||version==='8'||version==='9'?';'+ACCOUNT_REVISION_SQL:'')+(version==='7'||version==='8'||version==='9'?';'+DRAFT_USAGE_SQL:'')+(version==='8'||version==='9'?';'+ACCOUNT_EPOCH_SQL:'')+(version==='9'?';'+SOURCE_TENANT_SQL:''));
        const actual = all("SELECT type,name,sql,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
        if (actual.length !== expected.length)
            fail('dsh_schema_invalid');
        for (const row of expected) {
            const found = actual.find(x => x.name === row.name && x.type === row.type);
            if (!found || normalized(found.sql) !== row.sql)
                fail('dsh_schema_invalid');
        }
        for (const row of all("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'sqlite_%'"))
            if (row.type !== 'index' || row.sql !== null || !row.name.startsWith('sqlite_autoindex_' + row.tbl_name + '_') || !expected.some(x => x.type === 'table' && x.name === row.tbl_name))
                fail('dsh_schema_invalid');
        if (all('PRAGMA foreign_key_check').length)
            fail('dsh_budget_corrupt');
        schema2 = version !== '1';schema3=baseVersion==='3'||baseVersion==='4'||baseVersion==='5';schema4=baseVersion==='4'||baseVersion==='5'&&meta('dshSourceProfile')===SOURCE_READ_PROFILE;schema5=baseVersion==='5';schema6=version==='6'||version==='7'||version==='8'||version==='9';schema7=version==='7'||version==='8'||version==='9';schema8=version==='8'||version==='9';schema9=version==='9';
        if(schema9&&(meta('dshSourceTenantProfile')!==SOURCE_TENANT_PROFILE||meta('dshSourceTenantSchemaDigest')!==dshDigest('dsh-source-tenant-schema-v2',SOURCE_TENANT_SQL)))fail('dsh_schema_invalid');
        if(schema8&&(meta('dshAccountEpochProfile')!==ACCOUNT_EPOCH_PROFILE||meta('dshAccountEpochSchemaDigest')!==dshDigest('dsh-account-epoch-schema-v1',ACCOUNT_EPOCH_SQL)))fail('dsh_schema_invalid');
        if(schema7&&(meta('dshDraftUsageProfile')!==DRAFT_USAGE_PROFILE||meta('dshDraftUsageSchemaDigest')!==dshDigest('dsh-draft-usage-schema-v1',DRAFT_USAGE_SQL)))fail('dsh_schema_invalid');
        if(schema6&&(meta('dshAccountRevisionProfile')!==ACCOUNT_REVISION_PROFILE||meta('dshAccountRevisionSchemaDigest')!==dshDigest('dsh-account-revision-schema-v1',ACCOUNT_REVISION_SQL)))fail('dsh_schema_invalid');
        if(schema5&&(meta('dshConservativeProfile')!==CONSERVATIVE_PROFILE||meta('dshConservativeSchemaDigest')!==dshDigest('dsh-budget-conservative-schema-v1',CONSERVATIVE_SQL+(schema4?CONSERVATIVE_SOURCE_GUARDS:''))))fail('dsh_schema_invalid');
        if(schema4&&(meta('dshSourceProfile')!==SOURCE_READ_PROFILE||meta('dshSourceSchemaDigest')!==dshDigest('dsh-budget-source-schema-v1',SOURCE_SCHEMA_SQL)))fail('dsh_schema_invalid');
        if(schema3&&(meta('dshWorkProfile')!==WORK_ESCROW_PROFILE||meta('dshWorkSchemaDigest')!==dshDigest('dsh-budget-work-schema-v1',WORK_SCHEMA_SQL)))fail('dsh_schema_invalid');
    }
    function account(id, a) {
        const r = one('SELECT * FROM dsh_budget_accounts WHERE account_id=?', id);
        if (!r || r.owner_id !== ownerId || r.profile_id !== a.profileId || r.workspace_id !== a.workspaceId || r.tenant_id !== a.tenantId || r.mandate_id !== a.mandateId || r.mandate_revision !== a.mandateRevision || r.authorization_epoch !== a.authorizationEpoch || r.authority_hash !== a.authorityHash)
            fail('dsh_account_forbidden');
        return r;
    }
    function operations(id) {
        return all('SELECT * FROM dsh_budget_operations WHERE account_id=? ORDER BY operation_key', id);
    }
    function attempts(id) {
        return all('SELECT * FROM dsh_budget_attempts WHERE account_id=? ORDER BY operation_key,attempt_sequence', id);
    }
    const opData = r => ({
        operationKey: r.operation_key, purpose: r.purpose, inputId: r.input_id, evidenceHash: r.evidence_hash, semanticHash: r.semantic_hash, threadHash: r.thread_hash, workId: r.work_id, maxAttempts: r.max_attempts, deadline: r.deadline
    });
    const atData = r => ({
        attemptId: r.attempt_id, sequence: r.attempt_sequence, bodyHash: r.body_hash, providerId: r.provider_id, modelId: r.model_id, modelProfileId: r.model_profile_id, pricingHash: r.pricing_hash, pricingKnown: true, maxInputTokens: r.max_input_tokens, maxOutputTokens: r.max_output_tokens, maxTokens: r.max_tokens, maxCostMicros: r.max_cost, toolRounds: r.tool_rounds
    });
    function costReceipt(t){return schema5?one('SELECT * FROM dsh_budget_cost_accounting_receipts WHERE attempt_id=?',t.attempt_id):null;}
    function accountingAttempt(t){const receipt=costReceipt(t);return receipt?{...t,actual_cost:receipt.charged_cost_upper}:t;}
    function costReceipts(accountId){return all('SELECT * FROM dsh_budget_cost_accounting_receipts WHERE account_id=? ORDER BY operation_key,attempt_sequence',accountId);}
    function graph() {
        if (!schema2)
            return;
        for (const a of all('SELECT * FROM dsh_budget_accounts')) {
            if (a.owner_id !== ownerId || a.profile_id !== profileId || a.workspace_id !== workspaceId)
                fail('dsh_budget_corrupt');
            for (const key of ['account_id', 'owner_id', 'profile_id', 'workspace_id', 'tenant_id', 'mandate_id'])
                dshId(a[key]);
            dshHash(a.authority_hash);
            for (const key of ['token_limit', 'cost_limit', 'mandate_revision', 'authorization_epoch', 'revision'])
                dshInteger(a[key], 1);
            dshInteger(a.valid_until, 0, 1e15);
            if (a.currency !== 'USD' || a.scale !== 6 || (a.status !== 'active' && a.status !== 'closed'))
                fail('dsh_budget_corrupt');
            let heldTokens = 0, heldCost = 0, spentTokens = 0, spentCost = 0;
            const ops = operations(a.account_id), rows = attempts(a.account_id);
            for (const op of ops) {
                const data = opData(op);
                if (dshDigest('dsh-budget-operation-v1', data) !== op.payload_hash || op.deadline > a.valid_until)
                    fail('dsh_budget_corrupt');
                const children = rows.filter(r => r.operation_key === op.operation_key);
                if (children.length === 0 || children.length > op.max_attempts)
                    fail('dsh_budget_corrupt');
                if (children.filter(pending).length > 1)
                    fail('dsh_budget_corrupt');
                for (let i = 0; i < children.length; i++) {
                    const t = children[i], v = atData(t);
                    parseDshInput('reserve', {
                        accountId: a.account_id, operation: data, attempt: v
                    });
                    if (t.attempt_sequence !== i + 1 || dshDigest('dsh-budget-attempt-v1', v) !== t.payload_hash)
                        fail('dsh_budget_corrupt');
                    if (t.state === 'settled') {
                        dshInteger(t.actual_tokens);
                        const receipt=costReceipt(t);
                        if(t.cost_basis==='conservative_upper_bound') {
                            if(!receipt||t.actual_cost!==null||receipt.account_id!==t.account_id||receipt.operation_key!==t.operation_key||receipt.attempt_sequence!==t.attempt_sequence||receipt.actual_tokens!==t.actual_tokens||receipt.basis!=='conservative_upper_bound'||receipt.pricing_hash!==t.pricing_hash||receipt.usage_receipt_hash!==t.usage_receipt_hash||receipt.settlement_revision!==t.settlement_revision||receipt.settlement_hash!==t.settlement_hash)fail('dsh_budget_corrupt');
                            const data=parseDshInput('settle_conservative',{accountId:t.account_id,operationKey:t.operation_key,sequence:t.attempt_sequence,attemptId:t.attempt_id,actualTokens:t.actual_tokens,chargedCostUpperBoundMicros:receipt.charged_cost_upper,pricingHash:receipt.pricing_hash,usageReceiptHash:receipt.usage_receipt_hash});
                            if(dshDigest('dsh-budget-conservative-settlement-v1',data)!==t.settlement_hash)fail('dsh_budget_corrupt');
                        } else if(receipt||schema5&&t.cost_basis!=='actual')fail('dsh_budget_corrupt');
                        else dshInteger(t.actual_cost);
                        dshHash(t.usage_receipt_hash);
                        dshHash(t.settlement_hash);
                        dshInteger(t.settlement_revision, 1);
                        if (t.cost_basis!=='conservative_upper_bound'&&dshDigest('dsh-budget-settlement-v1', {
                            accountId: t.account_id, operationKey: t.operation_key, sequence: t.attempt_sequence, attemptId: t.attempt_id, actualTokens: t.actual_tokens, actualCostMicros: t.actual_cost, usageReceiptHash: t.usage_receipt_hash
                        }) !== t.settlement_hash)
                            fail('dsh_budget_corrupt');
                        spentTokens = add(spentTokens, t.actual_tokens);
                        spentCost = add(spentCost, receipt?receipt.charged_cost_upper:t.actual_cost);
                    }
                    else if (t.state === 'prepared' || t.state === 'pre_send' || t.state === 'sent' || t.state === 'unknown') {
                        heldTokens = add(heldTokens, t.max_tokens);
                        heldCost = add(heldCost, t.max_cost);
                    }
                    else if (t.state !== 'not_sent')
                        fail('dsh_budget_corrupt');
                }
            }
            if(schema3){const funds=work.graphAccount(a);heldTokens=add(heldTokens,funds.availableTokens);heldCost=add(heldCost,funds.availableCost);}
            if(schema6){
                const history=all('SELECT * FROM dsh_budget_account_revisions WHERE account_id=? ORDER BY ordinal',a.account_id);
                let previous;
                for(let i=0;i<history.length;i++){
                    const row=history[i];
                    const before=JSON.parse(row.previous_config),after=JSON.parse(row.next_config);
                    const body={accountId:a.account_id,ordinal:row.ordinal,previousMandateRevision:row.previous_mandate_revision,nextMandateRevision:row.next_mandate_revision,previousAccountRevision:row.previous_account_revision,nextAccountRevision:row.next_account_revision,previousConfig:before,nextConfig:after,spentTokens:row.spent_tokens,spentCost:row.spent_cost};
                    if(row.ordinal!==i+1||row.next_mandate_revision<=row.previous_mandate_revision||row.next_account_revision!==row.previous_account_revision+1||dshDigest('dsh-account-revision-v1',body)!==row.receipt_hash||previous&&previous.next_config!==row.previous_config||before.mandateRevision!==row.previous_mandate_revision||after.mandateRevision!==row.next_mandate_revision||a.revision<row.next_account_revision||a.spent_tokens<row.spent_tokens||a.spent_cost<row.spent_cost)fail('dsh_budget_corrupt');
                    for(const config of [before,after]){parseDshInput('open',{accountId:a.account_id,tokenLimit:config.tokenLimit,costLimitMicros:config.costLimitMicros,currency:config.currency,scale:config.scale,validUntil:config.validUntil});dshInteger(config.mandateRevision,1);}
                    if(after.tokenLimit<row.spent_tokens||after.costLimitMicros<row.spent_cost)fail('dsh_budget_corrupt');
                    previous=row;
                }
                if(previous&&previous.next_config!==JSON.stringify(accountConfig(a)))fail('dsh_budget_corrupt');
            }
            if(schema8)accountEpoch.graph(a);
            if (a.held_tokens !== heldTokens || a.held_cost !== heldCost || a.spent_tokens !== spentTokens || a.spent_cost !== spentCost)
                fail('dsh_budget_corrupt');
            if (a.status === 'active' && (add(spentTokens, heldTokens) > a.token_limit || add(spentCost, heldCost) > a.cost_limit))
                fail('dsh_budget_corrupt');
        }
        if(schema5&&all('PRAGMA foreign_key_check').length)fail('dsh_budget_corrupt');
        if(schema4)sourceRead.graph();
        if(schema7)draftUsage.graph();
    }
    function migrate() {
        schema('1');
        db.exec(DSH_SCHEMA_SQL);
        put('schemaVersion', '2');
        schema2 = true;
        schema('2');
    }
    function bump(id) {
        const r = one('SELECT revision FROM dsh_budget_accounts WHERE account_id=?', id);
        if (r.revision >= 1e12)
            fail('dsh_budget_corrupt');
        run('UPDATE dsh_budget_accounts SET revision=revision+1 WHERE account_id=?', id);
    }
    function clock(now) {
        dshInteger(now, 0, 1e15);
        const prior = Number(meta('lastSeenMs'));
        dshInteger(prior, 0, 1e15);
        if (now < prior - 2000) {
            put('clockGuard', 1);
            return false;
        }
        put('lastSeenMs', Math.max(prior, now));
        return meta('clockGuard') === '0';
    }
    function pending(t) {
        return t.state === 'prepared' || t.state === 'pre_send' || t.state === 'sent' || t.state === 'unknown';
    }
    function recover() {
        if (!schema2)
            return;
        for (const a of all('SELECT * FROM dsh_budget_accounts')) {
            let changed = false;
            for (const t of attempts(a.account_id)) {
                if (t.state === 'prepared') {
                    run("UPDATE dsh_budget_attempts SET state='not_sent' WHERE attempt_id=?", t.attempt_id);
                    if(!schema3||!work.recovered(t))run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens-?,held_cost=held_cost-? WHERE account_id=?', t.max_tokens, t.max_cost, a.account_id);
                    changed = true;
                }
                else if (t.state === 'pre_send' || t.state === 'sent') {
                    run("UPDATE dsh_budget_attempts SET state='unknown' WHERE attempt_id=?", t.attempt_id);
                    changed = true;
                }
            }
            if (changed)
                bump(a.account_id);
        }
        if(schema3)work.recoverHeads();
        if(schema4)sourceRead.recover();
        graph();
    }
    function status(id, a) {
        const r = account(id, a);
        const result={account:r,operations:operations(id),attempts:attempts(id),workCapacity:schema3?work.capacity(id):null};
        if(schema5)result.costAccountingReceipts=costReceipts(id).map(row=>({accountId:row.account_id,operationKey:row.operation_key,attemptId:row.attempt_id,sequence:row.attempt_sequence,basis:row.basis,actualTokens:row.actual_tokens,chargedCostUpperBoundMicros:row.charged_cost_upper,pricingHash:row.pricing_hash,usageReceiptHash:row.usage_receipt_hash,settlementRevision:row.settlement_revision}));
        return result;
    }
    function accountConfig(a){return {mandateRevision:a.mandate_revision,tokenLimit:a.token_limit,costLimitMicros:a.cost_limit,validUntil:a.valid_until,currency:a.currency,scale:a.scale};}
    function migrateAccountRevision(){
        if(schema6)return;
        migrateConservative();
        if(!schema4){
            db.exec(SOURCE_SCHEMA_SQL+CONSERVATIVE_SOURCE_GUARDS);
            run('INSERT INTO metadata VALUES(?,?)','dshSourceProfile',SOURCE_READ_PROFILE);
            run('INSERT INTO metadata VALUES(?,?)','dshSourceSchemaDigest',dshDigest('dsh-budget-source-schema-v1',SOURCE_SCHEMA_SQL));
            put('dshConservativeSchemaDigest',dshDigest('dsh-budget-conservative-schema-v1',CONSERVATIVE_SQL+CONSERVATIVE_SOURCE_GUARDS));
            schema('5');graph();
        }
        db.exec(ACCOUNT_REVISION_SQL);put('schemaVersion','6');
        run('INSERT INTO metadata VALUES(?,?)','dshAccountRevisionProfile',ACCOUNT_REVISION_PROFILE);
        run('INSERT INTO metadata VALUES(?,?)','dshAccountRevisionSchemaDigest',dshDigest('dsh-account-revision-schema-v1',ACCOUNT_REVISION_SQL));
        schema('6');graph();
    }
    function migrateDraftUsage(){
        if(schema7)return;
        migrateAccountRevision();db.exec(DRAFT_USAGE_SQL);put('schemaVersion','7');
        run('INSERT INTO metadata VALUES(?,?)','dshDraftUsageProfile',DRAFT_USAGE_PROFILE);
        run('INSERT INTO metadata VALUES(?,?)','dshDraftUsageSchemaDigest',dshDigest('dsh-draft-usage-schema-v1',DRAFT_USAGE_SQL));
        schema('7');graph();
    }
    function migrateAccountEpoch(){
        if(schema8)return;
        migrateDraftUsage();db.exec(ACCOUNT_EPOCH_SQL);
        // Snapshot actual pre-migration rows; no caller chooses this baseline.
        for(const row of all('SELECT * FROM dsh_budget_accounts'))accountEpoch.anchor(row);
        run('INSERT INTO metadata VALUES(?,?)','dshAccountEpochProfile',ACCOUNT_EPOCH_PROFILE);
        run('INSERT INTO metadata VALUES(?,?)','dshAccountEpochSchemaDigest',dshDigest('dsh-account-epoch-schema-v1',ACCOUNT_EPOCH_SQL));
        put('schemaVersion','8');schema('8');graph();
    }
    function migrateSourceTenant(){
        if(schema9)return;
        migrateAccountEpoch();db.exec(SOURCE_TENANT_SQL);
        run('INSERT INTO metadata VALUES(?,?)','dshSourceTenantProfile',SOURCE_TENANT_PROFILE);
        run('INSERT INTO metadata VALUES(?,?)','dshSourceTenantSchemaDigest',dshDigest('dsh-source-tenant-schema-v2',SOURCE_TENANT_SQL));
        put('schemaVersion','9');schema('9');graph();
    }
    function reviseAccount(prior,v,a,now){
        if(prior.account_id!==v.accountId)fail('dsh_account_conflict');
        if(prior.owner_id!==ownerId||a.authorizationEpoch!==prior.authorization_epoch+1||prior.authority_hash!==a.authorityHash||prior.currency!==v.currency||prior.scale!==v.scale)fail('dsh_account_forbidden');
        if(a.mandateRevision<=prior.mandate_revision)fail('dsh_account_forbidden');
        if(prior.status!=='active'||prior.held_tokens||prior.held_cost||one("SELECT 1 FROM dsh_budget_attempts WHERE account_id=? AND state IN ('prepared','pre_send','sent','unknown')",v.accountId)||schema3&&one("SELECT 1 FROM dsh_budget_work_heads h JOIN dsh_budget_work_reservations r USING(reservation_id) WHERE r.account_id=? AND h.state!='closed'",v.accountId))fail('dsh_account_revision_busy');
        if(v.tokenLimit<prior.spent_tokens||v.costLimitMicros<prior.spent_cost||v.validUntil<=now)fail('dsh_account_revision_limits');
        migrateAccountEpoch();
        const ordinal=one('SELECT COUNT(*) AS n FROM dsh_budget_account_revisions WHERE account_id=?',v.accountId).n+1;
        const before=accountConfig(prior),after={mandateRevision:a.mandateRevision,tokenLimit:v.tokenLimit,costLimitMicros:v.costLimitMicros,validUntil:v.validUntil,currency:v.currency,scale:v.scale};
        const nextRevision=add(prior.revision,1);
        const body={accountId:v.accountId,ordinal,previousMandateRevision:prior.mandate_revision,nextMandateRevision:a.mandateRevision,previousAccountRevision:prior.revision,nextAccountRevision:nextRevision,previousConfig:before,nextConfig:after,spentTokens:prior.spent_tokens,spentCost:prior.spent_cost};
        const revisionHash=dshDigest('dsh-account-revision-v1',body);
        run('INSERT INTO dsh_budget_account_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)',v.accountId,ordinal,prior.mandate_revision,a.mandateRevision,prior.revision,nextRevision,JSON.stringify(before),JSON.stringify(after),prior.spent_tokens,prior.spent_cost,revisionHash);
        accountEpoch.advance(prior,a,nextRevision,revisionHash);
        const changed=run('UPDATE dsh_budget_accounts SET mandate_revision=?,authorization_epoch=?,token_limit=?,cost_limit=?,valid_until=?,revision=? WHERE account_id=? AND revision=? AND mandate_revision=? AND authorization_epoch=?',a.mandateRevision,a.authorizationEpoch,v.tokenLimit,v.costLimitMicros,v.validUntil,nextRevision,v.accountId,prior.revision,prior.mandate_revision,prior.authorization_epoch);
        if(changed.changes!==1)fail('dsh_account_revision_conflict');
        graph();return status(v.accountId,a);
    }
    function migrateConservative(){
        if(schema5)return;
        const prior=meta('schemaVersion');schema(prior);graph();
        if(!schema3){db.exec(WORK_SCHEMA_SQL);put('schemaVersion','3');run('INSERT INTO metadata VALUES(?,?)','dshWorkProfile',WORK_ESCROW_PROFILE);run('INSERT INTO metadata VALUES(?,?)','dshWorkSchemaDigest',dshDigest('dsh-budget-work-schema-v1',WORK_SCHEMA_SQL));schema('3');}
        const priorAttempts=all('SELECT * FROM dsh_budget_attempts'),priorEdges=all('SELECT * FROM dsh_budget_work_attempts');
        // Both referencing tables are rebuilt in the original transaction with
        // foreign_keys still ON. No global pragma or second writer is used.
        db.exec('DROP TABLE dsh_budget_work_attempts');db.exec('DROP TABLE dsh_budget_attempts');
        const nativeSchema=schemaRows(conservativeDshSchema(DSH_SCHEMA_SQL)),attempt=nativeSchema.find(row=>row.name==='dsh_budget_attempts');db.exec(attempt.sql);
        for (const row of nativeSchema)
            if (row.type === 'index' && row.name === 'dsh_budget_attempts_state') db.exec(row.sql);
        const columns=['account_id','operation_key','attempt_sequence','attempt_id','body_hash','provider_id','model_id','model_profile_id','pricing_hash','max_input_tokens','max_output_tokens','max_tokens','max_cost','tool_rounds','payload_hash','state','actual_tokens','actual_cost','usage_receipt_hash','settlement_hash','settlement_revision'];
        for(let i=0;i<priorAttempts.length;i++){const row=priorAttempts[i],values=[];for(let j=0;j<columns.length;j++)values.push(row[columns[j]]);run('INSERT INTO dsh_budget_attempts('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...values);}
        const workRows=schemaRows(WORK_SCHEMA_SQL);
        for(let i=0;i<workRows.length;i++){const row=workRows[i];if(row.name==='dsh_budget_work_attempts'||row.name==='dsh_budget_work_attempts_reservation'||row.name.startsWith('dsh_v3_dsh_budget_attempts_')||row.name.startsWith('dsh_v3_dsh_budget_work_attempts_')||row.name==='dsh_v3_work_attempt_transition'||row.name==='dsh_v3_work_attempt_no_delete')db.exec(row.sql);}
        for(let i=0;i<priorEdges.length;i++){const e=priorEdges[i];run('INSERT INTO dsh_budget_work_attempts VALUES(?,?,?,?,?,?)',e.account_id,e.operation_key,e.attempt_sequence,e.reservation_id,e.work_sequence,e.charged);}
        if(schema4){const rows=schemaRows(SOURCE_SCHEMA_SQL);for(let i=0;i<rows.length;i++)if(rows[i].name.startsWith('dsh_v4_dsh_budget_attempts_')||rows[i].name.startsWith('dsh_v4_dsh_budget_work_attempts_'))db.exec(rows[i].sql);}
        db.exec(CONSERVATIVE_SQL+(schema4?CONSERVATIVE_SOURCE_GUARDS:''));put('schemaVersion','5');
        run('INSERT INTO metadata VALUES(?,?)','dshConservativeProfile',CONSERVATIVE_PROFILE);run('INSERT INTO metadata VALUES(?,?)','dshConservativeSchemaDigest',dshDigest('dsh-budget-conservative-schema-v1',CONSERVATIVE_SQL+(schema4?CONSERVATIVE_SOURCE_GUARDS:'')));
        schema('5');graph();
    }
    function executeSourceRead(purpose,payload) {
        const wrapper=dshRecord(payload,['input','authority','now','existing']);
        const a=dshRecord(wrapper.authority,['requestSource','profileId','workspaceId','accountId','identity','commandDigest']);
        const identity=parseSourceIdentity(a.identity),v=parseSourceReadInput(purpose,wrapper.input);
        if(a.profileId!==profileId||a.workspaceId!==workspaceId||identity.kind==='source_setup'&&a.requestSource!=='user'||identity.kind==='source_binding'&&a.requestSource!=='scheduler')fail('dsh_source_authority_required');
        if(dshSourceReadCommandDigest(purpose,v)!==a.commandDigest)fail('dsh_source_authority_required');
        const accountId=purpose==='source_read_settle'?wrapper.existing?.accountId:v.accountId;
        if(accountId!==a.accountId)fail('dsh_source_account_forbidden');
        schema(meta('schemaVersion'));
        let rejectedClock=false;
        const result=transaction(()=>{
            if(purpose!=='source_read_settle'&&!clock(wrapper.now)){rejectedClock=true;return null;}
            if(!schema4) {
                if(purpose==='source_read_migrate')return {disposition:'not_required',transition:null};
                if(purpose!=='source_read_scan')fail('dsh_source_scan_required');
                if(!schema2)migrate();
                graph();
                if(one("SELECT 1 FROM dsh_budget_attempts WHERE state IN ('prepared','pre_send','sent','unknown')"))fail('dsh_work_migration_busy');
                if(!schema3){schema('2');db.exec(WORK_SCHEMA_SQL);put('schemaVersion','3');run('INSERT INTO metadata VALUES(?,?)','dshWorkProfile',WORK_ESCROW_PROFILE);run('INSERT INTO metadata VALUES(?,?)','dshWorkSchemaDigest',dshDigest('dsh-budget-work-schema-v1',WORK_SCHEMA_SQL));schema('3');}
                db.exec(SOURCE_SCHEMA_SQL);if(!schema5)put('schemaVersion','4');else db.exec(CONSERVATIVE_SOURCE_GUARDS);
                run('INSERT INTO metadata VALUES(?,?)','dshSourceProfile',SOURCE_READ_PROFILE);run('INSERT INTO metadata VALUES(?,?)','dshSourceSchemaDigest',dshDigest('dsh-budget-source-schema-v1',SOURCE_SCHEMA_SQL));if(schema5){put('dshConservativeSchemaDigest',dshDigest('dsh-budget-conservative-schema-v1',CONSERVATIVE_SQL+CONSERVATIVE_SOURCE_GUARDS));schema('5');}else schema('4');
            }
            if(identity.kind==='source_setup'&&identity.identityVersion===2)migrateSourceTenant();
            graph();
            const result=sourceRead.execute(purpose,v,identity,wrapper.now,Number(meta('epoch')),wrapper.existing);
            graph();return result;
        });
        if(rejectedClock)fail('clock_rollback');
        return result;
    }
    function execute(purpose, payload, receiptKind) {
        schema(meta('schemaVersion'));
        const wrapper = dshRecord(payload, ['input', 'authority', 'now']), a = parseDshAuthority(wrapper.authority);
        checkDshSource(purpose, a);
        if (a.profileId !== profileId || a.workspaceId !== workspaceId)
            fail('dsh_account_forbidden');
        const v = parseDshInput(purpose, wrapper.input);
        if (dshBudgetCommandDigest(purpose, v) !== a.commandDigest)
            fail('dsh_actor_forbidden');
        if(purpose==='draft_finalize')return transaction(()=>{
            if(!schema3)fail('dsh_work_reservation_required');graph();account(v.accountId,a);
            migrateDraftUsage();
            const result=draftUsage.finalize(v);graph();return result;
        });
        if(purpose==='work_read')return transaction(()=>{
            if(!schema2)fail('dsh_account_unavailable');graph();
            const metadata=schema3?work.snapshot(v):{state:'not_observed',reservation:null,head:null,attestation:null,commandReceipt:null,closureBasis:null};
            return {schemaVersion:1,kind:'work_snapshot',accountId:v.accountId,...metadata,status:status(v.accountId,a)};
        });
        if (purpose === 'read') {
            if (!schema2)
                fail('dsh_account_unavailable');
            if (receiptKind === 'observation') {
                return transaction(() => { graph(); return { schemaVersion: 1, kind: 'ledger_observation', status: status(v.accountId, a) }; });
            }
            graph();
            return status(v.accountId, a);
        }
        if(receiptKind==='draft_attempt'&&(purpose!=='reserve'||v.operation.purpose!=='draft'||!v.operation.workId||!schema3))fail('dsh_draft_attempt_required');
        if (receiptKind === 'attempt' && (purpose !== 'reserve' || v.operation.purpose === 'draft' || v.operation.workId !== null)) fail('dsh_workless_attempt_required');
        let newlyReserved = false;
        let rejectedClock = false;
        const result = transaction(() => {
            if (purpose === 'open' || purpose === 'reserve' || purpose === 'marker' || purpose === 'work_policy' || purpose==='work_policy_sync' || purpose === 'work_reserve')
                if (!clock(wrapper.now)) {
                    rejectedClock = true;
                    return null;
                }
            if (!schema2) {
                if (purpose !== 'open')
                    fail('dsh_account_unavailable');
                migrate();
            }
            graph();
            if((purpose==='work_policy'||purpose==='work_policy_sync')&&!schema3) {
                if(one("SELECT 1 FROM dsh_budget_attempts WHERE state IN ('prepared','pre_send','sent','unknown')"))fail('dsh_work_migration_busy');
                schema('2');db.exec(WORK_SCHEMA_SQL);put('schemaVersion','3');
                run('INSERT INTO metadata(key,value) VALUES(?,?)','dshWorkProfile',WORK_ESCROW_PROFILE);
                run('INSERT INTO metadata(key,value) VALUES(?,?)','dshWorkSchemaDigest',dshDigest('dsh-budget-work-schema-v1',WORK_SCHEMA_SQL));
                schema('3');graph();
            }
            if(purpose==='work_reserve'&&!schema3)fail('dsh_work_policy_required');
            if((purpose==='work_bind'||purpose==='work_close')&&!schema3)fail('dsh_work_reservation_required');
            if (purpose === 'open') {
                const prior = one('SELECT * FROM dsh_budget_accounts WHERE profile_id=? AND workspace_id=? AND tenant_id=? AND mandate_id=?', a.profileId, a.workspaceId, a.tenantId, a.mandateId);
                if (prior) {
                    if(prior.account_id!==v.accountId)fail('dsh_account_conflict');
                    if(prior.mandate_revision!==a.mandateRevision)return reviseAccount(prior,v,a,wrapper.now);
                    account(prior.account_id, a);
                    if (prior.account_id !== v.accountId || prior.token_limit !== v.tokenLimit || prior.cost_limit !== v.costLimitMicros || prior.currency !== v.currency || prior.scale !== v.scale || prior.valid_until !== v.validUntil)
                        fail('dsh_account_conflict');
                    return status(v.accountId, a);
                }
                if (v.validUntil <= wrapper.now)
                    fail('dsh_budget_expired');
                run("INSERT INTO dsh_budget_accounts(account_id,owner_id,profile_id,workspace_id,tenant_id,mandate_id,mandate_revision,authorization_epoch,authority_hash,currency,scale,token_limit,cost_limit,revision,status,valid_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',?)", v.accountId, ownerId, a.profileId, a.workspaceId, a.tenantId, a.mandateId, a.mandateRevision, a.authorizationEpoch, a.authorityHash, v.currency, v.scale, v.tokenLimit, v.costLimitMicros, v.validUntil);
                if(schema8)accountEpoch.anchor(account(v.accountId,a));
                return status(v.accountId, a);
            }
            if(purpose==='settle_conservative')migrateConservative();
            const ac = account(v.accountId, a);
            if(purpose==='work_policy'||purpose==='work_policy_sync') {const result=work.configure(v,a);graph();return result;}
            if(purpose==='work_reserve') {const result=work.reserve(v,a,ac,wrapper.now,Number(meta('epoch')));graph();return {...result,status:status(v.accountId,a)};}
            if(purpose==='work_bind') {const result=work.bind(v);graph();return result;}
            if(purpose==='work_close') {const result=work.close(v);graph();return result;}
            if (purpose === 'reserve') {
                const op = v.operation, at = v.attempt, opHash = dshDigest('dsh-budget-operation-v1', op), atHash = dshDigest('dsh-budget-attempt-v1', at);
                const oldOp = one('SELECT * FROM dsh_budget_operations WHERE account_id=? AND operation_key=?', v.accountId, op.operationKey), old = one('SELECT * FROM dsh_budget_attempts WHERE account_id=? AND operation_key=? AND attempt_sequence=?', v.accountId, op.operationKey, at.sequence);
                if (oldOp && oldOp.payload_hash !== opHash)
                    fail('dsh_operation_conflict');
                if (old) {
                    if (old.payload_hash !== atHash)
                        fail('dsh_attempt_conflict');
                    return status(v.accountId, a);
                }
                if (ac.status !== 'active' || wrapper.now >= ac.valid_until || wrapper.now >= op.deadline || op.deadline > ac.valid_until)
                    fail('dsh_budget_expired');
                const oldRows = all('SELECT * FROM dsh_budget_attempts WHERE account_id=? AND operation_key=?', v.accountId, op.operationKey);
                if (oldRows.some(pending) || at.sequence !== oldRows.length + 1 || at.sequence > op.maxAttempts)
                    fail('dsh_attempt_order');
                const allocation=schema3?work.allocate(ac,op,at):null;
                if (!allocation&&(add(add(ac.spent_tokens, ac.held_tokens), at.maxTokens) > ac.token_limit || add(add(ac.spent_cost, ac.held_cost), at.maxCostMicros) > ac.cost_limit))
                    fail('dsh_budget_insufficient');
                if (!oldOp)
                    run('INSERT INTO dsh_budget_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)', v.accountId, op.operationKey, op.purpose, op.inputId, op.evidenceHash, op.semanticHash, op.threadHash, op.workId, op.maxAttempts, op.deadline, opHash);
                run("INSERT INTO dsh_budget_attempts(account_id,operation_key,attempt_sequence,attempt_id,body_hash,provider_id,model_id,model_profile_id,pricing_hash,max_input_tokens,max_output_tokens,max_tokens,max_cost,tool_rounds,payload_hash,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'prepared')", v.accountId, op.operationKey, at.sequence, at.attemptId, at.bodyHash, at.providerId, at.modelId, at.modelProfileId, at.pricingHash, at.maxInputTokens, at.maxOutputTokens, at.maxTokens, at.maxCostMicros, at.toolRounds, atHash);
                if(allocation)work.allocated(allocation,v);
                else run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens+?,held_cost=held_cost+? WHERE account_id=?', at.maxTokens, at.maxCostMicros, v.accountId);
                bump(v.accountId);
                newlyReserved = true;
            }
            else {
                const t = one('SELECT * FROM dsh_budget_attempts WHERE account_id=? AND operation_key=? AND attempt_sequence=?', v.accountId, v.operationKey, v.sequence);
                if (!t || t.attempt_id !== v.attemptId)
                    fail('dsh_attempt_forbidden');
                if (purpose === 'settle_conservative') {
                    const hash=dshDigest('dsh-budget-conservative-settlement-v1',v),old=costReceipt(t);
                    if(old){if(old.settlement_hash!==hash)fail('dsh_usage_conflict');return status(v.accountId,a);}
                    if(t.state!=='pre_send'&&t.state!=='sent'&&t.state!=='unknown')fail('dsh_attempt_state');
                    if(v.pricingHash!==t.pricing_hash)fail('dsh_usage_pricing_conflict');
                    run('INSERT INTO dsh_budget_cost_accounting_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)',v.accountId,v.operationKey,v.attemptId,v.sequence,'conservative_upper_bound',v.actualTokens,v.chargedCostUpperBoundMicros,v.pricingHash,v.usageReceiptHash,1,hash);
                    run("UPDATE dsh_budget_attempts SET state='settled',actual_tokens=?,actual_cost=NULL,cost_basis='conservative_upper_bound',usage_receipt_hash=?,settlement_hash=?,settlement_revision=1 WHERE attempt_id=?",v.actualTokens,v.usageReceiptHash,hash,t.attempt_id);
                    const charged={actualTokens:v.actualTokens,actualCostMicros:v.chargedCostUpperBoundMicros},parent=schema3?work.settled(t,charged):null,overrun=v.actualTokens>t.max_tokens||v.chargedCostUpperBoundMicros>t.max_cost;
                    run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens-?,held_cost=held_cost-?,spent_tokens=?,spent_cost=?,status=?,close_reason=? WHERE account_id=?',parent?parent.heldTokens:t.max_tokens,parent?parent.heldCost:t.max_cost,add(ac.spent_tokens,v.actualTokens),add(ac.spent_cost,v.chargedCostUpperBoundMicros),overrun?'closed':ac.status,overrun?'overrun':ac.close_reason,v.accountId);bump(v.accountId);
                }
                else if (purpose === 'settle') {
                    if(t.cost_basis==='conservative_upper_bound')fail('dsh_usage_basis_conflict');
                    const h = dshDigest('dsh-budget-settlement-v1', v);
                    if (t.state === 'settled') {
                        if (h !== t.settlement_hash || t.actual_tokens !== v.actualTokens || t.actual_cost !== v.actualCostMicros)
                            fail('dsh_usage_conflict');
                        return status(v.accountId, a);
                    }
                    if (t.state !== 'pre_send' && t.state !== 'sent' && t.state !== 'unknown')
                        fail('dsh_attempt_state');
                    const spentTokens = add(ac.spent_tokens, v.actualTokens), spentCost = add(ac.spent_cost, v.actualCostMicros), overrun = v.actualTokens > t.max_tokens || v.actualCostMicros > t.max_cost;
                    run("UPDATE dsh_budget_attempts SET state='settled',actual_tokens=?,actual_cost=?,usage_receipt_hash=?,settlement_hash=?,settlement_revision=1 WHERE attempt_id=?", v.actualTokens, v.actualCostMicros, v.usageReceiptHash, h, t.attempt_id);
                    const parentDebit=schema3?work.settled(t,v):null;
                    run('UPDATE dsh_budget_accounts SET held_tokens=held_tokens-?,held_cost=held_cost-?,spent_tokens=?,spent_cost=?,status=?,close_reason=? WHERE account_id=?', parentDebit?parentDebit.heldTokens:t.max_tokens, parentDebit?parentDebit.heldCost:t.max_cost, spentTokens, spentCost, overrun ? 'closed' : ac.status, overrun ? 'overrun' : ac.close_reason, v.accountId);
                    bump(v.accountId);
                }
                else if (purpose === 'unknown') {
                    if (t.state === 'prepared')
                        fail('dsh_attempt_state');
                    if (t.state === 'pre_send' || t.state === 'sent') {
                        run("UPDATE dsh_budget_attempts SET state='unknown' WHERE attempt_id=?", t.attempt_id);
                        bump(v.accountId);
                    }
                }
                else {
                    if (t.body_hash !== v.bodyHash)
                        fail('dsh_attempt_conflict');
                    const target = purpose === 'marker' ? 'pre_send' : 'sent';
                    if (t.state === 'not_sent' || (purpose === 'sent' && t.state === 'prepared'))
                        fail('dsh_attempt_state');
                    if ((purpose === 'marker' && t.state === 'prepared') || (purpose === 'sent' && t.state === 'pre_send')) {
                        const op = one('SELECT deadline FROM dsh_budget_operations WHERE account_id=? AND operation_key=?', v.accountId, v.operationKey);
                        if (ac.status !== 'active' || wrapper.now >= ac.valid_until || wrapper.now >= op.deadline)
                            fail('dsh_budget_expired');
                        run('UPDATE dsh_budget_attempts SET state=? WHERE attempt_id=?', target, t.attempt_id);
                        bump(v.accountId);
                    }
                }
            }
            graph();
            return status(v.accountId, a);
        });
        if (rejectedClock)
            fail('clock_rollback');
        if (receiptKind === 'attempt'||receiptKind==='draft_attempt') return { schemaVersion: 1, kind: receiptKind==='draft_attempt'?'draft_attempt_receipt':'workless_attempt_receipt', accountId: v.accountId, operationKey: v.operation.operationKey, attemptId: v.attempt.attemptId, sequence: v.attempt.sequence, disposition: newlyReserved ? 'newly_reserved' : 'existing', status: result };
        return result;
    }
    return {
        executeSourceRead,
        observeReceipt(payload) { return execute('read', payload, 'observation'); },
        reserveAttemptReceipt(payload) { return execute('reserve', payload, 'attempt'); },
        reserveDraftAttemptReceipt(payload) {return execute('reserve',payload,'draft_attempt');},
        schema, graph, recover, execute, isSchema2: () => {
            // Known rollback can undo the tentative first migration. This
            // original connection remains the fact source. Unknown transaction
            // fate is rejected by the worker before this callback is reached.
            const version = meta('schemaVersion'),baseVersion=version==='6'||version==='7'||version==='8'||version==='9'?'5':version;
            if (version !== '1' && version !== '2' && version !== '3' && version !== '4' && version !== '5' && version !== '6' && version !== '7' && version !== '8' && version !== '9')
                fail('dsh_schema_invalid');
            schema2 = version !== '1';schema3=baseVersion==='3'||baseVersion==='4'||baseVersion==='5';schema4=baseVersion==='4'||baseVersion==='5'&&meta('dshSourceProfile')===SOURCE_READ_PROFILE;schema5=baseVersion==='5';schema6=version==='6'||version==='7'||version==='8'||version==='9';schema7=version==='7'||version==='8'||version==='9';schema8=version==='8'||version==='9';schema9=version==='9';
        if(schema9&&(meta('dshSourceTenantProfile')!==SOURCE_TENANT_PROFILE||meta('dshSourceTenantSchemaDigest')!==dshDigest('dsh-source-tenant-schema-v2',SOURCE_TENANT_SQL)))fail('dsh_schema_invalid');
        if(schema8&&(meta('dshAccountEpochProfile')!==ACCOUNT_EPOCH_PROFILE||meta('dshAccountEpochSchemaDigest')!==dshDigest('dsh-account-epoch-schema-v1',ACCOUNT_EPOCH_SQL)))fail('dsh_schema_invalid');
        if(schema7&&(meta('dshDraftUsageProfile')!==DRAFT_USAGE_PROFILE||meta('dshDraftUsageSchemaDigest')!==dshDigest('dsh-draft-usage-schema-v1',DRAFT_USAGE_SQL)))fail('dsh_schema_invalid');
        if(schema6&&(meta('dshAccountRevisionProfile')!==ACCOUNT_REVISION_PROFILE||meta('dshAccountRevisionSchemaDigest')!==dshDigest('dsh-account-revision-schema-v1',ACCOUNT_REVISION_SQL)))fail('dsh_schema_invalid');
        if(schema5&&(meta('dshConservativeProfile')!==CONSERVATIVE_PROFILE||meta('dshConservativeSchemaDigest')!==dshDigest('dsh-budget-conservative-schema-v1',CONSERVATIVE_SQL+(schema4?CONSERVATIVE_SOURCE_GUARDS:''))))fail('dsh_schema_invalid');
        if(schema4&&(meta('dshSourceProfile')!==SOURCE_READ_PROFILE||meta('dshSourceSchemaDigest')!==dshDigest('dsh-budget-source-schema-v1',SOURCE_SCHEMA_SQL)))fail('dsh_schema_invalid');
        if(schema3&&(meta('dshWorkProfile')!==WORK_ESCROW_PROFILE||meta('dshWorkSchemaDigest')!==dshDigest('dsh-budget-work-schema-v1',WORK_SCHEMA_SQL)))fail('dsh_schema_invalid');
            return schema2;
        }
    };
}
export const DSH_SCHEMA_SQL = `
CREATE TABLE dsh_budget_accounts (
 account_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 mandate_id TEXT NOT NULL, mandate_revision INTEGER NOT NULL CHECK(typeof(mandate_revision)='integer' AND mandate_revision BETWEEN 1 AND 1000000000000),
 authorization_epoch INTEGER NOT NULL CHECK(typeof(authorization_epoch)='integer' AND authorization_epoch BETWEEN 1 AND 1000000000000),
 authority_hash TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='USD'), scale INTEGER NOT NULL CHECK(scale=6),
 token_limit INTEGER NOT NULL CHECK(typeof(token_limit)='integer' AND token_limit BETWEEN 1 AND 1000000000000),
 cost_limit INTEGER NOT NULL CHECK(typeof(cost_limit)='integer' AND cost_limit BETWEEN 1 AND 1000000000000),
 spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spent_tokens)='integer' AND spent_tokens>=0),
 held_tokens INTEGER NOT NULL DEFAULT 0 CHECK(typeof(held_tokens)='integer' AND held_tokens>=0),
 spent_cost INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spent_cost)='integer' AND spent_cost>=0),
 held_cost INTEGER NOT NULL DEFAULT 0 CHECK(typeof(held_cost)='integer' AND held_cost>=0),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 1000000000000),
 status TEXT NOT NULL CHECK(status IN ('active','closed')),
 close_reason TEXT,
 valid_until INTEGER NOT NULL CHECK(typeof(valid_until)='integer' AND valid_until BETWEEN 0 AND 1000000000000000),
 UNIQUE(profile_id,workspace_id,tenant_id,mandate_id)
);
CREATE TABLE dsh_budget_operations (
 account_id TEXT NOT NULL REFERENCES dsh_budget_accounts(account_id),
 operation_key TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('assessment','preview','draft')),
 input_id TEXT NOT NULL, evidence_hash TEXT NOT NULL, semantic_hash TEXT NOT NULL, thread_hash TEXT NOT NULL,
 work_id TEXT, max_attempts INTEGER NOT NULL CHECK(typeof(max_attempts)='integer' AND max_attempts BETWEEN 1 AND 64),
 deadline INTEGER NOT NULL CHECK(typeof(deadline)='integer' AND deadline BETWEEN 0 AND 1000000000000000),
 payload_hash TEXT NOT NULL,
 PRIMARY KEY(account_id,operation_key),
 CHECK((purpose='draft' AND work_id IS NOT NULL) OR (purpose IN ('assessment','preview') AND work_id IS NULL))
);
CREATE TABLE dsh_budget_attempts (
 account_id TEXT NOT NULL, operation_key TEXT NOT NULL,
 attempt_sequence INTEGER NOT NULL CHECK(typeof(attempt_sequence)='integer' AND attempt_sequence BETWEEN 1 AND 64),
 attempt_id TEXT NOT NULL UNIQUE,
 body_hash TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, model_profile_id TEXT NOT NULL,
 pricing_hash TEXT NOT NULL,
 max_input_tokens INTEGER NOT NULL CHECK(typeof(max_input_tokens)='integer' AND max_input_tokens BETWEEN 1 AND 1000000000000),
 max_output_tokens INTEGER NOT NULL CHECK(typeof(max_output_tokens)='integer' AND max_output_tokens BETWEEN 1 AND 1000000000000),
 max_tokens INTEGER NOT NULL CHECK(typeof(max_tokens)='integer' AND max_tokens BETWEEN 1 AND 1000000000000),
 max_cost INTEGER NOT NULL CHECK(typeof(max_cost)='integer' AND max_cost BETWEEN 1 AND 1000000000000),
 tool_rounds INTEGER NOT NULL CHECK(tool_rounds=0),
 payload_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','pre_send','sent','unknown','settled','not_sent')),
 actual_tokens INTEGER CHECK(actual_tokens IS NULL OR (typeof(actual_tokens)='integer' AND actual_tokens>=0)),
 actual_cost INTEGER CHECK(actual_cost IS NULL OR (typeof(actual_cost)='integer' AND actual_cost>=0)),
 usage_receipt_hash TEXT, settlement_hash TEXT,
 settlement_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(settlement_revision)='integer' AND settlement_revision BETWEEN 0 AND 1000000000000),
 PRIMARY KEY(account_id,operation_key,attempt_sequence),
 FOREIGN KEY(account_id,operation_key) REFERENCES dsh_budget_operations(account_id,operation_key),
 CHECK(max_tokens=max_input_tokens+max_output_tokens),
 CHECK((state='settled' AND actual_tokens IS NOT NULL AND actual_cost IS NOT NULL AND settlement_hash IS NOT NULL AND usage_receipt_hash IS NOT NULL AND settlement_revision>0)
    OR (state<>'settled' AND actual_tokens IS NULL AND actual_cost IS NULL AND settlement_hash IS NULL AND usage_receipt_hash IS NULL AND settlement_revision=0))
);
CREATE INDEX dsh_budget_attempts_state ON dsh_budget_attempts(account_id,state);
`;
const ORIGINAL_SCHEMA_SQL = `
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE config(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
        CREATE TABLE intents(id TEXT PRIMARY KEY,manifestId TEXT NOT NULL,hash TEXT NOT NULL,runId TEXT);
        CREATE TABLE runs(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,manifestHash TEXT NOT NULL,bindingHash TEXT NOT NULL,day TEXT NOT NULL,deadline INTEGER NOT NULL,status TEXT NOT NULL,remainingTokens INTEGER NOT NULL,remainingRequests INTEGER NOT NULL,reason TEXT);
        CREATE TABLE grants(runId TEXT PRIMARY KEY,state TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL);
        CREATE TABLE request_attempts(id TEXT PRIMARY KEY,runId TEXT NOT NULL,stepId TEXT NOT NULL,bodyHash TEXT NOT NULL,tokens INTEGER NOT NULL,nonce TEXT NOT NULL,status TEXT NOT NULL,usage TEXT,preSend INTEGER NOT NULL DEFAULT 0,sendStarted INTEGER NOT NULL DEFAULT 0,UNIQUE(runId,stepId));
        CREATE TABLE daily_budget(day TEXT PRIMARY KEY,usedTokens INTEGER NOT NULL DEFAULT 0,reservedTokens INTEGER NOT NULL DEFAULT 0,usedRequests INTEGER NOT NULL DEFAULT 0,reservedRequests INTEGER NOT NULL DEFAULT 0,guidanceUsed INTEGER NOT NULL DEFAULT 0,guidanceReserved INTEGER NOT NULL DEFAULT 0,CHECK(reservedTokens>=0 AND reservedRequests>=0));
        CREATE TABLE formal_trials(ownerId TEXT PRIMARY KEY,manifestHash TEXT NOT NULL,spent INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE applied_operations(id TEXT PRIMARY KEY,summary TEXT NOT NULL);
        CREATE TABLE disabled_bindings(hash TEXT PRIMARY KEY);
        CREATE TABLE forward_steps(id TEXT PRIMARY KEY,beforeMark INTEGER NOT NULL,afterMark INTEGER NOT NULL,activitySeq INTEGER NOT NULL,consumed INTEGER NOT NULL);
`;
