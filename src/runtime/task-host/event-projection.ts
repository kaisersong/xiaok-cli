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
    const kind = normalizeArtifactKind(event.kind);
    const previewAvailable = kind === 'html' || kind === 'image' || kind === 'text';
    return {
      type: 'artifact_recorded',
      artifactId: event.artifactId,
      kind,
      label: event.label,
      filePath: event.path ?? '',
      previewAvailable,
      turnId: event.turnId,
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
  if (event.type === 'tool_started' || event.type === 'pre_tool_use') {
    const toolName = event.toolName;
    const toolInput = event.toolInput;
    return {
      type: 'progress',
      eventId: `${event.turnId}:tool:${toolName}:${Date.now()}`,
      message: `🔧 ${toolName}${toolInput?.path ? `: ${String(toolInput.path).slice(0, 50)}` : ''}`,
      stage: 'tool',
    };
  }
  if (event.type === 'tool_finished' || event.type === 'post_tool_use') {
    const toolName = event.toolName;
    const ok = event.type === 'tool_finished' ? event.ok : true;
    return {
      type: 'progress',
      eventId: `${event.turnId}:tool-done:${toolName}:${Date.now()}`,
      message: ok ? `✓ ${toolName} 完成` : `✗ ${toolName} 失败`,
      stage: ok ? 'completed' : 'failed',
    };
  }
  if (event.type === 'post_tool_use_failure') {
    return {
      type: 'progress',
      eventId: `${event.turnId}:tool-fail:${event.toolName}:${Date.now()}`,
      message: `✗ ${event.toolName}: ${event.error.slice(0, 100)}`,
      stage: 'failed',
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
    // Canvas events: emit alongside existing progress events (not replacing them)
    const canvasEvents = projectRuntimeEventToCanvasEvents(event);
    projected.push(...canvasEvents);
  }
  return projected;
}

/**
 * Extract canvas-specific structured events from runtime events.
 * These are emitted in addition to the existing progress events (backward compatible).
 */
function projectRuntimeEventToCanvasEvents(event: RuntimeEvent): DesktopTaskEvent[] {
  if (event.type === 'pre_tool_use') {
    return [{
      type: 'canvas_tool_call',
      toolName: event.toolName,
      input: event.toolInput,
      toolUseId: event.toolUseId,
      eventId: `${event.turnId}:canvas:${event.toolUseId}:call`,
    }];
  }
  if (event.type === 'post_tool_use') {
    const responseStr = typeof event.toolResponse === 'string'
      ? event.toolResponse.slice(0, 10000)
      : JSON.stringify(event.toolResponse).slice(0, 10000);
    return [{
      type: 'canvas_tool_result',
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      ok: true,
      response: responseStr,
      eventId: `${event.turnId}:canvas:${event.toolUseId}:result`,
    }];
  }
  if (event.type === 'post_tool_use_failure') {
    return [{
      type: 'canvas_tool_result',
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      ok: false,
      response: event.error.slice(0, 10000),
      eventId: `${event.turnId}:canvas:${event.toolUseId}:failure`,
    }];
  }
  if (event.type === 'file_changed') {
    return [{
      type: 'canvas_file_changed',
      filePath: event.filePath,
      change: event.event,
      eventId: `canvas:file:${event.filePath}:${event.event}`,
    }];
  }
  return [];
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
