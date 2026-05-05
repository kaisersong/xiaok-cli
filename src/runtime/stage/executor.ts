/**
 * Stage executor — analyzes intent, checks context, triggers subagents.
 *
 * Core flow:
 * 1. Analyze user intent → list of stages (reuses IntentPlanner)
 * 2. For each stage: check context → subagent if tight, inline if sufficient
 * 3. Subagent gets forkContext: undefined for clean context
 * 4. Collect debug events with timing for each phase
 */

import { readFileSync, statSync } from 'fs';
import { existsSync } from 'fs';
import type { SkillMeta, SkillResourceEntry } from '../../ai/skills/loader.js';
import type { ToolRegistry } from '../../ai/tools/index.js';
import type { ModelAdapter } from '../../types.js';
import type { CustomAgentDef } from '../../ai/agents/loader.js';
import { executeNamedSubAgent } from '../../ai/agents/subagent-executor.js';
import type { StageDef, StageResult, StageTiming, DebugEvent, StageOutput, StageExecutionResult } from './types.js';

const EXECUTION_BUFFER = 4000;
const SUBAGENT_THRESHOLD_RATE = 0.60;

export interface StageExecutorDeps {
  adapter: () => ModelAdapter;
  createRegistry: (cwd: string, allowedTools?: string[], agentId?: string) => ToolRegistry;
  buildSystemPrompt: (cwd: string) => Promise<string>;
  skills: SkillMeta[];
  sessionId: string;
  cwd: string;
  contextLimit: number;
  currentTokens: number;
}

export async function executeStagedSkill(
  userInput: string,
  deps: StageExecutorDeps,
): Promise<StageOutput> {
  const debugEvents: DebugEvent[] = [];

  // === Intent Analysis ===
  const t0 = now();
  const stages = analyzeIntent(userInput, deps.skills, deps.cwd);
  debugEvents.push({
    timestamp: Date.now(),
    phase: 'intent_analysis',
    detail: `Detected ${stages.length} stages: ${stages.map(s => s.title).join(', ')}`,
    durationMs: now() - t0,
    level: 'info',
  });

  if (stages.length === 0) {
    return { stages: [], results: [], debugEvents };
  }

  const results: StageResult[] = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const stageLabel = `${i + 1}/${stages.length}`;

    // Skip if previous stage failed
    if (results.length > 0 && results[results.length - 1].status === 'failed') {
      results.push({
        stage,
        status: 'skipped',
        timing: emptyTiming(),
        debugEvents: [],
        error: 'Skipped due to previous stage failure',
      });
      continue;
    }

    // === Context Check ===
    const t1 = now();
    const skill = deps.skills.find(s => s.name === stage.skill);
    const skillSize = skill ? skill.content.length : 0;
    const refsSize = skill ? totalRefsSize(skill.referencesManifest) : 0;
    const useSubagent = shouldUseSubagent(deps.currentTokens, deps.contextLimit, skillSize, refsSize);

    debugEvents.push({
      timestamp: Date.now(),
      phase: 'context_check',
      stage: stageLabel,
      detail: useSubagent
        ? `context ${Math.round(deps.currentTokens / deps.contextLimit * 100)}% used → switching to subagent`
        : `context ${Math.round(deps.currentTokens / deps.contextLimit * 100)}% used → inline execution`,
      durationMs: now() - t1,
      level: useSubagent ? 'warn' : 'info',
    });

    if (useSubagent) {
      const result = await executeInSubagent(stage, skill, deps);
      result.debugEvents = debugEvents.filter(e => e.stage === stageLabel);
      results.push(result);
    } else {
      // For now, always use subagent for skill execution to ensure clean context
      // Inline path will be added later when needed
      const result = await executeInSubagent(stage, skill, deps);
      result.debugEvents = debugEvents.filter(e => e.stage === stageLabel);
      results.push(result);
    }
  }

  return { stages, results, debugEvents };
}

async function executeInSubagent(
  stage: StageDef,
  skill: SkillMeta | undefined,
  deps: StageExecutorDeps,
): Promise<StageResult> {
  const timing = emptyTiming();
  const stageLabel = stage.id;

  try {
    // Build minimal system prompt for subagent (no conversation history)
    const systemPrompt = buildStageSystemPrompt(stage, skill);

    const prompt = `Execute the skill "${stage.skill}" for this request: ${stage.title}${
      stage.inputFiles?.length ? `\nInput files: ${stage.inputFiles.join(', ')}` : ''
    }`;

    const agentDef: CustomAgentDef = {
      name: `stage-${stage.id}`,
      systemPrompt,
      allowedTools: skill?.allowedTools,
      model: skill?.model,
    };

    const tSpawn = now();
    const result = await executeNamedSubAgent({
      agentDef,
      prompt,
      sessionId: deps.sessionId,
      cwd: deps.cwd,
      adapter: deps.adapter,
      createRegistry: deps.createRegistry,
      buildSystemPrompt: deps.buildSystemPrompt,
      // CRITICAL: no forkContext → clean context, no conversation history
      forkContext: undefined,
    });
    timing.subagentSpawnMs = now() - tSpawn;
    timing.subagentExecMs = now() - tSpawn;

    timing.skillLoadMs = estimateSkillLoadTime(skill);
    timing.skillExecMs = timing.subagentExecMs - timing.skillLoadMs;

    return {
      stage,
      status: 'completed',
      timing,
      debugEvents: [],
    };
  } catch (error) {
    return {
      stage,
      status: 'failed',
      timing,
      debugEvents: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildStageSystemPrompt(stage: StageDef, skill: SkillMeta | undefined): string {
  const lines = [
    'You are executing a skill.',
    `Skill: ${stage.skill}`,
    `Request: ${stage.title}`,
  ];

  if (skill?.description) {
    lines.push(`Description: ${skill.description}`);
  }
  if (skill?.whenToUse) {
    lines.push(`When to use: ${skill.whenToUse}`);
  }
  if (stage.inputFiles?.length) {
    lines.push(`Input files: ${stage.inputFiles.join(', ')}`);
  }

  lines.push('');
  lines.push('Read the skill files and execute the task. Save your output to files.');
  lines.push('Do not ask for confirmation — just execute.');

  return lines.join('\n');
}

export function shouldUseSubagent(
  currentTokens: number,
  maxTokens: number,
  skillContentSize: number,
  skillRefsSize: number,
): boolean {
  const available = maxTokens - currentTokens;
  const estimatedNeeded = Math.ceil((skillContentSize + skillRefsSize) / 4) + EXECUTION_BUFFER;

  if (available < estimatedNeeded) {
    return true;
  }

  const usageRate = currentTokens / maxTokens;
  return usageRate > SUBAGENT_THRESHOLD_RATE;
}

function totalRefsSize(refs: SkillResourceEntry[]): number {
  return refs.reduce((sum, r) => sum + r.size, 0);
}

function estimateSkillLoadTime(skill: SkillMeta | undefined): number {
  if (!skill) return 0;
  const totalBytes = skill.content.length + totalRefsSize(skill.referencesManifest);
  // Rough estimate: ~100ms per KB of skill content
  return Math.ceil(totalBytes / 1000) * 100;
}

function emptyTiming(): StageTiming {
  return {
    totalMs: 0,
    contextCheckMs: 0,
    subagentSpawnMs: 0,
    subagentExecMs: 0,
    skillLoadMs: 0,
    skillExecMs: 0,
    artifactReadMs: 0,
  };
}

function now(): number {
  return performance.now();
}

/**
 * Analyze user intent to determine stages.
 * Uses rule-based matching on keywords — fast, no LLM call needed.
 */
export function analyzeIntent(userInput: string, skills: SkillMeta[], cwd: string): StageDef[] {
  const stages: StageDef[] = [];
  const input = userInput.toLowerCase();

  // Extract file paths from input
  const files = extractFilePaths(userInput);

  // Check for report generation
  if (hasKeyword(input, ['报告', 'report', '生成报告'])) {
    const reportSkill = skills.find(s => s.name === 'kai-report-creator');
    if (reportSkill) {
      stages.push({
        id: `${stages.length + 1}`,
        title: extractStageTitle(userInput, '报告'),
        skill: 'kai-report-creator',
        inputFiles: files,
      });
    }
  }

  // Check for slide generation
  if (hasKeyword(input, ['幻灯片', 'slides', 'ppt', '生成幻灯片', '生成ppt'])) {
    const slideSkill = skills.find(s => s.name === 'kai-slide-creator');
    if (slideSkill) {
      stages.push({
        id: `${stages.length + 1}`,
        title: extractStageTitle(userInput, '幻灯片'),
        skill: 'kai-slide-creator',
        inputFiles: files,
      });
    }
  }

  // Check for document generation
  if (hasKeyword(input, ['文档', 'document', 'docx', '生成文档'])) {
    const docSkill = skills.find(s => s.name === 'kai-docx-generator');
    if (docSkill) {
      stages.push({
        id: `${stages.length + 1}`,
        title: extractStageTitle(userInput, '文档'),
        skill: 'kai-docx-generator',
        inputFiles: files,
      });
    }
  }

  // Fallback: if no specific stages matched but user wants something done
  if (stages.length === 0 && skills.length > 0) {
    // Try to find the best matching skill based on input
    const bestSkill = findBestSkillMatch(input, skills);
    if (bestSkill) {
      stages.push({
        id: '1',
        title: userInput,
        skill: bestSkill.name,
        inputFiles: files,
      });
    }
  }

  return stages;
}

function hasKeyword(input: string, keywords: string[]): boolean {
  return keywords.some(kw => input.includes(kw.toLowerCase()));
}

function extractStageTitle(userInput: string, keyword: string): string {
  // Try to extract a meaningful title from the user input
  // For now, just return a cleaned version of the input
  const cleaned = userInput.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 50) {
    return cleaned.substring(0, 50) + '...';
  }
  return cleaned;
}

function extractFilePaths(input: string): string[] {
  // Simple path extraction: matches absolute paths
  const pathRegex = /(?:file:\/\/)?([\/][\w\/\.\-\%一-鿿]+\.(?:md|txt|json|html|csv|pdf))/g;
  const files: string[] = [];
  let match;
  while ((match = pathRegex.exec(input)) !== null) {
    files.push(match[1]);
  }
  return files;
}

function findBestSkillMatch(input: string, skills: SkillMeta[]): SkillMeta | null {
  let bestScore = 0;
  let bestSkill: SkillMeta | null = null;

  for (const skill of skills) {
    let score = 0;
    const desc = (skill.description || '').toLowerCase();
    const whenToUse = (skill.whenToUse || '').toLowerCase();
    const hints = JSON.stringify(skill.taskHints || {}).toLowerCase();

    const keywords = input.split(/\s+/);
    for (const keyword of keywords) {
      if (keyword.length < 2) continue;
      if (desc.includes(keyword)) score += 2;
      if (whenToUse.includes(keyword)) score += 1;
      if (hints.includes(keyword)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }

  return bestScore > 0 ? bestSkill : null;
}

export function formatDebugOutput(result: StageOutput): string {
  const lines: string[] = [];

  lines.push(`[xiaok] Skill execution: ${result.stages.map(s => s.title).join(' → ')}`);
  lines.push(`[stage:plan] Analyzing intent... (${result.debugEvents.find(e => e.phase === 'intent_analysis')?.durationMs ?? 0}ms)`);
  lines.push(`[stage:plan] Detected ${result.stages.length} stages:`);
  for (const stage of result.stages) {
    lines.push(`  ${stage.id}. ${stage.title} (${stage.skill})`);
  }
  lines.push('');

  for (const stageResult of result.results) {
    const label = `${stageResult.stage.id}/${result.stages.length}`;
    const timing = stageResult.timing;

    if (stageResult.status === 'skipped') {
      lines.push(`[stage:${label}] Skipped: ${stageResult.error ?? 'previous stage failed'}`);
      continue;
    }

    if (stageResult.status === 'failed') {
      lines.push(`[stage:${label}] FAILED: ${stageResult.error}`);
      continue;
    }

    // Context check info
    const ctx = stageResult.contextCheck;
    if (ctx) {
      const action = ctx.needsSubagent ? 'switching to subagent' : 'inline execution';
      lines.push(`[stage:${label}] Context check: ${ctx.usagePercent}% used, ${Math.round(ctx.estimatedNeeded / 4)} tokens needed, ${ctx.available} available → ${action}`);
    }

    lines.push(`[stage:${label}] Subagent spawned: skill=${stageResult.stage.skill} (${timing.subagentSpawnMs}ms)`);
    lines.push(`[stage:${label}] Skill load: ~${timing.skillLoadMs}ms (${stageResult.timing.skillLoadMs > 0 ? Math.round((ctx?.estimatedNeeded ?? 0) / 1000) : 0}KB)`);
    lines.push(`[stage:${label}] ✓ ${stageResult.stage.title} completed`);
    lines.push('');
  }

  const totalMs = result.results.reduce((sum, r) => sum + r.timing.totalMs, 0);
  lines.push(`[xiaok] Skill flow completed (${result.results.filter(r => r.status === 'completed').length}/${result.stages.length} stages)`);
  lines.push(`  Total: ${(totalMs / 1000).toFixed(1)}s`);

  return lines.join('\n');
}
export type { StageDef, StageTiming, DebugEvent, StageResult, StageOutput } from "./types.js";
