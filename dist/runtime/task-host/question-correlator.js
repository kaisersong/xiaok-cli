export class NeedsUserQuestionCorrelator {
    currentByTaskId = new Map();
    questionsById = new Map();
    publish(question) {
        this.currentByTaskId.set(question.taskId, question);
        this.questionsById.set(question.questionId, question);
    }
    answer(taskId, answer) {
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
    getCurrent(taskId) {
        return this.currentByTaskId.get(taskId);
    }
}
