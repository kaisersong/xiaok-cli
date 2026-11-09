import {
  dshAObjectKey,
  dshAHash,
  dshHeadIdentity as identity,
  dshHeadHash as hash,
  validateDshAObservation,
} from "../../src/runtime/multi-agent/dsh-admission-data.js";
import { captureIpcData } from "./ipc-data-snapshot.js";
const keys = Reflect.ownKeys,
  freeze = Object.freeze,
  isArray = Array.isArray;
function has(values: readonly unknown[], value: unknown): boolean {
  for (let i = 0; i < values.length; i++) if (values[i] === value) return true;
  return false;
}

export type DshSourceThread = {
  sourceBindingId: string;
  tenantId: string;
  workspaceId: string;
  provider: "github";
  repositoryId: string;
  kind: "issue";
  threadId: string;
};
export type DshSourceObservation = {
  thread: DshSourceThread;
  objectKind: "issue" | "comment";
  objectId: string;
  providerRevision: string;
  contentHash: string;
  kind: "created" | "edited" | "deleted" | "snapshot";
  completeness: "complete" | "partial" | "unknown";
  paginationComplete: boolean;
  sourceEvidenceHash: string;
};
export type DshSourceObjectFreeze = Readonly<{
  reasonCode: "REVISION_CONTENT_CONFLICT" | "REVISION_ORDER_UNPROVEN";
  observationHash: string;
}>;
export type DshSourceObjectState = Readonly<{
  current: DshSourceObservation | null;
  freeze: DshSourceObjectFreeze | null;
}>;
export type DshSourceRevisionComparison = Readonly<{
  objectIdentity: string;
  previousRevision: string;
  candidateRevision: string;
  relation: "same" | "newer" | "older" | "incomparable";
  evidenceHash: string;
}>;
export type DshSourceObjectResult = Readonly<{
  state: DshSourceObjectState;
  disposition:
    | "accepted"
    | "duplicate"
    | "ignored_stale_revision"
    | "needs_review";
  reasonCode: string | null;
  invalidatedRevision: string | null;
}>;
function fail(): never {
  throw Error("dsh_source_object_contract");
}
function fields(
  value: unknown,
  names: readonly string[],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isArray(value)) fail();
  const namesFound = keys(value);
  if (namesFound.length !== names.length) fail();
  for (let i = 0; i < namesFound.length; i++)
    if (typeof namesFound[i] !== "string" || !has(names, namesFound[i])) fail();
}
function observation(value: unknown): asserts value is DshSourceObservation {
  validateDshAObservation(value);
}
function objectKey(value: DshSourceObservation): string {
  return dshAObjectKey(value as unknown as Record<string, unknown>);
}
/** Identity data only. Neither this hash nor a comparison DTO authenticates a Source. */
export function dshSourceObjectIdentity(value: unknown): string {
  const data = captureIpcData(value, "dsh_source_object_contract");
  observation(data);
  return objectKey(data);
}
function complete(value: DshSourceObservation): boolean {
  return value.completeness === "complete" && value.paginationComplete;
}
function freezeData<T>(value: T): T {
  if (value && typeof value === "object") {
    const names = keys(value);
    for (let i = 0; i < names.length; i++)
      freezeData((value as Record<PropertyKey, unknown>)[names[i]!]);
    freeze(value);
  }
  return value;
}
function comparison(
  value: unknown,
  previous: DshSourceObservation,
  candidate: DshSourceObservation,
): DshSourceRevisionComparison | null {
  if (value === null) return null;
  fields(value, [
    "objectIdentity",
    "previousRevision",
    "candidateRevision",
    "relation",
    "evidenceHash",
  ]);
  hash(value.objectIdentity);
  hash(value.evidenceHash);
  identity(value.previousRevision);
  identity(value.candidateRevision);
  if (
    value.objectIdentity !== objectKey(candidate) ||
    value.previousRevision !== previous.providerRevision ||
    value.candidateRevision !== candidate.providerRevision ||
    !has(["same", "newer", "older", "incomparable"], value.relation)
  )
    fail();
  if (
    (value.relation === "same") !==
    (previous.providerRevision === candidate.providerRevision)
  )
    fail();
  return value as DshSourceRevisionComparison;
}
/** Pure safety plan for the original A transaction, not a provider comparator,
 * authorization, inbox, or dispatch permit. The caller must first retain all
 * original Source SDK results and authenticate complete observation/comparison
 * evidence; shape checks here do not supply that authority. */
export function reduceDshSourceObjectHead(
  stateInput: unknown,
  candidateInput: unknown,
  comparisonInput: unknown,
): DshSourceObjectResult {
  const state = captureIpcData(stateInput, "dsh_source_object_contract");
  const candidate = captureIpcData(
    candidateInput,
    "dsh_source_object_contract",
  );
  const proof = captureIpcData(comparisonInput, "dsh_source_object_contract");
  fields(state, ["current", "freeze"]);
  observation(candidate);
  if (state.current !== null) {
    observation(state.current);
    if (!complete(state.current)) fail();
  }
  if (state.freeze !== null) {
    fields(state.freeze, ["reasonCode", "observationHash"]);
    hash(state.freeze.observationHash);
    if (
      state.current === null ||
      !has(
        ["REVISION_CONTENT_CONFLICT", "REVISION_ORDER_UNPROVEN"],
        state.freeze.reasonCode,
      )
    )
      fail();
  }
  const previous = state.current;
  if (previous !== null && objectKey(previous) !== objectKey(candidate))
    throw Error("dsh_source_object_domain");
  const order =
    previous === null
      ? proof === null
        ? null
        : fail()
      : comparison(proof, previous, candidate);
  const result = (
    next: DshSourceObjectState,
    disposition: DshSourceObjectResult["disposition"],
    reasonCode: string | null = null,
    invalidatedRevision: string | null = null,
  ): DshSourceObjectResult =>
    freezeData({ state: next, disposition, reasonCode, invalidatedRevision });
  const held = state as DshSourceObjectState;
  if (state.freeze !== null)
    return result(held, "needs_review", "SOURCE_OBJECT_FROZEN");
  // A partial representation's hash cannot contradict a complete object hash.
  if (!complete(candidate))
    return result(held, "needs_review", "SOURCE_OBSERVATION_INCOMPLETE");
  if (previous === null)
    return result({ current: candidate, freeze: null }, "accepted");
  const sameContent =
    previous.contentHash === candidate.contentHash &&
    (previous.kind === "deleted") === (candidate.kind === "deleted");
  const relation =
    previous.providerRevision === candidate.providerRevision
      ? "same"
      : (order?.relation ?? "incomparable");
  if (relation === "older") return result(held, "ignored_stale_revision");
  if (relation === "same" && sameContent) return result(held, "duplicate");
  if (relation === "newer")
    return result(
      { current: candidate, freeze: null },
      "accepted",
      null,
      previous.providerRevision,
    );
  const reasonCode =
    relation === "same"
      ? "REVISION_CONTENT_CONFLICT"
      : "REVISION_ORDER_UNPROVEN";
  if (sameContent) return result(held, "needs_review", reasonCode);
  // Conflicts only narrow. No observation automatically resolves this freeze.
  const observationHash = dshAHash([
    "dsh-source-conflict-v1",
    objectKey(candidate),
    candidate.providerRevision,
    candidate.contentHash,
    candidate.kind,
    candidate.sourceEvidenceHash,
  ]);
  return result(
    { current: previous, freeze: { reasonCode, observationHash } },
    "needs_review",
    reasonCode,
    previous.providerRevision,
  );
}
