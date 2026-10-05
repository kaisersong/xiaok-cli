/** Scope is immutable source identity, never inferred from a rewritten header. */
export type ProtectedRunScope='protected-execution-run'|'whole-task';
declare const protectedRunCompletionReceiptBrand:unique symbol;
/** Only the actual ledger instance's private WeakMap and complete physical census
 * can authenticate this object. Serialization and TypeScript casts grant nothing. */
export interface ProtectedRunCompletionReceipt{readonly [protectedRunCompletionReceiptBrand]:true}
export interface ProtectedRunCompletionExpectation{readonly sourceRunId:string;readonly runNonce:string;readonly archiveHash:string;readonly scope:ProtectedRunScope}
export interface ProtectedRunCompletionAuthority{
 assertComplete(receipt:ProtectedRunCompletionReceipt,expected:Readonly<ProtectedRunCompletionExpectation>):void;
}
