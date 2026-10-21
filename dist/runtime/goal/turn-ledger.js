/** The durable boundary rejects replay before any counter or evidence write.
 * The service can recognize exact duplicates and continue publication recovery. */
export function assertGoalTurnAppend(current, incoming, state) {
    const keys = new Set(current.map(turn => JSON.stringify([turn.goalId, turn.epoch, turn.turnId])));
    for (const turn of incoming) {
        if (turn.goalId !== state.goalId || turn.epoch !== state.epoch || typeof turn.turnId !== 'string' || !turn.turnId
            || Buffer.byteLength(turn.turnId) > 160 || /[\x00-\x1f\x7f]/.test(turn.turnId)
            || ![turn.tokensUsed, turn.activeWallClockMs, turn.recordedAt].every(n => Number.isSafeInteger(n) && n >= 0))
            throw Error('goal_turn_identity');
        const key = JSON.stringify([turn.goalId, turn.epoch, turn.turnId]);
        if (keys.has(key))
            throw Error('goal_duplicate_turn');
        keys.add(key);
    }
}
