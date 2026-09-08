import { parentPort } from 'node:worker_threads';
import { buildCompletionEvidenceContext, evidenceForExpectation, isEmptyDelivery } from './delivery-pure.js';
import { isDeliveryPlanComplete } from './deliverable-gate.js';
import {
  DELIVERY_INPUT_LIMIT, DELIVERY_OUTPUT_LIMIT, DeliveryVerificationError,
  deliveryFactsSnapshot, encodeDeliveryFrame, parseDeliveryFrame, validateDeliveryFactsV1, validateDeliveryResponse,
  type DeliveryResponseV1,
} from './delivery-facts.js';

// Fixed CPU-only entry. Closing the input port allows a real native exit.
parentPort?.once('message', (frame: unknown) => {
  let requestId = '00000000-0000-4000-8000-000000000000';
  let response: DeliveryResponseV1;
  try {
    const request = parseDeliveryFrame(frame, DELIVERY_INPUT_LIMIT);
    validateDeliveryFactsV1(request); requestId = request.requestId;
    const snapshot = deliveryFactsSnapshot(request);
    const context = buildCompletionEvidenceContext(request.taskId, snapshot);
    response = { version: 1, requestId, result: {
      kind: 'facts', planComplete: isDeliveryPlanComplete(snapshot), emptyDelivery: isEmptyDelivery(snapshot),
      guard: context.expectation ? { kind: 'evaluate', expectation: context.expectation,
        evidence: evidenceForExpectation(context.expectation, context.evidence) } : { kind: 'skip' },
    } };
    validateDeliveryResponse(response, request);
    parentPort!.postMessage(encodeDeliveryFrame(response, DELIVERY_OUTPUT_LIMIT));
  } catch (error) {
    const code = error instanceof DeliveryVerificationError
      ? error.code === 'validation_limit' ? 'validation_limit' : 'verifier_input_invalid'
      : 'verifier_internal_error';
    response = { version: 1, requestId, result: { kind: 'error', code } };
    parentPort!.postMessage(encodeDeliveryFrame(response, DELIVERY_OUTPUT_LIMIT));
  } finally { parentPort!.close(); }
});
