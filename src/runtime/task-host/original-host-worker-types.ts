import type { WorkerOptions } from 'node:worker_threads';
import type { buildDeliveryFactsV1 } from './delivery-facts.js';

/** Data from an original private producer. This interface grants no authority. */
export interface OriginalHostWorkerRequest {
  readonly workerKind: 'delivery_verifier' | 'protection_read';
  readonly entry: string;
  readonly options: Readonly<WorkerOptions>;
  readonly initialFrameBase64?: string;
  readonly deliveryRequest?: ReturnType<typeof buildDeliveryFactsV1>;
  assertCurrent(): void;
  assertLocal(): void;
}

export interface OriginalHostWorkerContext {
  readonly pOnly: true;
  readonly executionClass: 'snapshot_prep';
  readonly taskId: string;
  readonly parentRef: object | null;
  assertCurrent(): void;
  assertLocal(): void;
}
