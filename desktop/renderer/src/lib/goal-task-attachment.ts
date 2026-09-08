export interface GoalTaskAttachmentInput {
  prepared: { threadId: string; taskId: string; attachmentId: string };
  currentThreadId: string;
  isCurrent?: () => boolean;
  isCandidateCurrent: () => boolean;
  updateThreadTaskId: (threadId: string, taskId: string) => Promise<void>;
  subscribeTask: (taskId: string, handler: (event: unknown) => void) => () => void;
  onEvent: (event: unknown) => void;
  onSubscribed: (unsubscribe: () => void) => void;
  ackGoalTaskAttached: (input: { threadId: string; attachmentId: string }) => Promise<void>;
}

export type GoalAttachmentOutcome = { kind: 'confirmed' } | { kind: 'unknown'; error: unknown };

export async function attachPreparedGoalTask(input: GoalTaskAttachmentInput): Promise<GoalAttachmentOutcome | null> {
  if (input.prepared.threadId !== input.currentThreadId || input.isCurrent?.() === false || !input.isCandidateCurrent()) return null;
  await input.updateThreadTaskId(input.currentThreadId, input.prepared.taskId);
  if (input.isCurrent?.() === false || !input.isCandidateCurrent()) return null;
  const unsubscribe = input.subscribeTask(input.prepared.taskId, input.onEvent);
  try {
    if (input.isCurrent?.() === false || !input.isCandidateCurrent()) { unsubscribe(); return null; }
    input.onSubscribed(unsubscribe);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  // Ownership has transferred. A newer candidate may still fail its update;
  // only teardown of this route, not candidate replacement, releases this view.
  if (input.isCurrent?.() === false) { unsubscribe(); return null; }
  try {
    await input.ackGoalTaskAttached({
      threadId: input.currentThreadId,
      attachmentId: input.prepared.attachmentId,
    });
  } catch (error) {
    if (input.isCurrent?.() === false) { unsubscribe(); return null; }
    return { kind: 'unknown', error };
  }
  if (input.isCurrent?.() === false) { unsubscribe(); return null; }
  return { kind: 'confirmed' };
}
