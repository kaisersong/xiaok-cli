/** Local close ownership only: no SDK brand, actor or authorization. */
export interface PendingCloseOwner<T extends { close(): Promise<void> }> {
  readonly settled: Promise<T>;
  close(): Promise<void>;
}
/** The actual caller supplies its ONE already-started public producer Promise. */
export function ownPendingClose<T extends { close(): Promise<void> }>(settled: Promise<T>): PendingCloseOwner<T> {
  let closing: Promise<void> | undefined;
  return { settled, close() { return closing ??= settled.then(value => value.close()); } };
}
