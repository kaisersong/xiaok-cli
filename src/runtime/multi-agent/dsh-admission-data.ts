import { types } from "node:util";
import { createHash, Hash } from "node:crypto";
import { canonicalVerificationJson as json } from "../verification/protocol.js";
import {instantMs} from '../admission/parse.js';
const proxy = types.isProxy,
  descriptor = Object.getOwnPropertyDescriptor,
  proto = Object.getPrototypeOf,
  objectPrototype = Object.prototype,
  keys = Reflect.ownKeys,
  own = Object.hasOwn,
  isArray = Array.isArray,
  finite = Number.isSafeInteger,
  exec = Function.prototype.call.bind(RegExp.prototype.exec);
const hashApply = Reflect.apply,
  hashUpdate = Hash.prototype.update,
  hashDigest = Hash.prototype.digest;
function hashText(text: string): string {
  const state = createHash("sha256");
  hashApply(hashUpdate, state, [text]);
  return hashApply(hashDigest, state, ["hex"]) as string;
}
export type DshARecord = Record<string, unknown>;
export const DSH_A_PROFILE = "main_dsh_source_ingress_writer_v1";
export const DSH_A_TABLES = Object.freeze([
  "dsh_a_profile",
  "dsh_a_source_bindings",
  "dsh_a_inbox",
  "dsh_a_input_proofs",
  "dsh_a_object_heads",
] as const);
export const DSH_A_DIGEST = hashText(
  "main-dsh-source-ingress-v1|original-store-native-transaction|kind-input-key|immutable-input-versioned-proof|same-object-head|original-schema4-inheritance",
);
export const DSH_A_FUNCTION = "xiaok_main_dsh_source_ingress_v1";
export const DSH_A_DDL = `CREATE TABLE dsh_a_profile(singleton INTEGER PRIMARY KEY CHECK(singleton=1),profile TEXT NOT NULL,digest TEXT NOT NULL,store_id TEXT NOT NULL);
CREATE TABLE dsh_a_source_bindings(binding_id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
CREATE TABLE dsh_a_inbox(input_id TEXT PRIMARY KEY,input_key TEXT NOT NULL UNIQUE,binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),object_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
CREATE TABLE dsh_a_input_proofs(input_id TEXT NOT NULL REFERENCES dsh_a_inbox(input_id),proof_version INTEGER NOT NULL,proof_hash TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(input_id,proof_version));
CREATE TABLE dsh_a_object_heads(object_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL REFERENCES dsh_a_source_bindings(binding_id),revision INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);`;
export function dshAHash(value: unknown): string {
  return hashText(json(value));
}
export function dshAJson(value: unknown): string {
  return json(value);
}
export function dshAFail(code = "DSH_A_CONTRACT_INVALID"): never {
  throw Error(code);
}
export function dshAFields(
  value: unknown,
  names: readonly string[],
  optional: readonly string[] = [],
): asserts value is DshARecord {
  if (
    !value ||
    typeof value !== "object" ||
    proxy(value) ||
    isArray(value) ||
    (proto(value) !== objectPrototype && proto(value) !== null)
  )
    dshAFail();
  const found = keys(value);
  if (found.length < names.length || found.length > names.length+optional.length) dshAFail();
  for (let i = 0; i < names.length; i++) {
    const row = descriptor(value, names[i]!);
    if (!row || !own(row, "value") || !row.enumerable) dshAFail();
  }
  for(let i=0;i<found.length;i++){
    const key=found[i];let accepted=false;
    for(let j=0;j<names.length;j++)if(key===names[j])accepted=true;
    for(let j=0;j<optional.length;j++)if(key===optional[j])accepted=true;
    const row=descriptor(value,key!);if(!accepted||!row||!own(row,'value')||!row.enumerable)dshAFail();
  }
}
export function dshAText(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 2048 ||
    exec(/[\x00-\x1f\x7f]/, value)
  )
    dshAFail();
}
export function dshARevision(value: unknown): asserts value is number {
  if (!finite(value) || typeof value !== "number" || value < 1) dshAFail();
}
export function dshAAuth(value: unknown): asserts value is DshARecord {
  dshAFields(value, [
    "tenantId",
    "workspaceId",
    "connectionId",
    "providerAccountId",
    "repositoryId",
    "credentialEpoch",
  ]);
  const names = [
    "tenantId",
    "workspaceId",
    "connectionId",
    "providerAccountId",
    "repositoryId",
  ];
  for (let i = 0; i < names.length; i++) dshAText(value[names[i]!]);
  dshARevision(value.credentialEpoch);
}
export function dshAThread(value: unknown): asserts value is DshARecord {
  dshAFields(value, [
    "sourceBindingId",
    "tenantId",
    "workspaceId",
    "provider",
    "repositoryId",
    "kind",
    "threadId",
  ]);
  const names = keys(value);
  for (let i = 0; i < names.length; i++) dshAText(value[names[i] as string]);
  if (value.provider !== "github" || value.kind !== "issue") dshAFail();
}
export function dshASourceKey(provider: unknown, auth: DshARecord): string {
  if (provider !== "github") dshAFail();
  return dshAHash([
    "dsh-a-source-v1",
    auth.tenantId,
    auth.workspaceId,
    provider,
    auth.repositoryId,
  ]);
}
export function dshABinding(value: unknown): asserts value is DshARecord {
  dshAFields(value, [
    "bindingId",
    "provider",
    "authScope",
    "sourceBindingVersion",
    "roleMappingVersion",
    "provenanceVersion",
  ]);
  dshAText(value.bindingId);
  if (value.provider !== "github") dshAFail();
  dshAAuth(value.authScope);
  const names = [
    "sourceBindingVersion",
    "roleMappingVersion",
    "provenanceVersion",
  ];
  for (let i = 0; i < names.length; i++) dshARevision(value[names[i]!]);
}
const ENVELOPE = [
  "thread",
  "authScope",
  "providerEventId",
  "objectKind",
  "objectId",
  "providerRevision",
  "contentHash",
  "receivedAt",
  "objectAuthorId",
  "actorEvidence",
  "actorMappingVersion",
  "provenanceVersion",
  "actorEvidenceHash",
  "kind",
  "trust",
  "snapshotRef",
  "completeness",
  "paginationComplete",
  "authorizationCheckedAt",
] as const;
export function dshAEnvelope(value: unknown): asserts value is DshARecord {
  dshAFields(value, ENVELOPE,['providerOccurredAt','providerTimeEvidenceRef']);
  if(own(value,'providerOccurredAt'))instantMs(value.providerOccurredAt as string);
  if(own(value,'providerTimeEvidenceRef'))dshAText(value.providerTimeEvidenceRef);
  dshAThread(value.thread);
  dshAAuth(value.authScope);
  const t = value.thread,
    a = value.authScope;
  const scopeNames = ["tenantId", "workspaceId", "repositoryId"];
  for (let i = 0; i < scopeNames.length; i++)
    if (t[scopeNames[i]!] !== a[scopeNames[i]!]) dshAFail();
  const texts = [
      "objectId",
      "providerRevision",
      "snapshotRef",
      "receivedAt",
      "authorizationCheckedAt",
    ],
    hashes = ["contentHash", "actorEvidenceHash"],
    revisions = ["actorMappingVersion", "provenanceVersion"];
  for (let i = 0; i < texts.length; i++) dshAText(value[texts[i]!]);
  for (let i = 0; i < hashes.length; i++) {
    const v = value[hashes[i]!];
    if (typeof v !== "string" || !exec(/^[a-f0-9]{64}$/, v)) dshAFail();
  }
  for (let i = 0; i < revisions.length; i++) dshARevision(value[revisions[i]!]);
  if (
    (value.objectKind !== "issue" && value.objectKind !== "comment") ||
    (value.objectKind === "issue" && value.objectId !== t.threadId) ||
    (value.kind !== "created" &&
      value.kind !== "edited" &&
      value.kind !== "deleted" &&
      value.kind !== "snapshot") ||
    (value.completeness !== "complete" &&
      value.completeness !== "partial" &&
      value.completeness !== "unknown") ||
    typeof value.paginationComplete !== "boolean" ||
    value.trust !== "external_untrusted"
  )
    dshAFail();
  const optional = ["providerEventId", "objectAuthorId"];
  for (let i = 0; i < optional.length; i++)
    if (value[optional[i]!] !== null) dshAText(value[optional[i]!]);
  const e = value.actorEvidence as DshARecord;
  if (e?.kind === "unknown") {
    dshAFields(e, ["kind", "reason"]);
    dshAText(e.reason);
  } else {
    const field =
      e?.kind === "verified_event"
        ? "eventRef"
        : e?.kind === "verified_audit"
          ? "auditRef"
          : null;
    if (!field) dshAFail();
    dshAFields(e, ["kind", field, "triggerActorId"]);
    dshAText(e[field]);
    dshAText(e.triggerActorId);
  }
}
/** Canonical identity includes kind per frozen5.2; proof upgrades are separate. */
export function dshAInputKey(e: DshARecord): string {
  const t = e.thread as DshARecord;
  return dshAHash([
    "dsh-a-input-v1",
    t.sourceBindingId,
    e.objectKind,
    e.objectId,
    e.providerRevision,
    e.contentHash,
    e.kind,
  ]);
}
export function dshAProof(e: DshARecord): DshARecord {
  return {
    actorEvidence: e.actorEvidence,
    actorMappingVersion: e.actorMappingVersion,
    provenanceVersion: e.provenanceVersion,
    actorEvidenceHash: e.actorEvidenceHash,
    authScope: e.authScope,
    authorizationCheckedAt: e.authorizationCheckedAt,
  };
}
export function dshAObservation(e: DshARecord): DshARecord {
  return {
    thread: e.thread,
    objectKind: e.objectKind,
    objectId: e.objectId,
    providerRevision: e.providerRevision,
    contentHash: e.contentHash,
    kind: e.kind,
    completeness: e.completeness,
    paginationComplete: e.paginationComplete,
    sourceEvidenceHash: e.actorEvidenceHash,
  };
}
/** Shared identity tuple for the original Head and original SQL capture.
 * Data only; callers authenticate and validate the already captured record. */
export function dshAObjectKey(e: DshARecord): string {
  const t = e.thread as DshARecord;
  return dshAHash([
    "dsh-source-object-v1",
    t.sourceBindingId,
    t.tenantId,
    t.workspaceId,
    t.provider,
    t.repositoryId,
    t.kind,
    t.threadId,
    e.objectKind,
    e.objectId,
  ]);
}
/** Stored metadata validation for original SQL readers; supplies no authority. */
export function validateDshAStoredBody(
  table: string,
  value: unknown,
): asserts value is DshARecord {
  if (table === "dsh_a_source_bindings") {
    dshAFields(value, ["binding", "status", "revision"]);
    dshABinding(value.binding);
    dshARevision(value.revision);
    if (value.status !== "active" && value.status !== "locally_revoked")
      dshAFail();
  } else if (table === "dsh_a_inbox") {
    dshAFields(value, ["inputId", "envelope"]);
    dshAEnvelope(value.envelope);
    if (value.inputId !== "dsh-input:" + dshAInputKey(value.envelope))
      dshAFail();
  } else if (table === "dsh_a_input_proofs") {
    dshAFields(value, [
      "actorEvidence",
      "actorMappingVersion",
      "provenanceVersion",
      "actorEvidenceHash",
      "authScope",
      "authorizationCheckedAt",
    ]);
    dshARevision(value.actorMappingVersion);
    dshARevision(value.provenanceVersion);
    dshAAuth(value.authScope);
    dshAText(value.authorizationCheckedAt);
    if (
      typeof value.actorEvidenceHash !== "string" ||
      !exec(/^[a-f0-9]{64}$/, value.actorEvidenceHash)
    )
      dshAFail();
    const actor = value.actorEvidence as DshARecord;
    if (actor?.kind === "unknown") {
      dshAFields(actor, ["kind", "reason"]);
      dshAText(actor.reason);
    } else if (
      actor?.kind === "verified_event" ||
      actor?.kind === "verified_audit"
    ) {
      const field = actor.kind === "verified_event" ? "eventRef" : "auditRef";
      dshAFields(actor, ["kind", field, "triggerActorId"]);
      dshAText(actor[field]);
      dshAText(actor.triggerActorId);
    } else dshAFail();
  } else if (table === "dsh_a_object_heads") {
    dshAFields(value, ["objectId", "revision", "state"]);
    dshAText(value.objectId);
    dshARevision(value.revision);
    dshAFields(value.state, ["current", "freeze"]);
    if (value.state.current !== null) {
      const v = value.state.current;
      validateDshAObservation(v);
      if (
        dshAObjectKey(v) !== value.objectId ||
        v.completeness !== "complete" ||
        v.paginationComplete !== true
      )
        dshAFail();
    }
    if (value.state.freeze !== null) {
      if (value.state.current === null) dshAFail();
      dshAFields(value.state.freeze, ["reasonCode", "observationHash"]);
      dshHeadHash(value.state.freeze.observationHash);
      if (
        value.state.freeze.reasonCode !== "REVISION_CONTENT_CONFLICT" &&
        value.state.freeze.reasonCode !== "REVISION_ORDER_UNPROVEN"
      )
        dshAFail();
    }
  } else dshAFail();
}
const headChar = Function.prototype.call.bind(String.prototype.charCodeAt);
export function dshHeadIdentity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > 2048)
    dshAFail("dsh_source_object_contract");
  for (let i = 0; i < value.length; i++) {
    const code = headChar(value, i);
    if (code === 0) dshAFail("dsh_source_object_contract");
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = headChar(value, ++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        dshAFail("dsh_source_object_contract");
    } else if (code >= 0xdc00 && code <= 0xdfff)
      dshAFail("dsh_source_object_contract");
  }
}
export function dshHeadHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || exec(/^[a-f0-9]{64}$/, value) === null)
    dshAFail("dsh_source_object_contract");
}
/** The original Head observation parser, shared with cold SQL metadata reads. */
export function validateDshAObservation(
  value: unknown,
): asserts value is DshARecord {
  dshAFields(value, [
    "thread",
    "objectKind",
    "objectId",
    "providerRevision",
    "contentHash",
    "kind",
    "completeness",
    "paginationComplete",
    "sourceEvidenceHash",
  ]);
  dshAFields(value.thread, [
    "sourceBindingId",
    "tenantId",
    "workspaceId",
    "provider",
    "repositoryId",
    "kind",
    "threadId",
  ]);
  const thread = value.thread,
    names = [
      "sourceBindingId",
      "tenantId",
      "workspaceId",
      "repositoryId",
      "threadId",
    ];
  for (let i = 0; i < names.length; i++) dshHeadIdentity(thread[names[i]!]);
  if (
    thread.provider !== "github" ||
    thread.kind !== "issue" ||
    (value.objectKind !== "issue" && value.objectKind !== "comment")
  )
    dshAFail("dsh_source_object_contract");
  dshHeadIdentity(value.objectId);
  dshHeadIdentity(value.providerRevision);
  dshHeadHash(value.contentHash);
  dshHeadHash(value.sourceEvidenceHash);
  if (
    (value.kind !== "created" &&
      value.kind !== "edited" &&
      value.kind !== "deleted" &&
      value.kind !== "snapshot") ||
    (value.completeness !== "complete" &&
      value.completeness !== "partial" &&
      value.completeness !== "unknown") ||
    typeof value.paginationComplete !== "boolean" ||
    (value.objectKind === "issue" && value.objectId !== thread.threadId)
  )
    dshAFail("dsh_source_object_contract");
}
