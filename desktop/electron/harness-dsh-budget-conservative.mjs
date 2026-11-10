export const CONSERVATIVE_PROFILE='harness_dsh_conservative_accounting_v1';
const core=['dsh_budget_accounts','dsh_budget_operations','dsh_budget_attempts','dsh_budget_work_policies','dsh_budget_work_reservations','dsh_budget_work_heads','dsh_budget_work_attempts','dsh_budget_command_attestations','dsh_budget_command_receipts','dsh_budget_work_closures','dsh_budget_cost_accounting_receipts'];
const source=['dsh_budget_source_accounts','dsh_budget_source_scans','dsh_budget_source_attempts','dsh_budget_source_identity_history'];
function guards(tables){let out='';for(let i=0;i<tables.length;i++)for(const op of ['INSERT','UPDATE','DELETE'])out+=`\nCREATE TRIGGER dsh_v5_${tables[i]}_${op.toLowerCase()} BEFORE ${op} ON ${tables[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v5() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;return out;}
export const CONSERVATIVE_SOURCE_GUARDS=guards(source);
export const CONSERVATIVE_SQL=`
CREATE TABLE dsh_budget_cost_accounting_receipts (
 account_id TEXT NOT NULL,operation_key TEXT NOT NULL,attempt_id TEXT NOT NULL UNIQUE,attempt_sequence INTEGER NOT NULL,
 basis TEXT NOT NULL CHECK(basis='conservative_upper_bound'),actual_tokens INTEGER NOT NULL CHECK(typeof(actual_tokens)='integer' AND actual_tokens>=0),
 charged_cost_upper INTEGER NOT NULL CHECK(typeof(charged_cost_upper)='integer' AND charged_cost_upper>=0),
 pricing_hash TEXT NOT NULL,usage_receipt_hash TEXT NOT NULL,settlement_revision INTEGER NOT NULL CHECK(settlement_revision=1),settlement_hash TEXT NOT NULL,
 PRIMARY KEY(account_id,operation_key,attempt_sequence),
 FOREIGN KEY(account_id,operation_key,attempt_sequence) REFERENCES dsh_budget_attempts(account_id,operation_key,attempt_sequence)
);
CREATE TRIGGER dsh_cost_receipts_no_update BEFORE UPDATE ON dsh_budget_cost_accounting_receipts BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_cost_receipts_no_delete BEFORE DELETE ON dsh_budget_cost_accounting_receipts BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;`+guards(core);
export function conservativeDshSchema(original){return original.replace(' settlement_revision INTEGER NOT NULL DEFAULT 0'," cost_basis TEXT NOT NULL DEFAULT 'actual' CHECK(cost_basis IN ('actual','conservative_upper_bound')),\n settlement_revision INTEGER NOT NULL DEFAULT 0").replace("actual_cost IS NOT NULL AND settlement_hash IS NOT NULL", "((cost_basis='actual' AND actual_cost IS NOT NULL) OR (cost_basis='conservative_upper_bound' AND actual_cost IS NULL)) AND settlement_hash IS NOT NULL");}
