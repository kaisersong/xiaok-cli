/** Fixed historical identity encoding only; never grants native ownership. */
export function capturedGoalTaskKey(taskId, scope) {
    const strings = [taskId, scope.goalId, scope.goalTurnId, scope.threadId];
    if (strings.some(value => typeof value !== 'string' || !value) || scope.kind !== 'goal_turn' || !['user', 'continuation'].includes(String(scope.origin)) || !Number.isSafeInteger(scope.epoch) || Number(scope.epoch) < 1)
        throw Error('captured_goal_task_tuple');
    return JSON.stringify([taskId, 'goal_turn', scope.origin, scope.goalId, scope.epoch, scope.goalTurnId, scope.threadId]);
}
