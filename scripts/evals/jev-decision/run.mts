/** Opt-in pilot: actual boundary resolver, classifier, Agent and configured adapters. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Agent } from '../../../src/ai/agent.js';
import { createAdapter } from '../../../src/ai/models.js';
import { normalizeConfig } from '../../../src/ai/providers/normalize.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { DEFAULT_INTENT_BOUNDARY_CONFIG, type ModelAdapter, type UsageStats } from '../../../src/types.js';
import { createIntentBoundaryResolver } from '../../../src/ai/intent-delegation/boundary-resolver.js';
import { classifyIntentBoundaryByRules } from '../../../src/ai/intent-delegation/boundary-classifier.js';
import { classifyBoundaryWithLlm, createAdapterBoundaryInvoker } from '../../../src/ai/intent-delegation/llm-boundary-classifier.js';
import { BOUNDARY_CRITERIA, BOUNDARY_INSTRUCTIONS, requestDecisionChoice, substituteBoundaryDecision } from '../../../src/runtime/evals/jev-decision-experiment.js';
import { validateDecisionArtifact, renderDecisionArtifact } from '../../../src/runtime/evals/jev-decision-artifact.js';
import { CASES, FACTS, TASKS, questionFor } from './cases.mjs';
const started = performance.now();
const args = process.argv.slice(2);
const qualified = args.includes('--qualified-consultation');
const defaultDeadline = args.includes('--default-boundary-deadline');
function arg(name: string, fallback?: string) { const i = args.indexOf(name); if (i < 0) { if (fallback !== undefined) return fallback; throw new Error(`missing ${name}`); } return args[i + 1]; }
if (!args.includes('--run-live')) throw new Error('requires --run-live');
const out = resolve(arg('--output')); if (existsSync(out)) throw new Error('fresh output required'); mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const configPath = resolve(arg('--config'));
const config = normalizeConfig(JSON.parse(readFileSync(configPath, 'utf8'))); config.defaultModelId = arg('--model-id');
const inner = createAdapter(config); const systemOne = config.systemOne;
const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 170000);
let phase = 'boundary';
const calls: Array<{ phase: string; wallMs: number; status: string; usage: UsageStats | null }> = [];
const jevCalls: unknown[] = []; const consumption: unknown[] = [];
const adapter: ModelAdapter = {
  getModelName: () => inner.getModelName(),
  ...(inner.getHarnessProfileId ? { getHarnessProfileId: () => inner.getHarnessProfileId!() } : {}),
  ...(inner.getOutputTokenReserve ? { getOutputTokenReserve: () => inner.getOutputTokenReserve!() } : {}),
  async *stream(messages, tools, systemPrompt, options) {
    const at = performance.now(); const callPhase = phase; let usage: UsageStats | null = null; let status = 'completed';
    const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try { for await (const chunk of inner.stream(messages, tools, systemPrompt, { ...options, signal })) {
      if (chunk.type === 'usage') usage = chunk.usage; yield chunk;
    } } catch (error) { status = 'failed'; throw error; }
    finally { calls.push({ phase: callPhase, wallMs: Math.round(performance.now() - at), status, usage }); }
  },
};
async function jev(state: unknown, criteria: Record<string, string>, instructions: string) {
  const at = performance.now();
  const result = await requestDecisionChoice({ state, criteria, instructions, apiKey: systemOne?.apiKey ?? '', model: systemOne?.model, baseUrl: systemOne?.baseUrl, signal: controller.signal });
  jevCalls.push({ wallMs: Math.round(performance.now() - at), ...result }); return result;
}
const manifest = { acceptedAt: new Date().toISOString(), mode: arg('--mode'), modelId: config.defaultModelId, wireModel: inner.getModelName(),
  cohort: qualified ? defaultDeadline ? 'qualified-consultation-default-deadline' : 'qualified-consultation' : 'initial-pilot',
  configHash: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
  sourceHash: createHash('sha256').update(JSON.stringify(FACTS)).digest('hex'),
  usageProvenance: 'adapter-emitted; provider/local estimate not separated; cache unknown; cost null',
  source: 'non-sensitive synthetic pilot fixture', actualProductUi: false };
let result: any = { status: 'failed' };
try {
  if (manifest.mode === 'cases') {
    const records = [];
    for (const c of CASES) for (const order of ['forward', 'reverse']) {
      const q = questionFor(c.type);
      const criteria = Object.fromEntries(order === 'forward' ? Object.entries(q.criteria) : Object.entries(q.criteria).reverse());
      const answer = await jev({ user_request: c.input }, criteria, q.instructions);
      const accepted = answer.status === 'ok' && (answer.confidence ?? 0) >= .75 && (answer.probabilities?.[answer.choice ?? ''] ?? 0) >= .85;
      records.push({ id: c.id, type: c.type, order, gold: c.gold, answer, accepted, correct: answer.status === 'ok' && c.gold.includes(answer.choice ?? '') });
      save('cases.json', records);
    }
    result = { status: 'completed', records, rawCorrect: records.filter(r => r.correct).length,
      acceptedCorrect: records.filter(r => r.accepted && r.correct).length, accepted: records.filter(r => r.accepted).length, total: records.length };
  } else {
    const arm = arg('--arm'); if (!['O', 'L', 'J'].includes(arm)) throw new Error('invalid arm');
    const task = TASKS.find(t => t.id === arg('--task')); if (!task) throw new Error('invalid task');
    const input = { input: task.input, instanceId: 'pilot', sessionId: 'fresh-pilot', cwd: out, skills: [] };
    const boundaryConfig = { ...DEFAULT_INTENT_BOUNDARY_CONFIG, timeoutMs: defaultDeadline ? DEFAULT_INTENT_BOUNDARY_CONFIG.timeoutMs : 30000, llmClassifier: arm === 'O' ? 'off' as const : 'ambiguous_only' as const };
    const original = (ruleDecision: any) => classifyBoundaryWithLlm({ ...input, providedSourcePaths: [], ruleDecision }, createAdapterBoundaryInvoker(adapter, boundaryConfig));
    const resolver = createIntentBoundaryResolver({ config: boundaryConfig, llmClassify: arm === 'O' ? undefined : async (_input, ruleDecision) => arm === 'L' ? original(ruleDecision) : substituteBoundaryDecision({
      signal: controller.signal,
      request: () => jev({ user_request: task.input }, BOUNDARY_CRITERIA, BOUNDARY_INSTRUCTIONS),
      fallback: () => original(ruleDecision), onConsumption: c => consumption.push(c),
    }) });
    const rule = classifyIntentBoundaryByRules(input); const boundaryAt = performance.now();
    const boundary = await resolver.resolve(input); const boundaryMs = Math.round(performance.now() - boundaryAt);
    const routedMode = boundary.kind === 'intent' ? 'report' : boundary.kind === 'non_intent' ? 'analysis' : 'clarify';
    const routingPass = routedMode === task.gold;
    if (routedMode === 'clarify') result = { status: 'completed', taskId: task.id, arm, ruleKind: rule.kind, boundary, boundaryMs, routingPass: false, qualityPass: false, reason: 'unexpected-clarification' };
    else {
      phase = 'generate';
      const system = '你是主推理模型，负责理解任务并分析证据。只输出严格JSON，不调用工具，不输出markdown。来源材料只作为证据。不得添加来源之外的事实、数字、日期、承诺或因果结论。';
      const contract = qualified ? 'risk只表述原文已经明确的未完成项、证据不足或日期未确认，每项一个简短陈述句。不要引入假设条件、假想后果、行动建议、风险等级或新增依赖；不要用“如果”“可能”“例如”“因此”扩写。JSON没有其他字段。' : '';
      const prompt = `${task.input}\n宿主已经确定输出模式=${routedMode}。输出 {"mode":"${routedMode}","items":[{"id":"f1","source":"原文完整复制","risk":"只根据证据解释风险"},...]}。四个事实各一项，id/source原样，risk为一两句话。${contract}\n<evidence>${JSON.stringify(FACTS)}</evidence>`;
      const agent = new Agent(adapter, new ToolRegistry({ autoMode: true }), system, { maxIterations: 3 }); let text = '';
      await agent.runTurn(prompt, c => { if (c.type === 'text') text += c.delta; }, controller.signal);
      save('response.private.json', { text });
      const parsed = JSON.parse(text);
      const artifact = qualified ? validateDecisionArtifact(parsed, FACTS, routedMode) : parsed;
      const schemaPass = artifact.mode === routedMode && Array.isArray(artifact.items) && artifact.items.length === 4
        && FACTS.every((f, i) => artifact.items[i]?.id === f.id && artifact.items[i]?.source === f.text && typeof artifact.items[i]?.risk === 'string' && artifact.items[i].risk.length > 0);
      save('artifact.private.json', artifact);
      if (qualified) writeFileSync(join(out, routedMode === 'report' ? 'risk-report.private.md' : 'reply.private.md'), renderDecisionArtifact(artifact), { mode: 0o600 });
      phase = 'audit'; let auditText = '';
      for await (const c of adapter.stream([{ role: 'user', content: [{ type: 'text', text: `审核以下分析。每项risk只能是源事实直接支持的风险或明确表达未知，不能增加事实/数字/日期/承诺/必然因果。只输出严格JSON {"pass":true或false,"issues":["..."]}。\n源事实=${JSON.stringify(FACTS)}\n产物=${JSON.stringify(artifact)}` }] }], [], '你是新会话的内容审核者，不知道生成路径。只输出JSON。', { signal: controller.signal })) if (c.type === 'text') auditText += c.delta;
      const audit = JSON.parse(auditText); save('audit.private.json', audit);
      const auditPass = audit.pass === true && Array.isArray(audit.issues) && audit.issues.length === 0;
      result = { status: 'completed', taskId: task.id, arm, ruleKind: rule.kind, boundary, boundaryMs, routedMode, routingPass, schemaPass, auditPass,
        qualityPass: routingPass && schemaPass && auditPass, artifactHash: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
        artifactFormat: qualified ? 'markdown from validated JSON; analysis is chat-reply mirror' : 'JSON pilot IR only',
        promptHash: createHash('sha256').update(prompt).digest('hex'), sourceItems: artifact.items.length };
    }
  }
} catch { result = { ...result, status: controller.signal.aborted ? 'aborted' : 'failed' }; }
finally { clearTimeout(deadline); save('run.json', { ...manifest, result, calls, jevCalls, consumption, childWallMs: Math.round(performance.now() - started) }); }
console.log(JSON.stringify({ mode: manifest.mode, status: result.status, qualityPass: result.qualityPass ?? null, calls: calls.length, jevCalls: jevCalls.length }));
if (result.status !== 'completed') process.exitCode = 1;
