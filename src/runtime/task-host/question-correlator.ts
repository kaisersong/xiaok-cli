import type { NeedsUserQuestion, UserAnswer } from './types.js';

export type QuestionAnswerResult =
  | { status: 'accepted'; question: NeedsUserQuestion; answer: UserAnswer }
  | { status: 'stale'; question: NeedsUserQuestion }
  | { status: 'not_found' };

export class NeedsUserQuestionCorrelator {
  private readonly currentByTaskId = new Map<string, NeedsUserQuestion>();
  private readonly questionsById = new Map<string, NeedsUserQuestion>();

  publish(question: NeedsUserQuestion): void {
    this.currentByTaskId.set(question.taskId, question);
    this.questionsById.set(question.questionId, question);
  }

  answer(taskId: string, answer: UserAnswer): QuestionAnswerResult {
    const current = this.currentByTaskId.get(taskId);
    const question = this.questionsById.get(answer.questionId);
    if (!question || question.taskId !== taskId) {
      return { status: 'not_found' };
    }
    if (!current || current.questionId !== answer.questionId) {
      return { status: 'stale', question };
    }
    this.currentByTaskId.delete(taskId);
    return {
      status: 'accepted',
      question,
      answer,
    };
  }

  clear(taskId: string, questionId: string): void {
    if(this.currentByTaskId.get(taskId)?.questionId===questionId)this.currentByTaskId.delete(taskId);
    if(this.questionsById.get(questionId)?.taskId===taskId)this.questionsById.delete(questionId);
  }

  getCurrent(taskId: string): NeedsUserQuestion | undefined {
    return this.currentByTaskId.get(taskId);
  }
}
