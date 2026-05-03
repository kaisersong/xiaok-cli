import type { RuntimeEvent } from '../events.js';
import type { ArtifactKind, DesktopTaskEvent, PlanStep, TaskUnderstanding } from './types.js';

interface ProjectRuntimeEventInput {
  taskId: string;
  event: RuntimeEvent;
  understanding?: TaskUnderstanding;
}

interface ProjectRuntimeEventsInput {
  taskId: string;
  events: RuntimeEvent[];
  understanding?: TaskUnderstanding;
}

export function projectRuntimeEventToDesktopEvent(input: ProjectRuntimeEventInput): DesktopTaskEvent | null {
  const { event, taskId } = input;
  if (event.type === 'turn_started') {
    return { type: 'task_started', taskId };
  }
  if (event.type === 'intent_created') {
    return input.understanding
      ? { type: 'understanding_updated', understanding: input.understanding }
      : {
          type: 'progress',
          eventId: `${event.turnId}:${event.intentId}:created`,
          message: `已识别任务：${event.deliverable}`,
          stage: 'intent',
        };
  }
  if (event.type === 'stage_activated') {
    return {
      type: 'plan_updated',
      plan: [{
        id: event.stageId,
        label: event.label,
        status: 'running',
      }],
    };
  }
  if (event.type === 'step_activated') {
    return {
      type: 'progress',
      eventId: `${event.turnId}:${event.stepId}:activated`,
      message: `正在执行步骤 ${event.stepId}`,
      stage: 'step',
    };
  }
  if (event.type === 'breadcrumb_emitted') {
    return {
      type: 'progress',
      eventId: `${event.turnId}:${event.stepId}:breadcrumb`,
      message: event.message,
      stage: event.status,
    };
  }
  if (event.type === 'assistant_delta') {
    return {
      type: 'assistant_delta',
      eventId: `${event.turnId}:${event.stepId}:assistant:${event.delta.length}`,
      delta: event.delta,
    };
  }
  if (event.type === 'approval_required') {
    return {
      type: 'needs_user',
      question: {
        questionId: event.approvalId,
        taskId,
        kind: 'assumption_approval',
        prompt: '需要用户确认后继续。',
        choices: [
          { id: 'approve', label: '继续' },
          { id: 'deny', label: '暂停' },
        ],
      },
    };
  }
  if (event.type === 'artifact_recorded') {
    return {
      type: 'result',
      result: {
        summary: `已记录产物：${event.label}`,
        artifacts: [{
          artifactId: event.artifactId,
          kind: normalizeArtifactKind(event.kind),
          title: event.label,
          createdAt: event.turnId,
          previewAvailable: false,
        }],
      },
    };
  }
  if (event.type === 'receipt_emitted') {
    return {
      type: 'result',
      result: {
        summary: event.note,
        artifacts: [],
      },
    };
  }
  if (event.type === 'salvage_emitted') {
    return {
      type: 'salvage',
      salvage: {
        summary: [...event.summary],
        reason: event.reason,
      },
    };
  }
  if (event.type === 'turn_failed') {
    return {
      type: 'error',
      message: event.error.message,
    };
  }
  return null;
}

export function projectRuntimeEventsToDesktopEvents(input: ProjectRuntimeEventsInput): DesktopTaskEvent[] {
  const projected: DesktopTaskEvent[] = [];
  for (const event of input.events) {
    const desktopEvent = projectRuntimeEventToDesktopEvent({
      taskId: input.taskId,
      event,
      understanding: input.understanding,
    });
    if (desktopEvent) {
      projected.push(desktopEvent);
    }
  }
  return projected;
}

function normalizeArtifactKind(kind: string): ArtifactKind {
  const normalized = kind.toLowerCase();
  if (normalized === 'pptx') return 'pptx';
  if (normalized === 'pdf') return 'pdf';
  if (normalized === 'docx') return 'docx';
  if (normalized === 'xlsx') return 'xlsx';
  if (normalized === 'html') return 'html';
  if (normalized === 'image' || normalized === 'png' || normalized === 'jpg' || normalized === 'jpeg') return 'image';
  if (normalized === 'text' || normalized === 'markdown' || normalized === 'md') return 'text';
  return 'other';
}

export function planStepFromStage(id: string, label: string): PlanStep {
  return { id, label, status: 'running' };
}
