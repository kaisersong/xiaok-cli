/** Host-only contract. JSON carrying these fields is not a receipt or an execution authority. */
export interface QuiescenceExpectation {
  readonly sessionIdentity: string;
  readonly compoundOperationId: string;
  readonly validationInvocationId: string;
  readonly executionIdentity: string;
  readonly scopeDigest: string;
}
declare const physicalReceiptBrand: unique symbol;
export interface PhysicalQuiescenceReceipt {
  readonly [physicalReceiptBrand]: true;
}
export interface QuiescenceAuthority {
  /** Actual qualified-engine inspection; unknown/lost identity must reject, never mint a terminal fact. */
  inspectExecution(expected: QuiescenceExpectation): Promise<PhysicalQuiescenceReceipt>;
  /** Verifies the private issuer, engine epoch and all five expected bindings. Not semantic success. */
  assertQuiescent(receipt: PhysicalQuiescenceReceipt, expected: QuiescenceExpectation): void;
}
