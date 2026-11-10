import type {TaskCreateInput} from '../../src/runtime/task-host/types.js';
import type {KSwarmTaskHandoff} from './kswarm-runtime-bridge.js';
import {VISUAL_PDF_EXPORT_GUIDANCE} from './desktop-system-prompt.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const KSWARM_TASK_INPUT_MAPPER_VERSION='kswarm_task_handoff_prompt_v1';
type Execution=Pick<KSwarmTaskHandoff,'project'|'task'>;
/** The original two artifact layouts. Computing them neither creates a
 * directory nor consults today's capacity when observing a historical intent. */
export function buildKSwarmTaskArtifactPaths(execution:Execution,runId:string):{baseArtifactsDir:string;runArtifactsDir:string}{
 const baseArtifactsDir=execution.project.artifactsDir||(execution.project.workFolder?join(execution.project.workFolder,'artifacts'):'');
 const runDirectory=createHash('sha256').update(JSON.stringify([execution.project.id,execution.task.id,runId])).digest('hex').slice(0,32);
 return{baseArtifactsDir,runArtifactsDir:baseArtifactsDir?join(baseArtifactsDir,'run-'+runDirectory):baseArtifactsDir};
}
export function buildKSwarmTaskCreateInputCandidates(input:{execution:Execution;runId:string;targetParticipantId?:string}):TaskCreateInput[]{
 const paths=buildKSwarmTaskArtifactPaths(input.execution,input.runId),result=[buildKSwarmTaskCreateInput({...input,baseArtifactsDir:paths.baseArtifactsDir,artifactsDir:paths.baseArtifactsDir})];
 if(paths.runArtifactsDir!==paths.baseArtifactsDir)result.push(buildKSwarmTaskCreateInput({...input,baseArtifactsDir:paths.baseArtifactsDir,artifactsDir:paths.runArtifactsDir}));return result;
}

/** Original direct-task input mapping only. Paths are already selected by the
 * original owner; this pure projection creates no directories or permissions. */
export function buildKSwarmTaskCreateInput(input:{
  execution:Pick<KSwarmTaskHandoff,'project'|'task'>;
  targetParticipantId?:string;artifactsDir:string;baseArtifactsDir:string;
}):TaskCreateInput{
  const {execution:handoff,targetParticipantId,artifactsDir,baseArtifactsDir}=input;
  const requiresArtifactEvidence=shouldRequireKSwarmArtifactEvidence(handoff.task);
    const requiredOutputsText = formatKSwarmRequiredOutputs(handoff.task.requiredOutputs);
    const prompt = [
      'KSwarm 项目任务执行。',
      `执行者：${targetParticipantId || 'xiaok-worker'}`,
      `项目：${handoff.project.name}`,
      `目标：${handoff.project.goal}`,
      handoff.project.requirements ? `要求：${handoff.project.requirements}` : '',
      artifactsDir ? `产物目录：${artifactsDir}` : '',
      baseArtifactsDir && artifactsDir !== baseArtifactsDir ? `已有项目资料目录（只读参考，当前产物写入上面的产物目录）：${baseArtifactsDir}` : '',
      `任务：${handoff.task.title}`,
      handoff.task.brief ? `任务说明：${handoff.task.brief}` : '',
      handoff.task.acceptanceCriteria ? `验收标准：${handoff.task.acceptanceCriteria}` : '',
      requiredOutputsText ? `必须产出：${requiredOutputsText}` : '',
      handoff.task.evidenceContract ? `外部来源证据要求：${JSON.stringify(handoff.task.evidenceContract)}` : '',
      handoff.task.repairInstruction ? `修复反馈：${handoff.task.repairInstruction}` : '',
      requiresArtifactEvidence ? '本任务必须写入至少一个完整产物文件到产物目录；不要只在摘要里描述文件，最终交接必须能看到文件路径。' : '',
      VISUAL_PDF_EXPORT_GUIDANCE,
      requiresArtifactEvidence
        ? '不要调用项目推进或修复工具来代替本次任务执行；请直接完成当前任务，把产物文件写入上面的产物目录，使用文件路径作为交接依据，并返回 result manifest。'
        : '不要调用项目推进或修复工具来代替本次任务执行；请直接完成当前任务，并返回 result manifest。如果任务没有要求生成文件，artifacts 可以为空数组，但 summary 必须说明完成了哪些要求。',
    ].filter(Boolean).join('\n');
  return {prompt,materials:[]};
}

function formatKSwarmRequiredOutputs(outputs: KSwarmTaskHandoff['task']['requiredOutputs']): string {
  if (!Array.isArray(outputs)) return '';
  const normalized: string[] = [];
  for (let index=0;index<outputs.length;index++) {
    const output=outputs[index];
    const raw = typeof output === 'string'
      ? output
      : output?.type || output?.format || output?.kind || output?.mimeType || '';
    const value = String(raw || '').trim();
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized.join(', ');
}


export function shouldRequireKSwarmArtifactEvidence(task: KSwarmTaskHandoff['task']): boolean {
  if ((task.requiredOutputs ?? []).length > 0) return true;
  if (task.evidenceContract && task.evidenceContract.required === true) return true;
  return false;
}
