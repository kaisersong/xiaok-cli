import type { TaskSnapshot } from './types.js';
import type { CompletionEvidenceRecord, CompletionExpectation } from '../guards/completion-evidence.js';

export function collectArtifactEvidence(snapshot: TaskSnapshot): unknown[] {
  const resultArtifacts = snapshot.result?.artifacts ?? [];
  const eventArtifacts = snapshot.events.filter((event) => event.type === 'artifact_recorded');
  return [...resultArtifacts, ...eventArtifacts];
}

interface CompletionEvidenceContext {
  expectation?: CompletionExpectation;
  evidence: CompletionEvidenceRecord[];
}

export function buildCompletionEvidenceContext(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceContext {
  return {
    expectation: buildCompletionExpectation(taskId, snapshot),
    evidence: collectCompletionEvidence(taskId, snapshot),
  };
}

function buildCompletionExpectation(taskId: string, snapshot: TaskSnapshot): CompletionExpectation | undefined {
  const owner = { ownerKind: 'task' as const, ownerId: taskId };
  if (hasCreateProjectEvent(snapshot)) {
    return {
      ...owner,
      expectedKinds: ['project_update'],
      source: 'tool_schema',
      confidence: 'explicit',
    };
  }
  if (PROJECT_CREATION_PROMPT_PATTERN.test(snapshot.prompt)) {
    return {
      ...owner,
      expectedKinds: ['project_update'],
      source: 'task_spec',
      confidence: 'explicit',
    };
  }
  if (isKSwarmInternalAnswerPrompt(snapshot.prompt)) {
    return {
      ...owner,
      expectedKinds: ['answer'],
      source: 'kswarm_deliverable_type',
      confidence: 'explicit',
    };
  }
  if (isFileArtifactCompletionPrompt(snapshot.prompt)) {
    return {
      ...owner,
      expectedKinds: ['file_artifact'],
      source: 'task_spec',
      confidence: 'explicit',
    };
  }
  if (ANSWER_COMPLETION_PROMPT_PATTERN.test(snapshot.prompt)) {
    return {
      ...owner,
      expectedKinds: ['answer'],
      source: 'legacy_classifier',
      confidence: 'inferred',
    };
  }
  return undefined;
}

function collectCompletionEvidence(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceRecord[] {
  return [
    ...collectProjectUpdateEvidence(taskId, snapshot),
    ...collectFileArtifactCompletionEvidence(taskId, snapshot),
    ...collectAnswerCompletionEvidence(taskId, snapshot),
  ];
}

function collectAnswerCompletionEvidence(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceRecord[] {
  return snapshot.events.flatMap((event, index): CompletionEvidenceRecord[] => {
    if (event.type !== 'result') {
      return [];
    }
    const summary = event.result.summary.trim();
    if (!summary || isClarificationSummary(summary) || isBlockedSummary(summary)) {
      return [];
    }
    return [{
      ownerKind: 'task',
      ownerId: taskId,
      kind: 'answer',
      summary,
      metadata: {
        responseId: `${taskId}:result:${index}`,
      },
    }];
  });
}

function collectFileArtifactCompletionEvidence(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceRecord[] {
  const records: CompletionEvidenceRecord[] = [];
  for (const artifact of snapshot.result?.artifacts ?? []) {
    const uri = artifact.filePath?.trim() || `artifact://${artifact.artifactId}`;
    records.push({
      ownerKind: 'task',
      ownerId: taskId,
      kind: 'file_artifact',
      summary: artifact.title || artifact.artifactId,
      uri,
      metadata: {
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        ...(artifact.filePath ? { paths: [artifact.filePath] } : {}),
      },
    });
  }
  for (const event of snapshot.events) {
    if (event.type === 'artifact_recorded') {
      const uri = event.filePath.trim() || `artifact://${event.artifactId}`;
      records.push({
        ownerKind: 'task',
        ownerId: taskId,
        kind: 'file_artifact',
        summary: event.label || event.artifactId,
        uri,
        metadata: {
          artifactId: event.artifactId,
          kind: event.kind,
          ...(event.filePath.trim() ? { paths: [event.filePath.trim()] } : {}),
        },
      });
      continue;
    }
    if (event.type === 'canvas_file_changed' && event.filePath.trim()) {
      records.push({
        ownerKind: 'task',
        ownerId: taskId,
        kind: 'file_artifact',
        summary: `File changed: ${event.filePath}`,
        uri: event.filePath,
        metadata: { paths: [event.filePath] },
      });
      continue;
    }
  }
  const fileMutationFacts = new Map<string, Extract<TaskSnapshot['events'][number], { type: 'goal_tool_fact' }>>();
  const finishedTools = new Map<string, Extract<TaskSnapshot['events'][number], { type: 'goal_tool_finished' }>>();
  for (const event of snapshot.events) {
    if (event.type === 'goal_tool_fact' && event.factKind === 'file_mutation') {
      fileMutationFacts.set(event.invocationId, event);
    } else if (event.type === 'goal_tool_finished') {
      finishedTools.set(event.invocationId, event);
    }
  }
  for (const [invocationId, fact] of fileMutationFacts) {
    if (!finishedTools.get(invocationId)?.ok) continue;
    const paths = (fact.normalizedFilePaths ?? []).map(path => path.trim()).filter(Boolean);
    if (paths.length === 0) continue;
    records.push({
      ownerKind: 'task',
      ownerId: taskId,
      kind: 'file_artifact',
      summary: paths.join(', '),
      uri: paths[0],
      metadata: { paths },
    });
  }
  return dedupeEvidenceRecords(records);
}

function collectProjectUpdateEvidence(taskId: string, snapshot: TaskSnapshot): CompletionEvidenceRecord[] {
  const records: CompletionEvidenceRecord[] = [];
  for (const event of snapshot.events) {
    if (event.type !== 'canvas_tool_result' || event.toolName !== 'create_project' || !event.ok) {
      continue;
    }
    const project = parseProjectCreationResponse(event.response);
    if (!project) {
      continue;
    }
    records.push({
      ownerKind: 'task',
      ownerId: taskId,
      kind: 'project_update',
      summary: project.summary,
      metadata: {
        projectId: project.projectId,
        changedDeliverables: [project.changedDeliverable],
      },
    });
  }
  return records;
}

export function evidenceForExpectation(
  expectation: CompletionExpectation,
  evidence: CompletionEvidenceRecord[],
): CompletionEvidenceRecord[] {
  if (expectation.expectedKinds.includes('answer')) {
    return evidence;
  }
  // Keep answer evidence alongside the expected kinds so the guard's fallback path
  // can recognize substantive text completions even when the classifier asked for a
  // different deliverable kind.
  return evidence.filter(record =>
    record.kind === 'answer' || expectation.expectedKinds.includes(record.kind),
  );
}

function hasCreateProjectEvent(snapshot: TaskSnapshot): boolean {
  return snapshot.events.some(event =>
    (event.type === 'canvas_tool_call' || event.type === 'canvas_tool_result')
    && event.toolName === 'create_project',
  );
}

function parseProjectCreationResponse(response: string): {
  projectId: string;
  summary: string;
  changedDeliverable: string;
} | undefined {
  try {
    const parsed = JSON.parse(response) as { type?: unknown; projectId?: unknown; name?: unknown; error?: unknown };
    if (Object.prototype.hasOwnProperty.call(parsed, 'error')) {
      return undefined;
    }
    if (parsed.type !== 'project_card') {
      return undefined;
    }
    if (typeof parsed.projectId !== 'string' || parsed.projectId.trim().length === 0) {
      return undefined;
    }
    const projectId = parsed.projectId.trim();
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : projectId;
    return {
      projectId,
      summary: `Project card created: ${name}`,
      changedDeliverable: 'project_card',
    };
  } catch {
    return undefined;
  }
}

function isFileArtifactCompletionPrompt(prompt: string): boolean {
  const normalized = prompt.trim();
  if (
    !normalized
    || NO_FILE_ARTIFACT_PATTERN.test(normalized)
    || isExistingArtifactLookupPrompt(normalized)
  ) {
    return false;
  }
  if (FILE_ARTIFACT_COMPLETION_PATTERN.test(normalized)) {
    return true;
  }
  return STRONG_FILE_DELIVERABLE_PATTERN.test(normalized) && !ANSWER_COMPLETION_PROMPT_PATTERN.test(normalized);
}

export function shouldRequireArtifactEvidence(snapshot: TaskSnapshot): boolean {
  const prompt = snapshot.prompt.trim();
  if (!prompt) {
    return false;
  }

  // The current Desktop understanding builder is still sales-deck biased, so
  // the guard follows explicit user wording rather than inferred deliverable.
  if (OPERATIONAL_PROMPT_PATTERN.test(prompt)) {
    return false;
  }
  if (isExistingArtifactLookupPrompt(prompt)) {
    return false;
  }
  if (hasClarificationResult(snapshot)) {
    return false;
  }
  return ARTIFACT_PROMPT_PATTERN.test(prompt);
}

const OPERATIONAL_PROMPT_PATTERN = /(?:定时任务|提醒我|提醒|闹钟|reminder|schedule|scheduled|继续推进|推进项目|诊断.*项目|项目.*诊断|恢复项目|修复项目|KSwarm|continue_project|让小K帮忙|问小K|卡住|阻塞|stuck project|(?:验证|测试|诊断|检查).*(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use)|(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use).*(?:验证|测试|诊断|检查))/iu;

const ARTIFACT_PROMPT_PATTERN = /(?:ppt|pptx|幻灯片|演示文稿|slides?|deck|报告|文档|文章|故事|小故事|初稿|草稿|稿件|markdown|\.md\b|pdf|word|docx|excel|xlsx|表格|图表|图片|image|html|网页|文件|导出|保存为|生成.*(?:报告|文档|ppt|幻灯片|故事|文章|文件)|写.*(?:报告|文档|故事|文章|稿))/iu;

const PROJECT_CREATION_PROMPT_PATTERN = /(?:(?:创建|新建|发起|启动).{0,12}项目|create[_\s-]?project|create\s+a?\s*project|new\s+project)/iu;
const FILE_ARTIFACT_COMPLETION_PATTERN = /(?:(?:生成|创建|新建|制作|撰写|编写|导出|保存为|渲染|产出|输出|做一份|做一个|写一份|写一个|写|generate|create|write|draft|make|build|produce|export|render).{0,40}(?:pptx?|幻灯片|演示文稿|slides?|deck|报告|report|文档|document|docx|word|markdown|\.md\b|pdf|文件|file|产物|artifact|html|网页|excel|xlsx|表格|图表|图片|image|文章|帖子|故事|稿件|初稿|草稿)|(?:pptx?|幻灯片|演示文稿|slides?|deck|报告|report|文档|document|docx|word|markdown|\.md\b|pdf|文件|file|产物|artifact|html|网页|excel|xlsx|表格|图表|图片|image).{0,20}(?:生成|创建|新建|制作|撰写|编写|导出|保存|渲染|产出|输出|generate|create|write|draft|make|build|produce|export|render))/iu;
const STRONG_FILE_DELIVERABLE_PATTERN = /(?:pptx?|幻灯片|演示文稿|slides?|deck|报告|report|文档|document|docx|word|markdown|\.md\b|pdf|文件|file|产物|artifact)/iu;
const NO_FILE_ARTIFACT_PATTERN = /(?:(?:不需要|无需|不用|不要|别).{0,12}(?:生成|创建|新建|导出|保存|产出|输出|制作).{0,16}(?:文件|文档|报告|pptx?|幻灯片|slides?|产物|artifact|file|document|report)|(?:do\s+not|don't|dont)\s+(?:generate|create|export|write|make|produce)\s+(?:an?\s+)?(?:file|report|document|pptx?|slides?|deck|artifact)|no\s+(?:file|report|document|artifact)\s+(?:needed|required|necessary)|without\s+(?:exporting|generating|creating|writing|producing|making)\s+(?:an?\s+)?(?:file|report|document|pptx?|slides?|deck|artifact))/iu;
const ANSWER_COMPLETION_PROMPT_PATTERN = /(?:分析|解释|总结|概括|查看|诊断|状态|验证|定位|为什么|原因|评估|对比|检查|review|analy[sz]e|explain|summari[sz]e|status|diagnos|verify|validate|why|inspect|check)/iu;
const EXISTING_ARTIFACT_LOOKUP_PATTERN = /(?:在哪|哪里|目录|路径|位置|地址|怎么(?:复制|copy|打开|下载|拿到)|如何(?:复制|copy|打开|下载|拿到)|copy|复制|拷贝|打开|下载|拿到|给我.*(?:路径|目录|位置)|where|path|location|open|download|copy)/iu;
const ARTIFACT_REFERENCE_PATTERN = /(?:ppt|pptx|幻灯片|演示文稿|slides?|deck|报告|文档|markdown|\.md\b|pdf|word|docx|excel|xlsx|图片|image|html|网页|文件|产物|artifact)/iu;
const NEW_ARTIFACT_ACTION_PATTERN = /(?:生成|创建|新建|制作|做一份|做一个|写一份|写一个|撰写|编写|导出|保存为|渲染|generate|create|write|draft|make|build|produce|export|render)/iu;
const CLARIFICATION_RESULT_PATTERN = /(?:\?|？|请(?:告诉我|补充|提供|确认|选择)|还(?:差|需要)|需要(?:你|用户)?(?:提供|补充|确认|告诉)|主题是什么|(?:什么|哪个|哪种).*(?:主题|风格|内容|材料|文件|路径)|告诉我.*(?:主题|风格|内容|材料|文件|路径))/iu;
const COMPLETION_CLAIM_PATTERN = /(?:已(?:经)?(?:生成|完成|保存|创建|写好|导出|渲染)|生成完成|完成了|文件(?:已|已经)|pdf\s*已生成|ppt\s*已生成|报告(?:已经|已)?(?:写好|完成)|项目已创建成功)/iu;
const BLOCKED_RESULT_PATTERN = /(?:被阻塞|阻塞了|卡住了|无法完成|不能完成|未能完成|blocked|stuck|unable to complete|cannot complete)/iu;

function isKSwarmInternalAnswerPrompt(prompt: string): boolean {
  return prompt.startsWith('KSwarm PO 规划任务。')
    || prompt.startsWith('KSwarm PO 验收任务提交。')
    || prompt.startsWith('KSwarm 项目收尾。')
    || (prompt.startsWith('KSwarm 动态工作流节点执行。') && prompt.includes('你是 reviewer / adversarial agent。'));
}

function isExistingArtifactLookupPrompt(prompt: string): boolean {
  if (!EXISTING_ARTIFACT_LOOKUP_PATTERN.test(prompt)) {
    return false;
  }
  if (!ARTIFACT_REFERENCE_PATTERN.test(prompt)) {
    return false;
  }
  return !NEW_ARTIFACT_ACTION_PATTERN.test(prompt);
}

export function hasClarificationResult(snapshot: TaskSnapshot): boolean {
  const summary = snapshot.result?.summary?.trim() ?? '';
  return isClarificationSummary(summary);
}

function isClarificationSummary(summary: string): boolean {
  if (!summary) {
    return false;
  }
  if (!CLARIFICATION_RESULT_PATTERN.test(summary)) {
    return false;
  }
  // If the summary has completion claims, it's not purely clarification
  if (COMPLETION_CLAIM_PATTERN.test(summary)) {
    return false;
  }
  // Only treat as clarification if the summary is short and question-heavy
  // Longer responses with questions are likely explanations + clarification, not pure clarification
  const questionCount = (summary.match(/[?？]/g) || []).length;
  const sentenceCount = summary.split(/[。.!！\n]/).filter(s => s.trim().length > 10).length;
  // If more than 50% of sentences are questions, or if it's very short with questions, it's clarification
  if (summary.length < 150 && questionCount > 0) {
    return true;
  }
  if (sentenceCount > 0 && questionCount / sentenceCount > 0.5) {
    return true;
  }
  return false;
}

function isBlockedSummary(summary: string): boolean {
  return BLOCKED_RESULT_PATTERN.test(summary) && !COMPLETION_CLAIM_PATTERN.test(summary);
}

function dedupeEvidenceRecords(records: CompletionEvidenceRecord[]): CompletionEvidenceRecord[] {
  const seen = new Set<string>();
  const deduped: CompletionEvidenceRecord[] = [];
  for (const record of records) {
    const key = `${record.kind}:${record.uri ?? ''}:${record.summary}:${JSON.stringify(record.metadata ?? {})}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

export function isEmptyDelivery(snapshot: TaskSnapshot): boolean {
  const summary = snapshot.result?.summary?.trim() ?? '';
  const isFallbackSummary = !summary || summary === '模型没有返回内容。';
  const hasArtifacts = (snapshot.result?.artifacts?.length ?? 0) > 0;
  const hasRecordedArtifacts = snapshot.events.some((e) => e.type === 'artifact_recorded');
  const hasAssistantOutput = snapshot.events.some((e) => e.type === 'assistant_delta');
  return isFallbackSummary && !hasArtifacts && !hasRecordedArtifacts && !hasAssistantOutput;
}
