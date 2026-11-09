import { describe, expect, it } from 'vitest';
import { ATTENTION_CATALOG_DIGEST, ATTENTION_CODE_CATALOG, attentionFactSchema, mapAttentionFact } from '../../../src/runtime/conversation-activity/attention-catalog.js';
const fact = (reasonCode: string, fields = {}) => ({ profile: 'dsh', schemaVersion: 1, factId: 'fact', revision: 2, evidenceRefs: [], reasonCode, ...fields });
describe('original activity attention catalog', () => {
  it('keeps proven safety failure blocking while unknown protocol remains ordinary review', () => {
    expect(mapAttentionFact(fact('SEAL_CLEARANCE_DENIED'))).toEqual({reason:'authority_suspect',severity:'blocking',protocolUnavailable:false});
    expect(mapAttentionFact(fact('invented_code'))).toEqual({reason:'review_required',severity:'warning',protocolUnavailable:true});
    expect(mapAttentionFact(fact('SCOPE_VIOLATION',{schemaVersion:2}))).toEqual({reason:'review_required',severity:'warning',protocolUnavailable:true});
  });
  it('distinguishes blocked before publication from an authenticated ordinary owner unknown sent result', () => {
    expect(mapAttentionFact(fact('PUBLICATION_RECONCILIATION_PENDING',{profile:'ordinary'}))).toEqual({reason:'review_required',severity:'warning',protocolUnavailable:false});
    expect(mapAttentionFact(fact('delivery_unknown',{profile:'ordinary'}))).toEqual({reason:'delivery_unknown',severity:'blocking',protocolUnavailable:false});
  });
  it('never turns a plugin activity error string into a DSH safety fact', () => {
    expect(mapAttentionFact(fact('AUTHORITY_SUSPECT',{profile:'activity'}))).toEqual({reason:'review_required',severity:'warning',protocolUnavailable:true});
    expect(mapAttentionFact(fact('input_required',{profile:'activity'}))).toEqual({reason:null,severity:'blocking',protocolUnavailable:false});
  });
  it('requires control identity and rejects contradictory control axis rather than guessing', () => {
    expect(mapAttentionFact(fact('VISIBILITY_NARROWING'))).toMatchObject({reason:'revocation_pending',severity:'blocking',protocolUnavailable:false});
    expect(()=>attentionFactSchema.parse(fact('accepted_pending_owner_fence'))).toThrow();
    expect(()=>attentionFactSchema.parse(fact('accepted_pending_owner_fence',{controlKind:'stop',axis:'mode'}))).toThrow();
    expect(mapAttentionFact(fact('accepted_pending_owner_fence',{controlKind:'stop'}))).toMatchObject({reason:'stop_unconfirmed',severity:'blocking'});
    expect(mapAttentionFact(fact('accepted_pending_owner_fence',{controlKind:'mandate_revision',narrowing:false}))).toMatchObject({reason:'review_required',severity:'warning'});
    expect(mapAttentionFact(fact('accepted_pending_owner_fence',{controlKind:'mandate_revision',narrowing:true,axis:'egress'}))).toMatchObject({reason:'egress_policy_changed',severity:'blocking'});
  });
  it('parses only bounded metadata and exports a stable same-source catalog digest', () => {
    expect(()=>attentionFactSchema.parse(fact('review_required',{actor:'admin'}))).toThrow();
    expect(()=>attentionFactSchema.parse(fact('review_required',{revision:Number.MAX_SAFE_INTEGER+1}))).toThrow();
    expect(Object.isFrozen(ATTENTION_CODE_CATALOG)).toBe(true);expect(ATTENTION_CATALOG_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(ATTENTION_CODE_CATALOG.REVISION_BASE_NOT_READY).toBe('review_required');
  });
});
