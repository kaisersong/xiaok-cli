// Standard Promise and public-data boundary for the original Goal pause/cancel transport.
import type { DesktopGoalProjection } from './desktop-goal-coordinator.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { GOAL_PAUSE_CANCEL_OUTPUT } from '../shared/goal-pause-cancel-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
const preProducerWitness = new NativePromise<void>(resolve => resolve());
export function captureGoalPauseCancelOutput(raw: DesktopGoalProjection): DesktopGoalProjection {
  const data = captureIpcData(raw, 'goal_pause_cancel_projection_unavailable');
  if (!GOAL_PAUSE_CANCEL_OUTPUT.safeParse(data).success) throw Error('goal_pause_cancel_projection_unavailable');
  return data;
}
export function callGoalPauseCancelProducer(producer: () => Promise<DesktopGoalProjection>): Promise<DesktopGoalProjection> {
  // Must precede entry into the real async coordinator, including its invalidation.
  assertStandardIpcPromise(preProducerWitness, 'goal_pause_cancel_projection_unavailable');
  const raw = producer();
  assertStandardIpcPromise(raw, 'goal_pause_cancel_projection_unavailable');
  // No raw.then/property read and no clone of an authority/control object.
  return new NativePromise<DesktopGoalProjection>((resolve, reject) => apply(nativeThen, raw, [(value: DesktopGoalProjection) => {
    try { resolve(captureGoalPauseCancelOutput(value)); } catch (error) { reject(error); }
  }, reject]));
}
