/** Correlation only: these fields never authorize execution or acknowledge it. */
export type GoalAttachmentSource =
  | { kind: 'request'; requestId: string | null }
  | { kind: 'automatic'; predecessorTaskId: string };

export interface GoalAttachmentRequest {
  requestId?: string;
}

/** Official callers use crypto.randomUUID(); omitted legacy ids stay omitted. */
export function parseGoalRequestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error('invalid_goal_request_id');
  }
  return value;
}
