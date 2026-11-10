import {readBrokerBaselineReceipt,readBrokerFenceReceipt,projectDshBrokerControlTarget,brokerAdmissionDigest} from './dsh-broker-control-data.js';
import {parseGithubRepositoryCandidate} from './dsh-github-setup-data.js';
import { captureDispatchBusinessData } from "../conversation-activity/dispatch-business-data.js";
import {
  parseEvidenceManifest,
  parseMandateProjection,
  parseSemanticAssessment,
  instantMs,
} from "../admission/parse.js";
import {
  hashEvidenceManifest,
  hashMandateProjection,
  hashSemanticAssessment,
} from "../admission/hash.js";
import {
  dshAFields,
  dshAHash,
  dshAJson,
  dshAThread,
  dshAAuth,
  dshAText,
  type DshARecord,
} from "./dsh-admission-data.js";
import {
  DSH_A_AUTHORITY_TABLES,
  DSH_A_AUTHORITY_DDL,
  DSH_A_AUTHORITY_SQL_HASH,
  dshProfileAncestryHash,
  dshMandateIssuerEpoch,
  dshAuthorityRowHash,
  assertDshProfileAncestry,
  assertDshBindingHistory,
} from "./dsh-admission-authority-data.js";
import {
  parseDshSourceConfiguration,
  dshSourceScopeIdentity,
  dshSourceScopeKey,
} from "./dsh-source-configuration.js";
import { parseDshEgressPolicy } from "./dsh-egress-policy-data.js";
import {
  readGithubSourceRow,
  validateGithubSourceRelations,
  type GithubSourceTable,
  type GithubSourceStorageRow,
} from "./dsh-github-source-storage.js";
const parse = JSON.parse,
  apply = Reflect.apply,
  own = Object.hasOwn,
  array = Array.isArray,
  safe = Number.isSafeInteger,
  exec = RegExp.prototype.exec,
  bytes = Buffer.byteLength;
const objectKeys = Object.keys,
  assign = Object.assign,
  define = Object.defineProperty,
  freeze = Object.freeze;
const nativeSplit = String.prototype.split,
  nativeTrim = String.prototype.trim,
  nativeSlice = String.prototype.slice,
  nativeIndex = String.prototype.indexOf;
const zeroSelectionHash = "0".repeat(64);
const NativeMap = Map,
  mapGet = Map.prototype.get,
  mapSet = Map.prototype.set;
const split = (s: string, separator: string): string[] =>
  apply(nativeSplit, s, [separator]);
const trim = (s: string): string => apply(nativeTrim, s, []);
const slice = (s: string, start: number, end?: number): string =>
  apply(nativeSlice, s, [start, end]);
const index = (s: string, needle: string): number =>
  apply(nativeIndex, s, [needle]);
function has(items: readonly unknown[], value: unknown): boolean {
  for (let i = 0; i < items.length; i++) if (items[i] === value) return true;
  return false;
}
function put<T>(items: T[], value: T): void {
  define(items, items.length, {
    __proto__: null,
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  } as PropertyDescriptor);
}
function map<K, V>() {
  const value = new NativeMap<K, V>();
  return freeze({
    get(key: K): V | undefined {
      return apply(mapGet, value, [key]);
    },
    set(key: K, item: V): void {
      apply(mapSet, value, [key, item]);
    },
  });
}

type R = DshARecord;
function fail(reason = "body"): never {
  throw Error("DSH_A_COLD_" + reason.toUpperCase());
}
function record(value: unknown): R {
  if (!value || typeof value !== "object" || array(value)) fail();
  return value as R;
}
function fields(value: unknown, names: string, optional = ""): R {
  dshAFields(value, split(names, " "), optional ? split(optional, " ") : []);
  return value;
}
function int(value: unknown, min = 1): number {
  if (typeof value !== "number" || !safe(value) || value < min) fail("integer");
  return value;
}
function hash(value: unknown): void {
  if (typeof value !== "string" || !apply(exec, /^[a-f0-9]{64}$/, [value]))
    fail("hash");
}
function text(value: unknown): void {
  dshAText(value);
}
function same(a: unknown, b: unknown): boolean {
  return dshAJson(a) === dshAJson(b);
}
function requireSame(a: unknown, b: unknown): void {
  if (!same(a, b)) fail("relation");
}
function list(value: unknown): unknown[] {
  if (!array(value)) fail("array");
  return value;
}
function strings(value: unknown): void {
  const items = list(value);
  for (let i = 0; i < items.length; i++) {
    text(items[i]);
    for (let j = 0; j < i; j++) if (items[i] === items[j]) fail("duplicate");
  }
}
function scope(value: unknown): R {
  const s = fields(value, "profileId workspaceId");
  hash(s.profileId);
  hash(s.workspaceId);
  return s;
}
function bRecord(value: unknown): R {
  const r = record(value),
    body = { ...r };
  delete body.recordDigest;
  if (
    r.schemaVersion !== 1 ||
    r.contract !== "dsh_owner_admission_v1" ||
    r.recordDigest !== dshAHash(["dsh-record-v1", body])
  )
    fail("owner_record");
  text(r.id);
  text(r.kind);
  text(r.writerStoreId);
  scope(r.scope);
  return r;
}
function controlHead(raw: unknown): R {
  const h = fields(
    raw,
    "schemaVersion recordKind axis identity scopeKey controlId epoch revision operationId value",
    "ownerValue policyHash",
  );
  if (h.schemaVersion !== 1) fail();
  dshSourceScopeIdentity(h.identity);
  int(h.epoch);
  int(h.revision);
  text(h.scopeKey);
  text(h.controlId);
  hash(h.operationId);
  if (h.recordKind === "policy") {
    if (h.axis === "mode") {
      const v = fields(h.value, "mode");
      if (v.mode !== "off" && v.mode !== "observe" && v.mode !== "auto_draft")
        fail();
    } else {
      if (
        h.axis !== "mandate" &&
        h.axis !== "egress" &&
        h.axis !== "privacy" &&
        h.axis !== "readonly"
      )
        fail();
      const v = fields(h.value, "allowed restriction");
      if (
        typeof v.allowed !== "boolean" ||
        (v.restriction !== null && typeof v.restriction !== "string")
      )
        fail();
    }
  } else if (h.recordKind === "leaf") {
    const v = record(h.value);
    if (h.axis === "source_auth") {
      fields(
        v,
        "authScope sourceBindingVersion roleMappingVersion provenanceVersion status attestationRef",
      );
      dshAAuth(v.authScope);
      int(v.sourceBindingVersion);
      int(v.roleMappingVersion);
      int(v.provenanceVersion);
      text(v.attestationRef);
      if (
        v.status !== "active" &&
        v.status !== "revoked" &&
        v.status !== "unavailable"
      )
        fail();
    } else if (h.axis === "egress") {
      parseDshEgressPolicy(v);
      hash(h.policyHash);
      fields(
        h.ownerValue,
        "policyRef policyHash provider destinationRef purposes enabled",
      );
      if (h.policyHash !== record(h.ownerValue).policyHash) fail();
    } else if (h.axis === "mandate") {
      if (v.schemaVersion !== 1) fail();
      int(v.revision);
      int(v.authorizationEpoch);
      strings(v.allowedActions);
      strings(v.allowedActorProviderIds);
      instantMs(v.validUntil as string);
    } else if (h.axis === "readonly") {
      fields(
        v,
        "executionProfile schemaVersion snapshotHash snapshotPolicyDigest approvalRef",
      );
      if (v.executionProfile === "model_text_only_v1") {
        if (
          v.schemaVersion !== 1 ||
          v.snapshotHash !== null ||
          v.snapshotPolicyDigest !== null ||
          v.approvalRef !== null
        )
          fail();
      } else if (v.executionProfile === "dsh_readonly_v1") {
        if (v.schemaVersion !== 2) fail();
        hash(v.snapshotHash);
        hash(v.snapshotPolicyDigest);
        text(v.approvalRef);
      } else fail();
    } else fail();
  } else fail();
  return h;
}
const shapes: Readonly<Record<string, string>> = {
  dsh_a_domains:
    "schemaVersion scopeId storageScope principalId authorityId authorityEpoch budget ownerDomainIds state revision enrollmentRef",
  dsh_a_source_configurations:
    "schemaVersion scopeId revision configurationHash userIntentHash configuration",
  dsh_a_source_configuration_heads: "schemaVersion bindingId revision",
  dsh_a_source_setups:
    "schemaVersion scopeId revision configurationHash userIntentHash configuration",
  dsh_a_owner_domains:
    "schemaVersion scopeId storageScope domainId kind registrationRef storeId writerProfile writerSchemaVersion",
  dsh_a_mandates: "schemaVersion scopeId projection",
  dsh_a_mandate_heads:
    "schemaVersion scopeId mandateId mandateRevision revision",
  dsh_a_control_operations:
    "schemaVersion operationId semanticKey controlId scopeKey recordKind axis targetEpoch previousRevision canonicalHash domainsHash head",
  dsh_a_control_targets:
    "schemaVersion scopeId operationId ownerDomain controlId epoch canonicalHash command",
  dsh_a_control_domain_receipts:
    "schemaVersion scopeId operationId ownerDomain receiptId controlId epoch canonicalHash kind",
  dsh_a_windows:
    "schemaVersion scopeId sourceBindingId mandateId mandateRevision configurationRevision clockDomain clockEpoch baselineCheckpointRevision observationsEndAt profile isolationMs qualification maxObservedAt providerDate window",
  dsh_a_assessment_attempts:
    "schemaVersion scopeId inputId proofVersion mandateId mandateRevision assessmentVersion previousSelectionRevision attemptId basisHash bindingId evidenceManifest evidenceRefs sourceSnapshotRefs purpose modelPolicy operationKey semanticPayloadHash maxAttempts validUntil deadline",
  dsh_a_assessment_candidates:
    "schemaVersion scopeId candidateId attemptId assessmentVersion purpose evidenceManifestHash modelId promptVersion ruleVersion dataEgressPolicyRef validUntil result outputHash",
  dsh_a_assessments: "schemaVersion scopeId candidateId attemptId assessment",
  dsh_a_selections:
    "schemaVersion scopeId inputId mandateId mandateRevision assessmentVersion assessmentId assessmentHash previousSelectionHash",
  dsh_a_selection_heads:
    "schemaVersion scopeId inputId mandateId mandateRevision assessmentVersion assessmentId assessmentHash previousSelectionHash",
  dsh_a_decisions:
    "schemaVersion scopeId decisionId inputId mandateId mandateRevision policyVersion evaluatedSnapshotHash assessmentVersion suggestion",
  dsh_a_work_bindings:
    "bindingId mandateId thread generation ownerKind version transport",
  dsh_a_command_outbox:
    "schemaVersion scopeId commandClass authorityEpoch command decisionId selectionHash targetDomain manifestLink",
  dsh_a_delivery_heads:
    "schemaVersion scopeId commandId revision fencingToken state",
  dsh_a_control_delivery_heads:
    "schemaVersion scopeId operationId ownerDomain revision fencingToken state",
  dsh_a_owner_receipts:
    "schemaVersion scopeId acceptedCommandId ownerReceiptCommandId operationKey semanticPayloadHash ownerDomain receiptId receipt basis",
  dsh_a_source_control_receipts:
    "schemaVersion scopeId inputId proofVersion disposition commandId reasonCodes",
  dsh_a_shadow_results:
    "schemaVersion scopeId inputId mandateId mandateRevision policyVersion evaluatedSnapshotHash suggestion",
  dsh_a_budget_account_memberships:
    "schemaVersion scopeId accountId ownerId mandateId unitProfile origin originDigest",
};
const optional: Readonly<Record<string, string>> = {
  dsh_a_control_domain_receipts: "ownerControl brokerReceipt brokerCurrentAtObservation",
  dsh_a_owner_domains: "brokerBaseline",
  dsh_a_decisions: "supersedesDecisionId",
  dsh_a_mandates: "issuerEpoch",
  dsh_a_source_control_receipts: "scanId",
};
/** One inert parser shared by original writer reads and captured SQLite. A
 * successful parse says nothing about present Native/Source/budget authority. */
export function readDshAuthorityColdRow(table: string, raw: unknown): R {
  const row = record(captureDispatchBusinessData(raw)),
    encoded = row.data_json;
  if (typeof encoded !== "string") fail("json");
  const body = record(apply(parse, JSON, [encoded]));
  if (dshAJson(body) !== encoded || row.logical_bytes !== bytes(encoded))
    fail("bytes");
  if (table === "dsh_a_profile_migrations") {
    assertDshProfileAncestry(body);
    if (
      row.migration_id !== body.migrationId ||
      row.store_id !== body.storeId ||
      row.from_version !== body.fromVersion ||
      row.to_version !== body.toVersion ||
      row.from_profile !== body.fromProfile ||
      row.to_profile !== body.toProfile ||
      row.from_digest !== body.fromDigest ||
      row.to_digest !== body.toDigest ||
      row.ddl_hash !== DSH_A_AUTHORITY_SQL_HASH ||
      row.body_hash !== dshProfileAncestryHash(body)
    )
      fail("ancestry");
    return body;
  }
  if (table === "dsh_a_source_binding_revisions") {
    assertDshBindingHistory(body);
    if (
      row.binding_id !== body.bindingId ||
      row.binding_revision !== body.bindingRevision ||
      row.source_key !== body.sourceKey ||
      row.body_hash !== dshAuthorityRowHash(table, body)
    )
      fail("binding_history");
    return body;
  }
  if (
    table === "dsh_a_source_scans" ||
    table === "dsh_a_source_reads" ||
    table === "dsh_a_source_snapshots" ||
    table === "dsh_a_source_read_sets" ||
    table === "dsh_a_source_content_checkpoints"
  ) {
    return readGithubSourceRow(
      table as GithubSourceTable,
      dshGithubColdStorageRow(table as GithubSourceTable, row),
    );
  }
  if (table === "dsh_a_control_heads") controlHead(body);
  else {
    const shape = shapes[table];
    if (!shape) fail("table");
    fields(body, shape, optional[table] ?? "");
  }
  if (table === "dsh_a_mandates") {
    dshMandateIssuerEpoch(body);
  } else if (table !== "dsh_a_work_bindings" && body.schemaVersion !== 1)
    fail("version");
  if (row.body_hash !== dshAuthorityRowHash(table, body)) fail("hash");
  if (own(body, "scopeId")) hash(body.scopeId);
  const integerNames = [
    "revision",
    "version",
    "authorityEpoch",
    "mandateRevision",
    "assessmentVersion",
    "proofVersion",
    "fencingToken",
    "epoch",
    "targetEpoch",
    "configurationRevision",
    "clockEpoch",
    "baselineCheckpointRevision",
    "maxAttempts",
  ];
  for (let i = 0; i < integerNames.length; i++) {
    const name = integerNames[i]!;
    if (
      own(body, name) &&
      !(
        table === "dsh_a_decisions" &&
        name === "assessmentVersion" &&
        body[name] === null
      )
    )
      int(body[name]);
  }
  const digestNames = [
    "configurationHash",
    "userIntentHash",
    "canonicalHash",
    "domainsHash",
    "semanticKey",
    "basisHash",
    "semanticPayloadHash",
    "assessmentHash",
    "evidenceManifestHash",
    "outputHash",
    "evaluatedSnapshotHash",
    "originDigest",
  ];
  for (let i = 0; i < digestNames.length; i++)
    if (own(body, digestNames[i]!)) hash(body[digestNames[i]!]!);
  switch (table) {
    case "dsh_a_domains":
      scope(body.storageScope);
      text(body.principalId);
      text(body.authorityId);
      strings(body.ownerDomainIds);
      if (
        !has(
          ["off", "pending_baseline", "active", "narrowing"],
          body.state as string,
        )
      )
        fail();
      if (body.budget !== null) {
        const b = fields(body.budget, "ownerId accountId unitProfile");
        text(b.ownerId);
        text(b.accountId);
        if (b.unitProfile !== "dsh_budget_usd_micros_v1") fail();
      } else if (body.state === "active" || body.state === "narrowing") fail();
      break;
    case "dsh_a_source_configurations":
      parseDshSourceConfiguration(body.configuration);
      if (body.configurationHash !== dshAHash(body.configuration)) fail();
      break;
    case "dsh_a_source_setups": {
      const c = fields(
        body.configuration,
        "schemaVersion setupId tenantId candidateRepository mode accountId minimumIntervalMs selection issueRefs",
      );
      if (c.schemaVersion !== 1 || (c.mode !== "observe" && c.mode !== "off"))
        fail();
      parseGithubRepositoryCandidate(c.candidateRepository);
      const selection=record(c.selection),selected=selection.kind==='issue_ids'?'issueIds':'labelIds';
      fields(selection,selection.kind==='issue_ids'?'kind issueIds':'kind match labelIds');
      if(selection.kind!=='issue_ids'&&selection.kind!=='label_ids'||selection.kind==='label_ids'&&selection.match!=='all')fail('setup_selection');
      strings(selection[selected]);const ids=list(selection[selected]);if(!ids.length||ids.length>1000)fail('setup_selection');
      const refs=list(c.issueRefs);if(refs.length>1000||selection.kind==='label_ids'&&refs.length||selection.kind==='issue_ids'&&refs.length!==ids.length)fail('setup_selection');
      for(let i=0;i<refs.length;i++){const ref=fields(refs[i],'issueId issueNumber');text(ref.issueId);int(ref.issueNumber);if(!has(ids,ref.issueId))fail('setup_selection');for(let j=0;j<i;j++)if(record(refs[j]).issueId===ref.issueId||record(refs[j]).issueNumber===ref.issueNumber)fail('setup_selection');}
      int(c.minimumIntervalMs, 1000);
      text(c.setupId);
      text(c.tenantId);
      text(c.accountId);
      if (body.configurationHash !== dshAHash(c)) fail();
      break;
    }
    case "dsh_a_owner_domains":
      scope(body.storageScope);
      if (!has(["work", "egress_gate", "active_pointer"], body.kind as string))
        fail();
      text(body.domainId);
      text(body.registrationRef);
      text(body.storeId);
      int(body.writerSchemaVersion);
      if(body.writerProfile==="broker_dsh_control_v1"){
        const baseline=readBrokerBaselineReceipt(body.brokerBaseline);if(body.kind!=="active_pointer"||body.writerSchemaVersion!==9||baseline.realmId!==body.storeId||baseline.domainId!==body.domainId||dshAJson(baseline.scope)!==dshAJson(body.storageScope))fail("broker_domain");const domain={schemaVersion:1,kind:"broker_dsh",ownerKind:"active_pointer",domainId:body.domainId,storeId:body.storeId,scope:body.storageScope,writerProfile:body.writerProfile,writerSchemaVersion:9};if(body.registrationRef!=="dsh-a-broker-registration:"+dshAHash(["dsh-a-broker-registration-v1",body.scopeId,domain,baseline]))fail("broker_registration");
      }else if(own(body,"brokerBaseline"))fail("broker_domain");
      break;
    case "dsh_a_mandates": {
      const m = parseMandateProjection(body.projection);
      if (m.contentHash !== hashMandateProjection(m)) fail("mandate");
      break;
    }
    case "dsh_a_control_operations": {
      const h = controlHead(body.head);
      const names = [
        "controlId",
        "scopeKey",
        "recordKind",
        "axis",
        "targetEpoch",
        "operationId",
      ];
      for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        if (body[name] !== h[name === "targetEpoch" ? "epoch" : name]) fail();
      }
      if (
        h.revision !== int(body.previousRevision, 0) + 1 ||
        body.semanticKey !== body.operationId
      )
        fail();
      break;
    }
    case "dsh_a_control_targets":
      record(body.command);
      int(body.epoch);
      break;
    case "dsh_a_control_domain_receipts":
      if(body.kind==="original_broker_control_receipt"){const r=readBrokerFenceReceipt(body.brokerReceipt),q=record(r.request);if(own(body,"ownerControl")||typeof body.brokerCurrentAtObservation!=="boolean"||q.sourceHeadId!==body.controlId||q.epoch!==body.epoch||r.operationId!==body.operationId||r.domainId!==body.ownerDomain)fail("broker_control");}
      else if (body.kind === "original_b_control_receipt") {
        if(own(body,"brokerReceipt")||own(body,"brokerCurrentAtObservation"))fail("broker_control");
        const b = bRecord(body.ownerControl);
        if (b.id !== body.controlId || b.epoch !== body.epoch) fail();
      } else if (
        body.kind !== "same_native_control_commit" ||
        (own(body, "ownerControl")||own(body,"brokerReceipt")||own(body,"brokerCurrentAtObservation"))
      )
        fail();
      break;
    case "dsh_a_windows": {
      const w = fields(
        body.window,
        "windowId sourceBindingId prefixModeGuardsHash admissionGrantHash effectiveAt baselineCheckpointRef providerTimeBasisProofRef freshnessPolicyVersion",
      );
      if (
        body.profile !== "freshness_operational_v1" ||
        body.qualification !== "operational-v1" ||
        body.isolationMs !== 300000 ||
        body.sourceBindingId !== w.sourceBindingId ||
        w.freshnessPolicyVersion !== 1
      )
        fail();
      int(body.maxObservedAt, 0);
      instantMs(body.observationsEndAt as string);
      instantMs(w.effectiveAt as string);
      hash(w.prefixModeGuardsHash);
      hash(w.admissionGrantHash);
      fields(
        body.providerDate,
        "factRef attemptId rawBodyHash rawDate secondLowerBound exclusiveSecondUpperBound clockRelation",
      );
      if (record(body.providerDate).clockRelation !== "unconfirmed") fail();
      break;
    }
    case "dsh_a_assessment_attempts": {
      const m = parseEvidenceManifest(body.evidenceManifest);
      if (m.manifestHash !== hashEvidenceManifest(m)) fail();
      strings(body.evidenceRefs);
      strings(body.sourceSnapshotRefs);
      fields(
        body.modelPolicy,
        "modelId promptVersion ruleVersion assessmentProfile negativeHintPolicy",
      );
      if (
        (body.assessmentVersion !== 1 && body.assessmentVersion !== 2) ||
        (body.purpose !== "admission" && body.purpose !== "preview")
      )
        fail();
      int(body.previousSelectionRevision, 0);
      int(body.deadline, 0);
      int(body.validUntil, 0);
      break;
    }
    case "dsh_a_assessment_candidates": {
      const r = fields(body.result, "suggestedIntent evidenceRefs uncertainty");
      if (
        !has(
          ["draft_request", "followup", "chat", "ambiguous"],
          r.suggestedIntent as string,
        ) ||
        (r.uncertainty !== null && typeof r.uncertainty !== "string")
      )
        fail();
      strings(r.evidenceRefs);
      int(body.validUntil, 0);
      break;
    }
    case "dsh_a_assessments": {
      const a = parseSemanticAssessment(body.assessment);
      if (!a.decisive || a.assessmentHash !== hashSemanticAssessment(a))
        fail("assessment");
      break;
    }
    case "dsh_a_selections":
    case "dsh_a_selection_heads":
      if (body.assessmentVersion !== 1 && body.assessmentVersion !== 2) fail();
      hash(body.assessmentHash);
      if (body.previousSelectionHash !== null) hash(body.previousSelectionHash);
      break;
    case "dsh_a_decisions": {
      const d = fields(
        body.suggestion,
        "kind verdict reasonCodes evaluatedSnapshotHash assessmentRef previousReceiptRef",
      );
      if (
        d.kind !== "admission_suggestion" ||
        !has(
          ["accept", "followup", "reject", "needs_review"],
          d.verdict as string,
        ) ||
        d.evaluatedSnapshotHash !== body.evaluatedSnapshotHash
      )
        fail();
      strings(d.reasonCodes);
      break;
    }
    case "dsh_a_work_bindings": {
      dshAThread(body.thread);
      if (body.ownerKind !== "kswarm_dsh" || body.generation !== 1) fail();
      const t = record(body.transport);
      if (t.kind === "reserved") {
        fields(
          t,
          "kind createOperationKey createCommandId canonicalInitialInputId canonicalCreateManifestHash",
        );
        text(t.createOperationKey);
        text(t.createCommandId);
        text(t.canonicalInitialInputId);
        hash(t.canonicalCreateManifestHash);
      } else if (t.kind === "bound") {
        fields(
          t,
          "kind ownerWorkId ownerVersion workCreatedAt workExecutionDeadline",
        );
        text(t.ownerWorkId);
        int(t.ownerVersion);
        instantMs(t.workCreatedAt as string);
        instantMs(t.workExecutionDeadline as string);
      } else fail();
      break;
    }
    case "dsh_a_command_outbox": {
      const c = fields(
        body.command,
        "scope thread authScope schemaVersion commandId bindingId generation ownerKind mandateId mandateRevision authorizationEpoch action purpose inputId input canonical targetWorkId expectedOwnerVersion targetFenceEpoch dispatchPolicy assessmentRef assessmentHash admissionWindowRef freshnessAttestationRef evidenceManifestHash evidence freshness egressGuard budgetReservationRef authorityValidUntil executionDeadline executionProfile modeGuards controlGuards workGuard operationKey semanticPayloadHash attemptPayloadHash",
        "inputSetRevision",
      );
      if (
        c.schemaVersion !== 2 ||
        c.ownerKind !== "kswarm_dsh" ||
        c.generation !== 1 ||
        c.authorizationEpoch !== body.authorityEpoch
      )
        fail();
      scope(c.scope);
      dshAThread(c.thread);
      dshAAuth(c.authScope);
      if (
        !has(
          [
            "create_draft_work",
            "append_input",
            "prepare_draft",
            "request_stop",
            "invalidate_input",
          ],
          c.action as string,
        ) ||
        (body.commandClass !== "generating" &&
          body.commandClass !== "narrowing")
      )
        fail();
      const payload = { ...c };
      delete payload.operationKey;
      delete payload.semanticPayloadHash;
      delete payload.attemptPayloadHash;
      if (
        c.attemptPayloadHash !==
        dshAHash([
          "dsh-attempt-v1",
          payload,
          c.operationKey,
          c.semanticPayloadHash,
        ])
      )
        fail("command_attempt");
      break;
    }
    case "dsh_a_shadow_results": {
      const d = fields(
        body.suggestion,
        "kind semanticClassification reasonCodes evaluatedSnapshotHash assessmentRef",
      );
      if (
        d.kind !== "shadow_suggestion" ||
        !has(
          ["draft_request", "followup", "chat", "ambiguous", "unavailable"],
          d.semanticClassification,
        ) ||
        d.evaluatedSnapshotHash !== body.evaluatedSnapshotHash
      )
        fail();
      strings(d.reasonCodes);
      break;
    }
    case "dsh_a_delivery_heads":
    case "dsh_a_control_delivery_heads":
      if (
        !has(
          ["pending", "leased", "unknown", "receipt_observed", "fenced"],
          body.state as string,
        )
      )
        fail();
      break;
    case "dsh_a_owner_receipts": {
      const r = bRecord(body.receipt);
      if (
        r.kind !== "dsh_command" ||
        r.id !== body.receiptId ||
        r.commandId !== body.ownerReceiptCommandId ||
        r.operationKey !== body.operationKey ||
        r.semanticPayloadHash !== body.semanticPayloadHash ||
        (r.result !== "applied" && r.result !== "blocked")
      )
        fail("receipt");
      if (body.basis !== null) {
        const b = record(body.basis);
        const names = [
          "commandReceipt",
          "appliedOperation",
          "binding",
          "createRecord",
          "control",
          "workGuard",
        ];
        for (let i = 0; i < names.length; i++) bRecord(b[names[i]!]);
        requireSame(b.commandReceipt, r);
      } else if (r.result !== "blocked") fail();
      break;
    }
    case "dsh_a_source_control_receipts":
      if (
        !has(
          ["observed_only", "invalidation_only", "needs_review"],
          body.disposition as string,
        )
      )
        fail();
      strings(body.reasonCodes);
      break;
    case "dsh_a_budget_account_memberships": {
      const o = fields(
        body.origin,
        "kind ownerId ownerEpoch accountId accountRevision authorityHash",
      );
      if (
        o.kind !== "ledger_observation" ||
        o.ownerId !== body.ownerId ||
        o.accountId !== body.accountId ||
        body.unitProfile !== "dsh_budget_usd_micros_v1" ||
        body.originDigest !==
          dshAHash(["dsh-a-budget-observation-origin-v1", o])
      )
        fail();
      int(o.ownerEpoch);
      int(o.accountRevision);
      hash(o.authorityHash);
      break;
    }
  }
  const expected = dshAuthorityColdIndices(table, body, row);
  const names = objectKeys(expected);
  for (let i = 0; i < names.length; i++)
    if (!same(row[names[i]!], expected[names[i]!])) fail("index");
  return body;
}
/** Closed SQL projection, shared with row/cold validation. */
export function dshAuthorityColdIndices(table: string, b: R, row: R = {}): R {
  const c = record(b.command ?? {}),
    p = record(b.projection ?? {}),
    d = record(p.document ?? {}),
    a = record(b.assessment ?? {}),
    t = record(b.transport ?? {}),
    budget = b.budget === null ? {} : record(b.budget ?? {}),
    w = record(b.window ?? {});
  const base =
    own(row, "scope_id") && own(b, "scopeId") ? { scope_id: b.scopeId } : {};
  const direct: Readonly<Record<string, string>> = {
    dsh_a_source_configuration_heads: "binding_id:bindingId revision:revision",
    dsh_a_mandate_heads:
      "mandate_id:mandateId mandate_revision:mandateRevision revision:revision",
    dsh_a_control_operations:
      "operation_id:operationId control_id:controlId scope_key:scopeKey record_kind:recordKind axis_or_leaf:axis target_epoch:targetEpoch previous_revision:previousRevision canonical_hash:canonicalHash domains_hash:domainsHash semantic_key:semanticKey",
    dsh_a_control_targets: "operation_id:operationId owner_domain:ownerDomain",
    dsh_a_control_heads:
      "control_id:controlId scope_key:scopeKey record_kind:recordKind axis_or_leaf:axis epoch:epoch revision:revision operation_id:operationId",
    dsh_a_control_domain_receipts:
      "operation_id:operationId owner_domain:ownerDomain receipt_id:receiptId",
    dsh_a_assessment_attempts:
      "input_id:inputId mandate_id:mandateId assessment_version:assessmentVersion attempt_id:attemptId proof_version:proofVersion mandate_revision:mandateRevision previous_selection_revision:previousSelectionRevision",
    dsh_a_assessment_candidates:
      "candidate_id:candidateId attempt_id:attemptId output_hash:outputHash",
    dsh_a_selections:
      "input_id:inputId mandate_id:mandateId assessment_version:assessmentVersion assessment_id:assessmentId previous_selection_hash:previousSelectionHash",
    dsh_a_selection_heads:
      "input_id:inputId mandate_id:mandateId assessment_version:assessmentVersion",
    dsh_a_decisions:
      "decision_id:decisionId input_id:inputId mandate_id:mandateId policy_version:policyVersion mandate_revision:mandateRevision evaluated_snapshot_hash:evaluatedSnapshotHash assessment_version:assessmentVersion",
    dsh_a_delivery_heads:
      "command_id:commandId revision:revision fencing_token:fencingToken delivery_state:state",
    dsh_a_control_delivery_heads:
      "operation_id:operationId owner_domain:ownerDomain revision:revision fencing_token:fencingToken delivery_state:state",
    dsh_a_owner_receipts: "command_id:acceptedCommandId receipt_id:receiptId",
    dsh_a_source_control_receipts:
      "input_id:inputId proof_version:proofVersion disposition:disposition command_id:commandId",
    dsh_a_shadow_results:
      "input_id:inputId mandate_id:mandateId policy_version:policyVersion mandate_revision:mandateRevision evaluated_snapshot_hash:evaluatedSnapshotHash",
    dsh_a_budget_account_memberships:
      "account_id:accountId owner_id:ownerId mandate_id:mandateId unit_profile:unitProfile origin_digest:originDigest",
  };
  const out: R = { ...base };
  const mappings = direct[table] ? split(direct[table]!, " ") : [];
  for (let i = 0; i < mappings.length; i++) {
    const pair = split(mappings[i]!, ":"),
      column = pair[0]!,
      path = pair[1]!;
    out[column] = b[path] ?? null;
  }
  if (table === "dsh_a_domains")
    assign(out, {
      profile_id: record(b.storageScope).profileId,
      workspace_id: record(b.storageScope).workspaceId,
      principal_id: b.principalId,
      budget_owner_id: budget.ownerId ?? null,
      budget_account_id: budget.accountId ?? null,
      budget_unit_profile: budget.unitProfile ?? null,
      authority_id: b.authorityId,
      authority_epoch: b.authorityEpoch,
      revision: b.revision,
      state: b.state,
    });
  if (table === "dsh_a_source_configurations")
    assign(out, {
      binding_id: record(record(b.configuration).binding).bindingId,
      revision: b.revision,
      configuration_hash: b.configurationHash,
    });
  if (table === "dsh_a_source_setups")
    assign(out, {
      setup_id: record(b.configuration).setupId,
      revision: b.revision,
      configuration_hash: b.configurationHash,
    });
  if (table === "dsh_a_owner_domains")
    assign(out, {
      owner_domain: b.domainId,
      owner_kind: b.kind,
      registration_ref: b.registrationRef,
    });
  if (table === "dsh_a_mandates")
    assign(out, {
      mandate_id: d.mandateId,
      mandate_revision: d.revision,
      source_binding_id: d.sourceBindingId,
      content_hash: p.contentHash,
    });
  if (table === "dsh_a_control_domain_receipts") out.receipt_hash = dshAHash(b);
  if (table === "dsh_a_windows")
    assign(out, {
      source_binding_id: b.sourceBindingId,
      prefix_mode_hash: w.prefixModeGuardsHash,
      window_id: w.windowId,
    });
  if (table === "dsh_a_assessments")
    assign(out, {
      assessment_id: a.assessmentId,
      candidate_id: b.candidateId,
      attempt_id: b.attemptId,
      assessment_hash: a.assessmentHash,
    });
  if (table === "dsh_a_selection_heads") out.revision = b.assessmentVersion;
  if (table === "dsh_a_decisions")
    out.supersedes_decision_id = b.supersedesDecisionId ?? null;
  if (table === "dsh_a_work_bindings")
    assign(out, {
      binding_id: b.bindingId,
      source_binding_id: record(b.thread).sourceBindingId,
      stable_thread_key: dshAHash(b.thread),
      generation: b.generation,
      mandate_id: b.mandateId,
      revision: b.version,
      transport_kind: t.kind,
    });
  if (table === "dsh_a_command_outbox")
    assign(out, {
      command_id: c.commandId,
      binding_id: c.bindingId,
      input_id: c.inputId,
      command_class: b.commandClass,
      operation_key: c.operationKey,
      attempt_hash: c.attemptPayloadHash,
      semantic_hash: c.semanticPayloadHash,
      decision_id: b.decisionId,
      target_domain: b.targetDomain,
    });
  if (table === "dsh_a_owner_receipts")
    out.receipt_hash = record(b.receipt).recordDigest;
  return out;
}

export interface DshAuthorityColdSqlRow {
  readonly table: string;
  readonly row: Readonly<R>;
}
/** Validate the complete original A child snapshot. This does not construct
 * any opaque proof, command eligibility or restored authority. */
export function validateDshAuthorityColdGraph(
  rows: readonly DshAuthorityColdSqlRow[],
): void {
  const tables = map<string, Array<{ row: R; body: R }>>();
  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i]!,
      row = record(entry.row),
      body =
        entry.table === "dsh_a_profile"
          ? {}
          : record(apply(parse, JSON, [row.data_json as string]));
    const bucket = tables.get(entry.table) ?? [];
    put(bucket, { row, body });
    tables.set(entry.table, bucket);
  }
  const all = (table: string) => tables.get(table) ?? [];
  const find = (table: string, wanted: R) => {
    const entries = all(table),
      names = objectKeys(wanted);
    let found: (typeof entries)[number] | undefined;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      let match = true;
      for (let j = 0; j < names.length; j++)
        if (!same(entry.row[names[j]!], wanted[names[j]!])) match = false;
      if (match) {
        if (found) fail("foreign_key");
        found = entry;
      }
    }
    if (!found) fail("foreign_key");
    return found;
  };
  const parent = (table: string, row: R) =>
    find("dsh_a_domains", { scope_id: row.scope_id });
  const equalFields = (a: R, b: R, names: string) => {
    const fields = split(names, " ");
    for (let i = 0; i < fields.length; i++)
      requireSame(a[fields[i]!], b[fields[i]!]);
  };
  // Original fixed DDL defines all FK tuples, including nullable and deferred
  // cycles. No foreign schema or caller SQL is accepted by this consumer.
  const statements = split(DSH_A_AUTHORITY_DDL, "CREATE TABLE ");
  for (let si = 1; si < statements.length; si++) {
    const statement = statements[si]!,
      end = index(statement, ");"),
      table = trim(slice(statement, 0, index(statement, "("))),
      ddl = slice(statement, 0, end);
    const pattern = /FOREIGN KEY\(([^)]+)\) REFERENCES ([a-z_]+)\(([^)]+)\)/g;
    for (;;) {
      const match = apply(exec, pattern, [ddl]) as RegExpExecArray | null;
      if (!match) break;
      const local = split(match[1]!, ","),
        target = split(match[3]!, ",");
      const entries = all(table);
      for (let ei = 0; ei < entries.length; ei++) {
        const entry = entries[ei]!;
        const wanted: R = {};
        let absent = false;
        for (let i = 0; i < local.length; i++) {
          const value = entry.row[trim(local[i]!)];
          if (value === null) {
            absent = true;
            break;
          }
          wanted[trim(target[i]!)] = value;
        }
        if (!absent) find(match[2]!, wanted);
      }
    }
  }
  const scans = all("dsh_a_source_scans");
  for (let si = 0; si < scans.length; si++) {
    const scan = scans[si]!;
    const scanId = scan.row.scan_id,
      reads: GithubSourceStorageRow[] = [],
      snapshots: GithubSourceStorageRow[] = [];
    const readIds = list(scan.body.readAttemptIds),
      snapshotIds = list(scan.body.snapshotIds);
    for (let i = 0; i < readIds.length; i++)
      put(
        reads,
        dshGithubColdStorageRow(
          "dsh_a_source_reads",
          find("dsh_a_source_reads", {
            attempt_id: readIds[i],
            scan_id: scanId,
          }).row,
        ),
      );
    for (let i = 0; i < snapshotIds.length; i++)
      put(
        snapshots,
        dshGithubColdStorageRow(
          "dsh_a_source_snapshots",
          find("dsh_a_source_snapshots", { snapshot_id: snapshotIds[i] }).row,
        ),
      );
    const selected = find("dsh_a_source_read_sets", {
        scan_id: scanId,
        read_set_id: scan.row.read_set_id,
      }),
      checkpoints = all("dsh_a_source_content_checkpoints");
    let checkpoint: GithubSourceStorageRow | null = null;
    for (let i = 0; i < checkpoints.length; i++)
      if (checkpoints[i]!.row.scan_id === scanId)
        checkpoint = dshGithubColdStorageRow(
          "dsh_a_source_content_checkpoints",
          checkpoints[i]!.row,
        );
    validateGithubSourceRelations({
      scan: dshGithubColdStorageRow("dsh_a_source_scans", scan.row),
      reads,
      snapshots,
      readSet: dshGithubColdStorageRow("dsh_a_source_read_sets", selected.row),
      checkpoint,
      imports: [],
      observations: [],
    });
  }
  for (let ri = 0; ri < rows.length; ri++) {
    const entry = rows[ri]!;
    if (entry.table === "dsh_a_profile") continue;
    const row = entry.row as R,
      b = record(apply(parse, JSON, [row.data_json as string]));
    if (entry.table === "dsh_a_domains") {
      const profile = find("dsh_a_profile", { singleton: 1 }).row;
      if (
        b.scopeId !==
        dshAHash(["dsh-a-domain-v1", profile.store_id, b.storageScope])
      )
        fail("domain_scope");
    } else if (entry.table === "dsh_a_owner_domains") {
      const domain=parent(entry.table,row).body;requireSame(b.storageScope,domain.storageScope);
      if(b.writerProfile==="broker_dsh_control_v1"){const baseline=readBrokerBaselineReceipt(b.brokerBaseline),authority=record(baseline.authority);if(authority.authorityId!==domain.authorityId||int(authority.authorityEpoch)>int(domain.authorityEpoch))fail("broker_registration_authority");}
    }
    else if (entry.table === "dsh_a_source_configurations") {
      const history = all("dsh_a_source_binding_revisions");
      let matched = false;
      for (let i = 0; i < history.length; i++)
        if (
          history[i]!.row.binding_id === row.binding_id &&
          same(history[i]!.body.binding, record(b.configuration).binding)
        )
          matched = true;
      if (!matched) fail("configuration_history");
    } else if (entry.table === "dsh_a_mandates") {
      const document = record(record(b.projection).document),
        issuer = dshMandateIssuerEpoch(b),
        domain = parent(entry.table, row).body;
      if (issuer > int(domain.authorityEpoch)) fail("mandate_issuer");
      if (document.revision === 1) {
        if (document.authorizationEpoch !== issuer) fail("mandate_epoch");
      } else {
        const old = find("dsh_a_mandates", {
            scope_id: row.scope_id,
            mandate_id: row.mandate_id,
            mandate_revision: int(document.revision) - 1,
          }).body,
          previous = record(record(old.projection).document);
        if (
          document.authorizationEpoch !==
          int(previous.authorizationEpoch) + 1
        )
          fail("mandate_epoch");
      }
    } else if (entry.table === "dsh_a_mandate_heads") {
      const m = find("dsh_a_mandates", {
        scope_id: row.scope_id,
        mandate_id: row.mandate_id,
        mandate_revision: row.mandate_revision,
      });
      if (
        record(record(m.body.projection).document).revision !==
        b.mandateRevision
      )
        fail("mandate_head");
    } else if (
      entry.table === "dsh_a_control_heads" ||
      entry.table === "dsh_a_control_operations"
    ) {
      const h = entry.table === "dsh_a_control_heads" ? b : record(b.head),
        domain = parent(entry.table, row).body;
      if (h.scopeKey !== dshSourceScopeKey(domain.storageScope, h.identity))
        fail("control_scope");
      const id =
        h.recordKind === "policy"
          ? "dsh-policy:" + dshAHash(["dsh-policy-v1", h.scopeKey, h.axis])
          : "dsh-leaf:" +
            dshAHash(["dsh-authorization-leaf-v1", h.scopeKey, h.axis]);
      if (id !== h.controlId) fail("control_identity");
      if (
        h.axis === "egress" &&
        h.recordKind === "leaf" &&
        h.policyHash !==
          dshAHash([
            "dsh-a-egress-policy-v1",
            domain.storageScope,
            h.identity,
            h.value,
          ])
      )
        fail("egress_hash");
      if (h.axis === "mandate" && h.recordKind === "leaf") {
        const v = record(h.value),
          published = find("dsh_a_mandates", {
            scope_id: row.scope_id,
            mandate_id: v.mandateId,
            mandate_revision: v.revision,
          }).body;
        requireSame(record(published.projection).document, v);
      }
      if (entry.table === "dsh_a_control_operations") {
        let expected: unknown;
        if (
          h.recordKind === "policy" &&
          h.axis === "mode" &&
          h.operationId ===
            dshAHash([
              "dsh-a-mode-control-v1",
              row.scope_id,
              h.scopeKey,
              h.epoch,
            ])
        )
          expected = dshAHash({
            kind: "mode",
            identity: h.identity,
            mode: record(h.value).mode,
            epoch: h.epoch,
          });
        else if (
          h.recordKind === "policy" &&
          h.axis !== "mode" &&
          h.operationId ===
            dshAHash([
              "dsh-a-scope-policy-v1",
              row.scope_id,
              h.scopeKey,
              h.axis,
              h.epoch,
            ])
        )
          expected = dshAHash({
            kind: "scope_policy",
            identity: h.identity,
            axis: h.axis,
            allowed: record(h.value).allowed,
            epoch: h.epoch,
          });
        else if (
          h.recordKind === "leaf" &&
          h.axis === "egress" &&
          h.operationId ===
            dshAHash([
              "dsh-a-egress-control-v1",
              row.scope_id,
              h.scopeKey,
              h.epoch,
            ])
        )
          expected = h.policyHash;
        else if (
          h.recordKind === "leaf" &&
          h.operationId ===
            dshAHash([
              "dsh-a-user-leaf-v1",
              row.scope_id,
              h.scopeKey,
              h.axis,
              h.epoch,
            ])
        )
          expected = dshAHash(["dsh-a-leaf-value-v1", h.axis, h.value]);
        else if (h.recordKind === "policy" && h.axis === "mode") {
          const setups = all("dsh_a_source_setups");
          for (let i = 0; i < setups.length; i++)
            if (
              h.operationId ===
              dshAHash([
                "dsh-a-connect-source-mode-v1",
                row.scope_id,
                record(setups[i]!.body.configuration).setupId,
                record(h.identity).sourceBindingId,
              ])
            )
              expected = dshAHash(h);
        }
        if (expected === undefined || b.canonicalHash !== expected)
          fail("control_hash");
      } else
        requireSame(
          find("dsh_a_control_operations", {
            scope_id: row.scope_id,
            operation_id: b.operationId,
          }).body.head,
          b,
        );
    } else if (entry.table === "dsh_a_control_targets") {
      const op = find("dsh_a_control_operations", {
        scope_id: row.scope_id,
        operation_id: row.operation_id,
      }).body;
      equalFields(b, op, "operationId controlId");
      if (
        b.canonicalHash !== dshAHash(record(op.head).value) ||
        b.epoch !== op.targetEpoch
      )
        fail("control_target");
    } else if (entry.table === "dsh_a_control_domain_receipts") {
      const target = find("dsh_a_control_targets", {
        scope_id: row.scope_id,
        operation_id: row.operation_id,
        owner_domain: row.owner_domain,
      }).body;
      equalFields(
        b,
        target,
        "operationId ownerDomain controlId epoch canonicalHash",
      );
      if(b.kind==="original_broker_control_receipt"){
        const registration=find("dsh_a_owner_domains",{scope_id:row.scope_id,owner_domain:row.owner_domain}).body;
        const baseline=readBrokerBaselineReceipt(registration.brokerBaseline),r=readBrokerFenceReceipt(b.brokerReceipt);
        if(registration.writerProfile!=="broker_dsh_control_v1"||r.realmId!==registration.storeId||r.domainId!==registration.domainId||dshAJson(r.request)!==dshAJson(projectDshBrokerControlTarget(target,registration.storageScope,baseline.authority,registration.storeId))||b.receiptId!=="broker-control:"+brokerAdmissionDigest(r))fail("broker_control_relation");
      }
      else if (b.kind === "original_b_control_receipt") {
        const c = record(b.ownerControl),
          command = record(target.command);
        requireSame(c.scope, command.scope);
        requireSame(c.identity, command.identity);
        requireSame(c.value, command.value);
        if (
          c.epoch !== command.epoch ||
          (command.type === "leaf"
            ? c.factKind !== command.factKind
            : c.axis !== command.axis)
        )
          fail("owner_control");
      }
    } else if (entry.table === "dsh_a_assessment_attempts") {
      const input = find("dsh_a_inbox", { input_id: row.input_id }).body,
        proof = find("dsh_a_input_proofs", {
          input_id: row.input_id,
          proof_version: row.proof_version,
        }).body;
      if (
        proof.provenanceVersion !== b.proofVersion ||
        record(input.envelope).thread === undefined
      )
        fail("attempt_input");
      const mandate = find("dsh_a_mandates", {
        scope_id: row.scope_id,
        mandate_id: row.mandate_id,
        mandate_revision: row.mandate_revision,
      }).body;
      if (record(record(mandate.projection).document).mandateId !== b.mandateId)
        fail("attempt_mandate");
    } else if (entry.table === "dsh_a_assessment_candidates") {
      const attempt = find("dsh_a_assessment_attempts", {
        scope_id: row.scope_id,
        attempt_id: row.attempt_id,
      }).body;
      if (
        b.outputHash !==
          dshAHash(["dsh-a-assessment-candidate-v1", b.attemptId, b.result]) ||
        b.candidateId !== "dsh-assessment-candidate:" + b.outputHash
      )
        fail("candidate_hash");
      equalFields(b, attempt, "assessmentVersion purpose validUntil");
      equalFields(
        b,
        record(attempt.modelPolicy),
        "modelId promptVersion ruleVersion",
      );
      if (
        b.evidenceManifestHash !== record(attempt.evidenceManifest).manifestHash
      )
        fail("candidate_evidence");
    } else if (entry.table === "dsh_a_assessments") {
      const candidate = find("dsh_a_assessment_candidates", {
          scope_id: row.scope_id,
          candidate_id: row.candidate_id,
        }).body,
        a = record(b.assessment);
      if (
        candidate.attemptId !== b.attemptId ||
        a.assessmentId !== "dsh-assessment:" + candidate.outputHash
      )
        fail("assessment_candidate");
      equalFields(
        a,
        candidate,
        "assessmentVersion purpose evidenceManifestHash modelId promptVersion ruleVersion dataEgressPolicyRef",
      );
      equalFields(
        a,
        record(candidate.result),
        "suggestedIntent evidenceRefs uncertainty",
      );
      if (instantMs(a.validUntil as string) !== candidate.validUntil)
        fail("assessment_deadline");
    } else if (
      entry.table === "dsh_a_selections" ||
      entry.table === "dsh_a_selection_heads"
    ) {
      if (entry.table === "dsh_a_selection_heads")
        requireSame(
          find("dsh_a_selections", {
            scope_id: row.scope_id,
            input_id: row.input_id,
            mandate_id: row.mandate_id,
            assessment_version: row.assessment_version,
          }).body,
          b,
        );
      const final = find("dsh_a_assessments", {
          scope_id: row.scope_id,
          assessment_id: b.assessmentId,
        }).body,
        a = record(final.assessment),
        attempt = find("dsh_a_assessment_attempts", {
          scope_id: row.scope_id,
          attempt_id: final.attemptId,
        }).body;
      equalFields(b, a, "assessmentVersion assessmentId assessmentHash");
      equalFields(b, attempt, "inputId mandateId mandateRevision");
      if (
        b.assessmentVersion === 1 &&
        b.previousSelectionHash !== zeroSelectionHash
      )
        fail("selection_previous");
      if (b.assessmentVersion === 2) {
        const previous = find("dsh_a_selections", {
          scope_id: row.scope_id,
          input_id: row.input_id,
          mandate_id: row.mandate_id,
          assessment_version: 1,
        }).body;
        if (b.previousSelectionHash !== dshAHash(previous))
          fail("selection_previous");
      }
    } else if (entry.table === "dsh_a_decisions") {
      if (b.assessmentVersion !== null) {
        const selected = find("dsh_a_selections", {
          scope_id: row.scope_id,
          input_id: row.input_id,
          mandate_id: row.mandate_id,
          assessment_version: row.assessment_version,
        }).body;
        if (record(b.suggestion).assessmentRef !== selected.assessmentId)
          fail("decision_assessment");
      }
    } else if (entry.table === "dsh_a_work_bindings") {
      const c = record(
        find("dsh_a_command_outbox", {
          scope_id: row.scope_id,
          command_id: row.create_command_id,
        }).body.command,
      );
      if (
        c.action !== "create_draft_work" ||
        c.bindingId !== b.bindingId ||
        c.inputId !== row.canonical_initial_input_id ||
        record(c.canonical).createManifestHash !== row.canonical_manifest_hash
      )
        fail("binding_canonical");
      requireSame(c.thread, b.thread);
      if (record(b.transport).kind === "bound") {
        const receipt = find("dsh_a_owner_receipts", {
            scope_id: row.scope_id,
            command_id: row.create_command_id,
          }).body,
          r = record(receipt.receipt);
        if (
          r.result !== "applied" ||
          record(b.transport).ownerWorkId !== r.ownerWorkId
        )
          fail("binding_receipt");
      }
    } else if (entry.table === "dsh_a_command_outbox") {
      const c = record(b.command),
        binding = find("dsh_a_work_bindings", {
          scope_id: row.scope_id,
          binding_id: row.binding_id,
        }).body;
      requireSame(c.thread, binding.thread);
      requireSame(c.scope, parent(entry.table, row).body.storageScope);
      if (c.mandateId !== binding.mandateId) fail("command_binding");
      const mandate = find("dsh_a_mandates", {
        scope_id: row.scope_id,
        mandate_id: c.mandateId,
        mandate_revision: c.mandateRevision,
      }).body;
      if (
        record(record(mandate.projection).document).authorizationEpoch !==
        c.authorizationEpoch
      )
        fail("command_epoch");
    } else if (entry.table === "dsh_a_owner_receipts") {
      const outbox = find("dsh_a_command_outbox", {
          scope_id: row.scope_id,
          command_id: row.command_id,
        }).body,
        c = record(outbox.command),
        r = record(b.receipt);
      requireSame(r.command, c);
      if (
        b.ownerDomain !== outbox.targetDomain ||
        r.commandId !== c.commandId ||
        r.operationKey !== c.operationKey ||
        r.semanticPayloadHash !== c.semanticPayloadHash
      )
        fail("receipt_command");
      if (b.basis !== null) {
        const basis = record(b.basis),
          registration = find("dsh_a_owner_domains", {
            scope_id: row.scope_id,
            owner_domain: b.ownerDomain,
          }).body;
        const names = [
          "commandReceipt",
          "appliedOperation",
          "binding",
          "createRecord",
          "control",
          "workGuard",
        ];
        for (let i = 0; i < names.length; i++) {
          const value = record(basis[names[i]!]);
          if (value.writerStoreId !== registration.storeId)
            fail("receipt_store");
          requireSame(value.scope, c.scope);
        }
      }
    } else if (
      entry.table === "dsh_a_delivery_heads" &&
      b.state === "receipt_observed"
    )
      find("dsh_a_owner_receipts", {
        scope_id: row.scope_id,
        command_id: row.command_id,
      });
    else if (
      entry.table === "dsh_a_control_delivery_heads" &&
      b.state === "receipt_observed"
    )
      find("dsh_a_control_domain_receipts", {
        scope_id: row.scope_id,
        operation_id: row.operation_id,
        owner_domain: row.owner_domain,
      });
    else if (entry.table === "dsh_a_budget_account_memberships") {
      const domain = parent(entry.table, row).body,
        o = record(b.origin),
        budget = record(domain.budget);
      if (
        b.ownerId !== budget.ownerId ||
        o.authorityHash !==
          dshAHash([
            "dsh-a-budget-authority-v1",
            {
              storageScope: domain.storageScope,
              principalId: domain.principalId,
              authorityId: domain.authorityId,
              authorityEpoch: domain.authorityEpoch,
            },
          ])
      )
        fail("budget_origin");
    }
  }
}

export function dshGithubColdStorageRow(
  table: GithubSourceTable,
  row: R,
): GithubSourceStorageRow {
  const encoded = row.data_json as string,
    body = record(apply(parse, JSON, [encoded]));
  const key: R = {},
    index: R = {};
  const spec =
    table === "dsh_a_source_scans"
      ? ["scan_id", "binding_id binding_revision read_set_id"]
      : table === "dsh_a_source_reads"
        ? ["attempt_id", "scan_id plan_hash"]
        : table === "dsh_a_source_snapshots"
          ? [
              "snapshot_id",
              "binding_id read_attempt_id entry_index role content_hash",
            ]
          : table === "dsh_a_source_read_sets"
            ? ["read_set_id", "scan_id binding_id"]
            : ["binding_id", "revision scan_id read_set_id"];
  const names = split(spec[0]!, " ");
  for (let i = 0; i < names.length; i++) key[names[i]!] = row[names[i]!];
  const indices = split(spec[1]!, " ");
  for (let i = 0; i < indices.length; i++)
    index[indices[i]!] = row[indices[i]!];
  return {
    table,
    key,
    index,
    data: body,
    json: encoded,
    hash: row.body_hash as string,
    bytes: row.logical_bytes as number,
  };
}
