import { A2UI_MIME_TYPE, isA2UIMimeType, summarizeRenderUiInput } from '../../a2ui/index.js';
export function projectRuntimeEventToDesktopEvent(input) {
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
            creator: event.creator ?? 'agent',
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
        if (event.type === 'pre_tool_use' && toolName === 'render_ui')
            return null;
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
        if (event.type === 'post_tool_use' && toolName === 'render_ui') {
            const artifact = renderUiArtifactFromToolResponse(event.toolUseId, event.turnId, event.toolResponse);
            if (artifact)
                return artifact;
        }
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
    if (event.type === 'progress_plan_reported') {
        return {
            type: 'progress_plan_reported',
            steps: event.steps,
        };
    }
    if (event.type === 'turn_aborted') {
        return {
            type: 'task_cancelled',
            taskId,
            reason: 'user_aborted',
            ...(event.partialText ? { partialText: event.partialText } : {}),
        };
    }
    if (event.type === 'turn_stop') {
        return null;
    }
    if (event.type === 'turn_failed') {
        return {
            type: 'error',
            message: event.error.message,
        };
    }
    return null;
}
export function projectRuntimeEventsToDesktopEvents(input) {
    const projected = [];
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
function projectRuntimeEventToCanvasEvents(event) {
    if (event.type === 'pre_tool_use') {
        const display = event.toolName === 'render_ui' ? summarizeRenderUiInput(event.toolInput) : null;
        return [{
                type: 'canvas_tool_call',
                toolName: event.toolName,
                input: display
                    ? { title: display.title, sectionCount: display.sectionCount, payloadBytes: display.payloadBytes, redacted: true }
                    : event.toolInput,
                toolUseId: event.toolUseId,
                eventId: `${event.turnId}:canvas:${event.toolUseId}:call`,
                ts: Date.now(),
                ...(display ? { displayInputSummary: display.summary } : {}),
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
                ts: Date.now(),
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
                ts: Date.now(),
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
function normalizeArtifactKind(kind) {
    const normalized = kind.toLowerCase();
    if (normalized === 'pptx')
        return 'pptx';
    if (normalized === 'pdf')
        return 'pdf';
    if (normalized === 'docx')
        return 'docx';
    if (normalized === 'xlsx')
        return 'xlsx';
    if (normalized === 'html')
        return 'html';
    if (normalized === 'a2ui')
        return 'a2ui';
    if (normalized === 'image' || normalized === 'png' || normalized === 'jpg' || normalized === 'jpeg')
        return 'image';
    if (normalized === 'text' || normalized === 'markdown' || normalized === 'md')
        return 'text';
    return 'other';
}
function renderUiArtifactFromToolResponse(toolUseId, turnId, response) {
    const parsed = typeof response === 'string' ? parseJsonObject(response) : response;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null;
    const record = parsed;
    if (record.ok !== true)
        return null;
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
    if (!isA2UIMimeType(mimeType))
        return null;
    const filePath = typeof record.artifactPath === 'string' && record.artifactPath.trim()
        ? record.artifactPath.trim()
        : typeof record.output_path === 'string' ? record.output_path.trim() : '';
    if (!filePath)
        return null;
    const label = typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : filePath.split(/[\\/]/).pop() || 'A2UI artifact';
    return {
        type: 'artifact_recorded',
        artifactId: `artifact_${toolUseId}`,
        kind: 'a2ui',
        label,
        filePath,
        previewAvailable: true,
        turnId,
        creator: 'agent',
        mimeType: mimeType || A2UI_MIME_TYPE,
    };
}
function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export function planStepFromStage(id, label) {
    return { id, label, status: 'running' };
}
