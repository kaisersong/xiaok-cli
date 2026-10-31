import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runTimedExperiment, requestLayoutAdvice, formatInlineLayoutAdvice, experimentModePolicy, runProcessToExit, validateMatchedRuns } from '../../src/runtime/evals/jev-skill-experiment.js';

describe('端到端消融边界', () => {
  it('两个 source-owned 分支只切换 Jev，保留全部质量链路', () => {
    expect(experimentModePolicy('source-owned-only')).toEqual({ sourceOwned: true, contractMode: true, useJev: false });
    expect(experimentModePolicy('source-owned-advice')).toEqual({ sourceOwned: true, contractMode: true, useJev: true });
    expect(() => experimentModePolicy('invalid')).toThrow();
  });
  it('真实 child 等待后退出才结束计时，非零退出也保留时间', async () => {
    const result = await runProcessToExit({ executable: process.execPath, args: ['-e', 'setTimeout(()=>{console.log("finished");process.exit(2)},120)'], cwd: process.cwd(), deadlineMs: 5000 });
    expect(result.exitCode).toBe(2);
    expect(result.wallMs).toBeGreaterThanOrEqual(120);
    expect(result.stdout.trim()).toBe('finished');
    expect(result.timedOut).toBe(false);
  });
  it('真实挂起 child 被 deadline 结束，不报成功', async () => {
    const result = await runProcessToExit({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), deadlineMs: 120 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.wallMs).toBeGreaterThanOrEqual(110);
  });
  it('配对拒绝版本不一致、审核失败及没有实际送达的 Jev', () => {
    const common = { sourceHash:'source',configHash:'config',modelId:'configured',wireModel:'actual',preset:'fixed',runnerHash:'same',experimentHelperHash:'helper',rendererHash:'renderer',validationHashes:{schema:'fixed'},referenceHashes:{template:'fixed'},paginationHash:'pagination',skillHash:'skill',sourceFactsHash:'facts',sourceBinderHash:'binder',sourceExtractorHash:'extractor',sourceAuditorHash:'auditor',rubricHash:'rubric',plannerBasePromptHash:'prompt',sourceAuditInFullTimer:true, result:{status:'completed',value:{artifactReady:true}}, contentAudit:{status:'completed',verdict:'pass'} };
    const a:any = { arm:'A',exitCode:0,run:{...common,inlineAdviceHash:null,adviceCalls:[]} };
    const b:any = { arm:'B',exitCode:0,run:{...common,inlineAdviceHash:'delivered',adviceCalls:[{status:'ok'}]} };
    expect(validateMatchedRuns([a,b])).toMatchObject({comparable:true,allQualityPass:true,treatmentDelivered:true});
    expect(validateMatchedRuns([a,{...b,run:{...b.run,runnerHash:'different'}}]).comparable).toBe(false);
    expect(validateMatchedRuns([a,{...b,run:{...b.run,contentAudit:{status:'completed',verdict:'fail'}}}]).allQualityPass).toBe(false);
    expect(validateMatchedRuns([a,{...b,run:{...b.run,inlineAdviceHash:null}}]).treatmentDelivered).toBe(false);
    expect(validateMatchedRuns([a,{...b,exitCode:1}]).allQualityPass).toBe(false);
    expect(validateMatchedRuns([a,{...b,run:{...b.run,sourceHash:undefined}}]).comparable).toBe(false);
  });
});

describe('完整实验耗时', () => {
  it('前置准备、生成、最终产物检查和回退都进入同一个总时钟', async () => {
    let clock = 0;
    const result = await runTimedExperiment({
      now: () => clock,
      prepare: async () => { clock += 6000; return '完整源材料'; },
      generate: async source => { expect(source).toBe('完整源材料'); clock += 360000; return 'deck'; },
      finalize: async deck => { expect(deck).toBe('deck'); clock += 1600; return { artifactReady: true }; },
    });
    expect(result).toMatchObject({ status: 'completed', wallMs: 367600, value: { artifactReady: true } });
    expect(result.stages.map(s => s.elapsedMs)).toEqual([6000, 360000, 1600]);
  });

  it('失败仍记录总耗时和失败阶段，不能返回成功或零耗时', async () => {
    let clock = 0;
    const finalize = vi.fn();
    const result = await runTimedExperiment({
      now: () => clock,
      prepare: async () => { clock = 1000; return null; },
      generate: async () => { clock = 12000; throw new Error('private source echoed'); },
      finalize,
    });
    expect(result).toMatchObject({ status: 'failed', wallMs: 12000, failureStage: 'generate' });
    expect(result.stages[1]).toMatchObject({ status: 'failed', elapsedMs: 11000 });
    expect(finalize).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private source');
  });

  it('取消在前置阶段后阻止模型生成，保留耗时', async () => {
    const controller = new AbortController();
    const generate = vi.fn();
    const result = await runTimedExperiment({
      signal: controller.signal,
      prepare: async () => { controller.abort(); return null; },
      generate,
      finalize: async () => null,
    });
    expect(result.status).toBe('aborted');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('实验 Jev 建议仅选择布局，不裁掉章节', () => {
  it('无工具 planner 实际获得建议内容，不依赖不可读取的文件路径', () => {
    const advice = { s02: { choice: 'flow', confidence: 0.8, probabilities: { evidence: 0.1, comparison: 0.1, flow: 0.8 } } };
    const prompt = formatInlineLayoutAdvice(advice);
    expect(prompt).toContain(JSON.stringify(advice));
    expect(prompt).toContain('advisory_only');
    expect(prompt).not.toContain('.json');
    expect(formatInlineLayoutAdvice({})).toBe('');
  });
  const sections = [{ id: 's01', text: '项目准入须逐级签字，不能改写或删掉原文。' }];
  it('记录真实 usage 和解析模型，发送有界状态，概率/置信度分开', async () => {
    let body: any;
    const result = await requestLayoutAdvice({
      sections, apiKey: 'private-test-key', model: 'jev-latest',
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ model: 'jev-fixed', usage: { input_tokens: 800, output_tokens: 30 }, answers: {
          s01: { type: 'choice', choice: 'flow', confidence: 0.8, probabilities: { evidence: 0.1, comparison: 0.1, flow: 0.8 } },
        } }));
      },
    });
    expect(body.state.sections).toEqual(sections);
    expect(Object.keys(body.questions.s01.criteria)).toEqual(['evidence', 'comparison', 'flow']);
    expect(result).toMatchObject({ status: 'ok', model: 'jev-fixed', usage: { input_tokens: 800, output_tokens: 30 }, advice: { s01: { choice: 'flow', confidence: 0.8 } } });
    expect(JSON.stringify(result)).not.toContain('private-test-key');
  });

  it.each([
    { choice: 'delete_section', confidence: 0.9, probabilities: { evidence: 0.1, comparison: 0.1, flow: 0.8 } },
    { choice: 'flow', probabilities: { evidence: 0.1, comparison: 0.1, flow: 0.8 } },
    { choice: 'flow', confidence: 0.9, probabilities: { evidence: 0, comparison: 0, flow: 2 } },
  ])('坏响应不伪造判断或吞掉已知计费', async answer => {
    const result = await requestLayoutAdvice({ sections, apiKey: 'key', model: 'jev-latest', fetchImpl: async () => new Response(JSON.stringify({
      model: 'jev-fixed', usage: { input_tokens: 42, output_tokens: 5 }, answers: { s01: { type: 'choice', ...answer } },
    })) });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid-response', usage: { input_tokens: 42, output_tokens: 5 } });
    expect(result.advice).toEqual({});
  });

  it('没有 key 或输入超限不联网，原文不静默截断', async () => {
    const fetchImpl = vi.fn();
    expect((await requestLayoutAdvice({ sections, apiKey: '', model: 'jev-latest', fetchImpl })).reason).toBe('missing-key');
    expect((await requestLayoutAdvice({ sections: [{ id: 's01', text: '中文'.repeat(5000) }], apiKey: 'key', model: 'jev-latest', fetchImpl })).reason).toBe('input-limit');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('故障响应不输出供应商回显；计费 unknown 不补零', async () => {
    const result = await requestLayoutAdvice({ sections, apiKey: 'key', model: 'jev-latest', fetchImpl: async () => new Response('private source echoed', { status: 429 }) });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'http-429', usage: null, advice: {} });
    expect(JSON.stringify(result)).not.toContain('private source');
  });

  it('真实 HTTP header 已返回但 body 挂起时，deadline 仍生效', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.flushHeaders();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP address');
    const started = performance.now();
    try {
      const result = await requestLayoutAdvice({ sections, apiKey: 'key', model: 'jev-latest', baseUrl: `http://127.0.0.1:${address.port}` });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'timeout', usage: null });
      expect(performance.now() - started).toBeGreaterThan(1800);
      expect(performance.now() - started).toBeLessThan(3500);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
