import { dshFail as fail, dshDigest, dshRecord, dshInteger, dshHash, dshId, parseDshInput } from './harness-dsh-budget-data.mjs';
export const DRAFT_USAGE_PROFILE = 'harness_dsh_draft_usage_v1';
const tables = ['dsh_budget_accounts', 'dsh_budget_operations', 'dsh_budget_attempts', 'dsh_budget_work_policies', 'dsh_budget_work_reservations', 'dsh_budget_work_heads', 'dsh_budget_work_attempts', 'dsh_budget_command_attestations', 'dsh_budget_command_receipts', 'dsh_budget_work_closures', 'dsh_budget_source_accounts', 'dsh_budget_source_scans', 'dsh_budget_source_attempts', 'dsh_budget_source_identity_history', 'dsh_budget_cost_accounting_receipts', 'dsh_budget_account_revisions', 'dsh_budget_draft_usage_receipts'];
let guards = '';
for (let i = 0; i < tables.length; i++)
    for (const op of ['INSERT', 'UPDATE', 'DELETE'])
        guards += `\nCREATE TRIGGER dsh_v7_${tables[i]}_${op.toLowerCase()} BEFORE ${op} ON ${tables[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v7() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;
export const DRAFT_USAGE_SQL = `
CREATE TABLE dsh_budget_draft_usage_receipts (
 reservation_id TEXT NOT NULL REFERENCES dsh_budget_work_reservations(reservation_id),
 operation_key TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES dsh_budget_accounts(account_id),
 input_json TEXT NOT NULL,input_hash TEXT NOT NULL,proof_json TEXT NOT NULL,proof_hash TEXT NOT NULL,
 PRIMARY KEY(reservation_id,operation_key)
);
CREATE TRIGGER dsh_draft_usage_no_update BEFORE UPDATE ON dsh_budget_draft_usage_receipts BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_draft_usage_no_delete BEFORE DELETE ON dsh_budget_draft_usage_receipts BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;` + guards;
const parse = JSON.parse, json = JSON.stringify, NativeDate = Date, iso = Date.prototype.toISOString, apply = Reflect.apply;
const hash = (domain, value) => dshDigest(domain, value);
export function createDshDraftUsage({ one, all, run, ownerId }) {
    function basis(v) {
        const reservation = one('SELECT * FROM dsh_budget_work_reservations WHERE reservation_id=?', v.reservationId);
        const head = reservation && one('SELECT * FROM dsh_budget_work_heads WHERE reservation_id=?', v.reservationId);
        const at = one("SELECT * FROM dsh_budget_command_attestations WHERE reservation_id=? AND operation_key=? AND purpose='draft_prepare'", v.reservationId, v.operationKey);
        const command = at && one('SELECT * FROM dsh_budget_command_receipts WHERE attestation_id=?', at.attestation_id);
        const account = one('SELECT * FROM dsh_budget_accounts WHERE account_id=?', v.accountId);
        if (!account || account.owner_id !== ownerId || !reservation || reservation.account_id !== v.accountId || reservation.binding_id !== v.bindingId || !head || head.owner_work_id !== v.ownerWorkId || !at || at.semantic_payload_hash !== v.semanticPayloadHash || !command || command.result !== 'applied' || command.owner_work_id !== v.ownerWorkId)
            fail('dsh_draft_usage_forbidden');
        const usage = all('SELECT t.* FROM dsh_budget_work_attempts e JOIN dsh_budget_attempts t ON t.account_id=e.account_id AND t.operation_key=e.operation_key AND t.attempt_sequence=e.attempt_sequence WHERE e.reservation_id=? AND e.operation_key=? ORDER BY e.work_sequence', v.reservationId, v.operationKey);
        const operation = one('SELECT * FROM dsh_budget_operations WHERE account_id=? AND operation_key=?', v.accountId, v.operationKey);
        if (!operation || operation.purpose !== 'draft' || operation.work_id !== v.ownerWorkId || !usage.length)
            fail('dsh_draft_usage_unconfirmed');
        let target = false, conservative = false;
        const costs = [];
        for (let i = 0; i < usage.length; i++) {
            const row = usage[i];
            if (row.state !== 'settled' && row.state !== 'not_sent')
                fail('dsh_draft_usage_unconfirmed');
            if (row.attempt_id === v.attemptId && row.state === 'settled')
                target = true;
            if (row.state === 'settled' && row.cost_basis === 'conservative_upper_bound') {
                conservative = true;
                const cost = one('SELECT * FROM dsh_budget_cost_accounting_receipts WHERE attempt_id=?', row.attempt_id);
                if (!cost)
                    fail('dsh_draft_usage_unconfirmed');
                costs.push(cost);
            }
        }
        if (!target)
            fail('dsh_draft_usage_unconfirmed');
        return { reservation, head, at, command, account, operation, usage, costs, chargedBasis: conservative ? 'conservative_upper_bound' : 'actual' };
    }
    function make(v, b, usageRevision, ledgerRevision) {
        const validUntil = apply(iso, new NativeDate(Math.min(b.reservation.deadline, b.account.valid_until, b.at.valid_until, b.operation.deadline)), []);
        const receiptDigest = hash('dsh-draft-finalized-usage-v1', { input: v, attestation: b.at, command: b.command, operation: b.operation, usage: b.usage, costs: b.costs, usageRevision, ledgerRevision, validUntil });
        return { proofId: 'dsh-budget-commit:' + hash('dsh-budget-commit-id-v1', { ownerId, reservationId: v.reservationId, operationKey: v.operationKey }), budgetOwnerId: ownerId, reservationRef: v.reservationId, operationKey: v.operationKey, ownerWorkId: v.ownerWorkId, bindingId: v.bindingId, inputManifestHash: v.inputManifestHash, finalizedUsageRevision: usageRevision, validUntil, receiptDigest, chargedBasis: b.chargedBasis, ledgerRevision };
    }
    function existing(v) { return one('SELECT * FROM dsh_budget_draft_usage_receipts WHERE reservation_id=? AND operation_key=?', v.reservationId, v.operationKey); }
    function verify(row) {
        const v = parseDshInput('draft_finalize', parse(row.input_json)), proof = dshRecord(parse(row.proof_json), ['proofId', 'budgetOwnerId', 'reservationRef', 'operationKey', 'ownerWorkId', 'bindingId', 'inputManifestHash', 'finalizedUsageRevision', 'validUntil', 'receiptDigest', 'chargedBasis', 'ledgerRevision']), b = basis(v);
        for (const name of ['proofId', 'budgetOwnerId', 'reservationRef', 'operationKey', 'ownerWorkId', 'bindingId'])
            dshId(proof[name]);
        dshInteger(proof.finalizedUsageRevision, 1);
        dshInteger(proof.ledgerRevision, 1);
        dshHash(proof.inputManifestHash);
        dshHash(proof.receiptDigest);
        if (row.account_id !== v.accountId || row.reservation_id !== v.reservationId || row.operation_key !== v.operationKey || row.input_hash !== hash('dsh-draft-finalize-input-v1', v) || row.proof_hash !== hash('dsh-draft-commit-proof-v1', proof) || proof.finalizedUsageRevision > b.head.revision || proof.ledgerRevision > b.account.revision || hash('dsh-draft-commit-proof-v1', make(v, b, proof.finalizedUsageRevision, proof.ledgerRevision)) !== row.proof_hash)
            fail('dsh_budget_corrupt');
        return { v, proof, b };
    }
    function finalize(v) {
        const old = existing(v);
        if (old) {
            if (old.input_hash !== hash('dsh-draft-finalize-input-v1', v))
                fail('dsh_draft_usage_conflict');
            const { proof, b } = verify(old);
            return { schemaVersion: 1, kind: 'draft_commit_proof', issuerDomain: v.accountId, proof, eligible: b.head.state === 'bound' && b.head.held_tokens === 0 && b.head.held_cost === 0 };
        }
        const b = basis(v);
        if (b.head.state !== 'bound' || b.head.held_tokens || b.head.held_cost || b.head.overrun_tokens || b.head.overrun_cost)
            fail('dsh_draft_usage_unconfirmed');
        const proof = make(v, b, b.head.revision, b.account.revision);
        run('INSERT INTO dsh_budget_draft_usage_receipts VALUES(?,?,?,?,?,?,?)', v.reservationId, v.operationKey, v.accountId, json(v), hash('dsh-draft-finalize-input-v1', v), json(proof), hash('dsh-draft-commit-proof-v1', proof));
        return { schemaVersion: 1, kind: 'draft_commit_proof', issuerDomain: v.accountId, proof, eligible: true };
    }
    function graph() { for (const row of all('SELECT * FROM dsh_budget_draft_usage_receipts'))
        verify(row); }
    return { finalize, graph };
}
