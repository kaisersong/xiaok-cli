import { describe, expect, it } from 'vitest';
import { planObservationRequest } from '../../../src/runtime/sol-pi/request-projection.js';

function fixture() {
  const request = { modelId: 'model', protocolId: 'protocol', systemPrompt: 'system', max_tokens: 100, tools: [{ name: 'read', schema: { type: 'object' } }],
    privateEnvelope: { required: 'retain protocol-private envelope' },
    messages: [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'private', signature: 'signed' }, { type: 'tool_use', id: 't1', name: 'read', input: {} }, { type: 'tool_use', id: 't2', name: 'bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'old-cap-1', is_error: false }, { type: 'tool_result', tool_use_id: 't2', content: 'old-cap-2', is_error: true }] },
    ],
  };
  return { request, windowTokens: 10000, outputLimitField: 'max_tokens', outputReserveTokens: 100, safetyMarginTokens: 50, previewBytes: 80,
    tokenBound: { modelId: 'model', protocolId: 'protocol', validationEvidenceId: 'test-json-char-upper-bound', countRequestTokens: (value: unknown) => JSON.stringify(value).length },
    observations: [
      { kind: 'native' as const, segments: { before: '', native: 'old-cap-1', after: '' }, observationId: 'o1', toolUseId: 't1', authorizedText: 'A'.repeat(700), mandatoryStatus: 'terminal success complete=true', reference: 'observation_read o1', fullLogicalSendCount: 0 },
      { kind: 'native' as const, segments: { before: '', native: 'old-cap-2', after: '' }, observationId: 'o2', toolUseId: 't2', authorizedText: 'B'.repeat(700), mandatoryStatus: 'terminal error complete=false timeout', reference: 'observation_read o2', fullLogicalSendCount: 1 },
    ],
  };
}
function run(input = fixture()) { return planObservationRequest(input as never); }
function deepFreeze(value: any): any { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

describe('P1-B production request projection planner', () => {
  it('supports host verified default output reserve without inventing a wire field', () => {
    const input: any = fixture(); delete input.request.max_tokens;
    input.outputLimitField = null; input.outputReserveTokens = 393216;
    input.verifiedDefaultOutputReserveTokens = 393216; input.windowTokens = 1048576;
    const result = run(input); expect(result.status).toBe('projected');
    if (result.status === 'projected') {
      expect(result.request).not.toHaveProperty('max_tokens');
      expect(result.totalTokenUpperBound).toBe(result.inputTokenUpperBound + 393216 + 50);
    }
    for (const invalid of [undefined, 0, NaN, 393215, '393216']) {
      input.verifiedDefaultOutputReserveTokens = invalid; expect(run(input).status).toBe('skipped');
    }
    input.outputLimitField = 'max_tokens'; input.verifiedDefaultOutputReserveTokens = 393216;
    expect(run(input).status).toBe('skipped');
  });
  it('returns deduplicated actual full IDs including unknown, excluding preview and recall', () => {
    const input: any = fixture(); input.observations[0].fullLogicalSendCount = null;
    input.observations[1].fullLogicalSendCount = 2;
    expect(run(input)).toMatchObject({ status: 'projected', fullObservationIds: ['o1'], fullCountProposals: [] });
    input.observations[1] = { ...input.observations[0], toolUseId: 't2', segments: { before: '', native: 'old-cap-2', after: '' } };
    expect(run(input)).toMatchObject({ status: 'projected', fullObservationIds: ['o1'] });
    input.observations = input.observations.map((item: any) => ({ kind: 'recall', observationId: item.observationId, toolUseId: item.toolUseId }));
    expect(run(input)).toMatchObject({ status: 'projected', fullObservationIds: [] });
  });
  it('projects first-two full observations without mutating source or private protocol fields', () => {
    const input = fixture(); const before = structuredClone(input.request); deepFreeze(input.request); deepFreeze(input.observations);
    const result = run(input);
    expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    expect(result.request.messages[1]?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: false, content: expect.stringContaining('A'.repeat(700)) });
    expect(result.request.messages[1]?.content[1]).toMatchObject({ is_error: true, content: expect.stringContaining('complete=false timeout') });
    expect(result.request.messages[0]).toEqual(before.messages[0]); expect(result.request.privateEnvelope).toEqual(before.privateEnvelope);
    expect(input.request).toEqual(before); expect(result.fullCountProposals).toHaveLength(2);
  });
  it('uses stable bounded head-tail after two full logical sends and does not count SDK retries', () => {
    const input = fixture(); input.observations[0]!.fullLogicalSendCount = 2;
    const first = run(input), retry = run(input);
    expect(retry).toEqual(first); expect(input.observations[1]!.fullLogicalSendCount).toBe(1);
    expect(first.status).toBe('projected'); if (first.status !== 'projected') return;
    expect(first.request.messages[1]?.content[0]?.content).not.toContain('A'.repeat(700));
    expect(first.request.messages[1]?.content[0]?.content).toContain('observation_read o1');
    expect(first.fullCountProposals).toEqual([{ observationId: 'o2', expectedCount: 1 }]);
  });
  it('sends unknown-count full text when capacity permits without resetting its count to zero', () => {
    const input = fixture(); (input.observations[0] as any).fullLogicalSendCount = null;
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    expect(result.fullCountProposals).not.toContainEqual(expect.objectContaining({ observationId: 'o1' }));
    expect(result.request.messages[1]?.content[0]?.content).toContain('A'.repeat(700));
  });
  it('allocates one shared budget including system, schema and private protocol data', () => {
    const input = fixture(); input.windowTokens = 1700;
    input.request.systemPrompt = 'S'.repeat(250); input.request.privateEnvelope.required = 'P'.repeat(100);
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    const upperBound = input.tokenBound.countRequestTokens(result.request);
    expect(upperBound + input.outputReserveTokens + input.safetyMarginTokens).toBeLessThanOrEqual(input.windowTokens);
    expect(result.fullCountProposals.length).toBeLessThan(2);
    for (const block of result.request.messages[1]!.content) expect(block.content).toContain('observation_read');
  });
  it('rejects a request whose minimum mandatory protocol cannot fit', () => {
    const input = fixture(); input.windowTokens = 200;
    expect(run(input)).toMatchObject({ status: 'context_budget_exceeded' });
  });
  it.each(['window', 'missing-estimator', 'evidence', 'model', 'protocol', 'nan', 'throw', 'negative', 'overflow'])('skips unknown or invalid token bound %s', kind => {
    const input: any = fixture();
    if (kind === 'window') input.windowTokens = null;
    if (kind === 'missing-estimator') input.tokenBound = undefined;
    if (kind === 'evidence') input.tokenBound.validationEvidenceId = '';
    if (kind === 'model') input.tokenBound.modelId = 'other';
    if (kind === 'protocol') input.tokenBound.protocolId = 'other';
    if (kind === 'nan') input.tokenBound.countRequestTokens = () => NaN;
    if (kind === 'throw') input.tokenBound.countRequestTokens = () => { throw Error('unavailable'); };
    if (kind === 'negative') input.tokenBound.countRequestTokens = () => -1;
    if (kind === 'overflow') input.tokenBound.countRequestTokens = () => Number.MAX_VALUE;
    expect(run(input)).toMatchObject({ status: 'skipped' });
  });
  it.each(['duplicate-observation', 'duplicate-target', 'missing-target', 'non-text', 'unpaired', 'duplicate-call', 'bad-count'])('refuses invalid host mapping %s', kind => {
    const input: any = fixture();
    if (kind === 'duplicate-observation') input.observations[1].observationId = 'o1';
    if (kind === 'duplicate-target') input.observations[1].toolUseId = 't1';
    if (kind === 'missing-target') input.observations[0].toolUseId = 'absent';
    if (kind === 'non-text') input.request.messages[1].content[0].content = [{ type: 'image', data: 'private-image' }];
    if (kind === 'unpaired') input.request.messages[0].content.splice(1, 1);
    if (kind === 'duplicate-call') input.request.messages[0].content.push(input.request.messages[0].content[1]);
    if (kind === 'bad-count') input.observations[0].fullLogicalSendCount = -1;
    expect(run(input)).toMatchObject({ status: 'skipped' });
  });
  it('does not split UTF-8 preview and keeps over-budget 16MiB body out of the request', () => {
    const input = fixture(); input.observations[0]!.authorizedText = '😀'.repeat(4 * 1024 * 1024);
    input.windowTokens = 1300; input.previewBytes = 7;
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    const text = String(result.request.messages[1]?.content[0]?.content);
    expect(text).not.toContain('\uFFFD'); expect(Buffer.byteLength(text)).toBeLessThan(200);
    expect(JSON.stringify(result.request).length + 150).toBeLessThanOrEqual(1300);
  });
  it('passes exact output limit and unknown provider fields to the whole-request estimator', () => {
    const input = fixture(); const seen: unknown[] = [];
    input.tokenBound.countRequestTokens = request => { seen.push(structuredClone(request)); return JSON.stringify(request).length; };
    expect(run(input).status).toBe('projected');
    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) expect(request).toMatchObject({ max_tokens: 100, privateEnvelope: input.request.privateEnvelope });
    input.request.max_tokens = 200; expect(run(input).status).toBe('skipped');
  });
  it.each(['throw', 'nan'])('invalid later candidate estimate invalidates the entire plan (%s)', kind => {
    const input = fixture(); let calls = 0;
    input.tokenBound.countRequestTokens = request => {
      if (++calls === 2) { if (kind === 'throw') throw Error('estimator failed'); return NaN; }
      return JSON.stringify(request).length;
    };
    expect(run(input)).toMatchObject({ status: 'skipped' }); expect(calls).toBe(2);
  });

  it('snapshots host authorized observations before invoking an estimator callback', () => {
    const input = fixture(); let calls = 0;
    input.tokenBound.countRequestTokens = request => {
      if (++calls === 1) input.observations[0]!.authorizedText = 'UNAUTHORIZED_LATE_CHANGE';
      return JSON.stringify(request).length;
    };
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    expect(JSON.stringify(result.request)).not.toContain('UNAUTHORIZED_LATE_CHANGE');
    expect(result.request.messages[1]?.content[0]?.content).toContain('A'.repeat(700));
  });
  it('does not accept matching absent model identities as a verified estimator', () => {
    const input: any = fixture(); delete input.request.modelId; delete input.tokenBound.modelId;
    expect(run(input)).toMatchObject({ status: 'skipped' });
  });

  it('preserves host-delimited policy segments verbatim while projecting only the native body', () => {
    const input = fixture(); const before = 'PREHOOK POLICY: prohibit publication\n'; const after = '\nPOSTHOOK WARNING: review required';
    const resultBlock = input.request.messages[1]!.content[0]!;
    if (!('content' in resultBlock) || typeof resultBlock.content !== 'string') throw Error('expected_tool_result_content');
    resultBlock.content = before + 'old-cap-1' + after;
    input.observations[0]!.segments = { before, native: 'old-cap-1', after };
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    const text = String(result.request.messages[1]!.content[0]!.content); expect(text.startsWith(before)).toBe(true); expect(text.endsWith(after)).toBe(true);
  });
  it('rejects a guessed or stale segment boundary instead of silently deleting policy text', () => {
    const input = fixture(); const resultBlock = input.request.messages[1]!.content[0]!;
    if (!('content' in resultBlock) || typeof resultBlock.content !== 'string') throw Error('expected_tool_result_content');
    resultBlock.content += '\nNEW POLICY';
    expect(run(input)).toMatchObject({ status: 'skipped' });
  });
  it('groups consistent references to the same observation into one logical-send proposal', () => {
    const input = fixture(); input.observations[1] = { ...input.observations[0]!, toolUseId: 't2', segments: { before: '', native: 'old-cap-2', after: '' } };
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    expect(result.fullCountProposals).toEqual([{ observationId: 'o1', expectedCount: 0 }]);
    for (const resultBlock of result.request.messages[1]!.content) expect(resultBlock.content).toContain('A'.repeat(700));
  });
  it('never recursively projects a recall page, even when it shares an observation ID', () => {
    const input: any = fixture(); const original = structuredClone(input.request.messages[1].content[1]);
    input.observations[1] = { kind: 'recall', observationId: 'o1', toolUseId: 't2' };
    const result = run(input); expect(result.status).toBe('projected'); if (result.status !== 'projected') return;
    expect(result.request.messages[1]!.content[1]).toEqual(original); expect(result.fullCountProposals).toEqual([{ observationId: 'o1', expectedCount: 0 }]);
  });

});
