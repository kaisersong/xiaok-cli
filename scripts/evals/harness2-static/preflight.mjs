import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnoseTraceBundle } from '../../../src/runtime/diagnostics/diagnoser.ts';
import { diagnoseProjectSnapshot } from '../../../src/runtime/diagnostics/project-diagnoser.ts';

export const OPERATIONS = Object.freeze([
  'VERIFY_SOURCE_DATE', 'CHECK_REQUIRED_SECTIONS', 'VERIFY_REFERENCES_BEFORE_FINAL',
]);
export const DIAGNOSIS_CATEGORIES = Object.freeze([
  'blocked_task', 'dispatch_stalled', 'empty_artifact', 'approval_wait', 'missing_verification',
  'protected_output', 'missing_recovery_runtime', 'quality_failure', 'unknown',
]);
export const DIAGNOSIS_ACTIONS = Object.freeze([
  'inspect_blocked_task', 'reassign_task', 'dispatch_unblocked_task', 'inspect_artifacts',
  'rerun_with_artifact_contract', 'answer_approval', 'split_or_reassign_review',
]);

function validateOperations(value) {
  if (!Array.isArray(value) || value.length > OPERATIONS.length
    || new Set(value).size !== value.length || [...value].some(item => !OPERATIONS.includes(item))) {
    throw new Error('invalid_operations');
  }
}

/** v46 §10.1 only: a hit on a genuinely unmet operation; no over-selection penalty. */
export function evaluateSelection({ required, selected, fabricatedFacts = false, unauthorized = false }) {
  validateOperations(required);
  validateOperations(selected);
  if (typeof fabricatedFacts !== 'boolean' || typeof unauthorized !== 'boolean') throw new Error('invalid_violation');
  return !fabricatedFacts && !unauthorized && selected.some(item => required.includes(item)) ? 1 : 0;
}

export function proveStaticStop() {
  const subsets = Array.from({ length: 2 ** OPERATIONS.length }, (_, mask) =>
    OPERATIONS.filter((_, index) => mask & (1 << index)));
  const cases = [];
  for (const required of subsets) {
    const baseValue = evaluateSelection({ required, selected: OPERATIONS });
    for (const selected of subsets) for (const fabricatedFacts of [false, true]) for (const unauthorized of [false, true]) {
      const candidateValue = evaluateSelection({ required, selected, fabricatedFacts, unauthorized });
      cases.push({ required, selected, fabricatedFacts, unauthorized, baseValue, candidateValue, delta: candidateValue - baseValue });
    }
  }
  const maxDelta = Math.max(...cases.map(row => row.delta));
  if (maxDelta > 0) throw new Error('static_dominance_failed');
  // A scope counterexample, deliberately separate from the fixed decision metric.
  const required = [OPERATIONS[0]];
  const alternate = selected => evaluateSelection({ required, selected })
    - 0.6 * selected.filter(item => !required.includes(item)).length;
  const baseValue = alternate(OPERATIONS);
  const candidateValue = alternate(required);
  return {
    decision: 'stop_paid_reflect', metric: 'V_missing_operation_hit_v1',
    scope: 'v46_three_fixed_operations_only', maxDelta, minDelta: Math.min(...cases.map(row => row.delta)), cases,
    alternativeMetricCounterexample: { metric: 'V_minus_0.6_per_extra_operation', usedForDecision: false,
      required, baseValue, candidateValue, delta: candidateValue - baseValue },
  };
}

/** Fixed structured-code lookup. Natural language never creates operations. */
export function mapDiagnosis(report) {
  const known = report?.schemaVersion === 1 && Array.isArray(report.findings) && Array.isArray(report.recommendedActions)
    && [...report.findings].every(row => DIAGNOSIS_CATEGORIES.includes(row?.category))
    && [...report.recommendedActions].every(row => DIAGNOSIS_ACTIONS.includes(row?.id));
  return { status: known ? 'no_entry' : 'mapping_unknown', operations: [] };
}

const inventorySpecs = [
  ['src/runtime/diagnostics/diagnoser.ts', 'production_diagnosis', ['export function diagnoseTraceBundle'],
    '已有 trace 诊断；结构化 category/action 按冻结表映射，不推断报告质量操作。'],
  ['src/runtime/diagnostics/project-diagnoser.ts', 'production_diagnosis', ['export function diagnoseProjectSnapshot'],
    '已有 project 诊断；沿用 trace 诊断并补 dispatch_stalled。'],
  ['src/runtime/diagnostics/types.ts', 'diagnosis_schema', ['export type DiagnosisCategory ='],
    '声明的通用 verification/quality 类别不等于具体报告 verifier。'],
  ['src/runtime/harness-memory/types.ts', 'legacy_memory', ['export type HarnessMemoryStatus', 'export interface HarnessMemoryEvidence'],
    '已有 candidate/active/expired、scope/evidence；不重建经验生命周期。'],
  ['src/runtime/harness-memory/store.ts', 'legacy_memory', ['export class JsonHarnessMemoryStore', '  promote(', '  private persist('],
    '已有 JSON writer；本批不改变读写、锁或晋级。'],
  ['src/runtime/harness-memory/promotion.ts', 'legacy_memory', ['export function evaluateHarnessMemoryPromotion'],
    '已有来源数量晋级 helper，不能代替正式质量/成本验证。'],
  ['src/ai/prompts/builder.ts', 'cli_prompt', ['  async build(', '    const harnessMemories ='],
    'CLI builder 已查询 active harness memory 并最多取六条；不是 Desktop 投影证据。'],
  ['src/ai/prompts/assembler.ts', 'cli_prompt', ['  if (opts.harnessMemories &&'],
    '已有 CLI harness_memory 提示段；不等于目标 profile 的实际注入。'],
  ['src/ai/memory/layered-store.ts', 'legacy_memory', ['  async compact(', '  private startAutoCompact('],
    '已有长期记忆整理和 timer；本批不启动实例或修改其成本语义。'],
  ['src/ai/memory/compaction.ts', 'legacy_memory', ['export async function compactL0toL1', 'export async function compactL1toL2', 'export async function compactL2toL3'],
    '已有分层整理；未读取用户记忆正文，不断言目标问题未覆盖。'],
  ['desktop/electron/desktop-system-prompt.ts', 'desktop_prompt', ['export function buildDesktopSystemPrompt'],
    'Desktop base prompt 源码；实际 skill/workspace/memory 义务仍需真实 frame 对照。'],
  ['desktop/electron/desktop-services.ts', 'desktop_execution', ['    const modelIdentity =', '      loopResult = await runDesktopToolLoop('],
    'Desktop 独立拼装 system prompt 并调用真实 loop；不可借 CLI 能力推断已接入。'],
  ['desktop/electron/loop-evaluator.ts', 'production_verifier_registry', ['export async function evaluateLoopContract'],
    '只聚合已注册 verifier；具体 operation 映射需实际 criterion/version/回执。'],
  ['desktop/electron/completion-evidence-store.ts', 'production_completion', ['export class CompletionEvidenceStore'],
    '已有完成证据 store，产物/完成事实不自动证明来源日期或逐引用支持。'],
  ['src/runtime/guards/completion-evidence.ts', 'production_completion', ['export function validateCompletionEvidence'],
    '已有完成验证；不是已资格化的报告语义 verifier。'],
  ['scripts/evals/xiaok-product/scorers/report-scorer.mjs', 'offline_eval', ['export function scoreReport'],
    '离线结构评分不进入目标生产等价集合 E_target。'],
];

function collectInventory(root) {
  return inventorySpecs.map(([path, role, anchors, note]) => {
    const bytes = readFileSync(join(root, path));
    const lines = bytes.toString('utf8').split('\n');
    const sourceRefs = anchors.map(symbol => {
      const matches = lines.flatMap((line, index) => line.startsWith(symbol) ? [index + 1] : []);
      if (matches.length !== 1) throw new Error('source_anchor_changed');
      return { symbol: symbol.trim(), line: matches[0] };
    });
    return { path, role, sha256: createHash('sha256').update(bytes).digest('hex'), sourceRefs, note };
  });
}

function checkProductionDiagnoses() {
  const tasks = [{ id: 'blocked', title: 'synthetic blocked', status: 'blocked' },
    { id: 'empty', title: 'synthetic empty', status: 'done', artifacts: [] }];
  const agents = [{ id: 'idle', status: 'idle' }];
  const trace = diagnoseTraceBundle({ schemaVersion: 1, tasks, agents, summary: { projectStatus: 'active' },
    events: [{ id: 'approval', type: 'approval.required', data: {} }], scope: { kind: 'task', taskId: 'synthetic' } });
  const project = diagnoseProjectSnapshot({ project: { id: 'synthetic', name: 'synthetic', status: 'active' }, tasks, agents,
    dispatchPlan: { dispatchable: [{ taskId: 'next' }] } });
  return { evidenceKind: 'synthetic_production_entry_calls', cases: [trace, project].map((report, index) => ({
    entry: index === 0 ? 'diagnoseTraceBundle' : 'diagnoseProjectSnapshot',
    categories: report.findings.map(row => row.category), actions: report.recommendedActions.map(row => row.id),
    mapping: mapDiagnosis(report),
  })) };
}

/** Read-only P0a artifact. There is deliberately no research/config/dispatch interface. */
export async function buildStaticReport(root) {
  return {
    schemaVersion: 1, designVersion: 'v46',
    designSha256: 'd9dbd2b4d88ebcfb0c744ea8a530f9e0a10dd95b5a543669a55e1778aec4f8dc',
    evidenceLevel: 'static_source_and_synthetic_formula_only', productQualified: false,
    p0a: proveStaticStop(), diagnostics: checkProductionDiagnoses(), inventory: collectInventory(root),
    d0: { decision: 'not_started', scope: 'research_admission_only_not_engineering_progress', reason: 'real_D0_evidence_not_validated', missingEvidence: [
      'selected_workspace_policy_and_installed_skill_snapshots', 'actual_desktop_baseline_and_target_obligations',
      'planned_specific_production_verifier_registry', 'real_report_failure_buckets',
      'provider_transport_usage_hazard_history', 'frozen_cost_envelope_and_joint_power_protocol',
      'fingerprint_freeze_window_and_real_application_volume', 'explicit_frozen_deterministic_research_manifest',
    ] },
    validation: { covered: ['T15.1'], notValidated: ['D0', 'P2a', 'P2b', 'real_report_quality',
      'provider_usage_qualification', 'isolation', 'installed_package', 'production_guidance'] },
  };
}
