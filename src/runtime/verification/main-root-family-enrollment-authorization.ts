import {types} from 'node:util';
import {createRoomTurnCustody} from './original-sdk-custody.js';
import {parseMainRootFamilyEnrollmentReview, mainRootFamilyReviewBytes, mainRootFamilyReviewHash} from './main-root-family-enrollment-data.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
const retainedNativeOutcomes = new Set<object>();
/** Fixed root-broker pending-consent operation. It neither consumes the review
 * for namespace birth nor turns a partial family ledger into activation proof. */
export async function authorizeMainRootFamilyEnrollmentPending(input: {requestSource: 'user' | 'agent' | 'scheduler'; review: unknown}, options: {
  authorityId: string; allowedUserIds: readonly number[]; signal: AbortSignal;
  clock(): Readonly<ReceiverClockEvidence>;
  resolveAccount(uid: number, signal: AbortSignal): Promise<string>;
  approve(input: {uid: number; auditSessionId: number; reviewBytes: Buffer; continuousDeadlineMs: number}, signal: AbortSignal): Promise<string>;
  retainPhysicalUnknown(): void;
}) {
  if (input.requestSource !== 'user') throw Error('main_root_enrollment_source');
  const review = parseMainRootFamilyEnrollmentReview(input.review), stock = createRoomTurnCustody();
  const {signal} = options, p = review.principal, d = review.deadline;
  if (review.authorityId !== options.authorityId || !options.allowedUserIds.includes(p.uid)) throw Error('main_root_enrollment_authority');
  const clock = options.clock.bind(options), resolveAccount = options.resolveAccount.bind(options), approve = options.approve.bind(options);
  function deadline() {
    signal.throwIfAborted();let raw: unknown;
    stock.syncVoid(() => {raw = clock();stock.inventory(raw);}, undefined, []);stock.accepted();
    if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw Error('main_root_enrollment_deadline');
    const values: {[key: string]: any} = {};
    for (const key of ['domainId', 'qualificationEpoch', 'lowerBound', 'upperBound', 'evidenceHash']) {
      const row = Object.getOwnPropertyDescriptor(raw, key);
      if (!row || !Object.hasOwn(row, 'value')) throw Error('main_root_enrollment_deadline');values[key] = row.value;
    }
    if (Reflect.ownKeys(raw).length !== 5 || values.domainId !== d.domainId || values.qualificationEpoch !== d.qualificationEpoch || !Number.isSafeInteger(values.lowerBound) || !Number.isSafeInteger(values.upperBound) || values.upperBound < values.lowerBound || values.lowerBound < d.notBefore || values.upperBound >= d.validUntil) throw Error('main_root_enrollment_deadline');
  }
  async function current() {
    deadline();const account = await stock.sdk<string>(resolveAccount, undefined, [p.uid, signal]);stock.accepted();deadline();
    if (account !== p.accountGeneration) throw Error('main_root_enrollment_account_changed');
  }
  let first: {error: unknown} | undefined, result: {uid: number; auditSessionId: number; reviewHash: string} | undefined;
  try {
    result = await stock.root(async () => {
      await current();const reviewHash = mainRootFamilyReviewHash(review);
      const approved = await stock.sdk<string>(approve, undefined, [{uid: p.uid, auditSessionId: p.auditSessionId, reviewBytes: mainRootFamilyReviewBytes(review), continuousDeadlineMs: d.validUntil}, signal]);
      stock.accepted();await current();if (approved !== reviewHash) throw Error('main_root_enrollment_approval');
      return Object.freeze({uid: p.uid, auditSessionId: p.auditSessionId, reviewHash});
    });
  } catch (error) {first = {error};}
  try {await stock.waitPhysicalKnown();}
  catch (error) {retainedNativeOutcomes.add(Object.freeze({stock,options,review}));options.retainPhysicalUnknown();first ??= {error};}
  if (first) throw first.error;
  return result!;
}
