import type { CapturedGroupsRow } from "./captured-sqlite-groups-row.js";
import type { CapturedGroupsReference } from "./captured-sqlite-groups-references.js";
import { freezeCapturedData } from "./captured-source-json.js";
const keys = Object.keys,
  array = Array.isArray,
  define = Object.defineProperty,
  apply = Reflect.apply,
  ends = String.prototype.endsWith;
const put = <T,>(out: T[], value: T) =>
  define(out, out.length, {
    __proto__: null,
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  } as PropertyDescriptor);
const names: Readonly<Record<string, string>> = {
  issuedByUserId: "user-actor",
  triggerActorId: "dsh-provider-actor",
  objectAuthorId: "dsh-provider-actor",
  providerEventId: "dsh-provider-event",
  objectId: "dsh-provider-object",
  sourceObjectId: "dsh-provider-object",
  issueId: "dsh-provider-issue",
  issueNodeId: "dsh-provider-node",
  nodeId: "dsh-provider-node",
  authorId: "dsh-provider-actor",
  authorNodeId: "dsh-provider-node",
  taskId: "dsh-owner-task",
  proofId: "dsh-budget-proof",
  freshnessAttestationRef: "dsh-source-freshness",
  attestationRef: "dsh-source-attestation",
  eventRef: "dsh-provider-event",
  auditRef: "dsh-provider-audit",
  modelId: "dsh-provider-model",
  providerTimeEvidenceRef: "dsh-provider-event",

  scopeId: "dsh-a-domain",
  authorityId: "dsh-a-authority",
  principalId: "user-actor",
  sourceBindingId: "dsh-source-binding",
  connectionId: "dsh-source-connection",
  providerAccountId: "dsh-provider-account",
  repositoryId: "dsh-provider-repository",
  tenantId: "dsh-tenant",
  workspaceId: "dsh-workspace",
  profileId: "profile",
  mandateId: "dsh-mandate",
  ownerDomain: "dsh-owner-domain",
  domainId: "dsh-owner-domain",
  controlId: "dsh-control",
  scopeKey: "dsh-control-scope",
  operationId: "dsh-control-operation",
  commandId: "dsh-owner-command",
  acceptedCommandId: "dsh-owner-command",
  ownerReceiptCommandId: "dsh-owner-command",
  createCommandId: "dsh-owner-command",
  inputId: "dsh-source-input",
  canonicalInputId: "dsh-source-input",
  snapshotRef: "dsh-source-snapshot",
  snapshotId: "dsh-source-snapshot",
  parentSnapshotId: "dsh-source-snapshot",
  canonicalSnapshotRef: "dsh-source-snapshot",
  assessmentId: "dsh-assessment",
  assessmentRef: "dsh-assessment",
  candidateId: "dsh-assessment-candidate",
  decisionId: "dsh-admission-decision",
  supersedesDecisionId: "dsh-admission-decision",
  ownerWorkId: "dsh-owner-work",
  targetWorkId: "dsh-owner-work",
  draftCommitKey: "dsh-draft-commit-key",
  artifactId: "dsh-draft-artifact",
  draftInvocationId: "dsh-draft-invocation",
  operationKey: "dsh-owner-operation",
  receiptId: "dsh-owner-receipt",
  commandReceiptId: "dsh-owner-receipt",
  slotId: "dsh-draft-commit-key",
  scanId: "dsh-source-scan",
  readSetId: "dsh-source-read-set",
  selectedReadSetId: "dsh-source-read-set",
  lastFullReconcileScanId: "dsh-source-scan",
  readAttemptId: "dsh-source-read-attempt",
  parentReadAttemptId: "dsh-source-read-attempt",
  accountId: "dsh-budget-account",
  budgetRef: "dsh-budget-account",
  ownerId: "dsh-budget-owner",
  budgetOwnerId: "dsh-budget-owner",
  reservationRef: "dsh-budget-reservation",
  budgetReservationRef: "dsh-budget-reservation",
  dataEgressPolicyRef: "dsh-egress-policy",
  policyRef: "dsh-egress-policy",
  windowId: "dsh-auto-window",
  admissionWindowRef: "dsh-auto-window",
  baselineCheckpointRef: "dsh-source-scan",
  factRef: "dsh-provider-time-fact",
  providerTimeBasisProofRef: "dsh-provider-time-fact",
};
const sql: Readonly<Record<string, string>> = {
  scope_id: "dsh-a-domain",
  authority_id: "dsh-a-authority",
  principal_id: "user-actor",
  owner_domain: "dsh-owner-domain",
  control_id: "dsh-control",
  scope_key: "dsh-control-scope",
  operation_id: "dsh-control-operation",
  command_id: "dsh-owner-command",
  create_command_id: "dsh-owner-command",
  input_id: "dsh-source-input",
  canonical_initial_input_id: "dsh-source-input",
  mandate_id: "dsh-mandate",
  source_binding_id: "dsh-source-binding",
  assessment_id: "dsh-assessment",
  candidate_id: "dsh-assessment-candidate",
  decision_id: "dsh-admission-decision",
  receipt_id: "dsh-owner-receipt",
  scan_id: "dsh-source-scan",
  read_set_id: "dsh-source-read-set",
  snapshot_id: "dsh-source-snapshot",
  read_attempt_id: "dsh-source-read-attempt",
  account_id: "dsh-budget-account",
  budget_account_id: "dsh-budget-account",
  owner_id: "dsh-budget-owner",
  budget_owner_id: "dsh-budget-owner",
};
const containers: Readonly<Record<string, true>> = {
  storageScope: true,
  scope: true,
  authScope: true,
  thread: true,
  binding: true,
  configuration: true,
  candidateRepository: true,
  repository: true,
  projection: true,
  document: true,
  head: true,
  value: true,
  ownerValue: true,
  command: true,
  input: true,
  canonical: true,
  evidence: true,
  manifest: true,
  evidenceManifest: true,
  manifestLink: true,
  transport: true,
  origin: true,
  budget: true,
  providerDate: true,
  window: true,
  assessment: true,
  result: true,
  suggestion: true,
  basis: true,
  commandReceipt: true,
  appliedOperation: true,
  createRecord: true,
  control: true,
  workGuard: true,
  ownerControl: true,
  selection: true,
  object: true,
  creator: true,
  observations: true,
  candidates: true,
  entries: true,
  parents: true,
  ownerDomains: true,
};
const lists: Readonly<Record<string, string>> = {
  allowedActorProviderIds: "dsh-provider-actor",
  evidenceRefs: "dsh-source-input",
  inputIds: "dsh-source-input",
  validInputIds: "dsh-source-input",
  consumedInputIds: "dsh-source-input",
  sourceSnapshotRefs: "dsh-source-snapshot",
  snapshotIds: "dsh-source-snapshot",
  selectedSnapshotIds: "dsh-source-snapshot",
  readAttemptIds: "dsh-source-read-attempt",
  commentListAttemptIds: "dsh-source-read-attempt",
  issueListAttemptIds: "dsh-source-read-attempt",
  ownerDomainIds: "dsh-owner-domain",
  issueIds: "dsh-provider-issue",
  labelIds: "dsh-provider-label",
};
/** Exact typed history references. The source bytes and hashes remain intact;
 * this declaration stream never rewrites or re-signs a restored authority. */
export function declareCapturedDshAuthorityRow(
  row: CapturedGroupsRow,
): Readonly<{
  references: readonly CapturedGroupsReference[];
  unmapped: readonly string[];
  observationDeclarations: readonly never[];
}> {
  const references: CapturedGroupsReference[] = [];
  function ref(value: unknown, namespace: string, path: string) {
    if (typeof value === "string" && value)
      put(references, { namespace, id: value, path });
  }
  const columns = keys(sql);
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i]!,
      cell = row.cells[name];
    if (cell?.type === "text") ref(cell.value, sql[name]!, name);
  }
  const isWorkBinding =
    row.table === "dsh_a_work_bindings" ||
    row.table === "dsh_a_command_outbox" ||
    row.table === "dsh_a_owner_receipts";
  if (row.cells.binding_id?.type === "text")
    ref(
      row.cells.binding_id.value,
      isWorkBinding ? "dsh-work-binding" : "dsh-source-binding",
      "binding_id",
    );
  if (row.cells.attempt_id?.type === "text")
    ref(
      row.cells.attempt_id.value,
      row.table === "dsh_a_source_reads"
        ? "dsh-source-read-attempt"
        : "dsh-assessment-attempt",
      "attempt_id",
    );
  function walk(raw: unknown, path: string, workBinding: boolean): void {
    if (array(raw)) {
      for (let i = 0; i < raw.length; i++)
        walk(raw[i], path + "[" + i + "]", workBinding);
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const value = raw as Record<string, unknown>,
      fields = keys(value);
    for (let i = 0; i < fields.length; i++) {
      const name = fields[i]!,
        item = value[name],
        at = path + "." + name;
      if (name === "bindingId")
        ref(item, workBinding ? "dsh-work-binding" : "dsh-source-binding", at);
      else if (name === "attemptId")
        ref(
          item,
          row.table === "dsh_a_source_reads" ||
            apply(ends, path, ["providerDate"])
            ? "dsh-source-read-attempt"
            : "dsh-assessment-attempt",
          at,
        );
      else if (
        name === "ownerId" &&
        (row.table === "dsh_a_source_reads" ||
          row.table === "dsh_a_source_snapshots")
      )
        ref(item, "dsh-provider-actor", at);
      else if (name === "id" && row.table === "dsh_a_source_reads") {
        const body = row.json.data_json as Record<string, unknown>,
          plan = body.plan as Record<string, unknown>;
        ref(
          item,
          plan.kind === "labels"
            ? "dsh-provider-label"
            : "dsh-provider-repository",
          at,
        );
      } else if (name === "id" && typeof value.recordDigest === "string")
        ref(item, "dsh-owner-record", at);
      else if (names[name]) ref(item, names[name]!, at);
      if (lists[name] && array(item)) {
        for (let j = 0; j < item.length; j++)
          ref(item[j], lists[name]!, at + "[" + j + "]");
      }
      if (containers[name])
        walk(
          item,
          at,
          name === "command" ||
            name === "basis" ||
            name === "transport" ||
            name === "canonical"
            ? true
            : name === "configuration"
              ? false
              : workBinding,
        );
    }
  }
  walk(row.json.data_json, "data_json", isWorkBinding);
  return freezeCapturedData({
    references,
    unmapped: ["dsh_a_restore_requires_original_owner_requalification"],
    observationDeclarations: [],
  });
}
