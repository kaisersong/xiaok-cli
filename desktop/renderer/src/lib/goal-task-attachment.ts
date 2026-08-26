export interface GoalTaskAttachmentInput {
  prepared: { threadId: string; taskId: string; attachmentId: string };
  currentThreadId: string;
  updateThreadTaskId: (threadId: string, taskId: string) => Promise<void>;
  subscribeTask: (taskId: string, handler: (event: unknown) => void) => () => void;
  onEvent: (event: unknown) => void;
  ackGoalTaskAttached: (input: { threadId: string; attachmentId: string }) => Promise<void>;
}

export async function attachPreparedGoalTask(input: GoalTaskAttachmentInput): Promise<(() => void) | null> {
  if (input.prepared.threadId !== input.currentThreadId) return null;
  await input.updateThreadTaskId(input.currentThreadId, input.prepared.taskId);
  const unsubscribe = input.subscribeTask(input.prepared.taskId, input.onEvent);
  try {
    await input.ackGoalTaskAttached({
      threadId: input.currentThreadId,
      attachmentId: input.prepared.attachmentId,
    });
    return unsubscribe;
  } catch (error) {
    unsubscribe();
    throw error;
  }
}
