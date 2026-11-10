import { captureDispatchBusinessData } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import type { DshBudgetStatus } from './harness-dsh-budget-private-types.js';
const own = Object.hasOwn, keys = Reflect.ownKeys, array = Array.isArray, integer = Number.isSafeInteger, sameValue=Object.is;
const apply = Reflect.apply, regexExec = RegExp.prototype.exec, NativeError = Error, maximumSafe = Number.MAX_SAFE_INTEGER;
type Row = Record<string, unknown>;
function invalid(): never {
    throw new NativeError('dsh_budget_receipt_unconfirmed');
}
function exact(value: unknown, names: readonly string[]): asserts value is Row {
    if (!value || typeof value !== 'object' || array(value) || keys(value).length !== names.length) {
        invalid();
    }
    for (let i = 0; i < names.length; i++) {
        if (!own(value, names[i]!)) {
            invalid();
        }
    }
}
function text(value: unknown): void {
    if (typeof value !== 'string' || !value.length || value.length > 256 || apply(regexExec, /[\x00-\x1f\x7f]/, [value]) !== null) {
        invalid();
    }
}
function hash(value: unknown): void {
    if (typeof value !== 'string' || apply(regexExec, /^[a-f0-9]{64}$/, [value]) === null) {
        invalid();
    }
}
function count(value: unknown, minimum = 0, maximum = 1e12): void {
    if (typeof value !== 'number' || !integer(value) || sameValue(value,-0) || value < minimum || value > maximum) {
        invalid();
    }
}
function oneOf(value: unknown, values: readonly unknown[]): void {
    for (let i = 0; i < values.length; i++) {
        if (value === values[i]) {
            return;
        }
    }
    invalid();
}
function names(row: Row, list: readonly string[], check: (value: unknown) => void): void {
    for (let i = 0; i < list.length; i++) {
        check(row[list[i]!]);
    }
}
/** The caller retains the original response before this data parser. The
 * original ledger already validates its full SQL graph in the same cut. */
export function parseOriginalDshBudgetStatus(raw: unknown): DshBudgetStatus {
    const value = captureDispatchBusinessData(raw);
    if (!value || typeof value !== 'object') invalid();
    const statusFields=['account','operations','attempts'];
    if(own(value,'costAccountingReceipts'))statusFields.push('costAccountingReceipts');
    if(own(value,'workCapacity'))statusFields.push('workCapacity');
    exact(value,statusFields);
    if(own(value,'workCapacity')&&value.workCapacity!==null){
        exact(value.workCapacity,['maxActiveWorks','maxDraftRequestsPerWork','activeWorks']);
        count(value.workCapacity.maxActiveWorks);count(value.workCapacity.maxDraftRequestsPerWork);count(value.workCapacity.activeWorks);
    }
    const account = value.account;
    exact(account, [
        'account_id', 'owner_id', 'profile_id', 'workspace_id', 'tenant_id', 'mandate_id', 'mandate_revision', 'authorization_epoch', 'authority_hash', 'currency', 'scale', 'token_limit', 'cost_limit', 'spent_tokens', 'held_tokens', 'spent_cost', 'held_cost', 'revision', 'status', 'close_reason', 'valid_until'
    ]);
    names(account, [
        'account_id', 'owner_id', 'profile_id', 'workspace_id', 'tenant_id', 'mandate_id'
    ], text);
    hash(account.authority_hash);
    names(account, [
        'mandate_revision', 'authorization_epoch', 'token_limit', 'cost_limit', 'revision'
    ], value => count(value, 1));
    names(account, [
        'spent_tokens', 'held_tokens', 'spent_cost', 'held_cost'
    ], value => count(value, 0, maximumSafe));
    count(account.valid_until, 0, 1e15);
    oneOf(account.status, ['active', 'closed']);
    if (account.currency !== 'USD' || account.scale !== 6) {
        invalid();
    }
    if (account.close_reason !== null) {
        text(account.close_reason);
    }
    if (!array(value.operations) || !array(value.attempts)) {
        invalid();
    }
    for (let i = 0; i < value.operations.length; i++) {
        const op = value.operations[i];
        exact(op, [
            'account_id', 'operation_key', 'purpose', 'input_id', 'evidence_hash', 'semantic_hash', 'thread_hash', 'work_id', 'max_attempts', 'deadline', 'payload_hash'
        ]);
        names(op, ['account_id', 'operation_key', 'input_id'], text);
        names(op, [
            'evidence_hash', 'semantic_hash', 'thread_hash', 'payload_hash'
        ], hash);
        oneOf(op.purpose, ['assessment', 'preview', 'draft']);
        count(op.max_attempts, 1, 64);
        count(op.deadline, 0, 1e15);
        if (op.account_id !== account.account_id) {
            invalid();
        }
        if (op.purpose === 'draft') {
            text(op.work_id);
        }
        else if (op.work_id !== null) {
            invalid();
        }
    }
    for (let i = 0; i < value.attempts.length; i++) {
        const at = value.attempts[i];
        const attemptFields = [
            'account_id', 'operation_key', 'attempt_sequence', 'attempt_id', 'body_hash', 'provider_id', 'model_id', 'model_profile_id', 'pricing_hash', 'max_input_tokens', 'max_output_tokens', 'max_tokens', 'max_cost', 'tool_rounds', 'payload_hash', 'state', 'actual_tokens', 'actual_cost', 'usage_receipt_hash', 'settlement_hash', 'settlement_revision'
        ];
        if(own(at,'cost_basis'))attemptFields.push('cost_basis');
        exact(at,attemptFields);
        if(own(at,'cost_basis'))oneOf(at.cost_basis,['actual','conservative_upper_bound']);
        names(at, [
            'account_id', 'operation_key', 'attempt_id', 'provider_id', 'model_id', 'model_profile_id'
        ], text);
        names(at, ['body_hash', 'pricing_hash', 'payload_hash'], hash);
        count(at.attempt_sequence, 1, 64);
        names(at, [
            'max_input_tokens', 'max_output_tokens', 'max_tokens', 'max_cost'
        ], value => count(value, 1));
        if (at.tool_rounds !== 0 || at.account_id !== account.account_id || at.max_tokens !== (at.max_input_tokens as number) + (at.max_output_tokens as number)) {
            invalid();
        }
        oneOf(at.state, [
            'prepared', 'pre_send', 'sent', 'unknown', 'settled', 'not_sent'
        ]);
        count(at.settlement_revision);
        if (at.state === 'settled') {
            count(at.actual_tokens, 0, maximumSafe);
            if(at.cost_basis==='conservative_upper_bound'){if(at.actual_cost!==null)invalid();}
            else count(at.actual_cost, 0, maximumSafe);
            hash(at.usage_receipt_hash);
            hash(at.settlement_hash);
            count(at.settlement_revision, 1);
        }
        else if (at.actual_tokens !== null || at.actual_cost !== null || at.usage_receipt_hash !== null || at.settlement_hash !== null || at.settlement_revision !== 0) {
            invalid();
        }
    }
    if(own(value,'costAccountingReceipts')) {
        const rows=value.costAccountingReceipts;if(!array(rows))invalid();
        for(let i=0;i<rows.length;i++) {
            const row=rows[i];exact(row,['accountId','operationKey','attemptId','sequence','basis','actualTokens','chargedCostUpperBoundMicros','pricingHash','usageReceiptHash','settlementRevision']);
            names(row,['accountId','operationKey','attemptId'],text);names(row,['pricingHash','usageReceiptHash'],hash);
            count(row.sequence,1,64);count(row.settlementRevision,1,1);count(row.actualTokens);count(row.chargedCostUpperBoundMicros);
            if(row.basis!=='conservative_upper_bound'||row.accountId!==account.account_id)invalid();
            let matched=0;
            for(let j=0;j<value.attempts.length;j++){const at=value.attempts[j];if(at.attempt_id===row.attemptId){matched++;if(at.cost_basis!=='conservative_upper_bound'||at.state!=='settled'||at.actual_cost!==null||at.operation_key!==row.operationKey||at.attempt_sequence!==row.sequence||at.actual_tokens!==row.actualTokens||at.usage_receipt_hash!==row.usageReceiptHash||at.pricing_hash!==row.pricingHash||at.settlement_revision!==row.settlementRevision)invalid();}}
            if(matched!==1)invalid();
        }
        for(let i=0;i<value.attempts.length;i++)if(value.attempts[i].cost_basis==='conservative_upper_bound'){let count=0;for(let j=0;j<rows.length;j++)if(rows[j].attemptId===value.attempts[i].attempt_id)count++;if(count!==1)invalid();}
    }
    return value as unknown as DshBudgetStatus;
}
