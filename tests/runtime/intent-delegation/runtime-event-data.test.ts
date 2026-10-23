import {describe, expect, it} from 'vitest';
import {checkIntentEvent, type IntentDataEvent, type UncheckedIntentEvent} from '../../../src/runtime/intent-delegation/runtime-event-data.js';

interface EventCase {name: string; event: UncheckedIntentEvent; required: readonly string[]}
const common = {sessionId: 'session-data', turnId: 'turn-data', intentId: 'intent-data'};
const cases: EventCase[] = [
  {name: 'intent_created', event: {type: 'intent_created', ...common, templateId: 'template-data', deliverable: 'report', riskTier: 'low'}, required: ['sessionId', 'turnId', 'intentId', 'templateId', 'deliverable', 'riskTier']},
  {name: 'stage_activated', event: {type: 'stage_activated', ...common, stageId: 'stage-data', label: 'stage label', order: 0, totalStages: 1}, required: ['sessionId', 'turnId', 'intentId', 'stageId', 'label', 'order', 'totalStages']},
  {name: 'step_activated', event: {type: 'step_activated', ...common, stepId: 'step-data'}, required: ['sessionId', 'turnId', 'intentId', 'stepId']},
  {name: 'artifact_recorded', event: {type: 'artifact_recorded', ...common, stageId: 'stage-data', artifactId: 'artifact-data', label: 'artifact label', kind: 'future-public-kind', path: '/data-only/report', creator: 'creator-data', mimeType: 'text/plain'}, required: ['sessionId', 'turnId', 'intentId', 'stageId', 'artifactId', 'label', 'kind']},
  {name: 'breadcrumb_emitted', event: {type: 'breadcrumb_emitted', ...common, stepId: 'step-data', status: 'running', message: 'message-data'}, required: ['sessionId', 'turnId', 'intentId', 'stepId', 'status', 'message']},
  {name: 'receipt_emitted', event: {type: 'receipt_emitted', ...common, stepId: 'step-data', note: 'note-data'}, required: ['sessionId', 'turnId', 'intentId', 'stepId', 'note']},
  {name: 'salvage_emitted', event: {type: 'salvage_emitted', ...common, summary: ['one', 'two'], reason: 'reason-data'}, required: ['sessionId', 'turnId', 'intentId', 'summary']},
];

// Real production leaf only. No mirrored validator, wire/Store fixture, SDK, issuer or producer.
describe('runtime event DATA leaf candidate; not executed', () => {
  it.each(cases)('captures the complete $name public DATA variant', ({event}) => {
    const output: IntentDataEvent = checkIntentEvent(event);
    expect(output).toEqual(event);
    expect(output).not.toBe(event);
  });

  for (const entry of cases) {
    it.each(entry.required)(`${entry.name} rejects missing %s without a default`, field => {
      const fields = Object.fromEntries(Object.entries(entry.event).filter(([key]) => key !== field));
      const missing: UncheckedIntentEvent = {...fields, type: entry.event.type};
      expect(() => checkIntentEvent(missing)).toThrow(`intent_runtime_event_data:${field}`);
      expect(Object.hasOwn(missing, field)).toBe(false);
    });
    it.each(entry.required)(`${entry.name} rejects a wrong-type %s`, field => {
      const wrong: UncheckedIntentEvent = {...entry.event, [field]: {opaque: true}};
      expect(() => checkIntentEvent(wrong)).toThrow(`intent_runtime_event_data:${field}`);
    });
  }

  it.each(['low', 'medium', 'high'])('retains the actual riskTier union (%s)', riskTier => {
    const output = checkIntentEvent({type: 'intent_created', ...common, templateId: 'template-data', deliverable: 'report', riskTier});
    if (output.type !== 'intent_created') throw Error('wrong_variant');
    expect(output.riskTier).toBe(riskTier);
  });

  it.each(['running', 'blocked', 'completed', 'failed'])('retains the actual breadcrumb status union (%s)', status => {
    const output = checkIntentEvent({type: 'breadcrumb_emitted', ...common, stepId: 'step-data', status, message: 'message-data'});
    if (output.type !== 'breadcrumb_emitted') throw Error('wrong_variant');
    expect(output.status).toBe(status);
  });

  it('rejects invalid union strings, rather than mapping them to an allowed value', () => {
    expect(() => checkIntentEvent({type: 'intent_created', ...common, templateId: 'template-data', deliverable: 'report', riskTier: 'future-risk'})).toThrow('intent_runtime_event_data:riskTier');
    expect(() => checkIntentEvent({type: 'breadcrumb_emitted', ...common, stepId: 'step-data', status: 'planned', message: 'message-data'})).toThrow('intent_runtime_event_data:status');
  });

  it.each([NaN, Infinity, -Infinity, -0.5])('keeps number semantics, without inventing safe-integer/order policy (%s)', order => {
    const output = checkIntentEvent({type: 'stage_activated', ...common, stageId: 'stage-data', label: '', order, totalStages: 1});
    if (output.type !== 'stage_activated') throw Error('wrong_variant');
    expect(Object.is(output.order, order)).toBe(true);
    expect(output.label).toBe('');
  });

  it('accepts empty string DATA without treating it as an SDK identity or adding a default', () => {
    const output = checkIntentEvent({type: 'step_activated', sessionId: '', turnId: '', intentId: '', stepId: ''});
    expect(output).toEqual({type: 'step_activated', sessionId: '', turnId: '', intentId: '', stepId: ''});
  });

  it('preserves the presence of own optional undefined fields', () => {
    const artifact = checkIntentEvent({type: 'artifact_recorded', ...common, stageId: 'stage-data', artifactId: 'artifact-data', label: 'artifact label', kind: 'future-public-kind', path: undefined, creator: undefined, mimeType: undefined});
    expect(Object.hasOwn(artifact, 'path')).toBe(true);
    expect(Object.hasOwn(artifact, 'creator')).toBe(true);
    expect(Object.hasOwn(artifact, 'mimeType')).toBe(true);
    const salvage = checkIntentEvent({type: 'salvage_emitted', ...common, summary: [], reason: undefined});
    expect(Object.hasOwn(salvage, 'reason')).toBe(true);
    const absent = checkIntentEvent({type: 'salvage_emitted', ...common, summary: []});
    expect(Object.hasOwn(absent, 'reason')).toBe(false);
  });

  it.each(['path', 'creator', 'mimeType'])('rejects malformed optional artifact %s', field => {
    expect(() => checkIntentEvent({type: 'artifact_recorded', ...common, stageId: 'stage-data', artifactId: 'artifact-data', label: 'artifact label', kind: 'future-public-kind', [field]: null})).toThrow(`intent_runtime_event_data:${field}`);
  });

  it('rejects malformed optional salvage reason without replacing it', () => {
    expect(() => checkIntentEvent({type: 'salvage_emitted', ...common, summary: [], reason: null})).toThrow('intent_runtime_event_data:reason');
  });

  it('captures summary strings instead of retaining an untrusted array', () => {
    const source = ['before'];
    const output = checkIntentEvent({type: 'salvage_emitted', ...common, summary: source});
    if (output.type !== 'salvage_emitted') throw Error('wrong_variant');
    expect(output.summary).not.toBe(source);
    source[0] = 'after';
    expect(output.summary).toEqual(['before']);
    expect(() => checkIntentEvent({type: 'salvage_emitted', ...common, summary: ['one', 2]})).toThrow('intent_runtime_event_data:summary');
    expect(() => checkIntentEvent({type: 'salvage_emitted', ...common, summary: {length: 0}})).toThrow('intent_runtime_event_data:summary');
  });

  it('captures riskTier from exactly one property read', () => {
    let reads = 0;
    const input: UncheckedIntentEvent = {type: 'intent_created', ...common, templateId: 'template-data', deliverable: 'report', get riskTier() { reads += 1; return reads === 1 ? 'high' : {opaque: true}; }};
    const output = checkIntentEvent(input);
    if (output.type !== 'intent_created') throw Error('wrong_variant');
    expect(output.riskTier).toBe('high');
    expect(reads).toBe(1);
  });

  it('preserves the original fail Error kind/message', () => {
    let caught: unknown;
    try { checkIntentEvent({type: 'receipt_emitted', ...common, stepId: 'step-data', note: false}); }
    catch (error) { caught = error; }
    if (!(caught instanceof Error)) throw Error('expected_real_Error');
    expect(caught.name).toBe('Error');
    expect(caught.message).toBe('intent_runtime_event_data:note');
  });

  it('does not replace a source getter Error', () => {
    const original = Error('source_getter');
    let caught: unknown;
    try { checkIntentEvent({type: 'receipt_emitted', ...common, stepId: 'step-data', get note() { throw original; }}); }
    catch (error) { caught = error; }
    expect(caught).toBe(original);
  });

  it('keeps callee lookup before payload getters and preserves the observer receiver', () => {
    const events: string[] = [], seen: IntentDataEvent[] = [];
    const observer = {get emit() { events.push('callee'); return function(this: unknown, event: IntentDataEvent) { expect(this).toBe(observer); events.push('emit'); seen.push(event); }; }};
    const source = {get templateId() { events.push('template'); return 'template-data'; }, get deliverable() { events.push('deliverable'); return 'report'; }, get riskTier() { events.push('risk'); return 'low'; }};
    observer.emit(checkIntentEvent({type: 'intent_created', ...common, templateId: source.templateId, deliverable: source.deliverable, riskTier: source.riskTier}));
    expect(events).toEqual(['callee', 'template', 'deliverable', 'risk', 'emit']);
    expect(seen).toHaveLength(1);
  });

  it('reads the whole literal before rejecting it, without calling the observer', () => {
    const events: string[] = [];
    const observer = {get emit() { events.push('callee'); return (_event: IntentDataEvent) => { events.push('emit'); }; }};
    const source = {get templateId(): unknown { events.push('template'); return {opaque: true}; }, get deliverable() { events.push('deliverable'); return 'report'; }, get riskTier() { events.push('risk'); return 'low'; }};
    expect(() => observer.emit(checkIntentEvent({type: 'intent_created', ...common, templateId: source.templateId, deliverable: source.deliverable, riskTier: source.riskTier}))).toThrow('intent_runtime_event_data:templateId');
    expect(events).toEqual(['callee', 'template', 'deliverable', 'risk']);
  });

  it('does not evaluate payload when the observer getter throws', () => {
    const events: string[] = [], original = Error('callee_getter');
    const observer = {get emit(): (event: IntentDataEvent) => void { events.push('callee'); throw original; }};
    const source = {get stepId() { events.push('step'); return 'step-data'; }};
    let caught: unknown;
    try { observer.emit(checkIntentEvent({type: 'step_activated', ...common, stepId: source.stepId})); }
    catch (error) { caught = error; }
    expect(caught).toBe(original);
    expect(events).toEqual(['callee']);
  });
});
