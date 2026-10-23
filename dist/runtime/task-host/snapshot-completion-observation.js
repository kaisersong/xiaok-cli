import { observeInstalledCompletion, observeInstalledCompletionSync } from '../verification/installed-completion-observation.js';
/** Durable snapshots contain execution history, never cached verification authority. */
export function withoutTaskCompletionObservation(snapshot) {
    const { currentCompletion: ignored, ...execution } = snapshot;
    return execution;
}
function project(snapshot, observation) {
    const execution = withoutTaskCompletionObservation(snapshot);
    if (observation.kind === 'ordinary')
        return execution;
    if (observation.kind === 'unavailable')
        return { ...execution, currentCompletion: Object.freeze({ kind: 'unavailable' }) };
    const state = observation.state;
    return { ...execution, currentCompletion: Object.freeze({ kind: 'protected', state: Object.freeze({ ...state, owner: Object.freeze({ ...state.owner }) }) }) };
}
export async function observeTaskSnapshotCompletion(snapshot, taskId, signal) {
    if (snapshot.taskId !== taskId)
        throw Error('task_snapshot_completion_owner');
    return project(snapshot, await observeInstalledCompletion({ ownerKind: 'task', ownerId: taskId }, signal));
}
export function observeTaskSnapshotCompletionSync(snapshot, taskId) {
    if (snapshot.taskId !== taskId)
        throw Error('task_snapshot_completion_owner');
    return project(snapshot, observeInstalledCompletionSync({ ownerKind: 'task', ownerId: taskId }));
}
