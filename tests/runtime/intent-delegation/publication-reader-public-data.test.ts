import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseIntentPublicationCandidates, type IntentPublicationReaderLedgerData,
  type IntentPublicationCandidate, type IntentApplicationAttempt } from '../../../src/runtime/intent-delegation/publication-candidate-journal.js';
import { deriveIntentParentBody } from '../../../src/runtime/intent-delegation/parent-candidate.js';
import { parseIntentBusinessProjection, type IntentBusinessProjection } from '../../../src/runtime/intent-delegation/business-projection.js';
import { parseIntentReceiverAttempts, type IntentReceiverAttempt } from '../../../src/runtime/intent-delegation/receiver-publication-journal.js';
import { createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/types.js';
import { captureIntentData } from '../../../src/runtime/intent-delegation/data.js';
import { parseIntentBusinessContract, intentBusinessContractHash, type IntentBusinessContract } from '../../../src/runtime/verification/intent-business-contract.js';
import { createIntentApplicationBinding, intentApplicationBindingHash, type IntentStagePublicationReference } from '../../../src/runtime/verification/intent-application-binding.js';
import { intentHostSubjectOwner } from '../../../src/runtime/verification/intent-host-subject.js';
import { intentContractOriginalRegistration, intentOriginalRegistrationHash } from '../../../src/runtime/verification/intent-contract-enrollment.js';
import { canonicalVerificationJson as json } from '../../../src/runtime/verification/protocol.js';
import type { IntentPlanDraft, PlannedStep } from '../../../src/ai/intent-delegation/types.js';

// All status/owner/clock fields below are SYNTHETIC PUBLIC DTO DATA. No enrolled,
// ready, committed or clock token is evidence that any SDK/native/verifier ran.
// There is no host/store/client/issuer construction and no qualification call.
type WireRow = Omit<IntentPublicationCandidate, 'body'> & { body: unknown };
const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
const fullInputHash = (value: unknown) => hash(captureIntentData(value));
const H = createHash('sha256').update('DATA ONLY, NOT A GRANT').digest('hex');

function wireRow(contract: Readonly<IntentBusinessContract>, id: string, stageId: string | null, body: unknown): WireRow {
  const capturedBody = captureIntentData(body);
  const binding = createIntentApplicationBinding({ version: 1, kind: 'intent',
    subject: { version: 1, sessionId: contract.sessionId, intentId: contract.intentId, stageId },
    candidateId: id, candidateRevision: 1, contract, body: capturedBody });
  return { version: 1, id, intentId: contract.intentId, stageId, candidateRevision: 1,
    contractHash: intentBusinessContractHash(contract), body,
    bodyHash: hash(capturedBody), bindingHash: intentApplicationBindingHash(binding),
    sourceHash: hash({ contract: binding.contract, body: binding.body, fileObservations: [] }),
    fileObservations: [], createdAt: 100,
    applicationAttempts: [{ requestId: `${id}-reserved-data`, revision: 1, phase: 'reserved',
      route: null, observation: null, retirementReason: null, createdAt: 100, updatedAt: 100 }],
  };
}
function fixture(options: { undefinedReports?: boolean; reverseSubject?: boolean; negativeZeroEpoch?: boolean } = {}) {
  const step: PlannedStep = { stepId: 'data-step', key: 'collect', order: 0, role: 'collect',
    skillName: null, dependsOn: [], status: 'planned', riskTier: 'low' };
  const plan: IntentPlanDraft = { instanceId: 'data-instance', sessionId: 'data-session', intentId: 'data-intent',
    rawIntent: 'Synthetic DATA contract', normalizedIntent: 'synthetic data contract',
    providedSourcePaths: [], intentType: 'generate', deliverable: 'data.txt', finalDeliverable: 'data.txt',
    explicitConstraints: [], delegationBoundary: [], riskTier: 'low', intentMode: 'single_stage',
    segmentationConfidence: 'low', templateId: 'data-template', continuationMode: 'new_intent',
    stages: [{ stageId: 'data-stage', order: 0, label: 'DATA stage', intentType: 'generate',
      deliverable: 'data.txt', templateId: 'data-template', riskTier: 'low',
      dependsOnStageIds: [], steps: [step] }], steps: [step] };
  const definition = { version: 1, obligations: [{ obligationId: 'data-obligation', predicateId: 'content',
    predicateVersion: '1', semantics: 'current-subject', recipe: { kind: 'artifact-content', checks: [{
      id: 'content', path: 'data.txt', sha256: H, structure: 'utf8',
    }] } }] };
  const { instanceId: _instance, continuationMode: _mode, steps: _steps, ...contractPlan } = plan;
  const contract = parseIntentBusinessContract({ version: 1, ...contractPlan, verification: definition,
    stages: plan.stages.map(stage => ({ ...stage, verification: definition,
      steps: stage.steps.map(({ status: _status, ...data }) => data) })) });
  // Real public DATA creator, not a fake native factory or a cloned private brand.
  const originalDraft = createIntentLedgerRecord(plan, 100);
  const draftHash = createHash('sha256').update('xiaok-intent-native-draft-v1\0')
    .update(json(captureIntentData(originalDraft))).digest('hex');
  const nativeData = { version: 1, id: 'data-native-record', revision: 1,
    intentId: contract.intentId, contract, contractHash: intentBusinessContractHash(contract),
    originalDraft, originalDraftHash: draftHash, originalSource: 'user',
    subjects: [{ stageId: 'data-stage', attempts: [{ requestId: 'data-native-stage', phase: 'enrolled', retirementReason: null }] },
      { stageId: null, attempts: [{ requestId: 'data-native-parent', phase: 'enrolled', retirementReason: null }] }],
    createdAt: 100, updatedAt: 100 };
  const stageBody = { kind: 'intent-stage', stageId: 'data-stage', summary: 'Synthetic DATA summary',
    executionReports: [], artifacts: [], ...(options.undefinedReports ? { producerReports: undefined } : {}) };
  const childBase = wireRow(contract, 'data-child', 'data-stage', stageBody);
  const subject = { version: 1 as const, sessionId: contract.sessionId, intentId: contract.intentId, stageId: 'data-stage' };
  const owner = { profileId: 'synthetic-data-profile', ...intentHostSubjectOwner(subject) };
  const route = json({ kind: 'protected-unregistered', authorityId: 'synthetic-data-authority', owner });
  const registrationHash = intentOriginalRegistrationHash(intentContractOriginalRegistration({ subject, contract }));
  const deadline = { domainId: 'synthetic-data-clock', qualificationEpoch: 0, notBefore: 0, validUntil: 1000 };
  const application: IntentApplicationAttempt = { requestId: 'data-application', revision: 3, phase: 'ready', route,
    observation: { state: 'committed', challengePhase: 'committed', challengeId: 'data-app-challenge',
      reviewHash: H, registrationHash, deadline, current: { bindingHash: childBase.bindingHash, revision: 1 },
      pendingTransitionId: null }, retirementReason: null, createdAt: 100, updatedAt: 120 };
  const receiver: IntentReceiverAttempt = { requestId: 'data-receiver-request', candidateId: childBase.id,
    applicationRequestId: application.requestId, bindingHash: childBase.bindingHash, sourceHash: childBase.sourceHash,
    route, originalSource: 'user', ordinal: 1, revision: 2, status: 'committed',
    challenge: { challengeId: 'data-publication-challenge', owner, fullTupleHash: H, deadline },
    observation: { status: 'committed', owner, operationId: 'data-operation', fullTupleHash: H,
      businessRevision: 1, currentVerification: 'unavailable' },
    retirement: null, createdAt: 121, updatedAt: 122 };
  const projection: IntentBusinessProjection = { version: 1, candidateId: childBase.id,
    receiverRequestId: receiver.requestId, appliedAt: 130,
    clock: { domainId: 'synthetic-data-clock', qualificationEpoch: 0, lowerBound: 0, upperBound: 1000, evidenceHash: H },
    publications: [{ owner, operationId: 'data-operation', fullTupleHash: H, businessRevision: 1,
      payloadHash: H, bindingHash: childBase.bindingHash, applicationRevision: 1,
      candidateRevision: 1, registrationHash }] };
  const child: WireRow = { ...childBase, applicationAttempts: [application], receiverAttempts: [receiver], businessProjection: projection };
  const refSubject = options.reverseSubject
    ? { stageId: 'data-stage', intentId: contract.intentId, sessionId: contract.sessionId, version: 1 as const }
    : subject;
  const reference: IntentStagePublicationReference = { subject: refSubject, candidateId: child.id,
    candidateRevision: 1, bindingHash: child.bindingHash, immutablePayloadHash: H,
    operationId: 'data-operation', fullTupleHash: H, committedBusinessRevision: 1,
    receiverId: 'synthetic-data-receiver', receiverProtocolVersion: 1,
    receiverInstanceEpoch: options.negativeZeroEpoch ? -0 : 0 };
  const parentBody = { kind: 'intent-parent' as const, summary: 'Synthetic DATA summary', stages: [reference], artifacts: [] };
  const parent = wireRow(contract, 'data-parent', null, parentBody);
  const selectedLegacyFacts = { intentId: contract.intentId, intentType: 'review',
    stages: [{ stageId: 'data-stage', status: 'completed', steps: [{ stepId: 'data-step', key: 'collect', status: 'completed' }],
      structuralValidation: 'passed', semanticValidation: 'pending' }],
    overallStatus: 'completed', producerReports: [], executionTerminals: [], artifacts: [] };
  const unselected = { intentId: 'unselected-legacy', intentType: 'review', stages: null,
    overallStatus: 'legacy-status', artifacts: [{ legacy: true }] };
  const ledger = { sessionId: contract.sessionId, nativeContracts: [nativeData],
    publicationCandidates: [child, parent], intents: [selectedLegacyFacts, unselected],
    unselectedHistory: { kept: ['review', 'unknown'], qualified: false } };
  // Verify structural compatibility without a cast or a Modern-ledger promise.
  const readerInput: IntentPublicationReaderLedgerData = ledger;
  return { ledger: readerInput, completeRaw: ledger, child, parent, stageBody, parentBody,
    contract, reference, receiver, projection, selectedLegacyFacts, unselected };
}
function parsedChild(input: IntentPublicationReaderLedgerData): IntentPublicationCandidate {
  const row = parseIntentPublicationCandidates(input).find(value => value.id === 'data-child');
  if (!row) throw Error('missing_actual_parsed_child');
  return row;
}

describe('real public publication DATA reader positive and adversarial vectors', () => {
  it('accepts a complete synthetic stage/projection/receiver DATA chain without upgrading selected or unselected legacy records', () => {
    const f = fixture(), input = { ...f.completeRaw, publicationCandidates: [f.child] };
    const before = structuredClone(input), beforeHash = fullInputHash(input);
    const rows = parseIntentPublicationCandidates(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body.kind).toBe('intent-stage');
    expect(rows[0]?.receiverAttempts?.[0]?.status).toBe('committed');
    expect(rows[0]?.receiverAttempts?.[0]?.observation?.currentVerification).toBe('unavailable');
    expect(input.intents[0]?.intentType).toBe('review');
    expect(input.intents[1]).toEqual(f.unselected);
    expect(input).toEqual(before); expect(fullInputHash(input)).toBe(beforeHash);
  });
  it('accepts the complete parent journal and retains the original full Raw DATA/hash', () => {
    const f = fixture(), before = structuredClone(f.completeRaw), beforeHash = fullInputHash(f.completeRaw);
    const rows = parseIntentPublicationCandidates(f.ledger);
    expect(rows.map(row => row.id)).toEqual(['data-child', 'data-parent']);
    const parent = rows.find(row => row.id === 'data-parent');
    expect(parent?.body).toEqual(f.parentBody);
    expect(Object.isFrozen(rows)).toBe(true);
    expect(f.completeRaw).toEqual(before); expect(fullInputHash(f.completeRaw)).toBe(beforeHash);
  });
  it('derives the parent through the actual public helper and the exact synthetic child fact reference', () => {
    const f = fixture();
    expect(deriveIntentParentBody(f.ledger, f.contract.intentId, [f.reference])).toEqual(f.parentBody);
  });
  it('parses the real complete business projection against the real parsed candidate DATA', () => {
    const f = fixture(), child = parsedChild(f.ledger);
    expect(parseIntentBusinessProjection(f.projection, child, f.ledger)).toEqual(f.projection);
    expect(f.projection.clock.qualificationEpoch).toBe(0); // DTO number, not a qualified private clock.
  });
  it('parses real receiver challenge/observation/sequence DTOs without creating a publication client', () => {
    const f = fixture(), child = parsedChild(f.ledger);
    expect(parseIntentReceiverAttempts([f.receiver], child)).toEqual([f.receiver]);
  });
  it('accepts real subject key-order normalization while returning the original captured row body order', () => {
    const f = fixture({ reverseSubject: true });
    const binding = createIntentApplicationBinding({ version: 1, kind: 'intent',
      subject: { version: 1, sessionId: f.contract.sessionId, intentId: f.contract.intentId, stageId: null },
      candidateId: f.parent.id, candidateRevision: 1, contract: f.contract, body: f.parentBody });
    if (binding.body.kind !== 'intent-parent') throw Error('expected_real_parent_binding');
    expect(Object.keys(f.reference.subject)).toEqual(['stageId', 'intentId', 'sessionId', 'version']);
    expect(Object.keys(binding.body.stages[0]!.subject)).toEqual(['version', 'sessionId', 'intentId', 'stageId']);
    expect(json(binding.body)).toBe(json(f.parentBody));
    const parent = parseIntentPublicationCandidates(f.ledger).find(row => row.id === 'data-parent');
    if (!parent || parent.body.kind !== 'intent-parent') throw Error('expected_real_parent_row');
    expect(Object.keys(parent.body.stages[0]!.subject)).toEqual(Object.keys(f.reference.subject));
  });
  it('accepts original own-undefined capture normalization without silently replacing the caller body', () => {
    const f = fixture({ undefinedReports: true }), before = structuredClone(f.completeRaw);
    expect(Object.hasOwn(f.stageBody, 'producerReports')).toBe(true);
    const child = parsedChild(f.ledger);
    expect(Object.hasOwn(child.body, 'producerReports')).toBe(false);
    expect(Object.hasOwn(f.stageBody, 'producerReports')).toBe(true);
    expect(f.completeRaw).toEqual(before);
  });
  it('retains legal negative-zero DATA epoch semantics under canonical JSON rather than fabricating a real epoch', () => {
    const f = fixture({ negativeZeroEpoch: true });
    expect(Object.is(f.reference.receiverInstanceEpoch, -0)).toBe(true);
    const rows = parseIntentPublicationCandidates(f.ledger), parent = rows.find(row => row.id === 'data-parent');
    if (!parent || parent.body.kind !== 'intent-parent') throw Error('expected_real_parent_row');
    expect(Object.is(parent.body.stages[0]?.receiverInstanceEpoch, -0)).toBe(true);
    expect(json(parent.body)).toBe(json(f.parentBody));
  });
  it('rejects a schema-legal but crosslinked-wrong parent fullTuple through the original public entry', () => {
    const f = fixture(), body = { ...f.parentBody, stages: [{ ...f.reference, fullTupleHash: hash('wrong tuple') }] };
    const parent = wireRow(f.contract, f.parent.id, null, body);
    expect(() => parseIntentPublicationCandidates({ ...f.ledger, publicationCandidates: [f.child, parent] }))
      .toThrow('intent_parent_reference');
  });
  it('rejects a schema-legal projection that names no matching receiver', () => {
    const f = fixture(), child = { ...f.child, businessProjection: { ...f.projection, receiverRequestId: 'no-such-receiver' } };
    expect(() => parseIntentPublicationCandidates({ ...f.ledger, publicationCandidates: [child] }))
      .toThrow('intent_projection_original');
  });
  it('rejects a receiver fact with a foreign binding using the actual public receiver parser', () => {
    const f = fixture(), child = parsedChild(f.ledger);
    expect(() => parseIntentReceiverAttempts([{ ...f.receiver, bindingHash: hash('foreign binding') }], child))
      .toThrow('intent_receiver_identity');
  });
  it('documents the new selected-prefix earlier-error policy for a parent-first double-invalid journal', () => {
    const f = fixture();
    const child = { ...f.child, applicationAttempts: f.child.applicationAttempts.map(a => ({ ...a, revision: 0 })) };
    const parent = { ...f.parent, bodyHash: hash('also wrong parent body hash') };
    // Old path reaches parent hash after reading the child facts. R387 validates
    // the selected child prefix first and rejects its impossible ready revision.
    expect(() => parseIntentPublicationCandidates({ ...f.ledger, publicationCandidates: [parent, child] }))
      .toThrow('intent_candidate_attempt_revision');
  });
});
