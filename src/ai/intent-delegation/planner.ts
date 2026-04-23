import { DELEGATION_TEMPLATES } from './templates.js';
import { matchSkillsForTask } from './matcher.js';
import {
  extractProvidedSourcePaths,
  stripProvidedSourcePaths,
} from './path-contract.js';
import type {
  IntentMode,
  IntentPlanDraft,
  IntentStageDraft,
  IntentType,
  PlannedStep,
  RiskTier,
  SegmentationConfidence,
  StepRole,
} from './types.js';
import type { SkillMeta } from '../skills/loader.js';

export interface ActiveIntentContext {
  intentId: string;
  deliverable: string;
  intentType: IntentType;
  templateId: string;
}

export interface CreateIntentPlanInput {
  instanceId: string;
  sessionId: string;
  input: string;
  skills: SkillMeta[];
  activeIntent?: ActiveIntentContext;
  skillScoreLookup?: (input: {
    skillName: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverable: string;
  }) => number;
}

export type IntentPlannerResult =
  | {
      kind: 'plan';
      plan: IntentPlanDraft;
    }
  | {
      kind: 'non_intent';
      reason: 'control_command' | 'non_substantial';
    };

interface StageIntentSpec {
  rawSegment: string;
  deliverable: string;
  intentType: IntentType;
  stageLabel: string;
}

const CONTINUATION_PATTERNS = [
  /^(继续|继续做|继续写|继续生成)/u,
  /再改一版/u,
  /基于(刚才|上一个|上一版|刚才那个)/u,
  /按(刚才|上一个|上一版)(那版)?/u,
  /重新生成同一件事/u,
];

const CONTROL_COMMAND_PATTERN = /^\s*[/!][\w-]+/u;
const ACKNOWLEDGEMENT_PATTERNS = [
  /^(好的|好|收到|明白了|明白|了解了|了解|ok|okay)\s*$/iu,
];
const SUPPLEMENT_PATTERNS = [
  /^(补充|补一下|补一个|再补充)/u,
  /^这里还有/u,
  /^答案是/u,
  /^(是|不是|可以|不可以|用中文|用英文)/u,
  /^(目标用户|受众|行业|风格|限制|要求)[是为:：]/u,
];

const GENERATE_HINTS = ['写', '生成', '做', '整理', '产出', '起草', '方案', '提纲', '文案', '稿'];
const REVISE_HINTS = ['改', '修改', '重写', '润色', '适配', '调整', '优化', '更新', '升级'];
const SUMMARIZE_HINTS = ['总结', '提炼', '归纳', '摘要', '概述'];
const ANALYZE_HINTS = ['分析', '比较', '判断', '测算', '评估', '对比', '哪个更', '报价'];
const WORK_REQUEST_PATTERNS = [
  /(帮我|请|麻烦|给我).*(生成|写|做|整理|总结|分析|修改|重写|润色|升级|更新|导出|转换|提取)/u,
  /把.+(生成|写成|做成|整理成|总结成|改成|转换成|导出成)/u,
  /^(生成|写|做|整理|总结|分析|修改|重写|润色|升级|更新|导出|转换|提取)(?!到?什么|成什么|为?什么|什么|哪(个|一)?|多少|几|怎么|如何)/u,
];
const INFORMATIONAL_QUERY_PATTERNS = [
  /[?？]/u,
  /(什么|几|多少|哪(个|一)?|怎么|如何|是否|有没有|是不是)/u,
  /吗$/u,
  /\b(what|which|how|when|where|current)\b/iu,
];

export function createIntentPlan(input: CreateIntentPlanInput): IntentPlannerResult {
  const rawIntent = input.input.trim();
  if (isControlCommand(rawIntent)) {
    return { kind: 'non_intent', reason: 'control_command' };
  }
  if (isAcknowledgement(rawIntent)) {
    return { kind: 'non_intent', reason: 'non_substantial' };
  }
  if (isLikelyInformationalQuery(rawIntent)) {
    return { kind: 'non_intent', reason: 'non_substantial' };
  }

  const normalizedIntent = normalizeIntent(rawIntent);
  const providedSourcePaths = extractProvidedSourcePaths(rawIntent);
  const allowActiveShortReply = Boolean(
    input.activeIntent && (isSupplementOrClarification(rawIntent) || hasContinuationCue(rawIntent)),
  );
  if (!normalizedIntent || (!allowActiveShortReply && isNonSubstantial(normalizedIntent, input.activeIntent))) {
    return { kind: 'non_intent', reason: 'non_substantial' };
  }

  const extracted = extractIntentShape(rawIntent, providedSourcePaths, input.activeIntent);
  const continuationMode = detectContinuationMode(rawIntent, extracted.finalDeliverable, input.activeIntent);
  const topLevelIntentType = resolveTopLevelIntentType(rawIntent, extracted.stageSpecs, input.activeIntent, continuationMode);
  const topLevelTemplate = DELEGATION_TEMPLATES.find((candidate) => candidate.intentType === topLevelIntentType);
  if (!topLevelTemplate) {
    return { kind: 'non_intent', reason: 'non_substantial' };
  }

  const intentId = buildStableId('intent', normalizedIntent, input.sessionId);
  const instancePlanId = buildStableId('plan', normalizedIntent, input.instanceId);
  const riskTier = deriveRiskTier(topLevelIntentType, continuationMode, extracted.intentMode);
  const stages = buildStages({
    intentId,
    rawIntent,
    stageSpecs: extracted.stageSpecs,
    skills: input.skills,
    fallbackRiskTier: riskTier,
    skillScoreLookup: input.skillScoreLookup,
  });
  const activeStage = stages[0];

  return {
    kind: 'plan',
    plan: {
      instanceId: instancePlanId,
      intentId,
      sessionId: input.sessionId,
      rawIntent,
      normalizedIntent,
      providedSourcePaths,
      intentType: topLevelIntentType,
      deliverable: extracted.deliverable,
      finalDeliverable: extracted.finalDeliverable,
      explicitConstraints: extracted.constraints,
      delegationBoundary: extracted.boundary,
      riskTier,
      intentMode: extracted.intentMode,
      segmentationConfidence: extracted.segmentationConfidence,
      templateId: topLevelTemplate.id,
      stages,
      steps: activeStage?.steps.map(cloneStep) ?? [],
      continuationMode,
    },
  };
}

function isControlCommand(input: string): boolean {
  return CONTROL_COMMAND_PATTERN.test(input);
}

function isAcknowledgement(input: string): boolean {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[，。！？,.!?]/gu, '')
    .replace(/\s+/g, ' ');

  return ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLikelyInformationalQuery(input: string): boolean {
  const normalized = input.trim();
  const hasQuestionCue = INFORMATIONAL_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasQuestionCue) {
    return false;
  }

  const hasWorkRequestCue = WORK_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasWorkRequestCue) {
    return false;
  }

  return normalized.length <= 40;
}

function normalizeIntent(input: string): string {
  return input
    .toLowerCase()
    .replace(/[，。！？,.!?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonSubstantial(input: string, activeIntent?: ActiveIntentContext): boolean {
  if (input.length <= 2) {
    return true;
  }

  if (!activeIntent && /^\d+(?:\s*[*xX+\-/]\s*\d+)+$/u.test(input)) {
    return true;
  }

  return false;
}

function hasContinuationCue(input: string): boolean {
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(input));
}

function isSupplementOrClarification(input: string): boolean {
  return SUPPLEMENT_PATTERNS.some((pattern) => pattern.test(input));
}

function detectContinuationMode(
  rawIntent: string,
  finalDeliverable: string,
  activeIntent?: ActiveIntentContext,
): IntentPlanDraft['continuationMode'] {
  if (!activeIntent) {
    return 'new_intent';
  }

  const continuationCue = hasContinuationCue(rawIntent);
  if (continuationCue) {
    const nextFamily = inferDeliverableFamily(finalDeliverable || rawIntent);
    const activeFamily = inferDeliverableFamily(activeIntent.deliverable);
    if (nextFamily !== 'unknown' && activeFamily !== 'unknown' && nextFamily !== activeFamily) {
      return 'clarify';
    }
    return 'continue_active';
  }

  if (isSupplementOrClarification(rawIntent)) {
    return 'continue_active';
  }

  return 'new_intent';
}

function resolveTopLevelIntentType(
  rawIntent: string,
  stageSpecs: StageIntentSpec[],
  activeIntent: ActiveIntentContext | undefined,
  continuationMode: IntentPlanDraft['continuationMode'],
): IntentType {
  if (continuationMode === 'continue_active' && isSupplementOrClarification(rawIntent) && activeIntent) {
    return activeIntent.intentType;
  }
  if (continuationMode === 'continue_active' && hasContinuationCue(rawIntent)) {
    return 'revise';
  }
  return stageSpecs[stageSpecs.length - 1]?.intentType ?? classifyByRules(rawIntent);
}

function classifyByRules(rawIntent: string): IntentType {
  if (containsAny(rawIntent, ANALYZE_HINTS)) return 'analyze';
  if (containsAny(rawIntent, SUMMARIZE_HINTS)) return 'summarize';
  if (containsAny(rawIntent, REVISE_HINTS)) return 'revise';
  if (containsAny(rawIntent, GENERATE_HINTS)) return 'generate';
  return 'generate';
}

function containsAny(input: string, hints: string[]): boolean {
  return hints.some((hint) => input.includes(hint));
}

function extractIntentShape(
  rawIntent: string,
  providedSourcePaths: string[],
  activeIntent?: ActiveIntentContext,
): {
  deliverable: string;
  finalDeliverable: string;
  constraints: string[];
  boundary: string[];
  intentMode: IntentMode;
  segmentationConfidence: SegmentationConfidence;
  stageSpecs: StageIntentSpec[];
} {
  const constraints = extractConstraints(rawIntent);
  const boundary = extractBoundary(rawIntent);
  const pathStrippedIntent = stripProvidedSourcePaths(rawIntent, providedSourcePaths);
  const sequencedSpecs = extractSequencedStageSpecs(pathStrippedIntent);

  if (sequencedSpecs.length > 1) {
    return {
      deliverable: sequencedSpecs.map((stage) => stage.deliverable).join(' -> '),
      finalDeliverable: sequencedSpecs[sequencedSpecs.length - 1]!.deliverable,
      constraints,
      boundary,
      intentMode: 'multi_stage',
      segmentationConfidence: deriveSegmentationConfidence(pathStrippedIntent, sequencedSpecs),
      stageSpecs: sequencedSpecs,
    };
  }

  const singleDeliverable = extractSingleDeliverable(pathStrippedIntent) || activeIntent?.deliverable || '交付物';
  const singleIntentType = classifyByRules(pathStrippedIntent);
  return {
    deliverable: singleDeliverable,
    finalDeliverable: singleDeliverable,
    constraints,
    boundary,
    intentMode: 'single_stage',
    segmentationConfidence: 'low',
    stageSpecs: [
      {
        rawSegment: pathStrippedIntent,
        deliverable: singleDeliverable,
        intentType: singleIntentType,
        stageLabel: buildStageLabel(singleIntentType, singleDeliverable),
      },
    ],
  };
}

function extractConstraints(rawIntent: string): string[] {
  const patterns = [
    /(控制在[^，。！？,!.?]+)/u,
    /(限制在[^，。！？,!.?]+)/u,
    /(不要[^，。！？,!.?]+)/u,
    /(只要[^，。！？,!.?]+)/u,
    /(用中文|用英文)/u,
  ];

  const constraints: string[] = [];
  for (const pattern of patterns) {
    const matched = rawIntent.match(pattern)?.[1];
    if (matched) {
      constraints.push(matched.trim());
    }
  }

  return unique(constraints);
}

function extractBoundary(rawIntent: string): string[] {
  const patterns = [/(只需要[^，。！？,!.?]+)/u, /(先[^，。！？,!.?]+)/u];
  const boundary: string[] = [];

  for (const pattern of patterns) {
    const matched = rawIntent.match(pattern)?.[1];
    if (matched) {
      boundary.push(matched.trim());
    }
  }

  return unique(boundary);
}

function extractSingleDeliverable(rawIntent: string): string {
  const directPatterns = [
    /生成(?:一版|一个|一份)?([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /写(?:一版|一个|一份)?([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /做(?:一版|一个|一份)?([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /整理成(?:一版|一个|一份)?([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /总结成([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /做一个([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
    /分析一下([^，。！？,!.?]+?)(?:，|。|！|？|$)/u,
  ];

  for (const pattern of directPatterns) {
    const matched = pattern.exec(rawIntent)?.[1]?.trim();
    if (matched) {
      return cleanupDeliverable(matched);
    }
  }

  if (rawIntent.includes('报价测算')) return '报价测算';
  if (rawIntent.includes('关键结论')) return '关键结论';
  if (rawIntent.includes('产品方案')) return '产品方案';

  return '';
}

function extractSequencedStageSpecs(rawIntent: string): StageIntentSpec[] {
  const stageVerbPattern = [
    '生成',
    '写',
    '做',
    '整理成',
    '总结成',
    '做一个',
    '分析一下',
    '总结',
    '提炼',
    '归纳',
    '分析',
    '比较',
  ].join('|');

  const matches = Array.from(
    rawIntent.matchAll(
      new RegExp(
        `(?:先|然后|再|并且|并|接着|之后)?\\s*(${stageVerbPattern})(?:一版|一个|一份)?([^，。！？,!.?；;]+?)(?=(?:然后|再|并且|并|接着|之后)\\s*(?:${stageVerbPattern})|[，。！？,!.?；;]|$)`,
        'gu',
      ),
    ),
  );

  const specs = matches
    .map((match) => {
      const verb = (match[1] ?? '').trim();
      const deliverable = cleanupDeliverable(match[2] ?? '');
      if (!deliverable) {
        return null;
      }

      const rawSegment = `${verb}${deliverable}`;
      const intentType = classifyByRules(rawSegment);
      return {
        rawSegment,
        deliverable,
        intentType,
        stageLabel: buildStageLabel(intentType, deliverable),
      } satisfies StageIntentSpec;
    })
    .filter((value): value is StageIntentSpec => Boolean(value));

  return uniqueBy(specs, (spec) => `${spec.intentType}:${spec.deliverable}`);
}

function cleanupDeliverable(value: string): string {
  return value
    .replace(/\s+(?:\/|[a-zA-Z]:[\\/])\S+$/u, '')
    .replace(/^(把这篇文档|把这个文档|把这篇|把这个|给我把这篇文档|给我把这个文档|给我把这篇|给我把这个)/u, '')
    .replace(/^(这份|这个|一版|一份|一个)/u, '')
    .replace(/^[一二三四五六七八九十0-9]+(条|版|份|个)/u, '')
    .replace(/(，.*)$/u, '')
    .replace(/吗$/u, '')
    .trim();
}

function buildStageLabel(intentType: IntentType, deliverable: string): string {
  if (/^(md|markdown)$/iu.test(deliverable)) {
    return '提取 Markdown';
  }
  if (intentType === 'summarize') {
    return `提炼${deliverable}`;
  }
  if (intentType === 'analyze') {
    return `分析${deliverable}`;
  }
  if (intentType === 'revise') {
    return `修订${deliverable}`;
  }
  return `生成${deliverable}`;
}

function deriveSegmentationConfidence(
  rawIntent: string,
  stageSpecs: StageIntentSpec[],
): SegmentationConfidence {
  if (stageSpecs.length <= 1) {
    return 'low';
  }
  if (/(然后|再|接着|之后|并且|并)/u.test(rawIntent)) {
    return 'high';
  }
  return 'medium';
}

function inferDeliverableFamily(value: string): string {
  if (!value) return 'unknown';
  if (/(md|markdown)/iu.test(value)) return 'markdown';
  if (/(ppt|幻灯片|deck|slides)/iu.test(value)) return 'slides';
  if (/(总结|摘要|纪要|结论)/u.test(value)) return 'summary';
  if (/(测算|分析|判断|评估|报价)/u.test(value)) return 'analysis';
  if (/(表格|清单|表|csv|sheet)/iu.test(value)) return 'table';
  if (/(方案|报告|提纲|文案|稿|说明|proposal|report|brief)/iu.test(value)) return 'document';
  return 'unknown';
}

function deriveRiskTier(
  intentType: IntentType,
  continuationMode: IntentPlanDraft['continuationMode'],
  intentMode: IntentMode,
): RiskTier {
  if (continuationMode === 'clarify') return 'medium';
  if (intentType === 'analyze') return 'medium';
  if (intentMode === 'multi_stage') return 'medium';
  return 'low';
}

function buildStages(input: {
  intentId: string;
  rawIntent: string;
  stageSpecs: StageIntentSpec[];
  skills: SkillMeta[];
  fallbackRiskTier: RiskTier;
  skillScoreLookup?: CreateIntentPlanInput['skillScoreLookup'];
}): IntentStageDraft[] {
  return input.stageSpecs.map((spec, index) => {
    const template = DELEGATION_TEMPLATES.find((candidate) => candidate.intentType === spec.intentType)
      ?? DELEGATION_TEMPLATES.find((candidate) => candidate.intentType === 'generate');
    if (!template) {
      throw new Error(`missing template for stage intent type: ${spec.intentType}`);
    }

    const stageId = `${input.intentId}:stage:${index + 1}`;
    const stageRiskTier = spec.intentType === 'analyze' ? 'medium' : input.fallbackRiskTier;
    const steps = template.steps.map<PlannedStep>((step, stepIndex) => {
      const stepId = `${stageId}:step:${step.key}`;
      return {
        stepId,
        key: step.key,
        order: stepIndex,
        role: step.role,
        skillName: chooseSkillName(
          step.role,
          step.fallbackRoles ?? [],
          spec.intentType,
          spec.deliverable,
          spec.rawSegment || input.rawIntent,
          input.skills,
          input.skillScoreLookup,
        ),
        dependsOn: stepIndex === 0 ? [] : [`${stageId}:step:${template.steps[stepIndex - 1]!.key}`],
        status: 'planned',
        riskTier: step.defaultRiskTier ?? stageRiskTier,
      };
    });

    return {
      stageId,
      order: index,
      label: spec.stageLabel,
      intentType: spec.intentType,
      deliverable: spec.deliverable,
      templateId: template.id,
      riskTier: stageRiskTier,
      dependsOnStageIds: index === 0 ? [] : [`${input.intentId}:stage:${index}`],
      steps,
    };
  });
}

function chooseSkillName(
  role: StepRole,
  fallbackRoles: StepRole[],
  intentType: IntentType,
  deliverable: string,
  rawIntent: string,
  skills: SkillMeta[],
  skillScoreLookup?: CreateIntentPlanInput['skillScoreLookup'],
): string {
  const rolesToTry = [role, ...fallbackRoles];
  for (const candidateRole of rolesToTry) {
    const matchedSkill = pickBestSkill(candidateRole, intentType, deliverable, rawIntent, skills, skillScoreLookup);
    if (matchedSkill) {
      return matchedSkill;
    }
  }
  return `generic_llm::${role}`;
}

function pickBestSkill(
  role: StepRole,
  intentType: IntentType,
  deliverable: string,
  rawIntent: string,
  skills: SkillMeta[],
  skillScoreLookup?: CreateIntentPlanInput['skillScoreLookup'],
): string | null {
  const query = [roleQuery(role), intentType, deliverable, rawIntent].join(' ');
  const matches = matchSkillsForTask(query, skills, 10);

  let bestName: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const baseScore = scoreRoleMatch(match.skill, role, intentType, deliverable);
    const rerankBoost = skillScoreLookup?.({
      skillName: match.skill.name,
      intentType,
      stageRole: role,
      deliverable,
    }) ?? 0;
    const totalScore = baseScore + rerankBoost;
    if (totalScore >= 6 && totalScore > bestScore) {
      bestScore = totalScore;
      bestName = match.skill.name;
    }
  }
  return bestName;
}

function roleQuery(role: StepRole): string {
  switch (role) {
    case 'collect':
      return 'collect materials gather requirements';
    case 'inspect_current':
      return 'inspect current existing version';
    case 'normalize':
      return 'normalize materials structured brief';
    case 'identify_delta':
      return 'identify requested changes delta';
    case 'extract':
      return 'extract key points summarize';
    case 'compare':
      return 'compare evidence analyze options';
    case 'compose':
      return 'compose draft deliverable';
    case 'rewrite':
      return 'rewrite revise content';
    case 'structure':
      return 'structure summary';
    case 'conclude':
      return 'draw conclusion recommendation';
    case 'validate':
      return 'validate review output';
    case 'finalize':
      return 'finalize summary output';
  }
}

function scoreRoleMatch(
  skill: Pick<SkillMeta, 'description' | 'whenToUse' | 'taskHints'>,
  role: StepRole,
  intentType: IntentType,
  deliverable: string,
): number {
  const roleTokens = new Set(tokenize(`${roleQuery(role)} ${intentType}`));
  const descriptionTokens = new Set(tokenize(`${skill.description} ${skill.whenToUse ?? ''}`));
  const taskGoalTokens = new Set(tokenize(skill.taskHints.taskGoals.join(' ')));
  const ioTokens = new Set(
    tokenize(`${skill.taskHints.inputKinds.join(' ')} ${skill.taskHints.outputKinds.join(' ')}`),
  );
  const deliverableTokens = new Set(tokenize(deliverable));
  const intentTokens = new Set(tokenize(intentType === 'generate' ? 'create generate write compose' : intentType));
  const hasStructuredHints = (
    skill.taskHints.taskGoals.length
    + skill.taskHints.inputKinds.length
    + skill.taskHints.outputKinds.length
  ) > 0;
  const hasDeliverableEvidence = intersects(deliverableTokens, ioTokens) || intersects(deliverableTokens, descriptionTokens);

  let score = 0;
  if (intersects(roleTokens, taskGoalTokens)) score += 5;
  if (intersects(new Set([intentType]), taskGoalTokens) || intersects(new Set([intentType]), descriptionTokens)) {
    score += 3;
  }
  if (intersects(deliverableTokens, ioTokens)) score += 4;
  if (intersects(deliverableTokens, descriptionTokens)) score += 4;
  if (intersects(intentTokens, descriptionTokens) || intersects(intentTokens, taskGoalTokens)) score += 2;
  if (intersects(roleTokens, ioTokens)) score += 2;
  if (intersects(roleTokens, descriptionTokens)) score += 1;
  if (!hasStructuredHints && !hasDeliverableEvidence) {
    return Math.min(score, 5);
  }
  return score;
}

function tokenize(value: string): string[] {
  return Array.from(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const item of left) {
    if (right.has(item)) return true;
  }
  return false;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = getKey(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function cloneStep(step: PlannedStep): PlannedStep {
  return {
    ...step,
    dependsOn: [...step.dependsOn],
  };
}

function buildStableId(prefix: string, seed: string, suffix: string): string {
  const normalized = seed.replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-').replace(/^-+|-+$/g, '');
  const compact = normalized.slice(0, 24) || 'draft';
  const tail = suffix.replace(/[^a-z0-9]+/giu, '').slice(-8) || 'seed';
  return `${prefix}-${compact}-${tail}`;
}
