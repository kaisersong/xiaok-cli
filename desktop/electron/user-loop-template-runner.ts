import {createLoopTaskIdentityHost,createLoopTaskTerminalObserver,isLoopTaskCreationPending,type LoopReservedTaskPort} from './loop-task-identity.js';
import {createLoopTemplateExecutionRecovery} from './loop-template-execution-recovery.js';
import {captureLoopProducerValue} from './loop-scan-publication-body.js';
import {resolveUserLoopOutputTarget,verifyMarkdownFile} from './loop-template-files.js';
import {captureLoopRunContext,assertOrdinaryLoopOwner,type LoopRunContext} from './loop-run-context.js';
import type {LoopPublicationProducer} from './loop-store.js';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { accessSync, constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CompletionEvidenceStore } from './completion-evidence-store.js';
import type { CompletionOwnerKind } from './completion-evidence-types.js';
import {
  runAllowedLoopCommandCriterion,
  type LoopCommandAllowlist,
} from './loop-command-allowlist.js';
import {
  evaluateLoopContract,
  type LoopEvaluation,
  type LoopVerifierRegistry,
} from './loop-evaluator.js';
import { createLoopFinalizer, type LoopFinalizer } from './loop-finalizer.js';
import { isWeakOnlyBackgroundContract } from './loop-contract.js';
import type { LoopLLMPort } from './loop-llm-port.js';
import { extractViaLLM, extractViaRule } from './loop-llm-port.js';
import { LoopStore } from './loop-store.js';
import type { LearnedConstraint, LoopRun, LoopRunTrigger, UserLoopTemplate } from './loop-types.js';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';
import type { TaskCreateInput, TaskPermissionMode, TaskSnapshot } from '../../src/runtime/task-host/types.js';

export interface UserLoopTaskPort extends Partial<LoopReservedTaskPort> {
  createTask(input: TaskCreateInput): Promise<{ taskId: string }>;
  recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }>;
  cancelTask(taskId: string, reason?: string): Promise<void>;
}

export type UserLoopTemplateRunResult =
  | { status: 'publication_pending'|'executing'; run: LoopRun }
  | { status: 'success'; run: LoopRun }
  | { status: 'blocked'; run: LoopRun }
  | { status: 'failed'; run: LoopRun };

export interface CreateUserLoopTemplateRunnerOptions {
  acquireWriter?: (label: string) => { release(): void };
  loopStore: LoopStore;
  evidenceStore: CompletionEvidenceStore;
  taskPort: UserLoopTaskPort;
  finalizer?: LoopFinalizer;
  verifierRegistry?: LoopVerifierRegistry;
  commandAllowlist?: LoopCommandAllowlist;
  llmPort?: LoopLLMPort;
  onConstraintAdded?: (constraint: LearnedConstraint) => void;
  now?: () => number;
  pollIntervalMs?: number;
  maxRunMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunUserLoopTemplateInput {
  loopId: string;
  runId: string;
  trigger: LoopRunTrigger;
  requestSource:LoopRunContext['requestSource'];
  producer?:Readonly<LoopPublicationProducer>;
  signal?: AbortSignal;
}

export interface UserLoopTemplateRunner {
  recoverTemplateLoop?(input:{loopId:string;runId:string;requestSource:LoopRunContext['requestSource'];signal?:AbortSignal}):Promise<UserLoopTemplateRunResult>;
  runTemplateLoop(input: RunUserLoopTemplateInput): Promise<UserLoopTemplateRunResult> | UserLoopTemplateRunResult;
}

const DEFAULT_MAX_RUN_MS = 55 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
/**
 * Per-task host watchdog applied to user-loop template tasks. Must be larger
 * than DEFAULT_MAX_RUN_MS so the loop runner gets to call cancelTask before
 * the host's own watchdog fires.
 */
const DEFAULT_LOOP_TASK_WATCHDOG_MS = 65 * 60_000;

export function buildPromptWithConstraints(
  basePrompt: string,
  loopStore: LoopStore,
  loopId: string
): { prompt: string; injectedConstraintIds: string[] } {
  const active = loopStore.getActiveConstraints(loopId);
  if (!active.length) return { prompt: basePrompt, injectedConstraintIds: [] };

  const block = active.map((c, i) => `${i + 1}. ${c.rule}`).join('\n');
  const prompt = `${basePrompt}\n\n---\n以下规则必须遵守：\n${block}`;
  loopStore.bumpConstraintHits(active.map(c => c.id));
  return { prompt, injectedConstraintIds: active.map(c => c.id) };
}

export function runPreflight(template: UserLoopTemplate): { ok: true } | { ok: false; reason: string } {
  if (template.kind === 'markdown_file') {
    const dir = template.outputDirectory;
    if (!dir || !isAbsolute(dir)) {
      return { ok: false, reason: 'output_directory_not_absolute' };
    }
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, fsConstants.W_OK);
    } catch {
      return { ok: false, reason: 'output_directory_not_writable' };
    }
  }
  return { ok: true };
}

export function createUserLoopTemplateRunner(options: CreateUserLoopTemplateRunnerOptions): UserLoopTemplateRunner {
  // Preserve the actual Main writer port even if the composition options object changes.
  options = { ...options, acquireWriter: options.acquireWriter?.bind(options) };
  const taskPort:UserLoopTaskPort=Object.freeze({createTask:options.taskPort.createTask.bind(options.taskPort),recoverTask:options.taskPort.recoverTask.bind(options.taskPort),cancelTask:options.taskPort.cancelTask.bind(options.taskPort)});
  const identityHost=options.taskPort.reserveTask&&options.taskPort.createReservedTask&&options.taskPort.discardReservedTask?createLoopTaskIdentityHost(options.loopStore,options.taskPort as LoopReservedTaskPort):undefined;
  const terminalObserver=createLoopTaskTerminalObserver(options.loopStore,taskPort);
  const recovery=createLoopTemplateExecutionRecovery({store:options.loopStore,taskPort});
  const now = options.now ?? (() => Date.now());
  const finalizer = options.finalizer ?? createLoopFinalizer(options.loopStore);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxRunMs = options.maxRunMs ?? DEFAULT_MAX_RUN_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastTimestamp = 0;
  const timestamp = () => {
    const current = now();
    lastTimestamp = Math.max(current, lastTimestamp + 1);
    return lastTimestamp;
  };

  async function runMarkdownFileLoop(
    template: UserLoopTemplate,
    input: RunUserLoopTemplateInput
  ): Promise<UserLoopTemplateRunResult> {
    const runStartMs = now();
    const outputTarget = resolveUserLoopOutputTarget(template);
    if (!outputTarget.ok) {
      return blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        outputTarget.nextActionKind,
        outputTarget.message,
        outputTarget.metadata,
        timestamp()
      );
    }

    const outputPath = outputTarget.outputPath;

    // Preflight: fast environment check before consuming agent resources
    const preflight = runPreflight(template);
    if (!preflight.ok) {
      const result = blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        'preflight_failed',
        `Preflight failed: ${preflight.reason}`,
        { reason: preflight.reason },
        timestamp()
      );
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    // Expire stale constraints before injection
    options.loopStore.deactivateStaleConstraints(input.loopId, now());

    // Inject active constraints into prompt
    const { prompt: enhancedPrompt, injectedConstraintIds } = buildPromptWithConstraints(
      buildMarkdownLoopPrompt(template, outputPath),
      options.loopStore,
      input.loopId
    );

    const executeStartedAt = timestamp();
    const executeStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'execute', executeStartedAt, {
      trigger: input.trigger,
      outputPath,
      injectedConstraintIds,
    });

    if (input.signal?.aborted) {
      const message = 'Loop run aborted before task creation.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_crash', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_crash', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    let taskId: string;
    try {
      mkdirSync(template.outputDirectory, { recursive: true });
      if(!identityHost)throw Error('loop_reserved_task_port_required');
      const created = await identityHost.create({
        prompt: enhancedPrompt,
        materials: [],
        permissionMode: permissionModeFor(input.trigger, template),
        watchdogMs: DEFAULT_LOOP_TASK_WATCHDOG_MS,
        maxToolLoopIterations: 500,
      },{runId:input.runId,stageId:executeStage.id,requestSource:input.requestSource,signal:input.signal});
      taskId = created.taskId;
      
    } catch (error) {
      if(isLoopTaskCreationPending(error)){if(input.signal?.aborted){const original=options.loopStore.listLoopStages(input.runId).find(stage=>stage.id===executeStage.id)?.metadata.taskId;if(typeof original==='string')try{await taskPort.cancelTask(original,'loop_aborted');}catch{}}return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};}
      const message = (error as Error).message || 'User loop task creation failed.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      return failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
    }

    await waitForTerminalSnapshot({
      taskPort,
      taskId,
      maxRunMs,
      pollIntervalMs,
      sleep,
      signal: input.signal,
    }).catch(()=>undefined);
    let snapshot:TaskSnapshot|undefined;
    try{snapshot=await terminalObserver.observe({runId:input.runId,stageId:executeStage.id,requestSource:input.requestSource});}catch{return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};}
    if(!snapshot)return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};
    if (snapshot.status !== 'completed') {
      const errorEvent = [...(snapshot.events ?? [])].reverse().find(e => (e as any).type === 'error') as { type: 'error'; message?: string } | undefined;
      const errorReason = errorEvent?.message
        || snapshot.result?.summary?.split('\n')[0]?.slice(0, 200)
        || (snapshot.salvage?.reason)
        || `状态 ${snapshot.status}`;
      const message = `用户循环任务${snapshot.status === 'failed' ? '失败' : '未完成'}：${errorReason}`;
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      triggerAsyncExtraction(options, input, template, 'executor_failed', errorReason, snapshot);
      return result;
    }

    if(input.producer){input.producer.recordTemplateExecution({executeStageId:executeStage.id,taskSnapshot:snapshot,summary:`Task ${taskId} completed.`,evidenceIds:[],artifacts:[],now:timestamp()});options.loopStore.captureLoopPublicationCandidate({runId:input.runId,stageId:executeStage.id,expectedResultRevision:1},input.producer);}
    else options.loopStore.finishLoopStageSuccess(executeStage.id, [], timestamp(), `Task ${taskId} completed.`, { taskId });
    const verifyStartedAt = timestamp();
    const verifyStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'verify', verifyStartedAt, {
      taskId,
      outputPath,
      injectedConstraintIds,
      ...(input.producer?{localEvaluationStarted:true}:{}),
    });

    // Fallback: if task completed but file doesn't exist, try extracting from result.summary
    if (!existsSync(outputPath) && snapshot.result?.summary) {
      const summary = snapshot.result.summary;
      const hasMarkdownStructure = /^#\s+.+/m.test(summary) && summary.length > 500;
      if (hasMarkdownStructure) {
        try {
          const cleaned = summary.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
          writeFileSync(outputPath, cleaned, 'utf-8');
        } catch {
          // write failure continues to normal verify flow
        }
      }
    }

    const evaluation = await evaluateLoopContract({
      runId: input.runId,
      contract: template.contract,
      registry: {
        file_exists: async () => {
          const fileCheck = verifyMarkdownFile(outputPath);
          if (!fileCheck.ok) {
            return {
              status: 'blocked',
              nextActionKind: 'missing_file_artifact',
              nextActionSummary: `Missing markdown file artifact: ${outputPath}`,
            };
          }
          return {
            status: 'passed',
            summary: `Markdown file artifact verified: ${outputPath}`,
          };
        },
        ...(options.commandAllowlist ? {
          command_exit_zero: async ({ criterion }) => runAllowedLoopCommandCriterion({
            allowlist: options.commandAllowlist!,
            criterion,
            workspaceRoot: outputTarget.outputDirectory,
            outputDirectory: outputTarget.outputDirectory,
          }),
        } satisfies LoopVerifierRegistry : {}),
        ...(options.verifierRegistry ?? {}),
      },
      evidenceBundle: {
        outputPath,
        outputDirectory: outputTarget.outputDirectory,
        outputFileName: template.outputFileName,
        taskId,
        snapshot,
      },
    });

    if(input.producer&&evaluation.status!=='success'){
      input.producer.recordTemplateNonSuccess({executeStageId:executeStage.id,verifyStageId:verifyStage.id,evaluation,requestSource:input.requestSource,now:timestamp()});
      return {status:evaluation.status,run:options.loopStore.getLoopRun(input.runId)!};
    }

    if (evaluation.status === 'blocked') {
      const stageEvidenceIds = recordBlockedEvidence(options.evidenceStore, 'loop_stage', verifyStage.id, timestamp(), evaluation.nextActionSummary, {
        outputPath,
        nextActionKind: evaluation.nextActionKind,
      });
      options.loopStore.finishLoopStageBlocked(verifyStage.id, stageEvidenceIds, evaluation.nextActionSummary, timestamp(), {
        outputPath,
        nextActionKind: evaluation.nextActionKind,
      });
      const runEvidenceIds = recordBlockedEvidence(options.evidenceStore, 'loop_run', input.runId, timestamp(), evaluation.nextActionSummary, {
        outputPath,
        nextActionKind: evaluation.nextActionKind,
      });
      const blocked = finalizeEvaluation(finalizer, options.loopStore, {
        runId: input.runId,
        evaluation: {
          ...evaluation,
          evidenceIds: runEvidenceIds,
        },
        now: timestamp(),
      });
      const result = resultFromRun('blocked', blocked, input.runId, options.loopStore);
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      if (injectedConstraintIds.length > 0) {
        options.loopStore.incrementConsecutiveIneffective(injectedConstraintIds);
      }
      triggerAsyncExtraction(options, input, template, evaluation.nextActionKind, evaluation.nextActionSummary, snapshot);
      return result;
    }

    if (evaluation.status === 'failed') {
      options.loopStore.finishLoopStageFailure(verifyStage.id, evaluation.failureKind, evaluation.message, evaluation.evidenceIds, timestamp(), {
        outputPath,
      });
      const failed = finalizeEvaluation(finalizer, options.loopStore, {
        runId: input.runId,
        evaluation,
        now: timestamp(),
      });
      const result = resultFromRun('failed', failed, input.runId, options.loopStore);
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      triggerAsyncExtraction(options, input, template, evaluation.failureKind, evaluation.message, snapshot);
      return result;
    }

    // Verify success: reset ineffective counters
    if (injectedConstraintIds.length > 0) {
      options.loopStore.resetConsecutiveIneffective(injectedConstraintIds);
    }

    const summary = `Markdown file artifact verified: ${outputPath}`;
    const stageEvidenceIds = recordFileArtifactEvidence(options.evidenceStore, 'loop_stage', verifyStage.id, timestamp(), summary, outputPath);
    if(input.producer){input.producer.recordTemplateTerminal({executeStageId:executeStage.id,verifyStageId:verifyStage.id,summary,evidenceIds:stageEvidenceIds,artifacts:[],now:timestamp()});options.loopStore.recoverLoopPublicationCandidates({runId:input.runId,requestSource:input.requestSource});return {status:'publication_pending',run:options.loopStore.getLoopRun(input.runId)!};}
    options.loopStore.finishLoopStageSuccess(verifyStage.id, stageEvidenceIds, timestamp(), summary, { outputPath });
    const runEvidenceIds = recordFileArtifactEvidence(options.evidenceStore, 'loop_run', input.runId, timestamp(), summary, outputPath);
    const success = finalizeEvaluation(finalizer, options.loopStore, {
      runId: input.runId,
      evaluation: {
        ...evaluation,
        evidenceIds: runEvidenceIds,
        summary,
      },
      now: timestamp(),
    });
    const result = resultFromRun('success', success, input.runId, options.loopStore);
    recordDuration(options.loopStore, input.runId, runStartMs, now());
    return result;
  }

  async function runTaskCompletionLoop(
    template: UserLoopTemplate,
    input: RunUserLoopTemplateInput
  ): Promise<UserLoopTemplateRunResult> {
    const runStartMs = now();
    const effectivePermission = permissionModeFor(input.trigger, template);

    if (effectivePermission === 'plan' && input.trigger.kind === 'scheduled') {
      return blockRun(
        options.loopStore,
        options.evidenceStore,
        input.runId,
        'awaiting_auto_run_approval',
        'Scheduled task_completion loop requires autoRunApproved=true to execute.',
        { permissionMode: 'plan', loopId: input.loopId },
        timestamp()
      );
    }

    // Expire stale constraints before injection
    options.loopStore.deactivateStaleConstraints(input.loopId, now());

    // Inject active constraints into prompt
    const { prompt: enhancedPrompt, injectedConstraintIds } = buildPromptWithConstraints(
      template.prompt,
      options.loopStore,
      input.loopId
    );

    const executeStartedAt = timestamp();
    const executeStage = options.loopStore.startLoopStage(input.runId, input.loopId, 'execute', executeStartedAt, {
      trigger: input.trigger,
      injectedConstraintIds,
    });

    if (input.signal?.aborted) {
      const message = 'Loop run aborted before task creation.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_crash', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_crash', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    let taskId: string;
    try {
      if(!identityHost)throw Error('loop_reserved_task_port_required');
      const created = await identityHost.create({
        prompt: enhancedPrompt,
        materials: [],
        permissionMode: effectivePermission,
        watchdogMs: DEFAULT_LOOP_TASK_WATCHDOG_MS,
        maxToolLoopIterations: 500,
      },{runId:input.runId,stageId:executeStage.id,requestSource:input.requestSource,signal:input.signal});
      taskId = created.taskId;
      
    } catch (error) {
      if(isLoopTaskCreationPending(error)){if(input.signal?.aborted){const original=options.loopStore.listLoopStages(input.runId).find(stage=>stage.id===executeStage.id)?.metadata.taskId;if(typeof original==='string')try{await taskPort.cancelTask(original,'loop_aborted');}catch{}}return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};}
      const message = (error as Error).message || 'Task creation failed.';
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }

    await waitForTerminalSnapshot({
      taskPort,
      taskId,
      maxRunMs,
      pollIntervalMs,
      sleep,
      onPoll: () => options.loopStore.touchLoopRun(input.runId, timestamp()),
      signal: input.signal,
    }).catch(()=>undefined);

    let snapshot:TaskSnapshot|undefined;
    try{snapshot=await terminalObserver.observe({runId:input.runId,stageId:executeStage.id,requestSource:input.requestSource});}catch{return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};}
    if(!snapshot)return {status:'executing',run:options.loopStore.getLoopRun(input.runId)!};
    if (snapshot.status !== 'completed') {
      const message = snapshot.status === 'cancelled'
        ? `Task auto-cancelled after ${Math.round(maxRunMs / 60_000)} minutes timeout.`
        : `Task ended with status: ${snapshot.status}`;
      options.loopStore.finishLoopStageFailure(executeStage.id, 'executor_failed', message, [], timestamp());
      const result = failRun(options.loopStore, input.runId, 'executor_failed', message, timestamp());
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      triggerAsyncExtraction(options, input, template, 'executor_failed', message, snapshot);
      return result;
    }

    // Success: reset ineffective counters
    if (injectedConstraintIds.length > 0) {
      options.loopStore.resetConsecutiveIneffective(injectedConstraintIds);
    }

    const summary = `Task ${taskId} completed. Prompt: ${template.prompt.slice(0, 80)}`;
    if(input.producer){
      input.producer.recordTemplateExecution({executeStageId:executeStage.id,taskSnapshot:snapshot,summary,evidenceIds:[],artifacts:[],now:timestamp()});
      options.loopStore.captureLoopPublicationCandidate({runId:input.runId,stageId:executeStage.id,expectedResultRevision:1},input.producer);
      const weakOnly=template.contract.successCriteria.length>0&&template.contract.successCriteria.every(c=>c.kind==='task_completed'&&c.strength==='weak');
      const verifyStage=options.loopStore.startLoopStage(input.runId,input.loopId,'verify',timestamp(),{taskId,...(!weakOnly?{localEvaluationStarted:true}:{})});
      const evaluation=await evaluateLoopContract({runId:input.runId,contract:template.contract,registry:{...(options.verifierRegistry??{})},evidenceBundle:{taskId,snapshot}});
      if(evaluation.status!=='success'&&!weakOnly){
        input.producer.recordTemplateNonSuccess({executeStageId:executeStage.id,verifyStageId:verifyStage.id,evaluation,requestSource:input.requestSource,now:timestamp()});
        return {status:evaluation.status,run:options.loopStore.getLoopRun(input.runId)!};
      }
      if(weakOnly)options.loopStore.updateLoopStageMetadata(verifyStage.id,{taskId,localEvaluation:evaluation});
      const candidateSummary=evaluation.status==='success'?evaluation.summary:'Task execution ended; awaiting independent verification.';
      input.producer.recordTemplateTerminal({executeStageId:executeStage.id,verifyStageId:verifyStage.id,summary:candidateSummary,evidenceIds:evaluation.evidenceIds,artifacts:[],now:timestamp()});
      options.loopStore.recoverLoopPublicationCandidates({runId:input.runId,requestSource:input.requestSource});
      return {status:'publication_pending',run:options.loopStore.getLoopRun(input.runId)!};
    }
    options.loopStore.finishLoopStageSuccess(executeStage.id, [], timestamp(), summary, { taskId });
    const runEvidenceIds = recordTaskCompletionEvidence(
      options.evidenceStore, 'loop_run', input.runId, timestamp(), summary,
      { taskId, promptPreview: template.prompt.slice(0, 100) }
    );
    if (input.trigger.kind === 'scheduled' && isWeakOnlyBackgroundContract(template.contract)) {
      const nextActionSummary = 'Add a strong success criterion before scheduled task_completion loops can be marked successful.';
      const blockedEvidenceIds = recordBlockedEvidence(
        options.evidenceStore,
        'loop_run',
        input.runId,
        timestamp(),
        nextActionSummary,
        {
          reason: 'weak_only_background_contract',
          loopId: input.loopId,
          taskId,
        }
      );
      const blocked = options.loopStore.finishLoopRunBlocked(
        input.runId,
        [...runEvidenceIds, ...blockedEvidenceIds],
        'add_success_criterion',
        nextActionSummary,
        timestamp()
      );
      const result = resultFromRun('blocked', blocked, input.runId, options.loopStore);
      recordDuration(options.loopStore, input.runId, runStartMs, now());
      return result;
    }
    const success = finalizer.finishSuccess({
      runId: input.runId,
      evidenceIds: runEvidenceIds,
      now: timestamp(),
      summary,
    });
    const result = resultFromRun('success', success, input.runId, options.loopStore);
    recordDuration(options.loopStore, input.runId, runStartMs, now());
    return result;
  }

  return {
    async recoverTemplateLoop(raw){
      const descriptors=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string'||!['loopId','runId','requestSource','signal'].includes(k))||Object.values(descriptors).some(d=>!('value' in d)))throw Error('loop_run_source');
      const input=captureLoopProducerValue({loopId:descriptors.loopId?.value,runId:descriptors.runId?.value,requestSource:descriptors.requestSource?.value});const signal=descriptors.signal?.value as AbortSignal|undefined;if(typeof input.loopId!=='string'||typeof input.runId!=='string'||!input.requestSource)throw Error('loop_run_source');captureLoopRunContext({requestSource:input.requestSource});signal?.throwIfAborted();
      const run=options.loopStore.getLoopRun(input.runId),template=options.loopStore.getUserLoopTemplate(input.loopId);
      if(!run||run.loopId!==input.loopId||!template)throw Error('loop_template_recovery_original');
      if(run.status==='failed'||run.status==='blocked')return {status:run.status,run};
      if(options.loopStore.listLoopStages(run.id).some(stage=>stage.stageKind==='verify'&&stage.metadata.localEvaluationStarted===true)&&!options.loopStore.getLoopRunLifecycle(run.id)?.terminalResultPresent)return {status:'executing',run};
      if(options.loopStore.getLoopRunLifecycle(run.id)?.businessState==='publication_pending'){options.loopStore.recoverLoopPublicationCandidates({runId:run.id,requestSource:input.requestSource});return {status:'publication_pending',run};}
      const execute=options.loopStore.listLoopStages(run.id).find(stage=>stage.stageKind==='execute');
      if(!execute||typeof execute.metadata.taskId!=='string')return {status:'executing',run};
      if(!options.loopStore.getLoopRunLifecycle(run.id)?.executionStageIds.includes(execute.id)){
        let token:object;
        try{token=await recovery.prepareExecution({runId:run.id,executeStageId:execute.id,requestSource:input.requestSource,now:timestamp()});}
        catch(error){if(error instanceof Error&&(error.message==='loop_template_recovery_task_pending'||error.message===`task not found: ${execute.metadata.taskId}`))return {status:'executing',run};throw error;}
        signal?.throwIfAborted();options.loopStore.recoverLoopTemplateExecution(token);
      }
      const weakOnly=template.kind==='task_completion'&&template.contract.successCriteria.length>0&&template.contract.successCriteria.every(c=>c.kind==='task_completed'&&c.strength==='weak');
      if(template.kind!=='markdown_file'&&!weakOnly)return {status:'executing',run};
      const verify=options.loopStore.listLoopStages(run.id).find(stage=>stage.stageKind==='verify')??options.loopStore.startLoopStage(run.id,run.loopId,'verify',timestamp(),{taskId:execute.metadata.taskId});
      if(weakOnly){const evaluation=await evaluateLoopContract({runId:run.id,contract:template.contract,registry:{},evidenceBundle:{taskId:execute.metadata.taskId}});options.loopStore.updateLoopStageMetadata(verify.id,{taskId:execute.metadata.taskId,localEvaluation:evaluation});}
      const token=await (weakOnly?recovery.prepareWeakTerminal:recovery.prepareMarkdownTerminal)({runId:run.id,executeStageId:execute.id,verifyStageId:verify.id,requestSource:input.requestSource,now:timestamp()});signal?.throwIfAborted();options.loopStore.recoverLoopTemplateTerminal(token);
      options.loopStore.recoverLoopPublicationCandidates({runId:run.id,requestSource:input.requestSource});return {status:'publication_pending',run:options.loopStore.getLoopRun(run.id)!};
    },
    async runTemplateLoop(input: RunUserLoopTemplateInput): Promise<UserLoopTemplateRunResult> {
      const descriptors=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(input).some(k=>typeof k!=='string')||Object.values(descriptors).some(d=>!('value' in d)))throw Error('loop_run_source');
      const captured=captureLoopProducerValue({loopId:descriptors.loopId?.value,runId:descriptors.runId?.value,trigger:descriptors.trigger?.value,requestSource:descriptors.requestSource?.value});
      if(typeof captured.loopId!=='string'||typeof captured.runId!=='string'||!captured.trigger||!captured.requestSource)throw Error('loop_run_source');
      input={loopId:captured.loopId,runId:captured.runId,trigger:captured.trigger,requestSource:captured.requestSource,signal:descriptors.signal?.value,producer:descriptors.producer?.value};
      captureLoopRunContext({requestSource:input.requestSource});
      if(options.loopStore.getLoopRunPublicationBasis(input.runId)){if(!input.producer)throw Error('loop_publication_producer');}
      else assertOrdinaryLoopOwner('loop_run',input.runId);
      const template = options.loopStore.getUserLoopTemplate(input.loopId);
      if (!template) {
        return failRun(options.loopStore, input.runId, 'validation_failed', 'User loop template does not exist.', timestamp());
      }
      if (template.kind === 'task_completion') {
        return runTaskCompletionLoop(template, input);
      }
      return runMarkdownFileLoop(template, input);
    },
  };
}

function buildMarkdownLoopPrompt(template: UserLoopTemplate, outputPath: string): string {
  return [
    template.prompt,
    '',
    'Write the final Markdown artifact to this exact path:',
    outputPath,
    '',
    'The loop is successful only if that Markdown file exists and is non-empty.',
  ].join('\n');
}

function permissionModeFor(trigger: LoopRunTrigger, template: UserLoopTemplate): TaskPermissionMode {
  if (trigger.kind === 'scheduled' && !template.autoRunApproved) return 'plan';
  return 'default';
}


async function waitForTerminalSnapshot(input: {
  taskPort: UserLoopTaskPort;
  taskId: string;
  maxRunMs: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  onPoll?: () => void;
  signal?: AbortSignal;
}): Promise<TaskSnapshot> {
  const startedAt = Date.now();
  while (true) {
    if (input.signal?.aborted) {
      try {
        await input.taskPort.cancelTask(input.taskId, 'loop_aborted');
      } catch {
        // cancelTask may fail if task is already terminal
      }
      try {
        const { snapshot: final } = await input.taskPort.recoverTask(input.taskId);
        if (isTerminalTaskSnapshot(final)) return final;
        return { ...final, status: 'cancelled' } as TaskSnapshot;
      } catch {
        return { status: 'cancelled', events: [] } as unknown as TaskSnapshot;
      }
    }
    const { snapshot } = await input.taskPort.recoverTask(input.taskId);
    if (isTerminalTaskSnapshot(snapshot)) return snapshot;
    input.onPoll?.();
    if (Date.now() - startedAt >= input.maxRunMs) {
      try {
        await input.taskPort.cancelTask(input.taskId, 'loop_poll_timeout');
      } catch {
        // cancelTask may legitimately fail (task already terminal, snapshot
        // gone, etc.). The poll timeout has elapsed regardless; fall through
        // and report the latest snapshot we can observe.
      }
      try {
        const { snapshot: final } = await input.taskPort.recoverTask(input.taskId);
        if (isTerminalTaskSnapshot(final)) return final;
        return { ...final, status: 'failed' };
      } catch {
        return { ...snapshot, status: 'failed' };
      }
    }
    await input.sleep(input.pollIntervalMs);
  }
}

function isTerminalTaskSnapshot(snapshot: TaskSnapshot): boolean {
  return snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
}


function recordTaskCompletionEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  metadata: { taskId: string; promptPreview: string }
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['answer'],
    source: 'loop_stage_contract',
    confidence: 'legacy',
    metadata: { loopContract: true, weakSuccess: true, ...metadata },
    now,
  });
  const evidence = evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'answer',
    summary,
    metadata: { ...metadata, responseId: metadata.taskId, weakSuccess: true },
    now,
  });
  return [evidence.id];
}

function recordFileArtifactEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  outputPath: string
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['file_artifact'],
    source: 'loop_stage_contract',
    confidence: 'explicit',
    metadata: { loopContract: true, outputPath },
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'file_artifact',
    summary,
    metadata: { paths: [outputPath] },
    now,
  });
  return evidenceStore.completeOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function recordBlockedEvidence(
  evidenceStore: CompletionEvidenceStore,
  ownerKind: CompletionOwnerKind,
  ownerId: string,
  now: number,
  summary: string,
  metadata: Record<string, unknown>
): string[] {
  evidenceStore.upsertExpectation({
    ownerKind,
    ownerId,
    expectedKinds: ['blocked'],
    source: 'loop_stage_contract',
    confidence: 'explicit',
    metadata,
    now,
  });
  evidenceStore.insertEvidence({
    ownerKind,
    ownerId,
    kind: 'blocked',
    summary,
    metadata,
    now,
  });
  return evidenceStore.blockOwnerWithEvidence({ ownerKind, ownerId, now }).evidenceIds;
}

function failRun(
  loopStore: LoopStore,
  runId: string,
  failureKind: 'executor_failed' | 'validation_failed' | 'executor_crash',
  message: string,
  now: number
): UserLoopTemplateRunResult {
  const failed = loopStore.finishLoopRunFailure(runId, failureKind, message, [], now);
  return resultFromRun('failed', failed, runId, loopStore);
}

function blockRun(
  loopStore: LoopStore,
  evidenceStore: CompletionEvidenceStore,
  runId: string,
  nextActionKind: string,
  nextActionSummary: string,
  metadata: Record<string, unknown>,
  now: number
): UserLoopTemplateRunResult {
  const evidenceIds = recordBlockedEvidence(evidenceStore, 'loop_run', runId, now, nextActionSummary, metadata);
  const blocked = loopStore.finishLoopRunBlocked(runId, evidenceIds, nextActionKind, nextActionSummary, now);
  return resultFromRun('blocked', blocked, runId, loopStore);
}

function resultFromRun(
  status: UserLoopTemplateRunResult['status'],
  run: LoopRun | undefined,
  runId: string,
  loopStore: LoopStore
): UserLoopTemplateRunResult {
  const persisted = run ?? loopStore.getLoopRun(runId);
  if (!persisted) {
    throw new Error('User loop run did not persist a terminal state.');
  }
  return { status, run: persisted } as UserLoopTemplateRunResult;
}

function finalizeEvaluation(
  finalizer: LoopFinalizer,
  loopStore: LoopStore,
  input: { runId: string; evaluation: LoopEvaluation; now: number }
): LoopRun | undefined {
  if (finalizer.finalizeEvaluation) {
    return finalizer.finalizeEvaluation(input);
  }
  if (input.evaluation.status === 'success') {
    return finalizer.finishSuccess({
      runId: input.runId,
      evidenceIds: input.evaluation.evidenceIds,
      now: input.now,
      summary: input.evaluation.summary,
    });
  }
  if (input.evaluation.status === 'blocked') {
    return loopStore.finishLoopRunBlocked(
      input.runId,
      input.evaluation.evidenceIds,
      input.evaluation.nextActionKind,
      input.evaluation.nextActionSummary,
      input.now
    );
  }
  return loopStore.finishLoopRunFailure(
    input.runId,
    input.evaluation.failureKind,
    input.evaluation.message,
    input.evaluation.evidenceIds,
    input.now
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function recordDuration(loopStore: LoopStore, runId: string, startMs: number, endMs: number): void {
  const durationMs = Math.max(0, endMs - startMs);
  loopStore.finishLoopRunWithDuration(runId, durationMs);
}

function triggerAsyncExtraction(
  options: CreateUserLoopTemplateRunnerOptions,
  input: RunUserLoopTemplateInput,
  template: UserLoopTemplate,
  failureKind: string,
  failureReason: string,
  snapshot: TaskSnapshot
): void {
  let writer: { release(): void } | undefined;
  try { writer = options.acquireWriter?.('loop:constraint-extraction:' + input.runId); }
  catch { return; } // Shutdown denied this new auxiliary writer before scheduling.
  const llmPort = options.llmPort;

  const extractionContext = JSON.stringify({
    loopTitle: template.prompt.slice(0, 100),
    failureKind,
    failureReason: failureReason.slice(0, 300),
  }).slice(0, 500);

  const recordConstraint = (source: LearnedConstraint['source'], rule: string) => {
    try {
      const constraint = options.loopStore.addConstraint({
        loopId: input.loopId,
        source,
        rule,
        sourceRunId: input.runId,
        failureKind,
        failureReason,
        extractionContext,
        now: Date.now(),
      });
      if (options.onConstraintAdded) {
        try {
          options.onConstraintAdded(constraint);
        } catch (e) {
          console.warn('[loop-runner] onConstraintAdded callback failed:', (e as Error)?.message);
        }
      }
    } catch (e) {
      console.warn(`[loop-runner] addConstraint (${source}) failed:`, (e as Error)?.message);
    }
  };

  const addRuleConstraint = () => {
    const fallback = extractViaRule(failureKind, failureReason);
    if (fallback) recordConstraint('rule_extraction', fallback);
  };

  if (!llmPort) {
    setImmediate(() => { try { addRuleConstraint(); } finally { writer?.release(); } });
    return;
  }

  const extractionInput = {
    loopTitle: template.prompt.slice(0, 100),
    loopPrompt: template.prompt.slice(0, 500),
    failureKind,
    failureMessage: failureReason.slice(0, 300),
    lastAgentOutput: snapshot.result?.summary?.slice(-500) ?? '',
  };

  setImmediate(async () => {
    try {
      const rule = await extractViaLLM(llmPort, extractionInput);
      if (rule) {
        recordConstraint('llm_extraction', rule);
      } else {
        addRuleConstraint();
      }
    } catch (e) {
      console.warn('[loop-runner] extractViaLLM failed:', (e as Error)?.message);
      addRuleConstraint();
    } finally { writer?.release(); }
  });
}
