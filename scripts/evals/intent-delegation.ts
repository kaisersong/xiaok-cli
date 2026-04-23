import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIntentPlan, type ActiveIntentContext } from '../../src/ai/intent-delegation/planner.js';
import type { IntentPlanDraft, IntentType, PlannedStep, RiskTier } from '../../src/ai/intent-delegation/types.js';
import { activateIntentStep, createIntentLedgerRecord } from '../../src/runtime/intent-delegation/dispatcher.js';
import { appendIntentToLedger, createEmptySessionIntentLedger } from '../../src/runtime/intent-delegation/store.js';
import { markSessionOwned, takeoverSessionOwnership } from '../../src/runtime/intent-delegation/ownership.js';
import type { IntentLedgerRecord, SessionIntentLedger } from '../../src/runtime/intent-delegation/types.js';
import {
  buildIntentReminderBlock,
  formatCurrentIntentSummaryLine,
  formatIntentCreatedTranscriptBlock,
  formatProgressTranscriptBlock,
  formatReceiptTranscriptBlock,
  formatSalvageTranscriptBlock,
} from '../../src/ui/orchestration.js';

type BoundaryContinuationMode = 'new_intent' | 'continue_active' | 'clarify' | 'non_intent';

type IntentBoundaryRow = {
  id: string;
  hasActiveIntent: boolean;
  activeIntent?: ActiveIntentContext;
  expectedResultKind: 'plan' | 'non_intent';
  expectedContinuationMode: BoundaryContinuationMode;
  expectedIntentType: IntentType | null;
  prompt: string;
};

type PlanningRow = {
  id: string;
  hasActiveIntent: boolean;
  activeIntent?: ActiveIntentContext;
  prompt: string;
  expectedTemplateId: string;
  expectedStepRoles: string[];
};

type DispatchScenario = {
  id: string;
  check: 'single_active_step' | 'out_of_order_rejection' | 'high_risk_confirmation';
  prompt: string;
  riskTierOverride?: RiskTier;
};

type SurfaceRenderer =
  | 'intent_created'
  | 'progress'
  | 'receipt'
  | 'salvage'
  | 'summary_line'
  | 'reminder_block';

type SurfaceIntentSeed = {
  deliverable: string;
  intentType: IntentType;
  riskTier: RiskTier;
  templateId: string;
  delegationBoundary: string[];
  activeStepKey: string;
  overallStatus: IntentLedgerRecord['overallStatus'];
  latestBreadcrumb?: string;
};

type SurfaceCase = {
  id: string;
  renderer: SurfaceRenderer;
  instanceId?: string;
  ownerInstanceId?: string;
  intent?: SurfaceIntentSeed;
  stepId?: string;
  stepStatus?: 'running' | 'blocked' | 'completed' | 'failed';
  message?: string;
  note?: string;
  summary?: string[];
  reason?: string;
  expectedSubstrings?: string[];
  expectedExact?: string;
};

type SurfaceFixture = {
  cases: SurfaceCase[];
};

type CsvRecord = Record<string, string>;

type EvalFailure = {
  suite: string;
  id: string;
  message: string;
};

type EvalSuiteResult = {
  suite: string;
  passed: number;
  total: number;
  failures: EvalFailure[];
};

const REPO_ROOT = process.cwd();
const NONE = '-';
const DEFAULT_ACTIVE_INTENT: ActiveIntentContext = {
  intentId: 'intent-active',
  deliverable: '产品方案',
  intentType: 'generate',
  templateId: 'generate_v1',
};
const EMPTY_SKILLS = [];
const INTENT_TYPES: IntentType[] = ['generate', 'revise', 'summarize', 'analyze'];
const RISK_TIERS: RiskTier[] = ['low', 'medium', 'high'];
const PLAN_STATUSES: IntentLedgerRecord['overallStatus'][] = [
  'drafting_plan',
  'executing',
  'waiting_user',
  'recovering',
  'completed',
  'failed',
  'cancelled',
];

async function main(): Promise<void> {
  try {
    const suites = [
      evaluateIntentBoundary(),
      evaluateIntentPlanning(),
      evaluateDispatch(),
      evaluateSurface(),
    ];

    const failures = suites.flatMap((suite) => suite.failures);
    const passed = suites.reduce((sum, suite) => sum + suite.passed, 0);
    const total = suites.reduce((sum, suite) => sum + suite.total, 0);

    console.log('Intent Behavioral Eval');
    console.log('');
    for (const suite of suites) {
      const label = suite.failures.length === 0 ? 'PASS' : 'FAIL';
      console.log(`${label} ${suite.suite}: ${suite.passed}/${suite.total}`);
    }

    if (failures.length === 0) {
      console.log('');
      console.log(`All structured behavioral checks passed (${passed}/${total}).`);
      process.exit(0);
    }

    console.log('');
    console.log('Failures:');
    for (const failure of failures) {
      console.log(`- [${failure.suite}] ${failure.id}: ${failure.message}`);
    }
    console.log('');
    console.log(`Structured behavioral checks failed (${passed}/${total}).`);
    process.exit(1);
  } catch (error) {
    console.error('Intent Delegation Eval configuration error');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function evaluateIntentBoundary(): EvalSuiteResult {
  const rows = readCsvRows('evals/intent-boundary.prompts.csv', [
    'id',
    'has_active_intent',
    'active_deliverable',
    'active_intent_type',
    'active_template_id',
    'expected_result_kind',
    'expected_continuation_mode',
    'expected_intent_type',
    'prompt',
  ]).map(parseIntentBoundaryRow);
  const failures: EvalFailure[] = [];

  for (const row of rows) {
    const result = createIntentPlan({
      instanceId: 'eval-instance',
      sessionId: 'eval-session',
      input: row.prompt,
      skills: EMPTY_SKILLS,
      activeIntent: row.activeIntent,
    });

    const actualResultKind = result.kind;
    const actualContinuationMode: BoundaryContinuationMode = result.kind === 'plan'
      ? result.plan.continuationMode
      : 'non_intent';

    if (actualResultKind !== row.expectedResultKind) {
      failures.push({
        suite: 'intent-boundary',
        id: row.id,
        message: `expected result kind ${row.expectedResultKind}, got ${actualResultKind}`,
      });
      continue;
    }

    if (actualContinuationMode !== row.expectedContinuationMode) {
      failures.push({
        suite: 'intent-boundary',
        id: row.id,
        message: `expected continuation mode ${row.expectedContinuationMode}, got ${actualContinuationMode}`,
      });
    }

    if (row.expectedIntentType && result.kind === 'plan' && result.plan.intentType !== row.expectedIntentType) {
      failures.push({
        suite: 'intent-boundary',
        id: row.id,
        message: `expected intent type ${row.expectedIntentType}, got ${result.plan.intentType}`,
      });
    }
  }

  return summarizeSuite('intent-boundary', rows.length, failures);
}

function evaluateIntentPlanning(): EvalSuiteResult {
  const rows = readCsvRows('evals/intent-planning.prompts.csv', [
    'id',
    'has_active_intent',
    'active_deliverable',
    'active_intent_type',
    'active_template_id',
    'prompt',
    'expected_template_id',
    'expected_step_roles',
  ]).map(parsePlanningRow);
  const failures: EvalFailure[] = [];

  for (const row of rows) {
    const result = createIntentPlan({
      instanceId: 'eval-instance',
      sessionId: 'eval-session',
      input: row.prompt,
      skills: EMPTY_SKILLS,
      activeIntent: row.activeIntent,
    });

    if (result.kind !== 'plan') {
      failures.push({
        suite: 'intent-planning',
        id: row.id,
        message: `expected planner result, got ${result.kind}`,
      });
      continue;
    }

    if (result.plan.templateId !== row.expectedTemplateId) {
      failures.push({
        suite: 'intent-planning',
        id: row.id,
        message: `expected template ${row.expectedTemplateId}, got ${result.plan.templateId}`,
      });
    }

    const actualRoles = result.plan.steps.map((step) => step.role);
    if (actualRoles.join('|') !== row.expectedStepRoles.join('|')) {
      failures.push({
        suite: 'intent-planning',
        id: row.id,
        message: `expected ordered step roles ${row.expectedStepRoles.join('|')}, got ${actualRoles.join('|')}`,
      });
    }
  }

  return summarizeSuite('intent-planning', rows.length, failures);
}

function evaluateDispatch(): EvalSuiteResult {
  const scenarios = readJsonLines<DispatchScenario>('evals/dispatch-scenarios.jsonl').map(parseDispatchScenario);
  const failures: EvalFailure[] = [];

  for (const scenario of scenarios) {
    try {
      runDispatchScenario(scenario);
    } catch (error) {
      failures.push({
        suite: 'dispatch',
        id: scenario.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summarizeSuite('dispatch', scenarios.length, failures);
}

function evaluateSurface(): EvalSuiteResult {
  const fixture = parseSurfaceFixture(readJson<SurfaceFixture>('evals/orchestration-surface.cases.json'));
  const failures: EvalFailure[] = [];

  for (const entry of fixture.cases) {
    const output = renderSurfaceCase(entry);

    if (typeof entry.expectedExact === 'string' && output !== entry.expectedExact) {
      failures.push({
        suite: 'surface',
        id: entry.id,
        message: `expected exact output ${JSON.stringify(entry.expectedExact)}, got ${JSON.stringify(output)}`,
      });
      continue;
    }

    for (const expected of entry.expectedSubstrings ?? []) {
      if (!output.includes(expected)) {
        failures.push({
          suite: 'surface',
          id: entry.id,
          message: `missing expected surface output ${JSON.stringify(expected)}`,
        });
      }
    }
  }

  return summarizeSuite('surface', fixture.cases.length, failures);
}

function runDispatchScenario(scenario: DispatchScenario): void {
  const plan = createScenarioPlan(scenario);

  switch (scenario.check) {
    case 'single_active_step': {
      const intent = createIntentLedgerRecord(plan, 100);
      const firstStep = intent.steps[0];
      const secondStep = intent.steps[1];
      if (!firstStep || !secondStep) {
        throw new Error('scenario requires at least two steps');
      }

      const running = activateIntentStep(intent, firstStep.stepId, 101);
      const runningCount = running.steps.filter((step) => step.status === 'running').length;
      if (runningCount !== 1) {
        throw new Error(`expected exactly one running step, got ${runningCount}`);
      }

      const threw = expectThrows(
        () => activateIntentStep(running, secondStep.stepId, 102),
        /activeStepId/i,
      );
      if (!threw) {
        throw new Error('expected second activation to be rejected while another step is running');
      }
      return;
    }
    case 'out_of_order_rejection': {
      const intent = createIntentLedgerRecord(plan, 100);
      const secondStep = intent.steps[1];
      if (!secondStep) {
        throw new Error('scenario requires at least two steps');
      }

      const threw = expectThrows(
        () => activateIntentStep(intent, secondStep.stepId, 101),
        /out of order/i,
      );
      if (!threw) {
        throw new Error('expected out-of-order activation to be rejected');
      }
      return;
    }
    case 'high_risk_confirmation': {
      const ledger = appendIntentToLedger(
        createEmptySessionIntentLedger('eval-session', 100),
        plan,
        101,
      );
      const rejected = expectThrows(
        () => takeoverSessionOwnership(ledger, 'inst-b', { now: 103 }),
        /confirmation/i,
      );
      if (!rejected) {
        throw new Error('expected high-risk takeover to require explicit confirmation');
      }

      const confirmed = takeoverSessionOwnership(ledger, 'inst-b', {
        now: 104,
        confirmHighRisk: true,
      });
      if (confirmed.ownership.state !== 'takeover' || confirmed.ownership.ownerInstanceId !== 'inst-b') {
        throw new Error('expected confirmed takeover to succeed');
      }
    }
  }
}

function createScenarioPlan(scenario: DispatchScenario): IntentPlanDraft {
  const result = createIntentPlan({
    instanceId: 'eval-instance',
    sessionId: 'eval-session',
    input: scenario.prompt,
    skills: EMPTY_SKILLS,
  });
  if (result.kind !== 'plan') {
    throw new Error(`scenario prompt did not produce a plan: ${scenario.prompt}`);
  }

  const riskTier = scenario.riskTierOverride ?? result.plan.riskTier;
  const steps = result.plan.steps.map<PlannedStep>((step) => ({
    ...step,
    riskTier,
  }));
  const stages = result.plan.stages.map((stage) => ({
    ...stage,
    riskTier,
    steps: stage.steps.map((step) => ({
      ...step,
      riskTier,
    })),
  }));

  return {
    ...result.plan,
    riskTier,
    stages,
    steps,
  };
}

function renderSurfaceCase(entry: SurfaceCase): string {
  switch (entry.renderer) {
    case 'intent_created': {
      const ledger = createSurfaceLedger(entry);
      return formatIntentCreatedTranscriptBlock(ledger, ledger.activeIntentId ?? '');
    }
    case 'progress':
      return formatProgressTranscriptBlock({
        stepId: entry.stepId!,
        status: entry.stepStatus!,
        message: entry.message!,
      });
    case 'receipt':
      return formatReceiptTranscriptBlock(entry.note!);
    case 'salvage':
      return formatSalvageTranscriptBlock(entry.summary!, entry.reason);
    case 'summary_line': {
      const ledger = createSurfaceLedger(entry);
      return formatCurrentIntentSummaryLine(ledger, entry.instanceId!);
    }
    case 'reminder_block': {
      const ledger = createSurfaceLedger(entry);
      return buildIntentReminderBlock(ledger, entry.instanceId!)?.text ?? '';
    }
  }
}

function createSurfaceLedger(entry: SurfaceCase): SessionIntentLedger {
  const intent = createSurfaceIntent(entry.intent!);
  return {
    instanceId: 'eval-plan-customer-proposal',
    sessionId: 'eval-session',
    activeIntentId: intent.intentId,
    latestPlan: intent,
    intents: [intent],
    breadcrumbs: [],
    receipt: null,
    salvage: null,
    ownership: {
      state: 'owned',
      ownerInstanceId: entry.ownerInstanceId,
      previousOwnerInstanceId: undefined,
      updatedAt: 1700000000000,
    },
    updatedAt: 1700000000000,
  };
}

function createSurfaceIntent(seed: SurfaceIntentSeed): IntentLedgerRecord {
  const stageId = 'intent_customer_proposal:stage:1';
  const steps = [
    {
      stepId: `${stageId}:step:collect`,
      key: 'collect',
      order: 0,
      role: 'collect',
      skillName: null,
      dependsOn: [],
      status: seed.activeStepKey === 'collect' ? 'running' : 'completed',
      riskTier: seed.riskTier,
    },
    {
      stepId: `${stageId}:step:compose`,
      key: 'compose',
      order: 1,
      role: 'compose',
      skillName: null,
      dependsOn: [`${stageId}:step:collect`],
      status: seed.activeStepKey === 'compose' ? 'running' : 'planned',
      riskTier: seed.riskTier,
    },
  ] satisfies PlannedStep[];

  return {
    intentId: 'intent_customer_proposal',
    instanceId: 'eval-plan-customer-proposal',
    sessionId: 'eval-session',
    rawIntent: 'Write a customer proposal',
    normalizedIntent: 'write a customer proposal',
    intentType: seed.intentType,
    deliverable: seed.deliverable,
    finalDeliverable: seed.deliverable,
    explicitConstraints: [],
    delegationBoundary: [...seed.delegationBoundary],
    riskTier: seed.riskTier,
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    templateId: seed.templateId,
    stages: [{
      stageId,
      order: 0,
      label: `生成${seed.deliverable}`,
      intentType: seed.intentType,
      deliverable: seed.deliverable,
      templateId: seed.templateId,
      riskTier: seed.riskTier,
      dependsOnStageIds: [],
      steps,
      status: seed.overallStatus === 'completed' ? 'completed' : 'running',
      activeStepId: `${stageId}:step:${seed.activeStepKey}`,
      structuralValidation: 'pending',
      semanticValidation: 'pending',
      needsFreshContextHandoff: false,
    }],
    activeStageId: stageId,
    artifacts: [],
    steps,
    activeStepId: `${stageId}:step:${seed.activeStepKey}`,
    overallStatus: seed.overallStatus,
    attemptCount: 1,
    latestBreadcrumb: seed.latestBreadcrumb,
    latestReceipt: undefined,
    salvageSummary: undefined,
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
  };
}

function parseIntentBoundaryRow(row: CsvRecord, index: number): IntentBoundaryRow {
  const id = readRequiredString(row, 'id', 'intent-boundary', index);
  const hasActiveIntent = readBooleanCell(row, 'has_active_intent', 'intent-boundary', index);
  const activeIntent = readActiveIntent(row, 'intent-boundary', index, hasActiveIntent);
  const expectedResultKind = readEnumCell(row, 'expected_result_kind', ['plan', 'non_intent'], 'intent-boundary', index);
  const expectedContinuationMode = readEnumCell(
    row,
    'expected_continuation_mode',
    ['new_intent', 'continue_active', 'clarify', 'non_intent'],
    'intent-boundary',
    index,
  ) as BoundaryContinuationMode;
  const expectedIntentType = readEnumOrNone(row, 'expected_intent_type', INTENT_TYPES, 'intent-boundary', index);
  const prompt = readRequiredString(row, 'prompt', 'intent-boundary', index);

  if (expectedResultKind === 'non_intent' && expectedContinuationMode !== 'non_intent') {
    throw new Error(`[intent-boundary] row ${index + 1} (${id}) expected non_intent rows to use expected_continuation_mode=non_intent`);
  }
  if (expectedResultKind === 'plan' && expectedContinuationMode === 'non_intent') {
    throw new Error(`[intent-boundary] row ${index + 1} (${id}) plan rows cannot use expected_continuation_mode=non_intent`);
  }
  if (expectedResultKind === 'non_intent' && expectedIntentType !== null) {
    throw new Error(`[intent-boundary] row ${index + 1} (${id}) non_intent rows must use expected_intent_type=${NONE}`);
  }
  if (expectedResultKind === 'plan' && expectedContinuationMode === 'new_intent' && expectedIntentType === null) {
    throw new Error(`[intent-boundary] row ${index + 1} (${id}) new_intent rows must declare expected_intent_type`);
  }

  return {
    id,
    hasActiveIntent,
    activeIntent,
    expectedResultKind,
    expectedContinuationMode,
    expectedIntentType,
    prompt,
  };
}

function parsePlanningRow(row: CsvRecord, index: number): PlanningRow {
  const id = readRequiredString(row, 'id', 'intent-planning', index);
  const hasActiveIntent = readBooleanCell(row, 'has_active_intent', 'intent-planning', index);
  const activeIntent = readActiveIntent(row, 'intent-planning', index, hasActiveIntent);
  const prompt = readRequiredString(row, 'prompt', 'intent-planning', index);
  const expectedTemplateId = readRequiredString(row, 'expected_template_id', 'intent-planning', index);
  const expectedStepRoles = readRequiredString(row, 'expected_step_roles', 'intent-planning', index).split('|');
  if (expectedStepRoles.some((role) => role.trim() === '')) {
    throw new Error(`[intent-planning] row ${index + 1} (${id}) expected_step_roles must be a non-empty pipe-delimited list`);
  }

  return {
    id,
    hasActiveIntent,
    activeIntent,
    prompt,
    expectedTemplateId,
    expectedStepRoles,
  };
}

function parseDispatchScenario(input: DispatchScenario): DispatchScenario {
  if (!input || typeof input !== 'object') {
    throw new Error('[dispatch] invalid scenario entry');
  }
  if (typeof input.id !== 'string' || !input.id) {
    throw new Error('[dispatch] scenario missing id');
  }
  if (!['single_active_step', 'out_of_order_rejection', 'high_risk_confirmation'].includes(input.check)) {
    throw new Error(`[dispatch] scenario ${input.id} has invalid check ${String(input.check)}`);
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error(`[dispatch] scenario ${input.id} missing prompt`);
  }
  if (input.riskTierOverride && !RISK_TIERS.includes(input.riskTierOverride)) {
    throw new Error(`[dispatch] scenario ${input.id} has invalid riskTierOverride ${input.riskTierOverride}`);
  }
  return input;
}

function parseSurfaceFixture(input: SurfaceFixture): SurfaceFixture {
  if (!input || typeof input !== 'object' || !Array.isArray(input.cases)) {
    throw new Error('[surface] orchestration-surface.cases.json must contain a cases array');
  }

  return {
    cases: input.cases.map((entry, index) => parseSurfaceCase(entry, index)),
  };
}

function parseSurfaceCase(entry: SurfaceCase, index: number): SurfaceCase {
  const position = index + 1;
  if (!entry || typeof entry !== 'object') {
    throw new Error(`[surface] case ${position} must be an object`);
  }
  if (typeof entry.id !== 'string' || !entry.id) {
    throw new Error(`[surface] case ${position} missing id`);
  }
  if (!['intent_created', 'progress', 'receipt', 'salvage', 'summary_line', 'reminder_block'].includes(entry.renderer)) {
    throw new Error(`[surface] case ${entry.id} has invalid renderer ${String(entry.renderer)}`);
  }
  if (!Array.isArray(entry.expectedSubstrings) && typeof entry.expectedExact !== 'string') {
    throw new Error(`[surface] case ${entry.id} must declare expectedSubstrings or expectedExact`);
  }
  if (Array.isArray(entry.expectedSubstrings) && entry.expectedSubstrings.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`[surface] case ${entry.id} expectedSubstrings must contain only non-empty strings`);
  }
  if (Array.isArray(entry.expectedSubstrings) && entry.expectedSubstrings.length === 0 && typeof entry.expectedExact !== 'string') {
    throw new Error(`[surface] case ${entry.id} must include at least one explicit assertion`);
  }

  if (entry.renderer === 'intent_created' || entry.renderer === 'summary_line' || entry.renderer === 'reminder_block') {
    if (typeof entry.instanceId !== 'string' || !entry.instanceId) {
      throw new Error(`[surface] case ${entry.id} requires instanceId`);
    }
    if (typeof entry.ownerInstanceId !== 'string' || !entry.ownerInstanceId) {
      throw new Error(`[surface] case ${entry.id} requires ownerInstanceId`);
    }
    if (!entry.intent) {
      throw new Error(`[surface] case ${entry.id} requires intent`);
    }
    validateSurfaceIntentSeed(entry.id, entry.intent);
  }

  if (entry.renderer === 'progress') {
    if (typeof entry.stepId !== 'string' || !entry.stepId) {
      throw new Error(`[surface] case ${entry.id} requires stepId`);
    }
    if (!['running', 'blocked', 'completed', 'failed'].includes(entry.stepStatus ?? '')) {
      throw new Error(`[surface] case ${entry.id} requires valid stepStatus`);
    }
    if (typeof entry.message !== 'string' || !entry.message) {
      throw new Error(`[surface] case ${entry.id} requires message`);
    }
  }

  if (entry.renderer === 'receipt' && (typeof entry.note !== 'string' || !entry.note)) {
    throw new Error(`[surface] case ${entry.id} requires note`);
  }

  if (entry.renderer === 'salvage') {
    if (!Array.isArray(entry.summary) || entry.summary.length === 0 || entry.summary.some((item) => typeof item !== 'string' || !item)) {
      throw new Error(`[surface] case ${entry.id} requires a non-empty summary array`);
    }
  }

  return entry;
}

function validateSurfaceIntentSeed(id: string, seed: SurfaceIntentSeed): void {
  if (typeof seed.deliverable !== 'string' || !seed.deliverable) {
    throw new Error(`[surface] case ${id} intent.deliverable is required`);
  }
  if (!INTENT_TYPES.includes(seed.intentType)) {
    throw new Error(`[surface] case ${id} intent.intentType is invalid`);
  }
  if (!RISK_TIERS.includes(seed.riskTier)) {
    throw new Error(`[surface] case ${id} intent.riskTier is invalid`);
  }
  if (typeof seed.templateId !== 'string' || !seed.templateId) {
    throw new Error(`[surface] case ${id} intent.templateId is required`);
  }
  if (!Array.isArray(seed.delegationBoundary) || seed.delegationBoundary.some((item) => typeof item !== 'string')) {
    throw new Error(`[surface] case ${id} intent.delegationBoundary must be a string array`);
  }
  if (!['collect', 'compose'].includes(seed.activeStepKey)) {
    throw new Error(`[surface] case ${id} intent.activeStepKey must be collect or compose`);
  }
  if (!PLAN_STATUSES.includes(seed.overallStatus)) {
    throw new Error(`[surface] case ${id} intent.overallStatus is invalid`);
  }
  if (seed.latestBreadcrumb !== undefined && (typeof seed.latestBreadcrumb !== 'string' || !seed.latestBreadcrumb)) {
    throw new Error(`[surface] case ${id} intent.latestBreadcrumb must be a non-empty string when provided`);
  }
}

function readActiveIntent(
  row: CsvRecord,
  suite: string,
  index: number,
  hasActiveIntent: boolean,
): ActiveIntentContext | undefined {
  const deliverable = readRequiredString(row, 'active_deliverable', suite, index);
  const intentType = readRequiredString(row, 'active_intent_type', suite, index);
  const templateId = readRequiredString(row, 'active_template_id', suite, index);

  if (!hasActiveIntent) {
    if (deliverable !== NONE || intentType !== NONE || templateId !== NONE) {
      throw new Error(`[${suite}] row ${index + 1} inactive rows must use ${NONE} for active intent columns`);
    }
    return undefined;
  }

  if (deliverable === NONE || templateId === NONE) {
    throw new Error(`[${suite}] row ${index + 1} active rows must declare active_deliverable and active_template_id`);
  }
  if (!INTENT_TYPES.includes(intentType as IntentType)) {
    throw new Error(`[${suite}] row ${index + 1} active_intent_type must be one of ${INTENT_TYPES.join(', ')}`);
  }

  return {
    intentId: DEFAULT_ACTIVE_INTENT.intentId,
    deliverable,
    intentType: intentType as IntentType,
    templateId,
  };
}

function readCsvRows(relativePath: string, requiredHeaders: string[]): CsvRecord[] {
  const text = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
  const rows = parseCsv(text);
  const [headers, ...records] = rows;
  if (!headers) {
    throw new Error(`[eval-config] ${relativePath} is empty`);
  }

  for (const header of requiredHeaders) {
    if (!headers.includes(header)) {
      throw new Error(`[eval-config] ${relativePath} is missing required column ${header}`);
    }
  }

  return records.map((record, index) => {
    if (record.length !== headers.length) {
      throw new Error(
        `[eval-config] ${relativePath} row ${index + 2} has ${record.length} cells; expected ${headers.length}`,
      );
    }
    const row: CsvRecord = {};
    for (const header of headers) {
      const columnIndex = headers.indexOf(header);
      const value = record[columnIndex];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`[eval-config] ${relativePath} row ${index + 2} has blank value for ${header}`);
      }
      row[header] = value.trim();
    }
    return row;
  });
}

function readRequiredString(row: CsvRecord, key: string, suite: string, index: number): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[${suite}] row ${index + 1} missing ${key}`);
  }
  return value.trim();
}

function readBooleanCell(row: CsvRecord, key: string, suite: string, index: number): boolean {
  const value = readRequiredString(row, key, suite, index);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`[${suite}] row ${index + 1} ${key} must be true or false`);
  }
  return value === 'true';
}

function readEnumCell<T extends string>(
  row: CsvRecord,
  key: string,
  allowed: readonly T[],
  suite: string,
  index: number,
): T {
  const value = readRequiredString(row, key, suite, index);
  if (!allowed.includes(value as T)) {
    throw new Error(`[${suite}] row ${index + 1} ${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function readEnumOrNone<T extends string>(
  row: CsvRecord,
  key: string,
  allowed: readonly T[],
  suite: string,
  index: number,
): T | null {
  const value = readRequiredString(row, key, suite, index);
  if (value === NONE) {
    return null;
  }
  if (!allowed.includes(value as T)) {
    throw new Error(`[${suite}] row ${index + 1} ${key} must be ${NONE} or one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function summarizeSuite(suite: string, total: number, failures: EvalFailure[]): EvalSuiteResult {
  return {
    suite,
    total,
    passed: total - failures.length,
    failures,
  };
}

function expectThrows(fn: () => void, pattern: RegExp): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test(error instanceof Error ? error.message : String(error));
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && next === '\n') {
        index += 1;
      }
      currentRow.push(currentField);
      if (!(currentRow.length === 1 && currentRow[0] === '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += character;
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (!(currentRow.length === 1 && currentRow[0] === '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')) as T;
}

function readJsonLines<T>(relativePath: string): T[] {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`[eval-config] ${relativePath} line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

void main();
