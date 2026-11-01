import { describe, expect, it, vi } from 'vitest';
import {
  completeAssistantJson,
  validateEveningReflection,
  validateMorningBriefing,
} from '../../electron/assistant-llm.js';

describe('assistant no-tool structured LLM', () => {
  it('uses the narrow completion port and validates the production schema', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        summary: '完成两项关键工作。',
        candidates: [{
          kind: 'memory',
          title: '偏好简洁汇报',
          content: '用户偏好先给结论。',
          scope: 'global',
          confidence: 0.92,
          evidenceRefs: [{ kind: 'task', id: 'task-1' }],
          dedupeKey: 'memory:concise-reporting',
        }],
      }),
    });

    const result = await completeAssistantJson({
      port: { complete },
      systemPrompt: 'Return JSON.',
      snapshot: { items: [], dropped: {}, from: 0, to: 1, timeZone: 'UTC' },
      validate: validateEveningReflection,
      maxTokens: 500,
    });

    expect(result.candidates).toHaveLength(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'fast', temperature: 0 }));
  });

  it.each([
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'global', confidence: 1, evidenceRefs: [], dedupeKey: 'k' }] }, 'evidence'],
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'private', confidence: 1, evidenceRefs: [{ kind: 'task', id: '1' }], dedupeKey: 'k' }] }, 'scope'],
    [{ summary: 'x', candidates: [{ kind: 'memory', title: 't', content: 'c', scope: 'global', confidence: 2, evidenceRefs: [{ kind: 'task', id: '1' }], dedupeKey: 'k' }] }, 'confidence'],
  ])('rejects invalid evening candidate output: %s', (value, message) => {
    expect(() => validateEveningReflection(value)).toThrow(message);
  });

  it('caps morning recommendations at three without fabricating filler', () => {
    expect(validateMorningBriefing({ recommendations: [] }).recommendations).toEqual([]);
    expect(() => validateMorningBriefing({
      recommendations: Array.from({ length: 4 }, (_, index) => ({
        title: `item-${index}`,
        reasonCode: 'due_task',
        evidenceRefs: [{ kind: 'task', id: `task-${index}` }],
      })),
    })).toThrow('three');
  });

  it('fails closed on malformed JSON', async () => {
    await expect(completeAssistantJson({
      port: { complete: vi.fn().mockResolvedValue({ text: 'not-json' }) },
      systemPrompt: 'Return JSON.',
      snapshot: {},
      validate: validateEveningReflection,
      maxTokens: 500,
    })).rejects.toThrow('assistant_json_invalid');
  });
});

describe('morning action protocol v2',()=>{
 const reference={kind:'task_snapshot',id:'task-1'};
 const recommendation={title:'整理任务结果',reasonCode:'task_result',evidenceRefs:[reference],action:{kind:'review',reason:'有结果待审查',nextStep:'先检查证据',instruction:'整理此任务的结果与证据，不修改原任务。'}};
 const value=()=>({schemaVersion:2,recommendations:[structuredClone(recommendation)]});
 it('accepts bounded actions tied to this round and preserves their exact text',()=>{
  const input=value();const result=validateMorningBriefing(input,{evidenceRefs:[reference]});
  expect(result).toEqual(input);
 });
 it('rejects invented references or missing evidence context',()=>{
  expect(()=>validateMorningBriefing(value(),{evidenceRefs:[{...reference,id:'other'}]})).toThrow('evidence');
  expect(()=>validateMorningBriefing(value())).toThrow('context');
 });
 it.each(['permissionMode','shell','toolName','dedupeKey'])('rejects model-supplied authority field %s',field=>{
  const input=value();(input.recommendations[0]!.action as any)[field]='danger';
  expect(()=>validateMorningBriefing(input,{evidenceRefs:[reference]})).toThrow();
 });
 it('rejects overlong/blank instruction and too many references rather than clipping',()=>{
  for(const instruction of [' ', 'x'.repeat(4001)]){
   const input=value();input.recommendations[0]!.action.instruction=instruction;
   expect(()=>validateMorningBriefing(input,{evidenceRefs:[reference]})).toThrow();
  }
  const input=value();input.recommendations[0]!.evidenceRefs=Array.from({length:21},()=>reference);
  expect(()=>validateMorningBriefing(input,{evidenceRefs:[reference]})).toThrow();
 });
});
