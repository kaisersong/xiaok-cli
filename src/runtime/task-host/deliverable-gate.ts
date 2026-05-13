import type { TaskSnapshot } from './types.js';

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
  if (!looksLikeMultiDeliverable(snapshot.prompt)) {
    return true;
  }

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
