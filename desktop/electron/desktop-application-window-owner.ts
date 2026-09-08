/** One app bootstrap, arbitrarily many views. Failed partial boot is never retried. */
export class DesktopApplicationWindowOwner<T> {
  private bootstrapResult: Promise<T> | undefined;
  private opening: Promise<T> | undefined;
  constructor(private readonly ports: { current(): T | null; bootstrap(): Promise<T>; createView(): Promise<T> }) {}

  open(): Promise<T> {
    // Startup can publish a BrowserWindow before its services are ready.
    if (this.opening) return this.opening;
    const initialize = this.bootstrapResult === undefined;
    const next = initialize
      ? Promise.resolve().then(() => this.ports.bootstrap())
      : this.bootstrapResult!.then(() => this.ports.current() ?? this.ports.createView());
    if (initialize) this.bootstrapResult = next;
    this.opening = next;
    void next.finally(() => { if (this.opening === next) this.opening = undefined; }).catch(() => undefined);
    return next;
  }
}
