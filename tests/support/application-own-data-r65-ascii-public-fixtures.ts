// Approved R65 regression support: virtual tests/support module. Product setup/invocation awaits APPROVE.
import { createHash } from 'node:crypto';
import { createIntentApplicationBinding, intentApplicationBindingHash } from '../../src/runtime/verification/intent-application-binding.js';
import { intentHostSubjectOwner } from '../../src/runtime/verification/intent-host-subject.js';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import { readPublishedArtifacts } from '../../src/runtime/verification/published-artifact-reader.js';
import { validIntentCandidate, sections, selection } from './application-own-data-r64-fixtures.js';
import { ASCII_ESCAPE_BOUNDARIES } from './application-own-data-r65-ascii-boundaries.js';

// Independent concrete reader fixture for each literal boundary. Paths permit DEL;
// identifier fields reject DEL and must keep their existing control guard.
export function prepareAsciiBoundaryReader(index: number) {
  const boundary = ASCII_ESCAPE_BOUNDARIES[index];
  if (!boundary) throw Error('unknown_ascii_boundary');
  const candidate = validIntentCandidate();
  const verification = {
    version: 1 as const,
    obligations: [{
      obligationId: 'o', predicateId: 'p', predicateVersion: '1', semantics: 'current-subject' as const,
      recipe: { kind: 'artifact-content' as const, checks: [{
        id: 'c', path: boundary.legalPath, sha256: 'a'.repeat(64), structure: 'utf8' as const,
      }] },
    }],
  };
  const contract = { ...candidate.contract, verification,
    stages: candidate.contract.stages.map(stage => ({ ...stage, verification })) };
  // Root and stage definitions carry identical legal boundary paths. Creating the
  // binding precedes poisoning; parsing through reader is the actual test entry.
  const binding = createIntentApplicationBinding({ ...candidate, contract });
  const owner = { profileId: 'profile', ...intentHostSubjectOwner(binding.subject) };
  const application = { binding, bindingHash: intentApplicationBindingHash(binding), revision: 1 };
  const evaluations = sections().map(section => ({ ...section, application }));
  const bytes = Buffer.from(canonicalVerificationJson({ version: 1, owner, dependencies: [], evaluations, application }));
  const payload = { owner, businessRevision: 1, operationId: 'publication', fullTupleHash: 'b'.repeat(64),
    payloadHash: createHash('sha256').update(bytes).digest('hex'), bytes };
  const selections = [{ ...selection }];
  return { boundary, publicEntry: 'readPublishedArtifacts' as const,
    fixtureField: 'application.binding.contract.verification.obligations[0].recipe.checks[0].path' as const,
    invoke: () => readPublishedArtifacts(payload, selections) };
}
