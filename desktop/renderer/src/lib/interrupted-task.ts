import type { DesktopTaskEvent, NeedsUserQuestion, TaskSnapshot } from '../../../shared/task-types';

export interface InterruptedTask { taskId: string; choices?: NeedsUserQuestion['choices'] }
/** Presentation only: an expired question is never restored as an answerable execution. */
export function readTaskInterruption(snapshot: TaskSnapshot | undefined, expected: {taskId: string | null; threadId: string}): InterruptedTask | null {
  if (!snapshot || snapshot.status !== 'failed' || snapshot.taskId !== expected.taskId || snapshot.context?.threadId !== expected.threadId) return null;
  const error = snapshot.events.findLast((event): event is Extract<DesktopTaskEvent, {type: 'error'}> => event.type === 'error');
  if (error?.message !== 'app_shutdown') return null;
  const resolved = new Set<string>();
  for (let index = snapshot.events.length - 1; index >= 0; index--) {
    const event = snapshot.events[index];
    if (event.type === 'question_resolved') resolved.add(event.questionId);
    if (event.type === 'needs_user') {
      const question = event.question;
      const choices = question.taskId === snapshot.taskId && question.kind === 'freeform' && !resolved.has(question.questionId)
        ? question.choices?.map(({id, label}) => ({id, label})) : undefined;
      return {taskId: snapshot.taskId, ...(choices?.length ? {choices} : {})};
    }
  }
  return {taskId: snapshot.taskId};
}
