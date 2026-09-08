import type { GuardFailure, HostDeliveryRecord, HostDeliveryReport, HostDeliverySource } from './delivery-types.js';
import { isDeepStrictEqual } from 'node:util';

/** One live post-seal owner. A rejected waiter is never a physical drain receipt. */
export class HostDeliveryAttempt {
  readonly controller = new AbortController();
  readonly pending = new Set<Promise<unknown>>();
  private readonly seen = new WeakSet<Promise<unknown>>();
  acknowledged = false;
  readerStarted = false;
  record: HostDeliveryRecord;

  constructor(readonly source: HostDeliverySource, readonly deadline: number,
    startedAt: number, deadlineAt: number, private readonly now: () => number,
    private readonly report?: (report: HostDeliveryReport) => Promise<HostDeliveryReport>) {
    this.record = { version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending',
      hostSettlement: 'pending', readerCleanup: 'none', storeCleanup: 'none', startedAt, deadlineAt };
  }

  track = <T>(raw: Promise<T>): Promise<T> => {
    if (!this.seen.has(raw)) {
      this.seen.add(raw); this.pending.add(raw);
      void raw.then(() => this.pending.delete(raw), () => this.pending.delete(raw));
    }
    return raw;
  };

  async begin(): Promise<void> {
    if (!this.report) throw new Error('host_delivery_report_unavailable');
    const sent = this.capture();
    // Even an abort does not turn an unacknowledged marker into a durable one.
    const ack = await this.track(this.report(sent));
    if (!isDeepStrictEqual(ack, sent)) throw new Error('host_delivery_ack_mismatch');
    this.acknowledged = true;
    this.assertActive();
  }

  assertActive(): void {
    if (!this.controller.signal.aborted && performance.now() >= this.deadline) this.abort('delivery_timeout');
    this.controller.signal.throwIfAborted();
  }

  abort(code: 'delivery_timeout' | 'app_shutdown'): void {
    if (this.record.hostSettlement === 'committed' || this.controller.signal.aborted) return;
    if (this.record.verification === 'pending') this.fail(code);
    this.controller.abort(new Error(code));
    this.unknown();
  }

  fail(code: GuardFailure['code']): void {
    if (this.record.verification !== 'pending') return;
    this.record = { ...this.record, verification: 'failed', decisionAt: this.now(),
      guardFailure: { code, stage: this.record.stage, needsExplicitFollowup: true } };
  }

  pass(): void {
    this.assertActive();
    if (this.record.verification !== 'pending') throw new Error('delivery_decision_already_won');
    this.record = { ...this.record, verification: 'passed', decisionAt: this.now() };
  }

  unknown(): void {
    if (!this.acknowledged || this.record.status === 'unknown' || this.record.hostSettlement === 'committed') return;
    this.record = { ...this.record, status: 'unknown', hostSettlement: 'unknown', storeCleanup: 'pending',
      readerCleanup: this.readerStarted ? 'pending' : 'none' };
    this.publish();
  }

  publish(advance = true): void {
    if (!this.acknowledged || !this.report) return;
    if (advance) this.record = { ...this.record, revision: this.record.revision + 1 };
    // The physical callback remains owned even when its rejection is non-fatal
    // to the already committed host snapshot. It never retries verification.
    let report: Promise<HostDeliveryReport>;
    try { report = this.report(this.capture()); } catch { return; }
    this.track(report);
    void report.catch(() => undefined);
  }

  capture(): HostDeliveryReport {
    return { source: { ...this.source }, delivery: structuredClone(this.record) };
  }

  async wait<T>(raw: Promise<T>): Promise<T> {
    this.track(raw);
    const signal = this.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      raw.then(value => {
        signal.removeEventListener('abort', abort);
        try { this.assertActive(); resolve(value); } catch (error) { reject(error); }
      }, error => { signal.removeEventListener('abort', abort); reject(error); });
      if (signal.aborted) abort();
    });
  }

  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
