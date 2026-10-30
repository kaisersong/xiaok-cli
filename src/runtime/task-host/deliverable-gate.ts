import type { TaskSnapshot } from './types.js';
import { compactProjectCreationResponse } from './tool-result-response.js';

export interface DeliverableGateResult {
  complete: boolean;
  missing?: string[];
}

export interface DeliverableGateInput {
  prompt: string;
  artifacts: Array<{ kind?: string; label?: string }>;
  signal: AbortSignal;
}

export type DeliverableGateFunction = (input: DeliverableGateInput) => Promise<DeliverableGateResult>;

/**
 * Checks if a user prompt likely requests multiple deliverables.
 * Uses alternation patterns (not character classes) to match deliverable terms.
 */
export function looksLikeMultiDeliverable(prompt: string): boolean {
  const patterns = [
    // "一份X...一份Y" / "一个X...一个Y" / "一篇X...一篇Y"
    /(?:一份|一个|一篇).+(?:一份|一个|一篇)/,
    // "报告/文档/方案/总结" + connector + "演示文稿/演示文档/PPT/幻灯片/slides"
    /(?:报告|文档|方案|总结).{0,10}(?:和|与|及|还有|并|同时|另外|写|做|生成).{0,10}(?:演示文稿|演示文档|PPT|幻灯片|slides)/i,
    // reverse: "演示文稿/PPT" + connector + "报告/文档"
    /(?:演示文稿|演示文档|PPT|幻灯片|slides).{0,10}(?:和|与|及|还有|并|同时|另外|写|做|生成).{0,10}(?:报告|文档|方案|总结)/i,
  ];
  return patterns.some(p => p.test(prompt));
}

/**
 * Runs the deliverable completeness gate.
 * Returns true (pass) if:
 * - prompt doesn't look like multi-deliverable
 * - gate function says complete (if provided)
 * - built-in plan check passes (all progress steps completed)
 * - gate function throws (fail-open: don't block task completion)
 *
 * Built-in check: examines the last progress_plan_reported event.
 * If there are planned/running steps remaining, the task is incomplete.
 */
export async function runDeliverableGate(
  snapshot: TaskSnapshot,
  gateFunction: DeliverableGateFunction | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  if (hasStartedProjectHandoff(snapshot)) return true;
  if (!looksLikeMultiDeliverable(snapshot.prompt)) {
    return true;
  }

  if (!hasCompleteLastDeliveryPlan(snapshot)) return false;

  // If a custom gate function is provided, also run it
  if (gateFunction) {
    const artifacts = snapshot.events
      .filter(e => e.type === 'artifact_recorded')
      .map(e => {
        if (e.type === 'artifact_recorded') {
          return { kind: e.kind, label: e.label };
        }
        return {};
      });

    try {
      const result = await gateFunction({ prompt: snapshot.prompt, artifacts, signal });
      return result.complete;
    } catch {
      // Fail-open: if gate errors (abort, network, etc.), don't block completion
      return true;
    }
  }

  return true;
}

/** The same built-in, CPU-only check used by ordinary tasks and delivery facts. */
export function isDeliveryPlanComplete(snapshot: TaskSnapshot): boolean {
  if (hasStartedProjectHandoff(snapshot)) return true;
  if (!looksLikeMultiDeliverable(snapshot.prompt)) return true;
  return hasCompleteLastDeliveryPlan(snapshot);
}

/** This turn completes project creation/dispatch, never the project's deliverables. */
function hasStartedProjectHandoff(snapshot: TaskSnapshot): boolean {
  const prompt = snapshot.prompt.trim();
  if (!/^(?:(?:请(?:你)?|帮我|麻烦(?:你)?|我要|我想(?:要)?|现在|直接)\s*)*(?:创建|新建|建立).{0,16}项目/iu.test(prompt)
    || /(?:不要|不需要|不用|先不|暂不|别).{0,12}(?:创建|新建|建立|项目|后台)|是否|能否|如何|怎么|如果|除非|确认后|先确认|[?？]|当前会话|本轮|这轮|这一轮|同步交付|(?:另外|另行|同时|顺便).{0,16}(?:写|生成|交付|给我)|并(?:请)?给我/iu.test(prompt)) return false;
  // Snapshots own only this task's events. A later failed attempt supersedes an
  // earlier receipt; an assistant summary or another task's history is not evidence.
  for (let index = snapshot.events.length - 1; index >= 0; index--) {
    const event = snapshot.events[index]!;
    if (event.type !== 'canvas_tool_result' || event.toolName !== 'create_project') continue;
    if (!event.ok || event.response.length > 10_000) return false;
    try {
      const receipt = JSON.parse(event.response) as { ok?: unknown; created?: unknown } | null;
      if (receipt?.ok !== true || receipt.created !== true) return false;
    } catch { return false; }
    const compact = compactProjectCreationResponse(event.response);
    if (!compact) return false;
    const card = JSON.parse(compact) as { planningStart?: { sent?: boolean } };
    return card.planningStart?.sent === true;
  }
  return false;
}

function hasCompleteLastDeliveryPlan(snapshot: TaskSnapshot): boolean {
  // Built-in check: look at the last progress_plan_reported event
  const planEvents = snapshot.events.filter(e => e.type === 'progress_plan_reported') as Array<{
    type: 'progress_plan_reported';
    steps: Array<{ id: string; label: string; status: string }>;
  }>;
  if (planEvents.length > 0) {
    const lastPlan = planEvents[planEvents.length - 1];
    const hasIncomplete = lastPlan.steps.some(s => s.status !== 'completed');
    if (hasIncomplete) {
      return false;
    }
  }

  return true;
}
