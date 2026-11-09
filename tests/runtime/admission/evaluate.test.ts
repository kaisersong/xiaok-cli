import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/a2-snapshot.json', import.meta.url), 'utf8'));
const vectors = JSON.parse(readFileSync(new URL('./fixtures/a2-vectors.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(fixture));
const load = () => import('../../../src/runtime/admission/evaluate.js');
function bound(s: any) {
    s.binding.value = {
        kind: 'bound', binding: {
            bindingId: 'work.binding.1', mandateId: 'mandate.1', thread: s.input.envelope.thread, generation: 1, ownerKind: 'kswarm_dsh', version: 1, transport: {
                kind: 'bound', ownerWorkId: 'work.1', ownerVersion: 1, workCreatedAt: '2026-01-01T00:00:00.000Z', workExecutionDeadline: '2026-01-01T00:40:00.000Z'
            }
        }, ownerVersion: 1, inputSetRevision: 1, stopped: false, terminal: false, completionReached: false, generationClosed: false, workGuard: {
            scopeKey: 'actual-work-guard.1', epoch: 1, revision: 1, mode: 'auto_draft'
        }
    };
}
// Fixture integrity uses the real hash helpers, never an alternate evaluator.
function refresh(s: any, api: any) {
    const document = s.mandate.value.document, source = s.source.value, egress = s.egress.value;
    document.ownerDomainsHash = api.hashA2Data(['dsh-owner-domains-v1', document.ownerDomains]);
    s.mandate.value.contentHash = api.hashMandateProjection(s.mandate.value);
    const entry = s.input.evidence.value.entries[0], envelope = s.input.envelope;
    Object.assign(entry, {
        objectKind: envelope.objectKind, objectId: envelope.objectId, revision: envelope.providerRevision, contentHash: envelope.contentHash, provenanceVersion: envelope.provenanceVersion, actorEvidenceHash: envelope.actorEvidenceHash, actorMappingVersion: envelope.actorMappingVersion
    });
    Object.assign(source.evidenceHeads[0], entry);
    s.input.evidence.value.manifestHash = api.hashEvidenceManifest(s.input.evidence.value);
    const values = {
        source_auth: {
            authScope: source.binding.activeAuthScope, sourceBindingVersion: source.binding.version, roleMappingVersion: source.actorMappingVersion, provenanceVersion: source.provenanceVersion, status: source.credential, attestationRef: source.authAttestationRef
        }, mandate: document, egress: {
            policyRef: egress.policyRef, policyHash: egress.policyHash, provider: egress.provider, destinationRef: egress.destinationRef, purposes: egress.purposes, enabled: egress.decision === 'allow'
        }, readonly: s.mandate.value.workProfile.value
    };
    for (const leaf of s.controls.value.leaves) {
        if (leaf.kind !== 'readonly' || s.mandate.value.workProfile.state === 'known') {
            leaf.contentHash = api.hashA2Data(['dsh-authorization-leaf-v1', leaf.kind, values[leaf.kind as keyof typeof values]]);
        }
    }
    s.freshness.value.evidenceManifestHash = s.input.evidence.value.manifestHash;
    if (s.assessment) {
        s.assessment.evidenceManifestHash = s.input.evidence.value.manifestHash;
        s.assessment.assessmentHash = api.hashSemanticAssessment(s.assessment);
        if (s.selection.value.kind === 'selected') {
            s.selection.value.value.assessmentHash = s.assessment.assessmentHash;
        }
    }
}
describe('A2 original pure evaluator golden cases (synthetic facts are not producers)', () => {
    const cases = [
        [
            'explicit request', 'accept', 'EXPLICIT_DRAFT_REQUEST', (s: any) => {
            }
        ],
        [
            'active owner input', 'followup', 'ACTIVE_OWNER_INPUT', (s: any) => {
                bound(s);
                s.input.envelope.objectKind = 'comment';
                s.input.envelope.objectId = 'comment.3';
                s.input.envelope.kind = 'edited';
                s.assessment.suggestedIntent = 'followup';
            }
        ],
        [
            'ordinary chat', 'reject', 'NO_ACTIONABLE_REQUEST', (s: any) => {
                s.assessment.suggestedIntent = 'chat';
            }
        ],
        [
            'quoted request', 'reject', 'QUOTED_REQUEST_ONLY', (s: any) => {
                s.assessment.suggestedIntent = 'chat';
                s.assessment.uncertainty = 'QUOTED_REQUEST_ONLY';
            }
        ],
        [
            'ambiguous goal', 'needs_review', 'AMBIGUOUS_GOAL', (s: any) => {
                s.assessment.suggestedIntent = 'ambiguous';
            }
        ],
        [
            'out of mandate request', 'needs_review', 'OUT_OF_MANDATE_ACTION', (s: any) => {
                s.assessment.uncertainty = 'OUT_OF_MANDATE_ACTION';
            }
        ],
        [
            'out of selected issue', 'reject', 'OUT_OF_RULE_SCOPE', (s: any) => {
                s.mandate.value.document.selection.issueIds = ['other'];
            }
        ],
        [
            'verified actor denied', 'reject', 'ACTOR_NOT_WHITELISTED', (s: any) => {
                s.mandate.value.document.allowedActorProviderIds = ['other-actor'];
            }
        ],
        [
            'unknown editor', 'needs_review', 'TRIGGER_ACTOR_UNPROVEN', (s: any) => {
                s.input.envelope.kind = 'edited';
                s.input.envelope.actorEvidence = {
                    kind: 'unknown', reason: 'editor unavailable'
                };
            }
        ],
        [
            'consumed duplicate', 'reject', 'DUPLICATE_INPUT', (s: any) => {
                s.consumption.value = {
                    kind: 'consumed', thread: s.input.envelope.thread, inputId: 'input.1', evidenceManifestHash: s.input.evidence.value.manifestHash, mandateId: 'mandate.1', bindingId: 'work.binding.1', ownerWorkId: 'work.1', ownerVersion: 1, inputSetRevision: 1, operationKey: 'original.operation.1', semanticPayloadHash: 'f'.repeat(64), receiptRef: 'original.receipt.1'
                };
            }
        ],
        [
            'input conflict', 'needs_review', 'INPUT_CONFLICT', (s: any) => {
                s.source.value.evidenceHeads[0].state = 'conflict';
            }
        ],
        [
            'closed owner', 'needs_review', 'OWNER_NOT_RESUMABLE', (s: any) => {
                bound(s);
                s.binding.value.stopped = true;
            }
        ],
        [
            'other scope identity', 'reject', 'IDENTITY_OR_SCOPE_MISMATCH', (s: any) => {
                s.input.envelope.authScope.tenantId = 'other-tenant';
            }
        ],
    ] as const;
    for (const [name, verdict, reason, mutate] of cases) {
        it(name, async () => {
            const api = await load(), s = clone();
            mutate(s);
            refresh(s, api);
            const result = api.evaluateAdmission(s);
            expect(result.kind).toBe('admission_suggestion');
            if (result.kind === 'admission_suggestion') {
                expect(result.verdict).toBe(verdict);
                expect(result.reasonCodes).toEqual([reason]);
                if (reason === 'DUPLICATE_INPUT') {
                    expect(result.previousReceiptRef).toBe('original.receipt.1');
                }
            }
        });
    }
    for (const kind of ['snapshot', 'deleted'] as const) {
        it(kind + ' is a source-control result, never an AdmissionDecision', async () => {
            const api = await load(), envelope = {
                ...clone().input.envelope, kind
            };
            const result = api.classifySourceControl({
                envelope, controlEvidence: {
                    state: 'known', value: {
                        thread: envelope.thread, objectKind: envelope.objectKind, objectId: envelope.objectId, providerRevision: envelope.providerRevision, contentHash: envelope.contentHash, proofRef: 'source.proof.1', sourceBindingVersion: 1, kind: kind === 'deleted' ? 'verified_deletion' : 'verified_snapshot'
                    }
                }
            });
            expect(result.kind).toBe('source_control');
            expect(result.disposition).toBe(kind === 'deleted' ? 'invalidation_only' : 'observed_only');
            expect('verdict' in result).toBe(false);
            expect('assessmentRef' in result).toBe(false);
        });
    }
    it('matches the exact approved hash golden and preflight selection states', async () => {
        const api = await load(), s = clone();
        expect(api.hashEvaluationSnapshot(s)).toBe(vectors.vectors.find((v: any) => v.name === 'G1-selected-admission').expectedDigest);
        expect(api.preflightAdmission(s).state).toBe('assessment_available');
        s.assessment = null;
        s.selection.value = {
            kind: 'none'
        };
        expect(api.preflightAdmission(s)).toMatchObject({
            kind: 'preflight', state: 'assessment_required'
        });
        expect(api.hashPreflightSnapshot(s)).toBe(vectors.vectors[0].expectedDigest);
    });
});
describe('A2 deterministic boundaries', () => {
    const reason = (result: any) => result.reasonCodes[0];
    const unavailable = {
        state: 'unknown', reason: 'producer_unavailable'
    };
    for (const key of [
        'source', 'mandate', 'controls', 'egress', 'binding', 'consumption', 'selection', 'freshness'
    ] as const) {
        it('missing ' + key + ' never permits an admission', async () => {
            const api = await load(), s = clone();
            s[key] = unavailable;
            const result = api.evaluateAdmission(s);
            expect(result.kind).toBe('admission_suggestion');
            expect(result.verdict).not.toBe('accept');
            expect(result.verdict).not.toBe('followup');
        });
    }
    for (let level = 0; level < 5; level++) {
        it('prefix ' + level + ' observe forces shadow even caller requests admission', async () => {
            const api = await load(), s = clone();
            s.controls.value.prefixModes[level].mode = 'observe';
            const result = api.evaluateAdmission(s);
            expect(result.kind).toBe('shadow_suggestion');
            expect('verdict' in result).toBe(false);
            expect(result.reasonCodes).toEqual(['SHADOW_ONLY']);
        });
        it('prefix ' + level + ' off closes the gate', async () => {
            const api = await load(), s = clone();
            s.controls.value.prefixModes[level].mode = 'off';
            expect(reason(api.evaluateAdmission(s))).toBe('MODE_OFF');
        });
        it('prefix ' + level + ' scope cannot be substituted', async () => {
            const api = await load(), s = clone();
            s.controls.value.prefixModes[level].scopeKey = 'foreign-scope';
            expect(reason(api.evaluateAdmission(s))).toBe('IDENTITY_OR_SCOPE_MISMATCH');
        });
    }
    for (let cell = 0; cell < 20; cell++) {
        it('policy cell ' + cell + ' denies independently', async () => {
            const api = await load(), s = clone();
            s.controls.value.prefixPolicies[cell].allowed = false;
            const result = api.evaluateAdmission(s);
            expect(result.verdict).toBe('reject');
            expect(reason(result)).toBe(cell % 4 === 1 ? 'EGRESS_DENIED' : 'MANDATE_ACTION_UNAVAILABLE');
        });
    }
    for (let leaf = 0; leaf < 4; leaf++) {
        it('leaf ' + leaf + ' requires its exact frozen scope level', async () => {
            const api = await load(), s = clone();
            s.controls.value.leaves[leaf].scopeKey = s.controls.value.prefixModes[0].scopeKey;
            expect(reason(api.evaluateAdmission(s))).toBe('IDENTITY_OR_SCOPE_MISMATCH');
        });
    }
    for (const name of [
        'stopped', 'terminal', 'completionReached', 'generationClosed'
    ] as const) {
        it(name + ' cannot resume', async () => {
            const api = await load(), s = clone();
            bound(s);
            s.binding.value[name] = true;
            expect(reason(api.evaluateAdmission(s))).toBe('OWNER_NOT_RESUMABLE');
        });
    }
    it('work observe also forces shadow and cannot choose a new owner', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.workGuard.mode = 'observe';
        const result = api.evaluateAdmission(s);
        expect(result.kind).toBe('shadow_suggestion');
        for (const key of [
            'owner', 'command', 'verdict', 'bindingId', 'claim', 'run'
        ]) {
            expect(key in result).toBe(false);
        }
    });
    it('a modifier is judged by original actor evidence, never object author', async () => {
        const api = await load(), s = clone();
        s.input.envelope.objectAuthorId = 'not-allowed-author';
        expect(api.evaluateAdmission(s).verdict).toBe('accept');
        s.input.envelope.actorEvidence = {
            kind: 'verified_audit', auditRef: 'audit.2', triggerActorId: 'unallowed-editor'
        };
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('ACTOR_NOT_WHITELISTED');
    });
    it('a known hard rule mismatch outranks an unknown editor or budget', async () => {
        const api = await load(), s = clone();
        s.mandate.value.document.selection.issueIds = ['another'];
        s.input.envelope.actorEvidence = {
            kind: 'unknown', reason: 'no editor'
        };
        s.budget.draft = unavailable;
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('OUT_OF_RULE_SCOPE');
    });
    it('partial evidence is reviewed before a tempting conflict interpretation', async () => {
        const api = await load(), s = clone();
        s.input.envelope.completeness = 'partial';
        s.source.value.evidenceHeads[0].state = 'conflict';
        expect(reason(api.evaluateAdmission(s))).toBe('SNAPSHOT_INCOMPLETE');
    });
    for (const kind of ['pending', 'unknown']) {
        it('consumption ' + kind + ' cannot be inferred from cursors', async () => {
            const api = await load(), s = clone();
            s.consumption.value = {
                kind
            };
            expect(reason(api.evaluateAdmission(s))).toBe('OWNER_BINDING_UNCONFIRMED');
        });
    }
    for (const uncertainty of [
        '', ' ', 'quoted_request_only', ' QUOTED_REQUEST_ONLY', 'not_sure'
    ]) {
        it('non-null hint ' + JSON.stringify(uncertainty) + ' requires review', async () => {
            const api = await load(), s = clone();
            s.assessment.uncertainty = uncertainty;
            refresh(s, api);
            expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_UNCERTAIN');
        });
    }
    it('a quoted hint contradicting draft_request does not become a protocol reject', async () => {
        const api = await load(), s = clone();
        s.assessment.uncertainty = 'QUOTED_REQUEST_ONLY';
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_UNCERTAIN');
    });
    it('the same sentinel in an unbound prompt is never interpreted', async () => {
        const api = await load(), s = clone();
        s.assessment.promptVersion = 'old.prompt';
        s.assessment.suggestedIntent = 'chat';
        s.assessment.uncertainty = 'QUOTED_REQUEST_ONLY';
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_BINDING_MISMATCH');
    });
    for (const key of [
        'inputId', 'mandateId', 'assessmentId', 'assessmentHash'
    ] as const) {
        it('selected ' + key + ' must match the assessment tuple', async () => {
            const api = await load(), s = clone();
            s.selection.value.value[key] = key === 'assessmentHash' ? 'f'.repeat(64) : 'foreign';
            expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_SELECTION_UNCONFIRMED');
        });
    }
    it('a decisive body cannot appoint itself without an A selected pointer', async () => {
        const api = await load(), s = clone();
        s.selection.value = {
            kind: 'none'
        };
        expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_SELECTION_UNCONFIRMED');
    });
    for (const mutate of [(s: any) => {
            s.assessment.purpose = 'preview';
        }, (s: any) => {
            s.assessment.decisive = false;
        }]) {
        it('preview or nondecisive never admits', async () => {
            const api = await load(), s = clone();
            mutate(s);
            refresh(s, api);
            expect(reason(api.evaluateAdmission(s))).toBe('ASSESSMENT_PREVIEW_ONLY');
        });
    }
    it('shadow may classify a bound preview but has no verdict or permit fields', async () => {
        const api = await load(), s = clone();
        s.use = 'shadow';
        s.purpose = 'preview';
        s.assessment.purpose = 'preview';
        s.assessment.decisive = false;
        s.selection.value = {
            kind: 'none'
        };
        refresh(s, api);
        const result = api.evaluateAdmission(s);
        expect(result).toMatchObject({
            kind: 'shadow_suggestion', semanticClassification: 'draft_request'
        });
        expect('verdict' in result).toBe(false);
    });
    for (const refs of [[], ['unrelated']]) {
        it('empty or unrelated evidence references cannot admit ' + refs.length, async () => {
            const api = await load(), s = clone();
            s.assessment.evidenceRefs = refs;
            refresh(s, api);
            expect(api.evaluateAdmission(s).verdict).toBe('needs_review');
        });
    }
    it('valid assessment reuse does not re-charge the assessment request budget', async () => {
        const api = await load(), s = clone();
        s.budget.assessment = unavailable;
        expect(api.evaluateAdmission(s).verdict).toBe('accept');
        s.assessment = null;
        s.selection.value = {
            kind: 'none'
        };
        expect(reason(api.preflightAdmission(s))).toBe('BUDGET_UNCONFIRMED');
    });
    it('budget recovery changes only the related snapshot, never issues a permit', async () => {
        const api = await load(), s = clone(), before = api.hashEvaluationSnapshot(s);
        s.budget.draft.value.remainingTokens = 0;
        expect(reason(api.evaluateAdmission(s))).toBe('BUDGET_EXHAUSTED');
        s.budget.draft.value.remainingTokens = 21000;
        s.budget.draft.value.scopeRevision = 2;
        expect(api.hashEvaluationSnapshot(s)).not.toBe(before);
        expect(api.evaluateAdmission(s).verdict).toBe('accept');
    });
    it('mandate deadline tightening applies and widening cannot extend the original bound work', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.assessment.validUntil = '2026-01-01T01:00:00.000Z';
        s.clock.nowMs = Date.parse('2026-01-01T00:20:00.000Z');
        s.mandate.value.document.limits.executionDeadline = '2026-01-01T00:20:00.000Z';
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('WORK_DEADLINE_EXCEEDED');
        s.mandate.value.document.limits.executionDeadline = '2026-01-01T00:59:00.000Z';
        s.clock.nowMs = Date.parse('2026-01-01T00:40:00.000Z');
        refresh(s, api);
        expect(reason(api.evaluateAdmission(s))).toBe('WORK_DEADLINE_EXCEEDED');
        s.clock.nowMs--;
        expect(api.evaluateAdmission(s).verdict).toBe('followup');
    });
    for (const state of ['unverified', 'rollback_detected']) {
        it('clock ' + state + ' cannot be guessed from local time', async () => {
            const api = await load(), s = clone();
            s.clock = {
                state
            };
            expect(reason(api.evaluateAdmission(s))).toBe('TIME_BASIS_UNCONFIRMED');
        });
    }
    it('source control requires a verified exact deletion but no model or actor grant', async () => {
        const api = await load(), envelope = {
            ...clone().input.envelope, kind: 'deleted', actorEvidence: {
                kind: 'unknown', reason: 'deleted actor unknown'
            }
        };
        const result = api.classifySourceControl({
            envelope, controlEvidence: unavailable
        });
        expect(result.disposition).toBe('needs_review');
        expect('verdict' in result).toBe(false);
    });
});
describe('A2 canonical data boundary', () => {
    it('matches all approved semantic hash vectors', async () => {
        const api = await load();
        for (const vector of vectors.vectors) {
            const s = clone();
            switch (vector.name) {
                case 'G0-first-preflight':
                    s.assessment = null;
                    s.selection.value = {
                        kind: 'none'
                    };
                    break;
                case 'G2-now-plus-1ms-same-state':
                    s.clock.nowMs++;
                    break;
                case 'G3-assessment-deadline-equality':
                    s.clock.nowMs = Date.parse(s.assessment.validUntil);
                    break;
                case 'G4-different-principal':
                    s.principalId = 'principal.2';
                    break;
                case 'G5-only-matching-pointer-id-renamed':
                    s.assessment.assessmentId = 'assessment.renamed';
                    s.selection.value.value.assessmentId = 'assessment.renamed';
                    break;
                case 'G6-related-headroom-change':
                    s.budget.draft.value.scopeRevision = 2;
                    s.budget.draft.value.remainingTokens = 21000;
                    break;
            }
            expect(vector.name === 'G0-first-preflight' ? api.hashPreflightSnapshot(s) : api.hashEvaluationSnapshot(s)).toBe(vector.expectedDigest);
        }
    });
    it('rejects duplicate references and unknown fields without normalizing signed data', async () => {
        const api = await load(), s = clone();
        s.assessment.evidenceRefs = ['input.1', 'input.1'];
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        const other = clone();
        other.extra = undefined;
        expect(() => api.evaluateAdmission(other)).toThrow('A2_CONTRACT_INVALID');
    });
    it('never calls Proxy traps, accessors, toJSON or then when rejecting data', async () => {
        const api = await load();
        let traps = 0, getters = 0, calls = 0;
        const proxy = new Proxy(clone(), {
            ownKeys() {
                traps++;
                return [];
            }, get() {
                traps++;
                return undefined;
            }
        });
        expect(() => api.evaluateAdmission(proxy)).toThrow('A2_CONTRACT_INVALID');
        expect(traps).toBe(0);
        for (const key of ['then', 'toJSON', 'source']) {
            const s = clone();
            Object.defineProperty(s, key, {
                enumerable: true, get() {
                    getters++;
                    return () => {
                        calls++;
                    };
                }
            });
            expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        }
        expect(getters).toBe(0);
        expect(calls).toBe(0);
    });
    it('preserves Unicode identities and rejects malformed UTF16 without coercion', async () => {
        const api = await load(), s = clone();
        s.principalId = 'bad\ud800';
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        expect(api.hashA2Data({
            value: 'é'
        })).not.toBe(api.hashA2Data({
            value: 'e\u0301'
        }));
        expect(api.hashA2Data({
            z: 0, a: '请求', arr: [true, null, '😀']
        })).toBe(vectors.short.sha256);
    });
    it('data audit clocks and random assessment IDs do not churn semantic digest', async () => {
        const api = await load(), s = clone(), hash = api.hashEvaluationSnapshot(s);
        s.input.envelope.receivedAt = '2026-01-02T00:00:00Z';
        s.input.envelope.authorizationCheckedAt = '2026-01-02T00:00:00Z';
        s.input.evidence.value.sourceSnapshotAt = '2026-01-02T00:00:00Z';
        s.assessment.assessmentId = 'new-id';
        s.selection.value.value.assessmentId = 'new-id';
        s.clock.nowMs++;
        expect(api.hashEvaluationSnapshot(s)).toBe(hash);
    });
    it('snapshot/deleted cannot enter the admission functions and created cannot enter control', async () => {
        const api = await load(), s = clone();
        s.input.envelope.kind = 'snapshot';
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        expect(() => api.preflightAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        expect(() => api.classifySourceControl({
            envelope: clone().input.envelope, controlEvidence: {
                state: 'unknown', reason: 'missing'
            }
        })).toThrow('A2_CONTRACT_INVALID');
    });
});
describe('A2 cross-scope and exact collection siblings', () => {
    for (const field of [
        'tenantId', 'workspaceId', 'connectionId', 'providerAccountId', 'repositoryId', 'credentialEpoch'
    ]) {
        it('AuthScope ' + field + ' is not interchangeable', async () => {
            const api = await load(), s = clone();
            s.input.envelope.authScope[field] = field === 'credentialEpoch' ? 2 : 'foreign';
            expect(api.evaluateAdmission(s)).toMatchObject({
                verdict: 'reject', reasonCodes: ['IDENTITY_OR_SCOPE_MISMATCH']
            });
        });
    }
    for (const field of [
        'sourceBindingId', 'tenantId', 'workspaceId', 'repositoryId', 'threadId'
    ]) {
        it('thread ' + field + ' is bound exactly', async () => {
            const api = await load(), s = clone();
            s.input.envelope.thread[field] = 'foreign';
            expect(api.evaluateAdmission(s)).toMatchObject({
                verdict: 'reject', reasonCodes: ['IDENTITY_OR_SCOPE_MISMATCH']
            });
        });
    }
    it('issue and comment sharing a provider numeric id are different evidence', async () => {
        const api = await load(), s = clone();
        s.input.envelope.objectKind = 'comment';
        s.input.envelope.objectId = '42';
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['INPUT_CONFLICT']);
    });
    it('no current head or duplicate head cannot supply a unique evidence proof', async () => {
        const api = await load(), s = clone();
        s.source.value.evidenceHeads = [];
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['SOURCE_PROOF_UNCONFIRMED']);
        s.source.value.evidenceHeads = [fixture.source.value.evidenceHeads[0], fixture.source.value.evidenceHeads[0]];
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['SOURCE_PROOF_UNCONFIRMED']);
    });
    it('a missing policy cell, swapped cells or repeated prefix is rejected', async () => {
        const api = await load(), s = clone();
        s.controls.value.prefixPolicies.pop();
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        const other = clone();
        [other.controls.value.prefixPolicies[0], other.controls.value.prefixPolicies[1]] = [other.controls.value.prefixPolicies[1], other.controls.value.prefixPolicies[0]];
        expect(api.evaluateAdmission(other).reasonCodes).toEqual(['IDENTITY_OR_SCOPE_MISMATCH']);
        const repeated = clone();
        repeated.controls.value.prefixModes[1] = repeated.controls.value.prefixModes[0];
        expect(api.evaluateAdmission(repeated).reasonCodes).toEqual(['IDENTITY_OR_SCOPE_MISMATCH']);
    });
    it('source control cannot cross AuthScope simply because its proof repeats the supplied thread', async () => {
        const api = await load(), envelope = {
            ...clone().input.envelope, kind: 'deleted'
        };
        envelope.authScope.tenantId = 'foreign';
        const result = api.classifySourceControl({
            envelope, controlEvidence: {
                state: 'known', value: {
                    thread: envelope.thread, objectKind: envelope.objectKind, objectId: envelope.objectId, providerRevision: envelope.providerRevision, contentHash: envelope.contentHash, proofRef: 'source-proof', sourceBindingVersion: 1, kind: 'verified_deletion'
                }
            }
        });
        expect(result.disposition).toBe('needs_review');
        expect(result.reasonCodes).toEqual(['IDENTITY_OR_SCOPE_MISMATCH']);
    });
    it('changing a claimed body without its original digest is never a positive result', async () => {
        const api = await load(), s = clone();
        s.assessment.suggestedIntent = 'chat';
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['ASSESSMENT_INVALID']);
        const other = clone();
        other.mandate.value.document.limits.maxCostMinor++;
        expect(api.evaluateAdmission(other).reasonCodes).toEqual(['MANDATE_UNAVAILABLE']);
    });
});
describe('A2 invalid digest relations are not normalized into healthy snapshots', () => {
    it('changed assessment body with its old claimed hash has a different evaluation digest', async () => {
        const api = await load(), s = clone(), healthy = api.evaluateAdmission(s);
        s.assessment.suggestedIntent = 'chat';
        const invalid = api.evaluateAdmission(s);
        expect(invalid.reasonCodes).toEqual(['ASSESSMENT_INVALID']);
        expect(invalid.evaluatedSnapshotHash).not.toBe(healthy.evaluatedSnapshotHash);
    });
    it('a wrong selected ID cannot share the healthy digest after dropping random IDs', async () => {
        const api = await load(), s = clone(), healthy = api.evaluateAdmission(s);
        s.selection.value.value.assessmentId = 'loser.1';
        const invalid = api.evaluateAdmission(s);
        expect(invalid.reasonCodes).toEqual(['ASSESSMENT_SELECTION_UNCONFIRMED']);
        expect(invalid.evaluatedSnapshotHash).not.toBe(healthy.evaluatedSnapshotHash);
    });
    it('changed mandate body cannot keep a healthy digest by repeating its old hash', async () => {
        const api = await load(), s = clone(), healthy = api.evaluateAdmission(s);
        s.mandate.value.document.limits.maxCostMinor++;
        const invalid = api.evaluateAdmission(s);
        expect(invalid.reasonCodes).toEqual(['MANDATE_UNAVAILABLE']);
        expect(invalid.evaluatedSnapshotHash).not.toBe(healthy.evaluatedSnapshotHash);
    });
});
describe('A2 complete deterministic input contracts', () => {
    const cases: readonly [
        string,
        (s: any) => void,
        string
    ][] = [
        ['mandate revoked', s => {
                s.mandate.value.document.status = 'revoked';
            }, 'MANDATE_REVOKED'],
        ['missing local create action', s => {
                s.mandate.value.document.allowedActions = ['model.process_source', 'source.read'];
            }, 'MANDATE_ACTION_UNAVAILABLE'],
        ['expired mandate', s => {
                s.mandate.value.document.validUntil = '2026-01-01T00:00:01.000Z';
            }, 'MANDATE_EXPIRED'],
        ['observation equality', s => {
                s.mandate.value.document.followup.observationEndsAt = '2026-01-01T00:00:01.000Z';
            }, 'OBSERVATION_WINDOW_CLOSED'],
        ['assessment equality', s => {
                s.assessment.validUntil = '2026-01-01T00:00:01.000Z';
            }, 'ASSESSMENT_EXPIRED_REVIEW_REQUIRED'],
        ['egress denied', s => {
                s.egress.value.decision = 'deny';
            }, 'EGRESS_DENIED'],
        ['related budget insufficient', s => {
                s.budget.draft.value.remainingCostMinor = 0;
            }, 'BUDGET_EXHAUSTED'],
        ['work profile unavailable', s => {
                s.mandate.value.workProfile = {
                    state: 'unknown', reason: 'producer_unavailable'
                };
            }, 'MANDATE_UNAVAILABLE'],
        ['old backlog', s => {
                s.freshness.value.state = 'backlog';
            }, 'BACKLOG_REQUIRES_REVIEW'],
        ['future window makes old event backlog', s => {
                s.freshness.value.window.effectiveAt = '2026-01-01T00:00:01.000Z';
            }, 'BACKLOG_REQUIRES_REVIEW'],
    ];
    for (const [name, mutate, reason] of cases) {
        it(name, async () => {
            const api = await load(), s = clone();
            mutate(s);
            refresh(s, api);
            expect(api.evaluateAdmission(s).reasonCodes).toEqual([reason]);
        });
    }
    it('label selection requires a current exact thread snapshot', async () => {
        const api = await load(), s = clone();
        s.mandate.value.document.selection = {
            labelIds: ['label.1']
        };
        refresh(s, api);
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['SOURCE_PROOF_UNCONFIRMED']);
        s.labels = {
            state: 'known', value: {
                repositoryId: 'repo.1', threadId: '42', revision: 1, labelIds: ['label.1']
            }
        };
        expect(api.evaluateAdmission(s).verdict).toBe('accept');
        s.labels.value.repositoryId = 'other';
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['IDENTITY_OR_SCOPE_MISMATCH']);
    });
    it('unknown current work cannot be made resumable by an assessment', async () => {
        const api = await load(), s = clone();
        s.binding = {
            state: 'unknown', reason: 'pending'
        };
        expect(api.evaluateAdmission(s).reasonCodes).toEqual(['OWNER_BINDING_UNCONFIRMED']);
    });
    it('canonical sets reject reordered and duplicate provider identifiers', async () => {
        const api = await load(), s = clone();
        s.mandate.value.document.allowedActorProviderIds = ['z', 'a'];
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        const other = clone();
        other.mandate.value.document.ownerDomains.push(other.mandate.value.document.ownerDomains[0]);
        expect(() => api.evaluateAdmission(other)).toThrow('A2_CONTRACT_INVALID');
    });
    it('parser exact numbers and calendar dates never coerce invalid values', async () => {
        const api = await load();
        for (const value of [
            -0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1
        ]) {
            const s = clone();
            s.input.inputUtf8Bytes = value;
            expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        }
        for (const value of ['2026-02-30T00:00:00Z', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00.01Z']) {
            const s = clone();
            s.assessment.validUntil = value;
            expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
        }
    });
    it('source control has no assessment or unrelated field path', async () => {
        const api = await load(), envelope = {
            ...clone().input.envelope, kind: 'snapshot'
        };
        expect(() => api.classifySourceControl({
            envelope, controlEvidence: {
                state: 'unknown', reason: 'missing'
            }, assessment: clone().assessment
        })).toThrow('A2_CONTRACT_INVALID');
    });
});
describe('A2 purpose and stable work-slot sibling gates', () => {
    it('assessment egress alone cannot recommend a draft run', async () => {
        const api = await load(), s = clone();
        s.egress.value.purposes = ['admission', 'preview'];
        refresh(s, api);
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('EGRESS_UNCONFIRMED');
    });
    it('an existing bound work does not require a second free active-work slot', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.budget.draft.value.remainingActiveWorks = 0;
        expect(api.evaluateAdmission(s).verdict).toBe('followup');
    });
});
describe('A2 reviewed coverage, preview and temporal counterexamples', () => {
    it('another evidence input cannot stand in for the input being admitted', async () => {
        const api = await load(), s = clone();
        const other = {
            ...s.input.evidence.value.entries[0], inputId: 'input.2', objectKind: 'comment', objectId: 'comment.2'
        };
        s.input.evidence.value.entries.push(other);
        s.source.value.evidenceHeads.push({
            ...s.source.value.evidenceHeads[0], ...other
        });
        s.assessment.evidenceRefs = ['input.2'];
        refresh(s, api);
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('ASSESSMENT_BINDING_MISMATCH');
    });
    it('an already qualified shadow preview does not need draft budget or a new work slot', async () => {
        const api = await load(), s = clone();
        s.use = 'shadow';
        s.purpose = 'preview';
        s.assessment.purpose = 'preview';
        s.assessment.decisive = false;
        s.selection.value = {
            kind: 'none'
        };
        s.budget.draft = {
            state: 'unknown', reason: 'producer_unavailable'
        };
        s.budget.assessment = {
            state: 'unknown', reason: 'producer_unavailable'
        };
        s.egress.value.purposes = ['preview'];
        refresh(s, api);
        const result = api.evaluateAdmission(s);
        expect(result.kind).toBe('shadow_suggestion');
        expect(result.semanticClassification).toBe('draft_request');
    });
    it('a preview assessment request needs model budget but not draft or active-work slots', async () => {
        const api = await load(), s = clone();
        s.use = 'shadow';
        s.purpose = 'preview';
        s.assessment = null;
        s.selection.value = {
            kind: 'none'
        };
        s.budget.assessment.value.purpose = 'preview';
        s.budget.assessment.value.remainingActiveWorks = 0;
        s.budget.draft = {
            state: 'unknown', reason: 'producer_unavailable'
        };
        s.mandate.value.document.limits.maxActiveWorks = 0;
        s.mandate.value.document.limits.maxDraftRunsPerWork = 0;
        refresh(s, api);
        expect(api.preflightAdmission(s).state).toBe('assessment_required');
    });
    it('a different mandate cannot append to an existing mandate binding', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.binding.mandateId = 'mandate.original';
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('MANDATE_BINDING_MISMATCH');
        expect(api.evaluateAdmission(s).verdict).toBe('needs_review');
    });
    it('a future source event is not fresh merely because a supplied fact says fresh', async () => {
        const api = await load(), s = clone();
        s.freshness.value.eventOccurredAt = '2026-01-01T00:00:02.000Z';
        s.input.envelope.providerOccurredAt = s.freshness.value.eventOccurredAt;
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('TIME_BASIS_UNCONFIRMED');
    });
    it('a future bound work creation is not a currently resumable work', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.binding.transport.workCreatedAt = '2026-01-01T00:00:02.000Z';
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('TIME_BASIS_UNCONFIRMED');
    });
    it('assessment.createdAt is not a frozen field and is rejected rather than assumed trustworthy', async () => {
        const api = await load(), s = clone();
        s.assessment.createdAt = '2026-01-01T00:00:02.000Z';
        expect(() => api.evaluateAdmission(s)).toThrow('A2_CONTRACT_INVALID');
    });
});
describe('A2 temporal and audit hash cuts', () => {
    it('a future event becoming current changes the normalized time-state hash', async () => {
        const api = await load(), s = clone();
        s.freshness.value.eventOccurredAt = '2026-01-01T00:00:02.000Z';
        s.input.envelope.providerOccurredAt = s.freshness.value.eventOccurredAt;
        const before = api.evaluateAdmission(s);
        expect(before.reasonCodes[0]).toBe('TIME_BASIS_UNCONFIRMED');
        s.clock.nowMs = Date.parse(s.freshness.value.eventOccurredAt);
        const after = api.evaluateAdmission(s);
        expect(after.verdict).toBe('accept');
        expect(after.evaluatedSnapshotHash).not.toBe(before.evaluatedSnapshotHash);
    });
    it('a future work birth becoming current changes the work time-state hash', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.binding.transport.workCreatedAt = '2026-01-01T00:00:02.000Z';
        const before = api.evaluateAdmission(s);
        expect(before.reasonCodes[0]).toBe('TIME_BASIS_UNCONFIRMED');
        s.clock.nowMs = Date.parse(s.binding.value.binding.transport.workCreatedAt);
        const after = api.evaluateAdmission(s);
        expect(after.verdict).toBe('followup');
        expect(after.evaluatedSnapshotHash).not.toBe(before.evaluatedSnapshotHash);
    });
    it('receiptRef is returned as an audit reference and cannot change semantic duplicate classification', async () => {
        const api = await load(), s = clone();
        s.consumption.value = {
            kind: 'consumed', thread: s.input.envelope.thread, inputId: 'input.1', evidenceManifestHash: s.input.evidence.value.manifestHash, mandateId: 'mandate.1', bindingId: 'work.binding.1', ownerWorkId: 'work.1', ownerVersion: 1, inputSetRevision: 1, operationKey: 'original.operation.1', semanticPayloadHash: 'f'.repeat(64), receiptRef: 'original.receipt.1'
        };
        const before = api.evaluateAdmission(s);
        s.consumption.value.receiptRef = 'original.receipt.2';
        const after = api.evaluateAdmission(s);
        expect(before.verdict).toBe('reject');
        expect(after.reasonCodes[0]).toBe('DUPLICATE_INPUT');
        expect(after.evaluatedSnapshotHash).toBe(before.evaluatedSnapshotHash);
        expect(after.previousReceiptRef).toBe('original.receipt.2');
    });
    it('outputs are frozen own data with no inherited delivery callbacks', async () => {
        const api = await load(), result = api.evaluateAdmission(clone());
        expect(Object.getPrototypeOf(result)).toBeNull();
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.getPrototypeOf(result.reasonCodes)).toBeNull();
        expect(Object.isFrozen(result.reasonCodes)).toBe(true);
    });
});
it('A2 normalized time-state property uses an inert descriptor shell', async () => {
    const api = await load();
    const s = clone();
    let hits = 0, result: any, error: unknown;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
    Object.defineProperty(Object.prototype, 'get', {
        __proto__: null, configurable: true, get() {
            hits++;
            return undefined;
        }
    } as PropertyDescriptor);
    try {
        result = api.evaluateAdmission(s);
    }
    catch (reason) {
        error = reason;
    }
    finally {
        if (previous) {
            Object.defineProperty(Object.prototype, 'get', previous);
        }
        else {
            delete (Object.prototype as any).get;
        }
    }
    expect(hits).toBe(0);
    expect(error).toBeUndefined();
    expect(result.verdict).toBe('accept');
});
describe('A2 original bound owner projection', () => {
    it('an arbitrary owner kind cannot receive a followup suggestion', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.binding.ownerKind = 'foreign-owner';
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('OWNER_BINDING_UNCONFIRMED');
        expect(api.evaluateAdmission(s).verdict).toBe('needs_review');
    });
    it('the bound and transport owner versions must represent the same current owner', async () => {
        const api = await load(), s = clone();
        bound(s);
        s.binding.value.ownerVersion = 2;
        expect(api.evaluateAdmission(s).reasonCodes[0]).toBe('OWNER_BINDING_UNCONFIRMED');
    });
});
describe('A2 positive request-bound requirements', () => {
    it('zero token and cost quotas cannot be bypassed by a zero requirement', async () => {
        const api = await load(), s = clone();
        s.assessment = null;
        s.selection.value = {
            kind: 'none'
        };
        s.mandate.value.document.limits.maxTokens = 0;
        s.mandate.value.document.limits.maxCostMinor = 0;
        Object.assign(s.budget.assessment.value, {
            requiredMaxTokens: 0, requiredMaxCostMinor: 0, remainingTokens: 0, remainingCostMinor: 0
        });
        refresh(s, api);
        expect(api.preflightAdmission(s).state).toBe('blocked');
        expect(api.preflightAdmission(s).reasonCodes[0]).toBe('BUDGET_EXHAUSTED');
    });
    it('a request cannot claim a free positive budget quotation with zero requirements', async () => {
        const api = await load(), s = clone();
        s.assessment = null;
        s.selection.value = {
            kind: 'none'
        };
        s.budget.assessment.value.requiredMaxTokens = 0;
        s.budget.assessment.value.requiredMaxCostMinor = 0;
        expect(api.preflightAdmission(s).state).toBe('blocked');
        expect(api.preflightAdmission(s).reasonCodes[0]).toBe('BUDGET_EXHAUSTED');
    });
});
