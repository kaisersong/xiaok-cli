export const ACCOUNT_REVISION_PROFILE='harness_dsh_account_revision_v1';
const tables=[
 'dsh_budget_accounts','dsh_budget_operations','dsh_budget_attempts',
 'dsh_budget_work_policies','dsh_budget_work_reservations','dsh_budget_work_heads',
 'dsh_budget_work_attempts','dsh_budget_command_attestations','dsh_budget_command_receipts','dsh_budget_work_closures',
 'dsh_budget_source_accounts','dsh_budget_source_scans','dsh_budget_source_attempts','dsh_budget_source_identity_history',
 'dsh_budget_cost_accounting_receipts','dsh_budget_account_revisions',
];
let guards='';
for(let i=0;i<tables.length;i++)for(const op of ['INSERT','UPDATE','DELETE']){
 guards+=`\nCREATE TRIGGER dsh_v6_${tables[i]}_${op.toLowerCase()} BEFORE ${op} ON ${tables[i]} BEGIN SELECT CASE WHEN xiaok_harness_dsh_budget_v6() IS NOT 1 THEN RAISE(ABORT,'dsh_writer_required') END; END;`;
}
export const ACCOUNT_REVISION_SQL=`
CREATE TABLE dsh_budget_account_revisions (
 account_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>0),
 previous_mandate_revision INTEGER NOT NULL,next_mandate_revision INTEGER NOT NULL CHECK(next_mandate_revision>previous_mandate_revision),
 previous_account_revision INTEGER NOT NULL,next_account_revision INTEGER NOT NULL CHECK(next_account_revision=previous_account_revision+1),
 previous_config TEXT NOT NULL,next_config TEXT NOT NULL,spent_tokens INTEGER NOT NULL,spent_cost INTEGER NOT NULL,
 receipt_hash TEXT NOT NULL,
 PRIMARY KEY(account_id,ordinal),UNIQUE(account_id,next_mandate_revision),
 FOREIGN KEY(account_id) REFERENCES dsh_budget_accounts(account_id)
);
CREATE UNIQUE INDEX dsh_budget_account_mandate ON dsh_budget_accounts(profile_id,workspace_id,tenant_id,mandate_id);
CREATE TRIGGER dsh_account_revision_immutable_update BEFORE UPDATE ON dsh_budget_account_revisions BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;
CREATE TRIGGER dsh_account_revision_immutable_delete BEFORE DELETE ON dsh_budget_account_revisions BEGIN SELECT RAISE(ABORT,'dsh_immutable_record'); END;`+guards;
