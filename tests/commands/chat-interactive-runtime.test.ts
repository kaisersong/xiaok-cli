import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { Message, ModelAdapter, StreamChunk, ToolDefinition } from '../../src/types.js';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';
import { createEmptySessionIntentLedger } from '../../src/runtime/intent-delegation/types.js';
import { createEmptySessionSkillEvalState } from '../../src/runtime/intent-delegation/skill-eval.js';

interface FakeAdapterCall {
  model: string;
  systemPrompt: string;
  toolNames: string[];
  lastUserText: string;
  lastToolResult: string;
}

const { mockSelectModel } = vi.hoisted(() => ({
  mockSelectModel: vi.fn(),
}));

const adapterCalls: FakeAdapterCall[] = [];
const clonedModels: string[] = [];
let multiToolPhase = 0;
let denseCommandPhase = 0;
let reportIntentToolPhase = 0;

const reportIntentFixtureNames = [
  '01-market-overview.md',
  '02-customer-signals.txt',
  '03-execution-risks.txt',
] as const;

function loadReportIntentFixture(name: (typeof reportIntentFixtureNames)[number]): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', 'report-intent-source', name), 'utf8');
}

const denseCommandSequence = [
  'printf "cat /Users/song/.xiaok/skills/kai-report-creator/SKILL.md"',
  'printf "ls -la /Users/song/.xiaok/skills/kai-report-creator"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator"',
  'printf "find /Users/song/.xiaok/skills/kai-report-creator -maxdepth 2"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/templates"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/examples"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/scripts"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/assets"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/references"',
  'printf "cd /Users/song/.xiaok/skills/kai-report-creator/tests"',
  'printf "" && sleep 6',
];

function resetAdapterState(): void {
  adapterCalls.length = 0;
  clonedModels.length = 0;
  multiToolPhase = 0;
  denseCommandPhase = 0;
  reportIntentToolPhase = 0;
}

function extractLastUserText(messages: Message[]): string {
  const lastUserWithText = [...messages].reverse().find((message) => {
    if (message.role !== 'user') {
      return false;
    }
    return message.content.some((block) => block.type === 'text' && !block.text.startsWith('<system-reminder>'));
  });
  if (!lastUserWithText) {
    return '';
  }

  return lastUserWithText.content
    .filter((block) => block.type === 'text' && !block.text.startsWith('<system-reminder>'))
    .map((block) => block.text)
    .join('\n');
}

function extractLastToolResult(messages: Message[]): string {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || !lastMessage.content.some((block) => block.type === 'tool_result')) {
    return '';
  }

  return lastMessage.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => block.content)
    .join('\n');
}

function createFakeAdapter(model = 'test-model'): ModelAdapter & { cloneWithModel(nextModel: string): ModelAdapter } {
  return {
    getModelName() {
      return model;
    },
    cloneWithModel(nextModel: string) {
      clonedModels.push(nextModel);
      return createFakeAdapter(nextModel);
    },
    async *stream(
      messages: Message[],
      tools: ToolDefinition[],
      systemPrompt: string,
    ): AsyncIterable<StreamChunk> {
      const lastUserText = extractLastUserText(messages);
      const lastToolResult = extractLastToolResult(messages);
      const isReportMergeIntent = (
        lastUserText.includes('生成 md')
        && lastUserText.includes('生成报告')
        && (lastUserText.includes('根据这个文档') || lastUserText.includes('根据这些文档'))
      );
      adapterCalls.push({
        model,
        systemPrompt,
        toolNames: tools.map((tool) => tool.name),
        lastUserText,
        lastToolResult,
      });

      if (lastToolResult.includes('background subagent queued:')) {
        yield { type: 'text', delta: '后台任务已安排，等待完成通知。' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('已确认')) {
        yield { type: 'text', delta: '收到回答: 已确认' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('"taskId": "task_1"')) {
        yield { type: 'text', delta: 'task created' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('执行 skill "fork-research"')) {
        yield { type: 'text', delta: `fork skill result via ${model}` };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('draft the rollout')) {
        yield { type: 'text', delta: `background worker finished via ${model}` };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('请后台规划')) {
        yield {
          type: 'tool_use',
          id: 'tu_background_1',
          name: 'subagent',
          input: {
            agent: 'planner',
            prompt: 'draft the rollout',
            background: true,
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('请先问我一句')) {
        yield {
          type: 'tool_use',
          id: 'tu_ask_user_1',
          name: 'ask_user',
          input: {
            question: '确认目标？',
            placeholder: '答案',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('"想吃什么类型的？"')) {
        yield { type: 'text', delta: '已记录你的饮食偏好。' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('请用 AskUserQuestion 问我吃什么')) {
        yield {
          type: 'tool_use',
          id: 'tu_ask_user_question_1',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                question: '想吃什么类型的？',
                options: [
                  { label: '中餐炒菜（如宫保鸡丁、番茄炒蛋）', description: '经典家常炒菜配米饭' },
                  { label: '面食/粉类（如拉面、米粉、饺子）', description: '面条、粉类、水饺等' },
                  { label: '轻食/沙拉（如三明治、燕麦碗）', description: '低卡健康餐' },
                  { label: '快餐/便当（如汉堡、便当）', description: '方便快捷' },
                  { label: '火锅/烧烤（如麻辣烫、烤肉）', description: '聚餐或想吃点重的' },
                  { label: '其他（告诉我具体想法）', description: '自由输入' },
                ],
              },
            ],
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('分三次显示123')) {
        yield { type: 'text', delta: '1\n2\n3' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('分四次显示1234')) {
        yield { type: 'text', delta: '1\n2\n3\n4' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('分五次显示12345')) {
        yield { type: 'text', delta: '1\n2\n3\n4\n5' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('报告后慢速长续问')) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        yield { type: 'text', delta: `echo:${lastUserText}` };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('输出30行')) {
        yield {
          type: 'text',
          delta: Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('很多命令后慢命令')) {
        if (denseCommandPhase === 0) {
          denseCommandPhase = 1;
          yield { type: 'text', delta: '我先顺着引用把命令跑一遍。' };
          yield {
            type: 'tool_use',
            id: 'tu_dense_command_1',
            name: 'bash',
            input: {
              command: denseCommandSequence[0],
            },
          };
          yield { type: 'done' };
          return;
        }

        if (denseCommandPhase < denseCommandSequence.length) {
          const nextCommand = denseCommandSequence[denseCommandPhase];
          denseCommandPhase += 1;
          yield {
            type: 'tool_use',
            id: `tu_dense_command_${denseCommandPhase}`,
            name: 'bash',
            input: {
              command: nextCommand,
            },
          };
          yield { type: 'done' };
          return;
        }

        yield { type: 'text', delta: '很多命令完成' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('先说明再执行慢命令')) {
        if (lastToolResult.includes('（命令执行成功，无输出）')) {
          yield { type: 'text', delta: '慢命令结束' };
          yield { type: 'done' };
          return;
        }

        yield { type: 'text', delta: '我先跑一个慢命令。' };
        yield {
          type: 'tool_use',
          id: 'tu_slow_bash_command',
          name: 'bash',
          input: {
            command: 'sleep 3',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('多行结尾测试')) {
        yield {
          type: 'text',
          delta: [
            '适合中午的：',
            '',
            '- 快餐：鸡腿饭',
            '- 面食：拉面',
            '- 轻食：三明治',
            '',
            '想吃点重口还是清淡的？',
          ].join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('辣的续问')) {
        yield {
          type: 'text',
          delta: [
            '辣的午餐：',
            '',
            '- 川菜：麻婆豆腐饭',
            '- 小吃：麻辣烫',
          ].join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('延迟回复')) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        yield { type: 'text', delta: 'delayed reply' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('outside file A')) {
        if (lastUserText.includes('连续工具块') && multiToolPhase === 1) {
          multiToolPhase = 2;
          yield {
            type: 'tool_use',
            id: 'tu_multi_tool_bash',
            name: 'bash',
            input: {
              command: 'printf "grep result"',
            },
          };
          yield { type: 'done' };
          return;
        }
        if (lastUserText.includes('先读取再回答')) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          yield { type: 'text', delta: '读取完成' };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', delta: 'external read A ok' };
        yield { type: 'done' };
        return;
      }

      if (lastToolResult.includes('outside file B')) {
        yield { type: 'text', delta: 'external read B ok' };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('连续工具块') && multiToolPhase === 2) {
        multiToolPhase = 3;
        yield {
          type: 'tool_use',
          id: 'tu_multi_tool_glob',
          name: 'glob',
          input: {
            pattern: '**/*.txt',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('连续工具块') && multiToolPhase === 3) {
        multiToolPhase = 4;
        yield { type: 'text', delta: '连续工具块完成' };
        yield { type: 'done' };
        return;
      }

      if (
        lastToolResult.includes('project file fixture line')
        && !isReportMergeIntent
      ) {
        yield {
          type: 'text',
          delta: [
            '继续总结如下：',
            '',
            '- 第一项',
            '- 第二项',
          ].join('\n'),
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('读取外部文件A')) {
        yield {
          type: 'tool_use',
          id: 'tu_external_read_a',
          name: 'read',
          input: {
            file_path: process.env.XIAOK_TEST_EXTERNAL_FILE_A ?? '',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('先读取再回答')) {
        yield {
          type: 'tool_use',
          id: 'tu_external_read_then_answer',
          name: 'read',
          input: {
            file_path: process.env.XIAOK_TEST_EXTERNAL_FILE_A ?? '',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('读取外部文件B')) {
        yield {
          type: 'tool_use',
          id: 'tu_external_read_b',
          name: 'read',
          input: {
            file_path: process.env.XIAOK_TEST_EXTERNAL_FILE_B ?? '',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (lastUserText.includes('先读项目文件再继续')) {
        yield { type: 'text', delta: '我先读取项目文件。' };
        yield {
          type: 'tool_use',
          id: 'tu_project_read_then_answer',
          name: 'read',
          input: {
            file_path: process.env.XIAOK_TEST_PROJECT_FILE ?? '',
          },
        };
        yield { type: 'done' };
        return;
      }

      if (isReportMergeIntent) {
        if (reportIntentToolPhase === 0) {
          reportIntentToolPhase = 1;
          yield { type: 'text', delta: '我会先读取三份材料并合并成 Markdown。' };
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_read_a',
            name: 'read',
            input: {
              file_path: process.env.XIAOK_TEST_PROJECT_FILE_A ?? '',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 1) {
          reportIntentToolPhase = 2;
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_read_b',
            name: 'read',
            input: {
              file_path: process.env.XIAOK_TEST_PROJECT_FILE_B ?? '',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 2) {
          reportIntentToolPhase = 3;
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_read_c',
            name: 'read',
            input: {
              file_path: process.env.XIAOK_TEST_PROJECT_FILE_C ?? '',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 3) {
          reportIntentToolPhase = 4;
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_write_md',
            name: 'write',
            input: {
              file_path: join(process.cwd(), 'report-analysis.report.md'),
              content: '# merged report draft\n',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 4) {
          reportIntentToolPhase = 5;
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_bash_merge',
            name: 'bash',
            input: {
              command: 'printf "E2E_RUNTIME_MERGED_MD"',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 5) {
          reportIntentToolPhase = 6;
          yield {
            type: 'tool_use',
            id: 'tu_report_intent_bash_report',
            name: 'bash',
            input: {
              command: 'printf "const fs = require(\'fs\'); const report = fs.readFileSync(\'report-analysis.report.md\', \'utf8\'); // 解析并生成总结" && sleep 1',
            },
          };
          yield { type: 'done' };
          return;
        }

        if (reportIntentToolPhase === 6) {
          reportIntentToolPhase = 7;
          yield { type: 'text', delta: '三份文档已先合并为 Markdown，再生成报告。' };
          yield { type: 'done' };
          return;
        }
      }

      if (lastUserText.includes('连续工具块')) {
        multiToolPhase = 1;
        yield {
          type: 'tool_use',
          id: 'tu_multi_tool_read',
          name: 'read',
          input: {
            file_path: process.env.XIAOK_TEST_EXTERNAL_FILE_A ?? '',
          },
        };
        yield { type: 'done' };
        return;
      }

      yield { type: 'text', delta: `echo:${lastUserText || 'empty'}` };
      yield { type: 'done' };
    },
  };
}

function expectPromptVisible(harness: ReturnType<typeof createTtyHarness>): void {
  expect(harness.screen.lines().some((line) => line.includes('❯'))).toBe(true);
}

async function waitForInputTurnReady(harness: ReturnType<typeof createTtyHarness>): Promise<void> {
  await waitFor(() => {
    expectPromptVisible(harness);
    expect(harness.emitter.listenerCount('data')).toBeGreaterThan(0);
    const lines = harness.screen.lines();
    const hasLiveActivity = lines.some((line) => {
      const trimmed = line.trim();
      return /^(?:[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])\s+(?:Thinking|Exploring codebase|Tracing references|Running command|Answering|Compacting context)\b/u.test(trimmed);
    });
    expect(hasLiveActivity).toBe(false);
  }, { timeoutMs: 3_000 });
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function findLineIndex(lines: string[], pattern: string | RegExp): number {
  return lines.findIndex((line) => typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line));
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function normalizeAssistantLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.startsWith('● ') ? trimmed.slice(2) : trimmed;
}

function expectSingleFooter(lines: string[]): void {
  const statusRows = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes('project') && line.includes('%'));
  const promptRows = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => line.includes('❯') && statusRows.some((row) => row.index === index + 1));

  expect(promptRows).toHaveLength(1);
  expect(statusRows).toHaveLength(1);
  expect(statusRows[0]?.index).toBeGreaterThan(promptRows[0]?.index ?? -1);
}

function expectActiveTurnFooter(lines: string[]): void {
  expectSingleFooter(lines);
  expect(
    lines.some((line) => /Thinking|Answering|Running command|Executing command|Working/u.test(line)),
  ).toBe(true);
}

function expectNoTransientChrome(lines: string[]): void {
  expect(lines.some((line) => line.includes('欢迎使用 xiaok code!'))).toBe(false);
  expect(lines.some((line) => line.includes('Thinking'))).toBe(false);
  expect(lines.some((line) => line.includes('Answering'))).toBe(false);
}

function expectTurnBlock(
  lines: string[],
  inputText: string,
  expectedOutputLines: string[],
): void {
  const promptIndex = findLineIndex(lines, '❯');
  const statusIndex = lines.findIndex((line) => line.includes('project') && line.includes('%'));
  const submittedIndex = findLineIndex(lines, `› ${inputText}`);

  expect(submittedIndex).toBeGreaterThanOrEqual(0);
  expect(promptIndex).toBeGreaterThan(submittedIndex);
  expect(statusIndex).toBeGreaterThan(promptIndex);

  let lastIndex = submittedIndex;
  for (const outputLine of expectedOutputLines) {
    const nextIndex = lines.findIndex(
      (line, index) => index > lastIndex && normalizeAssistantLine(line) === outputLine,
    );
    expect(nextIndex).toBeGreaterThan(lastIndex);
    expect(nextIndex).toBeLessThan(promptIndex);
    lastIndex = nextIndex;
  }
}

function writeCompletedFeedbackResumeSessionFixture(
  rootDir: string,
  sessionId: string,
): { configDir: string; projectDir: string; sessionPath: string; intentId: string } {
  const configDir = join(rootDir, 'config');
  const projectDir = join(rootDir, 'project');
  const sessionsDir = join(configDir, 'sessions');
  const intentId = 'intent_feedback_footer_gap';
  const stageId = `${intentId}:stage:1`;
  const stepId = `${stageId}:step:compose`;
  const now = Date.now() - 20_000;

  mkdirSync(configDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    schemaVersion: 1,
    defaultModel: 'claude',
    models: {
      claude: { model: 'claude-test' },
    },
    defaultMode: 'interactive',
    contextBudget: 4000,
    channels: {},
  }, null, 2));

  const intentDelegation = createEmptySessionIntentLedger(sessionId, now);
  intentDelegation.activeIntentId = intentId;
  intentDelegation.instanceId = `inst_${sessionId}`;
  intentDelegation.intents.push({
    intentId,
    instanceId: `inst_${sessionId}`,
    sessionId,
    rawIntent: '根据文档生成报告',
    normalizedIntent: '根据文档生成报告',
    providedSourcePaths: [],
    intentType: 'generate',
    deliverable: '报告',
    finalDeliverable: '报告',
    explicitConstraints: [],
    delegationBoundary: [],
    riskTier: 'medium',
    intentMode: 'single_stage',
    segmentationConfidence: 'high',
    templateId: 'test-template',
    stages: [
      {
        stageId,
        order: 0,
        label: '生成报告',
        intentType: 'generate',
        deliverable: '报告',
        templateId: 'test-template',
        riskTier: 'medium',
        dependsOnStageIds: [],
        steps: [
          {
            stepId,
            key: 'compose',
            order: 0,
            role: 'compose',
            skillName: 'report-skill',
            dependsOn: [],
            status: 'completed',
            riskTier: 'medium',
          },
        ],
        status: 'completed',
        activeStepId: stepId,
        structuralValidation: 'passed',
        semanticValidation: 'passed',
        needsFreshContextHandoff: false,
      },
    ],
    activeStageId: stageId,
    artifacts: [],
    steps: [
      {
        stepId,
        key: 'compose',
        order: 0,
        role: 'compose',
        skillName: 'report-skill',
        dependsOn: [],
        status: 'completed',
        riskTier: 'medium',
      },
    ],
    activeStepId: stepId,
    overallStatus: 'completed',
    attemptCount: 1,
    latestReceipt: 'Completed 报告',
    createdAt: now,
    updatedAt: now,
  });

  const skillEval = createEmptySessionSkillEvalState(sessionId, now);
  skillEval.observations.push({
    observationId: `${stepId}:skill_eval`,
    sessionId,
    intentId,
    stageId,
    stepId,
    intentType: 'generate',
    stageRole: 'compose',
    deliverable: '报告',
    deliverableFamily: 'document',
    selectedSkillName: 'report-skill',
    actualSkillName: 'report-skill',
    status: 'completed',
    artifactRecorded: true,
    structuralValidation: 'passed',
    semanticValidation: 'passed',
    createdAt: now,
    updatedAt: now,
  });

  const sessionPath = join(sessionsDir, `${sessionId}.json`);
  writeFileSync(sessionPath, JSON.stringify({
    schemaVersion: 1,
    sessionId,
    cwd: projectDir,
    createdAt: now - 5_000,
    updatedAt: now,
    lineage: [sessionId],
    messages: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
    compactions: [],
    memoryRefs: [],
    approvalRefs: [],
    backgroundJobRefs: [],
    intentDelegation,
    skillEval,
  }, null, 2));

  return { configDir, projectDir, sessionPath, intentId };
}

vi.mock('../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => createFakeAdapter()),
}));

vi.mock('../../src/ui/model-selector.js', () => ({
  selectModel: mockSelectModel,
}));

describe('chat interactive runtime', () => {
  const tempDirs: string[] = [];
  let originalConfigDir: string | undefined;
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    resetAdapterState();
    mockSelectModel.mockReset();
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }

    vi.resetModules();
    vi.clearAllMocks();
    resetAdapterState();
  });

  it('runs a fork skill through the interactive slash flow and honors the skill model override', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(join(projectDir, '.xiaok', 'skills'), { recursive: true });
    mkdirSync(join(projectDir, '.xiaok', 'agents'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));
    writeFileSync(join(projectDir, '.xiaok', 'agents', 'researcher.md'), [
      '---',
      'model: gpt-5.4',
      '---',
      'Run research in a forked agent.',
    ].join('\n'));
    writeFileSync(join(projectDir, '.xiaok', 'skills', 'fork-research.md'), [
      '---',
      'name: fork-research',
      'description: Run research in a forked agent',
      'context: fork',
      'agent: researcher',
      '---',
      'Return a concise research answer.',
    ].join('\n'));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);
      expect(harness.output.normalized).not.toContain('[platform] degraded capabilities detected');
      expect(harness.output.normalized).not.toContain('mcp:mempalace degraded');

      harness.send('/fork-research summarize findings');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('fork skill result via gpt-5.4');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;

      expect(clonedModels).toContain('gpt-5.4');
      expect(adapterCalls.some((call) => call.lastUserText.includes('执行 skill "fork-research"'))).toBe(true);
      expect(harness.output.normalized).not.toContain('Error:');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('renders background subagent completion notices during an interactive chat turn', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(join(projectDir, '.xiaok', 'agents'), { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));
    writeFileSync(join(projectDir, '.xiaok', 'agents', 'planner.md'), [
      '---',
      'background: true',
      'model: gpt-5.4',
      '---',
      'You plan work in the background.',
    ].join('\n'));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');
    let pending: Promise<void> | undefined;

    try {
      const program = new Command();
      registerChatCommands(program);

      pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);
      expect(harness.output.normalized).not.toContain('[platform] degraded capabilities detected');
      expect(harness.output.normalized).not.toContain('mcp:mempalace degraded');

      harness.send('请后台规划');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('后台任务已安排，等待完成通知。');
      }, { timeoutMs: 3_000 });

      await waitFor(() => {
        expect(harness.output.normalized).toContain('[background] job_1 completed: background worker finished via gpt-5.4');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;

      expect(clonedModels).toContain('gpt-5.4');
      expect(adapterCalls.some((call) => call.toolNames.includes('subagent') && call.lastUserText.includes('请后台规划'))).toBe(true);
      expect(harness.output.normalized).not.toContain('Error:');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('keeps footer/status visible during a tool interruption and restarts assistant lead formatting after the tool block', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    const projectFile = join(projectDir, 'notes.txt');
    writeFileSync(projectFile, 'project file fixture line\n', 'utf8');

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_PROJECT_FILE = projectFile;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');
    let pending: Promise<void> | undefined;

    try {
      const program = new Command();
      registerChatCommands(program);

      pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('先读项目文件再继续');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.screen.text();
        expect(text).toContain('Read notes.txt');
      }, { timeoutMs: 3_000 });

      const duringToolLines = harness.screen.lines();
      const promptIndex = duringToolLines.findIndex((line) => line.includes('❯'));

      expect(promptIndex).toBeGreaterThanOrEqual(0);
      expect(duringToolLines.slice(Math.max(0, promptIndex - 3), promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);

      await waitFor(() => {
        expect(harness.screen.text()).toContain('继续总结如下：');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const finalLines = harness.screen.lines();
      const firstSegmentIndex = finalLines.findIndex((line) => line.trim() === '● 我先读取项目文件。');
      const secondSegmentIndex = finalLines.findIndex((line) => line.trim() === '● 继续总结如下：');
      const finalPromptIndex = finalLines.findIndex((line) => line.includes('❯ Type your message...'));

      expect(firstSegmentIndex).toBeGreaterThanOrEqual(0);
      expect(secondSegmentIndex).toBeGreaterThan(firstSegmentIndex);
      expect(finalPromptIndex).toBeGreaterThanOrEqual(secondSegmentIndex + 3);
      expect(finalLines.slice(secondSegmentIndex + 1, finalPromptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_PROJECT_FILE;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('shows a Thinking activity immediately even for fast replies', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(60, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('hi');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('Thinking');
        expect(harness.output.normalized).toContain('echo:hi');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('keeps a visible live activity while tool blocks are rendering', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-tool-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const externalFileA = join(projectDir, 'external-a.txt');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(externalFileA, 'outside file A');
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_EXTERNAL_FILE_A = externalFileA;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(60, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('先读取再回答');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('Read external-a.txt'))).toBe(true);
        expect(lines.some((line) => line.includes('Exploring codebase'))).toBe(true);
        expect(lines.some((line) => line.includes('❯'))).toBe(true);
        expect(lines.some((line) => line.includes('project') && line.includes('%'))).toBe(true);
        expect(lines.some((line) => line.includes('读取完成'))).toBe(false);
      }, { timeoutMs: 3_000 });

      await waitFor(() => {
        expect(harness.screen.text()).toMatch(/读取完成|external read A ok/);
      }, { timeoutMs: 5_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_EXTERNAL_FILE_A;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('keeps prompt, status, and live activity visible across consecutive tool blocks', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-multi-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const externalFileA = join(projectDir, 'external-a.txt');
    const projectSettingsDir = join(projectDir, '.xiaok');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    writeFileSync(externalFileA, 'outside file A');
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(printf *)'],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_EXTERNAL_FILE_A = externalFileA;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('连续工具块');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const hasRead = lines.some((line) => line.includes('Read external-a.txt'));
        const hasBash = lines.some((line) => line.includes('printf "grep result"'));
        const promptIndex = lines.map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'))
          .at(-1)?.index ?? -1;
        const statusIndex = lines.map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'))
          .at(-1)?.index ?? -1;
        const activityIndex = lines.findIndex((line) => /Thinking|Exploring codebase|Tracing references|Running command|Working/u.test(line));
        expect(hasRead).toBe(true);
        expect(hasBash).toBe(true);

        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(activityIndex).toBeGreaterThanOrEqual(17);
        expect(activityIndex).toBeLessThan(promptIndex);
      }, { timeoutMs: 5_000 });

      await waitFor(() => {
        expect(harness.output.normalized).toContain('连续工具块完成');
      }, { timeoutMs: 5_000 });

      await waitForInputTurnReady(harness);
      harness.send('工具块完成后还能继续吗');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:工具块完成后还能继续吗');
      }, { timeoutMs: 5_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_EXTERNAL_FILE_A;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('clears staged-intent summary after completion and keeps the next ordinary question out of intent mode', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-intent-followup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const demoFile = join(projectDir, 'demo.pdf');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(demoFile, 'demo pdf');
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send(`把这篇文档生成 md，然后生成报告 ${demoFile}`);
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('🤝 已理解，会先提取 Markdown，再生成报告。');
        expect(harness.output.normalized).toContain(`echo:把这篇文档生成 md，然后生成报告 ${demoFile}`);
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);

      expect(harness.screen.lines().some((line) => line.includes('Intent:'))).toBe(false);
      expect(countOccurrences(harness.output.normalized, '🤝 已理解')).toBe(1);

      harness.send('今天先不聊这个');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:今天先不聊这个');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);

      const lines = harness.screen.lines();
      expect(lines.some((line) => line.includes('Intent:'))).toBe(false);
      expect(countOccurrences(harness.output.normalized, '🤝 已理解')).toBe(1);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('does not display hidden thinking blocks when resuming a saved session', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const sessionsDir = join(configDir, 'sessions');
    const sessionId = 'sess_resume_hidden_thinking';
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));
    writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify({
      schemaVersion: 1,
      sessionId,
      cwd: projectDir,
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now() - 5_000,
      lineage: [sessionId],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '简单分析一下' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: '用户输入了一长串"1"，这看起来像是误触、测试或者没有实际意义的输入。',
            },
            {
              type: 'text',
              text: '这是正式回答。',
            },
          ],
        },
      ],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);
      await waitFor(() => {
        expect(harness.output.normalized).toContain('简单分析一下');
        expect(harness.output.normalized).toContain('这是正式回答。');
        expect(harness.output.normalized).not.toContain('[Thinking]');
        expect(harness.output.normalized).not.toContain('用户输入了一长串"1"');
      }, { timeoutMs: 3_000 });

      harness.send('resume 后继续');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:resume 后继续');
        const lines = harness.screen.lines();
        const resumedQuestionIndex = lines.findIndex((line) => line.includes('› 简单分析一下'));
        const resumedAnswerIndex = lines.findIndex((line) => line.includes('这是正式回答。'));
        const newSubmittedIndex = lines.findIndex((line) => line.includes('› resume 后继续'));
        const newAnswerIndex = lines.findIndex((line) => normalizeAssistantLine(line) === 'echo:resume 后继续');

        expect(resumedQuestionIndex).toBeGreaterThanOrEqual(0);
        expect(resumedAnswerIndex).toBeGreaterThan(resumedQuestionIndex);
        expect(newSubmittedIndex).toBeGreaterThan(resumedAnswerIndex);
        expect(newAnswerIndex).toBeGreaterThan(newSubmittedIndex);
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('appends the first new turn after the replayed history when resuming a longer session', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-resume-layout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const sessionsDir = join(configDir, 'sessions');
    const sessionId = 'sess_resume_layout_overlap';
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));
    writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify({
      schemaVersion: 1,
      sessionId,
      cwd: projectDir,
      createdAt: Date.now() - 20_000,
      updatedAt: Date.now() - 5_000,
      lineage: [sessionId],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '历史问题一' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'line a1\nline a2\nline a3\nline a4\nline a5' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: '历史问题二' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'line b1\nline b2\nline b3\nline b4\nline b5\nline b6' }],
        },
      ],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
      },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);
      harness.send('resume 继续提问');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('echo:resume 继续提问');
        const lines = harness.screen.lines();
        const historyQuestion2Index = lines.findIndex((line) => line.includes('› 历史问题二'));
        const historyLastAnswerIndex = lines.findIndex((line) => line.includes('line b6'));
        const newSubmittedIndex = lines.findIndex((line) => line.includes('› resume 继续提问'));
        const newAnswerIndex = lines.findIndex((line) => line.includes('echo:resume 继续提问'));

        expect(historyQuestion2Index).toBeGreaterThanOrEqual(0);
        expect(historyLastAnswerIndex).toBeGreaterThan(historyQuestion2Index);
        expect(newSubmittedIndex).toBeGreaterThan(historyLastAnswerIndex);
        expect(newAnswerIndex).toBeGreaterThan(newSubmittedIndex);
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('shows multiple slash command rows in interactive chat', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('/rem');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('/reminder'))).toBe(true);
        expect(lines.some((line) => line.includes('/remind '))).toBe(false);
        expect(lines.some((line) => line.includes('/reminders'))).toBe(false);
        expect(lines.some((line) => line.includes('/reminder-cancel'))).toBe(false);
      }, { timeoutMs: 3_000 });

      harness.send('\x03');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('renders built-in slash command output in the visible transcript area', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('/help');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const commandSectionStart = lines.findIndex((line) => line.includes('可用命令'));
        const skillsSectionStart = lines.findIndex((line) => line.includes('可用 skills'));
        const commandLines = lines.slice(
          commandSectionStart >= 0 ? commandSectionStart : 0,
          skillsSectionStart >= 0 ? skillsSectionStart : lines.length,
        );
        expect(lines.some((line) => line.includes('可用命令'))).toBe(true);
        expect(lines.some((line) => line.includes('/clear') && line.includes('清屏'))).toBe(true);
        expect(lines.some((line) => line.includes('/compact') && line.includes('压缩上下文'))).toBe(true);
        expect(lines.some((line) => line.includes('/context') && line.includes('查看当前仓库上下文'))).toBe(true);
        expect(lines.some((line) => line.includes('/reminder') && line.includes('list') && line.includes('cancel <id>'))).toBe(true);
        expect(lines.some((line) => line.includes('/settings') && line.includes('查看当前生效配置'))).toBe(true);
        expect(lines.some((line) => line.includes('/skills-reload') && line.includes('刷新 skill 目录'))).toBe(true);
        expect(lines.some((line) => line.includes('/yzjchannel') && line.includes('连接云之家 channel'))).toBe(true);
        expect(lines.some((line) => line.includes('/help') && line.includes('显示帮助'))).toBe(true);
        expect(lines.some((line) => line.includes('/remind '))).toBe(false);
        expect(lines.some((line) => line.includes('/reminders'))).toBe(false);
        expect(lines.some((line) => line.includes('/reminder-cancel'))).toBe(false);
        expect(lines.some((line) => line.includes('/commit'))).toBe(false);
        expect(commandLines.some((line) => line.includes('/review'))).toBe(false);
        expect(lines.some((line) => line.includes('/pr'))).toBe(false);
        expect(lines.some((line) => line.includes('/doctor'))).toBe(false);
        expect(lines.some((line) => line.includes('/init'))).toBe(false);
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('routes a slash-selected /models command to the model selector instead of the /mode branch and keeps the footer singular', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-models-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    mockSelectModel.mockResolvedValue(null);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('/mod');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('/mode'))).toBe(true);
        expect(lines.some((line) => line.includes('/models'))).toBe(true);
      }, { timeoutMs: 3_000 });

      for (let i = 0; i < 6; i += 1) {
        if (harness.screen.lines().some((line) => line.includes('❯ /models'))) {
          break;
        }
        harness.send('\x1b[B');
      }

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('❯ /models'))).toBe(true);
      }, { timeoutMs: 3_000 });

      harness.send('\r');

      await waitFor(() => {
        expect(mockSelectModel).toHaveBeenCalledTimes(1);
        expect(harness.output.normalized).toContain('已取消');
        expect(harness.output.normalized).not.toContain('当前权限模式：');
        expectSingleFooter(harness.screen.lines());
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('redirects removed slash commands to the top-level CLI instead of treating them as skills', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('/doctor');
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('chat 中已不再支持 /doctor');
        expect(harness.output.normalized).toContain('xiaok doctor');
        expect(harness.output.normalized).not.toContain('找不到 skill "doctor"');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 10_000);

  it('supports shift-tab mode cycling plus ask-user flow in interactive chat', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);
      expect(harness.output.normalized).not.toContain('[platform] degraded capabilities detected');
      expect(harness.output.normalized).not.toContain('mcp:mempalace degraded');

      harness.send('\x1b[Z');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('权限模式已切换为 auto');
      }, { timeoutMs: 3_000 });

      harness.send('/mode');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('当前权限模式：auto');
      }, { timeoutMs: 3_000 });

      harness.send('请先问我一句');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('Agent question: 确认目标？');
      }, { timeoutMs: 3_000 });

      harness.send('已确认');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('收到回答: 已确认');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps AskUserQuestion menu hints singular while navigating near the footer and clears them after confirm', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-ask-user-question-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(36, 16);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');
    const sendAskUserKey = (key: string): void => {
      harness.emitter.emit('data', key);
    };

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.output.normalized).toContain('line 30');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('请用 AskUserQuestion 问我吃什么');
      harness.send('\r');

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('想吃什么类型的？');
        expect(countOccurrences(screen, '↑↓ navigate   Enter select')).toBe(1);
      }, { timeoutMs: 3_000 });

      for (let i = 0; i < 10; i += 1) {
        sendAskUserKey('\x1b[B');
      }

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(countOccurrences(screen, '想吃什么类型的？')).toBe(1);
        expect(countOccurrences(screen, '↑↓ navigate   Enter select')).toBe(1);
      }, { timeoutMs: 3_000 });

      sendAskUserKey('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('已记录你的饮食偏好。');
      }, { timeoutMs: 3_000 });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).not.toContain('↑↓ navigate   Enter select');
        expect(screen).not.toContain('1. 中餐炒菜（如宫保鸡丁、番茄炒蛋）');
      }, { timeoutMs: 3_000 });

      await waitForInputTurnReady(harness);
      expectSingleFooter(harness.screen.lines());

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps welcome, submitted input, streamed output, thinking, and footer in the correct rows across the 3-turn layout scenario', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 40);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('分三次显示123');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('3');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const afterTurn1 = harness.screen.lines();
      expectNoTransientChrome(afterTurn1);
      expectSingleFooter(afterTurn1);
      expectTurnBlock(afterTurn1, '分三次显示123', ['1', '2', '3']);

      harness.send('分四次显示1234');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('4');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const afterTurn2 = harness.screen.lines();
      expectNoTransientChrome(afterTurn2);
      expectSingleFooter(afterTurn2);
      expectTurnBlock(afterTurn2, '分三次显示123', ['1', '2', '3']);
      expectTurnBlock(afterTurn2, '分四次显示1234', ['1', '2', '3', '4']);

      harness.send('分五次显示12345');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('5');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const afterTurn3 = harness.screen.lines();
      expectNoTransientChrome(afterTurn3);
      expectSingleFooter(afterTurn3);
      expectTurnBlock(afterTurn3, '分三次显示123', ['1', '2', '3']);
      expectTurnBlock(afterTurn3, '分四次显示1234', ['1', '2', '3', '4']);
      expectTurnBlock(afterTurn3, '分五次显示12345', ['1', '2', '3', '4', '5']);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the footer stable and the latest long output above it in a 24-row terminal', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('line 30');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const finalLines = harness.screen.lines();
      const promptRows = finalLines.filter((line) => line.includes('❯'));
      const statusRows = finalLines.filter((line) => line.includes('project') && line.includes('%'));
      const line30Index = finalLines.findIndex((line) => line.includes('line 30'));
      const promptIndex = finalLines.findIndex((line) => line.includes('❯'));
      const statusIndex = finalLines.findIndex((line) => line.includes('project') && line.includes('%'));

      expect(promptRows).toHaveLength(1);
      expect(statusRows).toHaveLength(1);
      expect(line30Index).toBeGreaterThanOrEqual(0);
      expect(promptIndex).toBeGreaterThan(line30Index);
      expect(statusIndex).toBeGreaterThan(promptIndex);
      expect(finalLines.some((line) => line.includes('欢迎使用 xiaok code!'))).toBe(false);
      expect(finalLines.some((line) => line.includes('Thinking'))).toBe(false);
      expect(finalLines.some((line) => line.includes('Answering'))).toBe(false);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the footer and thinking rail visible when a second turn starts after output has already reached the footer boundary', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('line 30');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('延迟回复');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const line30Index = lines.findIndex((line) => normalizeAssistantLine(line) === 'line 30');
        const submittedIndex = lines.findIndex((line) => line.includes('› 延迟回复'));
        const activityIndex = lines.findIndex((line) => /Thinking|Exploring codebase|Tracing references|Running command|Working/u.test(line));
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'));
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const statusIndex = statusRows.at(-1)?.index ?? -1;

        expect(line30Index).toBeGreaterThanOrEqual(0);
        expect(submittedIndex).toBeGreaterThan(line30Index);
        expect(activityIndex).toBeGreaterThan(submittedIndex);
        expect(promptRows).toHaveLength(1);
        expect(statusRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(promptIndex).toBeGreaterThan(activityIndex);
        expect(lines.slice(activityIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
        expect(lines.some((line) => line.includes('delayed reply'))).toBe(false);
      }, { timeoutMs: 1_200 });

      await waitFor(() => {
        expect(harness.screen.text()).toContain('delayed reply');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps footer chrome visible during a dense multi-command tool run after transcript output has already reached the footer boundary', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-dense-command-footer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const projectSettingsDir = join(projectDir, '.xiaok');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(printf *)'],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('line 30');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('很多命令后慢命令');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(lines.some((line) => line.includes('› 很多命令后慢命令'))).toBe(true);
        expect(harness.output.normalized).toContain('我先顺着引用把命令跑一遍。');
        expect(harness.output.normalized).toContain('cd /Users/song/.xiaok/skills/kai-report-creator/assets');
        expect(harness.output.normalized).toContain('printf "" && sleep 6');
        expect(lines.some((line) => /Running command|Executing command/u.test(line))).toBe(true);
      }, { timeoutMs: 2_500 });

      const realDateNow = Date.now.bind(Date);
      const acceleratedClockStartedAt = realDateNow();
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        const now = realDateNow();
        return now + 46_000 + Math.floor((now - acceleratedClockStartedAt) * 25);
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 3_200));

        const lines = harness.screen.lines();
        const activityIndex = lines.findIndex((line) => line.includes('Waiting for command output'));
        const noteCount = countOccurrences(harness.output.normalized, 'Still working: waiting for command output');
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'));
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const statusIndex = statusRows.at(-1)?.index ?? -1;

        expect(activityIndex).toBeGreaterThanOrEqual(0);
        expect(noteCount).toBeGreaterThanOrEqual(3);
        expect(promptRows).toHaveLength(1);
        expect(statusRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(promptIndex).toBeGreaterThan(activityIndex);
        expect(statusIndex).toBeGreaterThan(promptIndex);
      } finally {
        dateNowSpy.mockRestore();
      }

      await waitFor(() => {
        expect(harness.screen.text()).toContain('很多命令完成');
      }, { timeoutMs: 8_000 });
      await waitForInputTurnReady(harness);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the footer singular during a narrow complex report intent while changed and long ran blocks are visible', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-narrow-report-footer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const projectSettingsDir = join(projectDir, '.xiaok');
    const projectFiles = reportIntentFixtureNames.map((name) => join(projectDir, name));
    const reportPrompt = `根据这些文档 ${projectFiles.join('、')} 合并生成 md，然后生成报告`;
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    reportIntentFixtureNames.forEach((name, index) => {
      writeFileSync(projectFiles[index]!, loadReportIntentFixture(name), 'utf8');
    });
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(*)', `write(${projectDir}/*)`],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_PROJECT_FILE_A = projectFiles[0];
    process.env.XIAOK_TEST_PROJECT_FILE_B = projectFiles[1];
    process.env.XIAOK_TEST_PROJECT_FILE_C = projectFiles[2];
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(60, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send(reportPrompt);
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'));
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const statusIndex = statusRows.at(-1)?.index ?? -1;

        expect(harness.output.normalized).toContain('Wrote report-analysis.report.md');
        expect(harness.output.normalized).toContain('printf "const fs = require');
        expect(lines.some((line) => line.includes('Intent: md -> 报告'))).toBe(true);
        expect(lines.some((line) => /Running command|Executing command/u.test(line))).toBe(true);
        expect(promptRows).toHaveLength(1);
        expect(statusRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(lines[promptIndex]).not.toContain('Intent:');
      }, { timeoutMs: 4_000 });

      await waitFor(() => {
        expect(harness.output.normalized).toContain('三份文档已先合并为 Markdown，再生成报告。');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);

      const finalLines = harness.screen.lines();
      expectSingleFooter(finalLines);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_PROJECT_FILE_A;
      delete process.env.XIAOK_TEST_PROJECT_FILE_B;
      delete process.env.XIAOK_TEST_PROJECT_FILE_C;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the footer visible when a follow-up turn starts right after a completed complex intent', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-report-followup-footer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const projectSettingsDir = join(projectDir, '.xiaok');
    const projectFiles = reportIntentFixtureNames.map((name) => join(projectDir, name));
    const reportPrompt = `根据这些文档 ${projectFiles.join('、')} 合并生成 md，然后生成报告`;
    const longFollowupPrompt = '报告后慢速长续问，请补充制造业与 SaaS 的差异、风险、建议和下一步行动';
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    reportIntentFixtureNames.forEach((name, index) => {
      writeFileSync(projectFiles[index]!, loadReportIntentFixture(name), 'utf8');
    });
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(*)', `write(${projectDir}/*)`],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_PROJECT_FILE_A = projectFiles[0];
    process.env.XIAOK_TEST_PROJECT_FILE_B = projectFiles[1];
    process.env.XIAOK_TEST_PROJECT_FILE_C = projectFiles[2];
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(60, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send(reportPrompt);
      harness.send('\r');

      await waitFor(() => {
        expect(harness.output.normalized).toContain('三份文档已先合并为 Markdown，再生成报告。');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);

      harness.send(longFollowupPrompt);
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(harness.output.normalized).not.toContain(`echo:${longFollowupPrompt}`);
        expectActiveTurnFooter(lines);
        expect(lines.some((line) => line.includes('Intent:') && line.includes('Completed'))).toBe(false);
      }, { timeoutMs: 1_500 });

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(harness.output.normalized).toContain(`echo:${longFollowupPrompt}`);
        expectSingleFooter(lines);
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_PROJECT_FILE_A;
      delete process.env.XIAOK_TEST_PROJECT_FILE_B;
      delete process.env.XIAOK_TEST_PROJECT_FILE_C;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps footer spacing intact after the completed-intent feedback prompt runs between turns', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-feedback-footer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const sessionsDir = join(configDir, 'sessions');
    const sessionId = 'sess_feedback_footer_gap';
    const intentId = 'intent_feedback_footer_gap';
    const stageId = `${intentId}:stage:1`;
    const stepId = `${stageId}:step:compose`;
    const now = Date.now() - 20_000;
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    const intentDelegation = createEmptySessionIntentLedger(sessionId, now);
    intentDelegation.activeIntentId = intentId;
    intentDelegation.instanceId = 'inst_feedback_footer_gap';
    intentDelegation.intents.push({
      intentId,
      instanceId: 'inst_feedback_footer_gap',
      sessionId,
      rawIntent: '根据文档生成报告',
      normalizedIntent: '根据文档生成报告',
      providedSourcePaths: [],
      intentType: 'generate',
      deliverable: '报告',
      finalDeliverable: '报告',
      explicitConstraints: [],
      delegationBoundary: [],
      riskTier: 'medium',
      intentMode: 'single_stage',
      segmentationConfidence: 'high',
      templateId: 'test-template',
      stages: [
        {
          stageId,
          order: 0,
          label: '生成报告',
          intentType: 'generate',
          deliverable: '报告',
          templateId: 'test-template',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [
            {
              stepId,
              key: 'compose',
              order: 0,
              role: 'compose',
              skillName: 'report-skill',
              dependsOn: [],
              status: 'completed',
              riskTier: 'medium',
            },
          ],
          status: 'completed',
          activeStepId: stepId,
          structuralValidation: 'passed',
          semanticValidation: 'passed',
          needsFreshContextHandoff: false,
        },
      ],
      activeStageId: stageId,
      artifacts: [],
      steps: [
        {
          stepId,
          key: 'compose',
          order: 0,
          role: 'compose',
          skillName: 'report-skill',
          dependsOn: [],
          status: 'completed',
          riskTier: 'medium',
        },
      ],
      activeStepId: stepId,
      overallStatus: 'completed',
      attemptCount: 1,
      latestReceipt: 'Completed 报告',
      createdAt: now,
      updatedAt: now,
    });
    intentDelegation.latestPlan = intentDelegation.intents[0] ?? null;

    const skillEval = createEmptySessionSkillEvalState(now);
    skillEval.observations.push({
      observationId: `${stepId}:skill_eval`,
      sessionId,
      intentId,
      stageId,
      stepId,
      intentType: 'generate',
      stageRole: 'compose',
      deliverable: '报告',
      deliverableFamily: 'document',
      selectedSkillName: 'report-skill',
      actualSkillName: 'report-skill',
      status: 'completed',
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      createdAt: now,
      updatedAt: now,
    });

    writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify({
      schemaVersion: 1,
      sessionId,
      cwd: projectDir,
      createdAt: now - 5_000,
      updatedAt: now,
      lineage: [sessionId],
      messages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation,
      skillEval,
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.output.normalized;
        expect(text).toContain('line 30');
        expect(text).toContain('[xiaok]');
        expect(text).toContain('跳过');
      }, { timeoutMs: 4_000 });

      await waitFor(() => {
        const lines = harness.screen.lines();
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const summaryRows = lines.filter((line) => line.includes('Intent:'));
        let blankRows = 0;
        let cursor = promptIndex - 1;

        while (cursor >= 0 && lines[cursor] === '') {
          blankRows += 1;
          cursor -= 1;
        }

        expect(promptRows).toHaveLength(1);
        expect(cursor).toBeGreaterThanOrEqual(0);
        expect(promptIndex).toBe(22);
        expect(blankRows).toBeGreaterThanOrEqual(2);
        expect(lines.slice(0, cursor + 1).some((line) => line.includes('[xiaok]'))).toBe(true);
        expect(lines.slice(0, cursor + 1).some((line) => line.includes('跳过'))).toBe(true);
        expect(summaryRows).toHaveLength(0);
      }, { timeoutMs: 1_500 });

      harness.send('s');
      harness.send('\r');
      await waitForInputTurnReady(harness);

      harness.send('延迟回复');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const submittedIndex = lines.findIndex((line) => line.includes('› 延迟回复'));
        const activityIndex = lines.findIndex((line) => /Thinking|Exploring codebase|Tracing references|Running command|Working/u.test(line));
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line, index }) => line.includes('❯') && statusRows.some((row) => row.index === index + 1));
        const promptIndex = promptRows.at(-1)?.index ?? -1;

        expect(lines.some((line) => line.includes('[xiaok]'))).toBe(false);
        expect(submittedIndex).toBeGreaterThanOrEqual(0);
        expect(activityIndex).toBeGreaterThan(submittedIndex);
        expect(promptRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(lines.slice(activityIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
        expect(lines[promptIndex]).toContain('Finishing response...');
        expect(lines.some((line) => line.includes('delayed reply'))).toBe(false);
      }, { timeoutMs: 1_500 });

      await waitFor(() => {
        expect(harness.screen.text()).toContain('delayed reply');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);

      harness.send('多行结尾测试');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const secondSubmittedIndex = lines.findIndex((line) => line.includes('› 多行结尾测试'));
        const secondTailIndex = lines.findIndex((line) => normalizeAssistantLine(line) === '想吃点重口还是清淡的？');
        const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));

        expect(lines.some((line) => line.includes('[xiaok]'))).toBe(false);
        expect(secondSubmittedIndex).toBeGreaterThanOrEqual(0);
        expect(secondTailIndex).toBeGreaterThan(secondSubmittedIndex);
        expect(promptIndex).toBeGreaterThanOrEqual(secondTailIndex + 3);
        expect(lines.slice(secondTailIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 30_000);

  it('keeps the footer singular when a feedback-skipped session immediately starts a new intent with consecutive ran blocks', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-feedback-intent-ran-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const projectSettingsDir = join(projectDir, '.xiaok');
    const sessionsDir = join(configDir, 'sessions');
    const projectFiles = reportIntentFixtureNames.map((name) => join(projectDir, name));
    const reportPrompt = `根据这些文档 ${projectFiles.join('、')} 合并生成 md，然后生成报告`;
    const sessionId = 'sess_feedback_footer_gap_ran';
    const intentId = 'intent_feedback_footer_gap_ran';
    const stageId = `${intentId}:stage:1`;
    const stepId = `${stageId}:step:compose`;
    const now = Date.now() - 20_000;
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    reportIntentFixtureNames.forEach((name, index) => {
      writeFileSync(projectFiles[index]!, loadReportIntentFixture(name), 'utf8');
    });
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(*)', `write(${projectDir}/*)`],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    const intentDelegation = createEmptySessionIntentLedger(sessionId, now);
    intentDelegation.activeIntentId = intentId;
    intentDelegation.instanceId = 'inst_feedback_footer_gap_ran';
    intentDelegation.intents.push({
      intentId,
      instanceId: 'inst_feedback_footer_gap_ran',
      sessionId,
      rawIntent: '根据文档生成报告',
      normalizedIntent: '根据文档生成报告',
      providedSourcePaths: [],
      intentType: 'generate',
      deliverable: '报告',
      finalDeliverable: '报告',
      explicitConstraints: [],
      delegationBoundary: [],
      riskTier: 'medium',
      intentMode: 'single_stage',
      segmentationConfidence: 'high',
      templateId: 'test-template',
      stages: [
        {
          stageId,
          order: 0,
          label: '生成报告',
          intentType: 'generate',
          deliverable: '报告',
          templateId: 'test-template',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [
            {
              stepId,
              key: 'compose',
              order: 0,
              role: 'compose',
              skillName: 'report-skill',
              dependsOn: [],
              status: 'completed',
              riskTier: 'medium',
            },
          ],
          status: 'completed',
          activeStepId: stepId,
          structuralValidation: 'passed',
          semanticValidation: 'passed',
          needsFreshContextHandoff: false,
        },
      ],
      activeStageId: stageId,
      artifacts: [],
      steps: [
        {
          stepId,
          key: 'compose',
          order: 0,
          role: 'compose',
          skillName: 'report-skill',
          dependsOn: [],
          status: 'completed',
          riskTier: 'medium',
        },
      ],
      activeStepId: stepId,
      overallStatus: 'completed',
      attemptCount: 1,
      latestReceipt: 'Completed 报告',
      createdAt: now,
      updatedAt: now,
    });
    intentDelegation.latestPlan = intentDelegation.intents[0] ?? null;

    const skillEval = createEmptySessionSkillEvalState(now);
    skillEval.observations.push({
      observationId: `${stepId}:skill_eval`,
      sessionId,
      intentId,
      stageId,
      stepId,
      intentType: 'generate',
      stageRole: 'compose',
      deliverable: '报告',
      deliverableFamily: 'document',
      selectedSkillName: 'report-skill',
      actualSkillName: 'report-skill',
      status: 'completed',
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      createdAt: now,
      updatedAt: now,
    });

    writeFileSync(join(sessionsDir, `${sessionId}.json`), JSON.stringify({
      schemaVersion: 1,
      sessionId,
      cwd: projectDir,
      createdAt: now - 5_000,
      updatedAt: now,
      lineage: [sessionId],
      messages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation,
      skillEval,
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_PROJECT_FILE_A = projectFiles[0];
    process.env.XIAOK_TEST_PROJECT_FILE_B = projectFiles[1];
    process.env.XIAOK_TEST_PROJECT_FILE_C = projectFiles[2];
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.output.normalized;
        expect(text).toContain('line 30');
        expect(text).toContain('[xiaok] 这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
      }, { timeoutMs: 4_000 });

      harness.send('s');
      harness.send('\r');
      await waitForInputTurnReady(harness);

      harness.send(reportPrompt);
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line, index }) => line.includes('❯') && statusRows.some((row) => row.index === index + 1));
        const summaryRows = lines.filter((line) => line.includes('Intent:'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const statusIndex = statusRows.at(-1)?.index ?? -1;

        expect(harness.output.normalized).toContain('Read 01-market-overview.md');
        expect(harness.output.normalized).toContain('Read 02-customer-signals.txt');
        expect(harness.output.normalized).toContain('Read 03-execution-risks.txt');
        expect(harness.output.normalized).toContain('E2E_RUNTIME_MERGED_MD');
        expect(promptRows).toHaveLength(1);
        expect(statusRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(lines[promptIndex]).not.toContain('Intent:');
        expect(summaryRows.length).toBeLessThanOrEqual(1);
        if (summaryRows[0]) {
          expect(summaryRows[0]).not.toContain('Completed');
        }
      }, { timeoutMs: 4_000 });

      await waitFor(() => {
        expect(harness.screen.text()).toContain('三份文档已先合并为 Markdown，再生成报告。');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);

      const finalLines = harness.screen.lines();
      expectSingleFooter(finalLines);
      expect(finalLines.some((line) => line.includes('Intent:'))).toBe(false);
      expect(finalLines.some((line) => line.includes('Completed') && line.includes('Intent:'))).toBe(false);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_PROJECT_FILE_A;
      delete process.env.XIAOK_TEST_PROJECT_FILE_B;
      delete process.env.XIAOK_TEST_PROJECT_FILE_C;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 20_000);

  it('keeps the footer singular after confirming feedback and then immediately starting a new complex intent', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-feedback-intent-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    const projectSettingsDir = join(projectDir, '.xiaok');
    const sessionsDir = join(configDir, 'sessions');
    const projectFiles = reportIntentFixtureNames.map((name) => join(projectDir, name));
    const reportPrompt = `根据这些文档 ${projectFiles.join('、')} 合并生成 md，然后生成报告`;
    const sessionId = 'sess_feedback_footer_gap_confirm';
    const intentId = 'intent_feedback_footer_gap_confirm';
    const stageId = `${intentId}:stage:1`;
    const stepId = `${stageId}:step:compose`;
    const now = Date.now() - 20_000;
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(projectSettingsDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    reportIntentFixtureNames.forEach((name, index) => {
      writeFileSync(projectFiles[index]!, loadReportIntentFixture(name), 'utf8');
    });
    writeFileSync(join(projectSettingsDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['bash(*)', `write(${projectDir}/*)`],
      },
    }, null, 2));
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    const intentDelegation = createEmptySessionIntentLedger(sessionId, now);
    intentDelegation.activeIntentId = intentId;
    intentDelegation.instanceId = 'inst_feedback_footer_gap_confirm';
    intentDelegation.intents.push({
      intentId,
      instanceId: 'inst_feedback_footer_gap_confirm',
      sessionId,
      rawIntent: '根据文档生成报告',
      normalizedIntent: '根据文档生成报告',
      providedSourcePaths: [],
      intentType: 'generate',
      deliverable: '报告',
      finalDeliverable: '报告',
      explicitConstraints: [],
      delegationBoundary: [],
      riskTier: 'medium',
      intentMode: 'single_stage',
      segmentationConfidence: 'high',
      templateId: 'test-template',
      stages: [
        {
          stageId,
          order: 0,
          label: '生成报告',
          intentType: 'generate',
          deliverable: '报告',
          templateId: 'test-template',
          riskTier: 'medium',
          dependsOnStageIds: [],
          steps: [
            {
              stepId,
              key: 'compose',
              order: 0,
              role: 'compose',
              skillName: 'report-skill',
              dependsOn: [],
              status: 'completed',
              riskTier: 'medium',
            },
          ],
          status: 'completed',
          activeStepId: stepId,
          structuralValidation: 'passed',
          semanticValidation: 'passed',
          needsFreshContextHandoff: false,
        },
      ],
      activeStageId: stageId,
      artifacts: [],
      steps: [
        {
          stepId,
          key: 'compose',
          order: 0,
          role: 'compose',
          skillName: 'report-skill',
          dependsOn: [],
          status: 'completed',
          riskTier: 'medium',
        },
      ],
      activeStepId: stepId,
      overallStatus: 'completed',
      attemptCount: 1,
      latestReceipt: 'Completed 报告',
      createdAt: now,
      updatedAt: now,
    });
    intentDelegation.latestPlan = intentDelegation.intents[0] ?? null;

    const skillEval = createEmptySessionSkillEvalState(now);
    skillEval.observations.push({
      observationId: `${stepId}:skill_eval`,
      sessionId,
      intentId,
      stageId,
      stepId,
      intentType: 'generate',
      stageRole: 'compose',
      deliverable: '报告',
      deliverableFamily: 'document',
      selectedSkillName: 'report-skill',
      actualSkillName: 'report-skill',
      status: 'completed',
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      createdAt: now,
      updatedAt: now,
    });

    const sessionPath = join(sessionsDir, `${sessionId}.json`);
    writeFileSync(sessionPath, JSON.stringify({
      schemaVersion: 1,
      sessionId,
      cwd: projectDir,
      createdAt: now - 5_000,
      updatedAt: now,
      lineage: [sessionId],
      messages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation,
      skillEval,
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_TEST_PROJECT_FILE_A = projectFiles[0];
    process.env.XIAOK_TEST_PROJECT_FILE_B = projectFiles[1];
    process.env.XIAOK_TEST_PROJECT_FILE_C = projectFiles[2];
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.output.normalized;
        expect(text).toContain('line 30');
        expect(text).toContain('[xiaok] 这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
      }, { timeoutMs: 4_000 });

      harness.send('y');
      harness.send('\r');
      await waitForInputTurnReady(harness);

      await waitFor(() => {
        const persistedSession = JSON.parse(readFileSync(sessionPath, 'utf8')) as {
          skillEval?: {
            promptedIntentIds?: string[];
            feedback?: Array<{ intentId: string; sentiment: string }>;
          };
        };
        const persistedSkillEval = persistedSession.skillEval;

        expect(persistedSkillEval?.promptedIntentIds).toContain(intentId);
        expect(persistedSkillEval?.feedback).toHaveLength(1);
        expect(persistedSkillEval?.feedback?.[0]).toMatchObject({
          intentId,
          sentiment: 'positive',
        });
      }, { timeoutMs: 2_000 });

      await waitFor(() => {
        const lines = harness.screen.lines();
        expectSingleFooter(lines);
        expect(lines.some((line) => line.includes('[xiaok]'))).toBe(false);
        expect(lines.some((line) => line.includes('Intent:') && line.includes('Completed'))).toBe(false);
      }, { timeoutMs: 1_500 });

      harness.send(reportPrompt);
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        const promptRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('❯'));
        const statusRows = lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes('project') && line.includes('%'));
        const summaryRows = lines.filter((line) => line.includes('Intent:'));
        const promptIndex = promptRows.at(-1)?.index ?? -1;
        const statusIndex = statusRows.at(-1)?.index ?? -1;

        expect(harness.output.normalized).toContain('Read 01-market-overview.md');
        expect(harness.output.normalized).toContain('Read 02-customer-signals.txt');
        expect(harness.output.normalized).toContain('Read 03-execution-risks.txt');
        expect(harness.output.normalized).toContain('E2E_RUNTIME_MERGED_MD');
        expect(promptRows).toHaveLength(1);
        expect(statusRows).toHaveLength(1);
        expect(promptIndex).toBe(22);
        expect(statusIndex).toBe(23);
        expect(lines[promptIndex]).not.toContain('Intent:');
        expect(summaryRows.length).toBeLessThanOrEqual(1);
        if (summaryRows[0]) {
          expect(summaryRows[0]).not.toContain('Completed');
        }
      }, { timeoutMs: 4_000 });

      await waitFor(() => {
        expect(harness.screen.text()).toContain('三份文档已先合并为 Markdown，再生成报告。');
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);

      harness.send('确认反馈后继续追问');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(harness.output.normalized).toContain('echo:确认反馈后继续追问');
        expectSingleFooter(lines);
        expect(lines.some((line) => line.includes('Intent:') && line.includes('Completed'))).toBe(false);
      }, { timeoutMs: 4_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      delete process.env.XIAOK_TEST_PROJECT_FILE_A;
      delete process.env.XIAOK_TEST_PROJECT_FILE_B;
      delete process.env.XIAOK_TEST_PROJECT_FILE_C;
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 30_000);

  it('treats free-form input typed into the completed-intent feedback prompt as the next user turn', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-feedback-freeform-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const sessionId = 'sess_feedback_prompt_freeform';
    const { configDir, projectDir, sessionPath, intentId } = writeCompletedFeedbackResumeSessionFixture(rootDir, sessionId);
    tempDirs.push(rootDir);

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.output.normalized;
        expect(text).toContain('line 30');
        expect(text).toContain('[xiaok] 这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
      }, { timeoutMs: 4_000 });

      harness.send('吃什么');
      harness.send('\r');

      await waitFor(() => {
        const lines = harness.screen.lines();
        expect(harness.output.normalized).toContain('echo:吃什么');
        expect(lines.some((line) => line.includes('echo:吃什么'))).toBe(true);
        expectSingleFooter(lines);
        expect(lines.some((line) => line.includes('[xiaok]'))).toBe(false);
        expect(lines.some((line) => line.includes('Intent:') && line.includes('Completed'))).toBe(false);
      }, { timeoutMs: 4_000 });

      await waitFor(() => {
        const persistedSession = JSON.parse(readFileSync(sessionPath, 'utf8')) as {
          skillEval?: {
            promptedIntentIds?: string[];
            feedback?: Array<{ intentId: string; sentiment: string }>;
          };
        };
        const persistedSkillEval = persistedSession.skillEval;

        expect(persistedSkillEval?.promptedIntentIds).toContain(intentId);
        expect(persistedSkillEval?.feedback ?? []).toHaveLength(0);
      }, { timeoutMs: 2_000 });

      await waitForInputTurnReady(harness);
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 20_000);

  it('exits cleanly when ctrl+c is pressed while the completed-intent feedback prompt is active', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-feedback-ctrlc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const sessionId = 'sess_feedback_prompt_ctrlc';
    const { configDir, projectDir } = writeCompletedFeedbackResumeSessionFixture(rootDir, sessionId);
    tempDirs.push(rootDir);

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat', '--resume', sessionId]);

      await waitForInputTurnReady(harness);

      harness.send('输出30行');
      harness.send('\r');

      await waitFor(() => {
        const text = harness.output.normalized;
        expect(text).toContain('line 30');
        expect(text).toContain('[xiaok] 这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
      }, { timeoutMs: 4_000 });

      harness.send('\x03');
      await pending;

      expect(harness.output.normalized).toContain('已退出。');
      expect(harness.output.normalized).not.toContain('echo:输出30行');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 20_000);

  it('keeps the latest turn tail lines intact when earlier transcript blocks are still competing for the 24-row viewport', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('分三次显示123');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('3');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('分四次显示1234');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('4');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('分五次显示12345');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('5');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      const lines = harness.screen.lines();
      expectNoTransientChrome(lines);
      expectSingleFooter(lines);
      const secondPromptIndex = findLineIndex(lines, '› 分四次显示1234');
      const secondTailIndex = lines.findIndex((line) => normalizeAssistantLine(line) === '4');
      const thirdPromptIndex = findLineIndex(lines, '› 分五次显示12345');
      const thirdTailIndex = lines.findIndex((line) => normalizeAssistantLine(line) === '5');

      expect(secondPromptIndex).toBeGreaterThan(-1);
      expect(secondTailIndex).toBeGreaterThan(secondPromptIndex);
      expect(thirdPromptIndex).toBeGreaterThan(secondTailIndex);
      expect(thirdTailIndex).toBeGreaterThan(thirdPromptIndex);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the previous assistant tail visible after the next turn finishes', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('hi');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('echo:hi');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      {
        const lines = harness.screen.lines();
        const answerIndex = lines.findIndex((line) => normalizeAssistantLine(line) === 'echo:hi');
        const promptIndex = lines.findIndex((line) => line.includes('❯ Type your message...'));
        expect(answerIndex).toBeGreaterThanOrEqual(0);
        expect(promptIndex).toBeGreaterThanOrEqual(answerIndex + 3);
        expect(lines.slice(answerIndex + 1, promptIndex).filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
      }

      harness.send('next');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('echo:next');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);
      {
        const lines = harness.screen.lines();
        const firstAnswerIndex = lines.findIndex((line) => normalizeAssistantLine(line) === 'echo:hi');
        const submittedIndex = lines.findIndex((line) => line.includes('› next'));
        const secondAnswerIndex = lines.findIndex((line) => normalizeAssistantLine(line) === 'echo:next');
        expect(firstAnswerIndex).toBeGreaterThanOrEqual(0);
        expect(submittedIndex).toBeGreaterThan(firstAnswerIndex);
        expect(secondAnswerIndex).toBeGreaterThan(submittedIndex);
        expect(lines[firstAnswerIndex + 1]).toBe('');
      }
      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('does not clear the content region before writing the first submitted input', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 24);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('延迟回复');
      const rawBeforeSubmit = harness.output.raw;
      harness.send('\r');

      await waitFor(() => {
        expect(harness.screen.text()).toContain('› 延迟回复');
      }, { timeoutMs: 400 });

      const duringDelay = harness.screen.lines();
      const submittedIndex = findLineIndex(duringDelay, '› 延迟回复');
      const postSubmitRaw = harness.output.raw.slice(rawBeforeSubmit.length);
      expect(postSubmitRaw).not.toContain('\x1b[1;1H\x1b[2K\x1b[2;1H\x1b[2K');
      expect(submittedIndex).toBeGreaterThanOrEqual(0);
      expect(duringDelay.some((line) => line.includes('delayed reply'))).toBe(false);

      await waitFor(() => {
        expect(harness.screen.text()).toContain('delayed reply');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);

  it('keeps the last line of a multiline assistant reply visible after the next submitted input', async () => {
    const rootDir = join(tmpdir(), `xiaok-chat-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const configDir = join(rootDir, 'config');
    const projectDir = join(rootDir, 'project');
    tempDirs.push(rootDir);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: {
        claude: { model: 'claude-test' },
      },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }, null, 2));

    process.env.XIAOK_CONFIG_DIR = configDir;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const { registerChatCommands } = await import('../../src/commands/chat.js');
    const harness = createTtyHarness(120, 30);
    const sigintListeners = process.listeners('SIGINT');
    const stdoutResizeListeners = process.stdout.listeners('resize');

    try {
      const program = new Command();
      registerChatCommands(program);

      const pending = program.parseAsync(['node', 'xiaok', 'chat']);

      await waitForInputTurnReady(harness);

      harness.send('多行结尾测试');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('想吃点重口还是清淡的？');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      harness.send('辣的续问');
      harness.send('\r');
      await waitFor(() => {
        expect(harness.screen.text()).toContain('辣的午餐：');
      }, { timeoutMs: 3_000 });
      await waitForInputTurnReady(harness);

      {
        const lines = harness.screen.lines();
        const tailIndex = lines.findIndex((line) => normalizeAssistantLine(line) === '想吃点重口还是清淡的？');
        const submittedIndex = lines.findIndex((line) => line.includes('› 辣的续问'));
        const secondAnswerIndex = lines.findIndex((line) => normalizeAssistantLine(line) === '辣的午餐：');

        expect(tailIndex).toBeGreaterThanOrEqual(0);
        expect(submittedIndex).toBeGreaterThan(tailIndex);
        expect(secondAnswerIndex).toBeGreaterThan(submittedIndex);
        expect(lines[tailIndex + 1]).toBe('');
      }

      harness.send('/exit');
      harness.send('\r');
      await pending;
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintListeners.includes(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
      for (const listener of process.stdout.listeners('resize')) {
        if (!stdoutResizeListeners.includes(listener)) {
          process.stdout.removeListener('resize', listener);
        }
      }
      harness.restore();
    }
  }, 15_000);
});
