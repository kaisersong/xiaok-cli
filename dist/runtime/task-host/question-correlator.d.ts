import type { NeedsUserQuestion, UserAnswer } from './types.js';
export type QuestionAnswerResult = {
    status: 'accepted';
    question: NeedsUserQuestion;
    answer: UserAnswer;
} | {
    status: 'stale';
    question: NeedsUserQuestion;
} | {
    status: 'not_found';
};
export declare class NeedsUserQuestionCorrelator {
    private readonly currentByTaskId;
    private readonly questionsById;
    publish(question: NeedsUserQuestion): void;
    answer(taskId: string, answer: UserAnswer): QuestionAnswerResult;
    getCurrent(taskId: string): NeedsUserQuestion | undefined;
}
