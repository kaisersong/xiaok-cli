/**
 * Annotation context hook for Chat integration.
 *
 * Provides:
 * - formatAnnotationForChat: converts annotation payload to chat input prefix
 * - buildAgentContext: assembles full context JSON for Agent
 */

import type { AnnotationPayload } from '../components/ArtifactEditableViewer';

export interface AgentEditContext {
  action: 'edit-artifact';
  artifact_path: string;
  selector: string;
  text: string;
  dom_snapshot: string;
  user_intent: string;
  selectedText?: string;
  rangeAnchors?: unknown;
}

/**
 * Format annotation payload into a complete instruction for the Agent.
 * Includes file path, element context, user intent, and DOM snapshot.
 */
export function formatAnnotationForChat(payload: AnnotationPayload, filePath: string): string {
  const lines: string[] = [];

  lines.push(`请修改文件 ${filePath}：`);

  if (payload.prompt) {
    lines.push(`修改要求：${payload.prompt}`);
  }

  if (payload.type === 'text-selection') {
    const displayText = payload.text.length > 120
      ? payload.text.slice(0, 120) + '...'
      : payload.text;
    lines.push(`目标文字："${displayText}"`);
  } else {
    lines.push(`目标元素：<${payload.selector}>`);
    if (payload.text) {
      const displayText = payload.text.length > 120
        ? payload.text.slice(0, 120) + '...'
        : payload.text;
      lines.push(`元素内容：${displayText}`);
    }
  }

  if (payload.snapshot) {
    lines.push(`\nDOM 上下文：\n\`\`\`\n${payload.snapshot}\n\`\`\``);
  }

  return lines.join('\n');
}

/**
 * Build full Agent context JSON from annotation + user intent.
 */
export function buildAgentContext(
  payload: AnnotationPayload,
  filePath: string,
  userIntent: string,
): AgentEditContext {
  const ctx: AgentEditContext = {
    action: 'edit-artifact',
    artifact_path: filePath,
    selector: payload.selector,
    text: payload.text,
    dom_snapshot: payload.snapshot,
    user_intent: userIntent,
  };

  if (payload.type === 'text-selection' && payload.target) {
    const target = payload.target as { text?: string; start?: unknown; end?: unknown };
    ctx.selectedText = target.text;
    ctx.rangeAnchors = { start: target.start, end: target.end };
  }

  return ctx;
}
