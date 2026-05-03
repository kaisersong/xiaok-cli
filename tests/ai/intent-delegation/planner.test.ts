import { describe, it, expect } from 'vitest';
import type { SkillMeta } from '../../../src/ai/skills/loader.js';
import {
  createIntentPlan,
  type IntentPlannerResult,
} from '../../../src/ai/intent-delegation/planner.js';

function makeSkill(
  name: string,
  description: string,
  taskGoals: string[],
  inputKinds: string[],
  outputKinds: string[],
): SkillMeta {
  return {
    name,
    description,
    content: `# ${name}`,
    path: `/virtual/${name}.md`,
    source: 'project',
    tier: 'project',
    allowedTools: [],
    executionContext: 'inline',
    dependsOn: [],
    userInvocable: true,
    taskHints: {
      taskGoals,
      inputKinds,
      outputKinds,
      examples: [],
    },
  };
}

function expectPlan(result: IntentPlannerResult) {
  expect(result.kind).toBe('plan');
  return result.kind === 'plan' ? result.plan : null;
}

describe('intent delegation planner', () => {
  const skills: SkillMeta[] = [
    makeSkill(
      'collect-brief',
      'Collect source materials and requirements for a report or proposal',
      ['collect materials', 'gather requirements'],
      ['source materials', 'requirements'],
      ['normalized brief'],
    ),
    makeSkill(
      'normalize-brief',
      'Normalize raw notes into a structured brief',
      ['normalize materials', 'clean raw notes'],
      ['raw notes', 'materials'],
      ['structured brief'],
    ),
    makeSkill(
      'compose-report',
      'Compose a report, proposal, or draft document',
      ['compose deliverable', 'draft report'],
      ['brief', 'outline'],
      ['report', 'proposal'],
    ),
    makeSkill(
      'validate-copy',
      'Validate written output for quality and correctness',
      ['validate result', 'review output'],
      ['draft'],
      ['validated draft'],
    ),
    makeSkill(
      'rewrite-slides',
      'Revise an existing deck or slide content',
      ['rewrite content', 'revise deck'],
      ['existing deck', 'slide draft'],
      ['revised deck'],
    ),
    makeSkill(
      'extract-summary',
      'Extract key points from long materials',
      ['extract key points', 'summarize materials'],
      ['materials', 'long text'],
      ['key points'],
    ),
    makeSkill(
      'structure-summary',
      'Structure a concise summary from extracted points',
      ['structure summary', 'finalize summary'],
      ['key points'],
      ['summary'],
    ),
    makeSkill(
      'compare-evidence',
      'Compare options and evidence to support a decision',
      ['compare evidence', 'analyze tradeoffs'],
      ['options', 'evidence'],
      ['analysis'],
    ),
    makeSkill(
      'conclude-analysis',
      'Conclude an analysis with a recommendation',
      ['draw conclusion', 'recommend option'],
      ['analysis'],
      ['recommendation'],
    ),
  ];

  it('creates a new_intent generate plan with the generate template and ordered roles', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '帮我根据这些访谈笔记写一版产品方案，控制在一页内',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '产品方案',
      explicitConstraints: ['控制在一页内'],
    });
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'collect',
      'normalize',
      'compose',
      'validate',
    ]);
    expect(plan?.steps.map((step) => step.order)).toEqual([0, 1, 2, 3]);
    expect(plan?.steps[0]).toMatchObject({
      role: 'collect',
      dependsOn: [],
    });
    expect(plan?.steps[1]).toMatchObject({
      role: 'normalize',
      dependsOn: [plan?.steps[0]?.stepId],
    });
    expect(plan?.steps[2]).toMatchObject({
      role: 'compose',
      dependsOn: [plan?.steps[1]?.stepId],
    });
    expect(plan?.steps[3]).toMatchObject({
      role: 'validate',
      dependsOn: [plan?.steps[2]?.stepId],
    });
    expect(plan?.steps[0]?.skillName).not.toBe('generic_llm::collect');
    expect(plan?.steps[1]?.skillName).not.toBe('generic_llm::normalize');
    expect(plan?.steps[2]?.skillName).not.toBe('generic_llm::compose');
  });

  it('extracts a generated slide deliverable even when the prompt ends with a source path', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '把这篇文档生成幻灯片 /Users/song/Downloads/x-article-intent-ux.pdf',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '幻灯片',
      providedSourcePaths: ['/Users/song/Downloads/x-article-intent-ux.pdf'],
    });
  });

  it('captures chained generate deliverables instead of collapsing to the first one', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '把这篇文档生成md，然后生成报告 /Users/song/Downloads/x-article-intent-ux.pdf',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: 'md -> 报告',
      providedSourcePaths: ['/Users/song/Downloads/x-article-intent-ux.pdf'],
    });
  });

  it('plans a work request that starts with an absolute local path instead of treating it as a slash command', () => {
    const sourcePath = '/Users/song/Downloads/金蝶灵基_for_CEO_V2.0_Plan与TODO_5月10日版.md';
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: `${sourcePath} 生成报告，然后生成幻灯片`,
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '报告 -> 幻灯片',
      finalDeliverable: '幻灯片',
      providedSourcePaths: [sourcePath],
      intentMode: 'multi_stage',
    });
    expect(plan?.stages.map((stage) => stage.label)).toEqual([
      '生成报告',
      '生成幻灯片',
    ]);
  });

  it('builds a multi-stage plan for a multi-file Chinese prompt with path-prefixed sources', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '根据这几个文档，/Users/song/Downloads/AI原生工作中枢设计推演v2.docx /Users/song/Downloads/AI原生IM协同.md /Users/song/Downloads/AI原生企业的管理思想、管理范式与组织形态.pptx 整理一篇汇总的文档，然后生成幻灯片',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '汇总的文档 -> 幻灯片',
      finalDeliverable: '幻灯片',
      providedSourcePaths: [
        '/Users/song/Downloads/AI原生工作中枢设计推演v2.docx',
        '/Users/song/Downloads/AI原生IM协同.md',
        '/Users/song/Downloads/AI原生企业的管理思想、管理范式与组织形态.pptx',
      ],
      intentMode: 'multi_stage',
    });
    expect(plan?.stages.map((stage) => stage.label)).toEqual([
      '生成汇总的文档',
      '生成幻灯片',
    ]);
  });

  it('returns continue_active for a continuation cue without a deliverable-family change', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '再改一版，更偏金融行业',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'continue_active',
      intentType: 'revise',
      templateId: 'revise_v1',
      deliverable: '产品方案',
    });
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'inspect_current',
      'identify_delta',
      'rewrite',
      'validate',
    ]);
  });

  it('treats material supplements as continue_active instead of a new intent', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '这里还有一份竞品资料，也一起参考',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'continue_active',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '产品方案',
    });
  });

  it('treats short clarification replies as continue_active when an intent is active', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '是',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'continue_active',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '产品方案',
    });
  });

  it('keeps acknowledgements as non_intent even when an intent is active', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '好的',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    expect(result).toEqual({
      kind: 'non_intent',
      reason: 'non_substantial',
    });
  });

  it('treats punctuated acknowledgement variants as non_intent', () => {
    for (const input of ['好的。', '收到！', 'OK!']) {
      const result = createIntentPlan({
        instanceId: 'instance-1',
        sessionId: 'session-1',
        input,
        activeIntent: {
          intentId: 'intent-active',
          deliverable: '产品方案',
          intentType: 'generate',
          templateId: 'generate_v1',
        },
        skills,
      });

      expect(result).toEqual({
        kind: 'non_intent',
        reason: 'non_substantial',
      });
    }
  });

  it('returns clarify when a continuation cue also changes deliverable family', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '基于刚才那个，顺便做一个报价测算',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'clarify',
      intentType: 'analyze',
      templateId: 'analyze_v1',
      deliverable: '报价测算',
    });
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'collect',
      'compare',
      'conclude',
      'validate',
    ]);
  });

  it('returns non_intent for control commands', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '/plan',
      activeIntent: {
        intentId: 'intent-active',
        deliverable: '产品方案',
        intentType: 'generate',
        templateId: 'generate_v1',
      },
      skills,
    });

    expect(result).toEqual({
      kind: 'non_intent',
      reason: 'control_command',
    });
  });

  it('keeps informational status questions out of intent mode without hardcoding a single phrase', () => {
    for (const input of ['更新到什么版本了', '这个 skill 安装好了吗', 'current version?']) {
      const result = createIntentPlan({
        instanceId: 'instance-1',
        sessionId: 'session-1',
        input,
        skills,
      });

      expect(result).toEqual({
        kind: 'non_intent',
        reason: 'non_substantial',
      });
    }
  });

  it('still treats delegated work phrased as a question as intent', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '能帮我根据这些访谈笔记写一版产品方案吗？',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'generate',
      templateId: 'generate_v1',
      deliverable: '产品方案',
    });
  });

  it('requires positive delegation evidence before inheriting an active intent into a short follow-up', () => {
    for (const input of ['先这样吧', '今天先不聊这个', '不继续这个了']) {
      const result = createIntentPlan({
        instanceId: 'instance-1',
        sessionId: 'session-1',
        input,
        activeIntent: {
          intentId: 'intent-active',
          deliverable: 'md -> 报告',
          intentType: 'generate',
          templateId: 'generate_v1',
        },
        skills,
      });

      expect(result).toEqual({
        kind: 'non_intent',
        reason: 'non_substantial',
      });
    }
  });

  it('does not treat a bare file path mention as intent without source-task cues or deliverable cues', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '文件在这里 /Users/song/Downloads/demo.pdf',
      skills,
    });

    expect(result).toEqual({
      kind: 'non_intent',
      reason: 'non_substantial',
    });
  });

  it('classifies summarize requests with the summarize template', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '把这份会议纪要总结成三条关键结论',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'summarize',
      templateId: 'summarize_v1',
      deliverable: '关键结论',
    });
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'collect',
      'extract',
      'structure',
      'finalize',
    ]);
  });

  it('classifies analyze requests with the analyze template', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '分析一下方案A和方案B哪个更适合当前阶段',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan).toMatchObject({
      continuationMode: 'new_intent',
      intentType: 'analyze',
      templateId: 'analyze_v1',
    });
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'collect',
      'compare',
      'conclude',
      'validate',
    ]);
  });

  it('uses template fallbackRoles before generic_llm fallback during slotting', () => {
    const fallbackSkills: SkillMeta[] = [
      makeSkill(
        'collect-brief',
        'Collect source materials and requirements for a report or proposal',
        ['collect materials', 'gather requirements'],
        ['source materials', 'requirements'],
        ['normalized brief'],
      ),
      makeSkill(
        'normalize-brief',
        'Normalize raw notes into a structured brief',
        ['normalize materials', 'clean raw notes'],
        ['raw notes', 'materials'],
        ['structured brief'],
      ),
      makeSkill(
        'compose-report',
        'Compose a report, proposal, or draft document',
        ['compose deliverable', 'draft report'],
        ['brief', 'outline'],
        ['report', 'proposal'],
      ),
    ];

    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '帮我根据这些访谈笔记写一版产品方案',
      skills: fallbackSkills,
    });

    const plan = expectPlan(result);
    expect(plan?.templateId).toBe('generate_v1');
    expect(plan?.steps.map((step) => step.role)).toEqual([
      'collect',
      'normalize',
      'compose',
      'validate',
    ]);
    expect(plan?.steps[2]).toMatchObject({
      role: 'compose',
      skillName: 'compose-report',
    });
    expect(plan?.steps[3]).toMatchObject({
      role: 'validate',
      skillName: 'compose-report',
      dependsOn: [plan?.steps[2]?.stepId],
    });
  });

  it('matches a report skill from description and whenToUse even when structured task hints are empty', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '把这篇文档生成 md，然后生成报告 /Users/song/Downloads/salesforce_ai_evolution.html',
      skills: [
        {
          name: 'kai-report-creator',
          description: 'Use when the user wants to CREATE or GENERATE a report, business summary, data dashboard, or research doc — 报告/数据看板/商业报告/研究文档/KPI仪表盘.',
          whenToUse: 'Use for --generate and --from FILE when the user wants a report.',
          content: '# kai-report-creator',
          path: '/virtual/kai-report-creator.md',
          source: 'project',
          tier: 'project',
          allowedTools: [],
          executionContext: 'inline',
          dependsOn: [],
          userInvocable: true,
          taskHints: {
            taskGoals: [],
            inputKinds: [],
            outputKinds: [],
            examples: [],
          },
        },
      ],
    });

    const plan = expectPlan(result);
    expect(plan?.stages[0]?.deliverable).toBe('md');
    expect(plan?.stages[0]?.steps[2]).toMatchObject({
      key: 'compose',
      skillName: 'generic_llm::compose',
    });
    expect(plan?.stages[1]?.deliverable).toBe('报告');
    expect(plan?.stages[1]?.steps[2]).toMatchObject({
      key: 'compose',
      skillName: 'kai-report-creator',
    });
  });

  it('splits 和-joined deliverables into separate stages', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '/Users/song/Downloads/简历.docx 把这个文档生成报告和幻灯片',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan?.stages.map((stage) => stage.label)).toEqual([
      '生成报告',
      '生成幻灯片',
    ]);
    expect(plan).toMatchObject({
      intentMode: 'multi_stage',
      finalDeliverable: '幻灯片',
    });
  });

  it('splits 、-joined deliverables into separate stages', () => {
    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '帮我生成PPT、报告、摘要',
      skills,
    });

    const plan = expectPlan(result);
    expect(plan?.stages.length).toBe(3);
    expect(plan?.stages.map((stage) => stage.label)).toEqual([
      '生成PPT',
      '生成报告',
      '提炼摘要',
    ]);
  });

  it('allows contextual skill scoring to rerank otherwise similar matches without overriding stage semantics', () => {
    const rerankedSkills: SkillMeta[] = [
      makeSkill(
        'report-alpha',
        'Compose a report or proposal from a brief',
        ['compose deliverable'],
        ['brief'],
        ['report'],
      ),
      makeSkill(
        'report-beta',
        'Compose a report or proposal from a brief',
        ['compose deliverable'],
        ['brief'],
        ['report'],
      ),
    ];

    const result = createIntentPlan({
      instanceId: 'instance-1',
      sessionId: 'session-1',
      input: '根据这份资料生成一版报告',
      skills: rerankedSkills,
      skillScoreLookup: ({ skillName, stageRole, deliverable }) => (
        skillName === 'report-beta' && stageRole === 'compose' && deliverable === '报告' ? 2 : 0
      ),
    });

    const plan = expectPlan(result);
    expect(plan?.stages[0]?.steps[2]).toMatchObject({
      key: 'compose',
      skillName: 'report-beta',
    });
  });
});
