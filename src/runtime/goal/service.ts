import {createInstalledVerificationClient} from '../verification/controller-client.js';
import {createOwnerEnrollmentClient} from '../verification/completion-client.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import { authorizeGoalNativeProjection, assertGoalNativeApplicationCurrent } from './native-mutation-projection.js';
import { authorizeGoalCompletionProjection } from './completion-projection.js';
import { randomUUID } from 'node:crypto';
import { FileGoalNativeJournal, goalNativeCandidate, goalNativeStateHash, parseGoalNativeMutation, type GoalNativeMutation } from './native-mutation-journal.js';
import { parseGoalVerificationDefinition, assertGoalVerificationExtension } from './verification-definition.js';
import { createGoalState, reduceGoal } from './reducer.js';
import { createGoalCompletionIntent, goalApplicationFromState, type GoalCompletionIntent } from './completion-intent.js';
import { canonicalVerificationJson as canonicalJson } from '../verification/protocol.js';
import type {
  GoalCommitInput,
  GoalDocument,
  GoalEvidenceEnvelope,
  GoalInput,
  GoalMutationContext,
  GoalOwnershipPort,
  GoalState,
  GoalStore,
} from './types.js';

function captureFields(raw: unknown, required: string[], optional: string[] = []): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.getOwnPropertySymbols(raw).length)
    throw Error('goal_native_mutation_shape');
  const fields = Object.getOwnPropertyDescriptors(raw), result: Record<string, unknown> = {};
  if (required.some(key => !Object.hasOwn(fields, key))) throw Error('goal_native_mutation_shape');
  for (const [key, descriptor] of Object.entries(fields)) {
    if (![...required, ...optional].includes(key) || !descriptor.enumerable || !('value' in descriptor))
      throw Error('goal_native_mutation_shape');
    if (descriptor.value !== undefined || required.includes(key)) result[key] = descriptor.value;
  }
  return result;
}

export interface GoalServiceOptions {
  store: GoalStore;
  ownership: GoalOwnershipPort;
  now?: () => number;
  nativeJournal?: FileGoalNativeJournal;
}

export class GoalService {
  private readonly now: () => number;

  constructor(private readonly options: GoalServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  load(sessionId: string): Promise<GoalDocument | null> {
    return this.options.store.load(sessionId);
  }

  async requestCompletion(context: GoalMutationContext, input: { taskId: string; turnId: string; summary: string }): Promise<GoalCompletionIntent> {
    context = structuredClone(context);
    input = structuredClone(input);
    this.requireSource(context, ['runtime']);
    await this.assertOwned(context);
    const current = await this.requireCurrent(context);
    const existing = current.completionIntents?.find(row => row.application.goalId === current.state.goalId
      && row.application.epoch === current.state.epoch && row.turnId === input.turnId);
    if (existing) {
      if (existing.taskId !== input.taskId || existing.summary !== input.summary) throw Error('goal_completion_claim_changed');
      return structuredClone(existing);
    }
    if (current.state.pendingCompletionIntentId) throw Error('goal_publication_pending');
    if (current.state.status !== 'active') throw Error('goal_completion_claim_inactive');
    if (current.turns.some(turn => turn.goalId === current.state.goalId && turn.epoch === current.state.epoch
      && turn.turnId === input.turnId)) throw Error('goal_completion_claim_turn_already_settled');
    const now = this.now(), intent = createGoalCompletionIntent({ state: current.state, ...input, now });
    const next = { ...current.state, revision: current.state.revision + 1, updatedAt: now };
    await this.commit({ sessionId: context.sessionId, expectedRevision: current.state.revision, next,
      events: [this.event(next, context, 'completion_claimed')], turns: [], evidence: [],
      completionIntent: { expectedRevision: null, next: intent } });
    return structuredClone(intent);
  }

  /** Persist an unapproved draft. This does not activate a Goal or authorize a
   * native request; both later phases must revalidate this complete basis. */
  async reserveNativeMutation(context: GoalMutationContext, raw: {
    kind: 'create' | 'replace'; input: GoalInput; definition: unknown; minimumEpoch?: number;
  }): Promise<GoalNativeMutation> {
    context = JSON.parse(canonicalJson(captureFields(context, ['sessionId', 'instanceId', 'requestSource', 'expectedRevision'])));
    const envelope = captureFields(raw, ['kind', 'input', 'definition'], ['minimumEpoch']);
    envelope.input = captureFields(envelope.input, ['objective', 'expectedEvidenceKinds'], ['completionCriterion', 'turnLimit']);
    const args = JSON.parse(canonicalJson(envelope)) as typeof raw;
    this.requireSource(context, ['user']);
    const journal = this.options.nativeJournal;
    if (!journal) throw Error('goal_native_journal_unavailable');
    if (args.kind !== 'create' && args.kind !== 'replace') throw Error('goal_native_mutation_kind');
    if (args.minimumEpoch !== undefined && (!Number.isSafeInteger(args.minimumEpoch) || args.minimumEpoch < 1
      || args.kind === 'create')) throw Error('goal_native_mutation_epoch');
    const definition = parseGoalVerificationDefinition(args.definition);
    let forkSource:GoalNativeMutation['forkSource'];
    await this.assertOwned(context);
    const document = await this.options.store.load(context.sessionId), current = document?.state ?? null;
    if (args.kind === 'create') {
      if (context.expectedRevision !== null) throw Error('Goal create expects null revision');
      if (current && !['complete', 'cancelled'].includes(current.status)) throw Error('A current goal already exists');
    } else {
      if (!current) throw Error('Goal not found');
      if (current.revision !== context.expectedRevision) throw Error('stale goal revision');
      for (const row of journal.load(context.sessionId)) {
        if (row.status === 'applied' && row.target.goalId === current.goalId && row.target.epoch === current.epoch)
          {assertGoalVerificationExtension(row.definition, definition);forkSource=row.forkSource;}
      }
    }
    // Goal persistence omits optional undefined fields. Hash those same durable
    // values, including status, usage and pending publication, not just revision.
    const basis = goalNativeStateHash(current), now = Math.max(this.now(), current?.updatedAt ?? 0, current?.createdAt ?? 0);
    const normalizedInput = { objective: args.input.objective, completionCriterion: args.input.completionCriterion,
      expectedEvidenceKinds: args.input.expectedEvidenceKinds, turnLimit: args.input.turnLimit };
    const candidate = args.kind === 'create'
      ? createGoalState({ ...normalizedInput, sessionId: context.sessionId, now })
      : reduceGoal(current!, { ...normalizedInput, type: 'replace', now });
    if (args.kind === 'replace') candidate.epoch = Math.max(candidate.epoch, args.minimumEpoch ?? 1);
    const row = parseGoalNativeMutation({ id: `goal_native_${randomUUID()}`, revision: 1,
      sessionId: context.sessionId, kind: args.kind,
      ...(forkSource?{forkSource}:{}),
      previous: current ? { goalId: current.goalId, epoch: current.epoch, revision: current.revision,
        createdAt: current.createdAt, forkedFromGoalId: current.forkedFromGoalId ?? null, stateHash: basis } : null,
      target: goalApplicationFromState(candidate), turnLimit: candidate.budgetLimits.turnLimit, definition,
      enrollmentRequestId: `goal_enroll_${randomUUID()}`, applicationRequestId: `goal_bind_${randomUUID()}`,
      status: 'reserved', createdAt: now, updatedAt: now });
    await this.assertOwned(context);
    if (goalNativeStateHash((await this.options.store.load(context.sessionId))?.state ?? null) !== basis)
      throw Error('goal_native_mutation_basis_changed');
    journal.put({ sessionId: context.sessionId, requestSource: 'user', expectedRevision: null, next: row });
    return row;
  }

  /** Explicit new-session fork. Original rules come only from the installed
   * authority; no caller-selected definition or previous proof is inherited. */
  async reserveNativeFork(context:GoalMutationContext,sourceSessionId:string,signal?:AbortSignal):Promise<GoalNativeMutation>{
    context=JSON.parse(canonicalJson(captureFields(context,['sessionId','instanceId','requestSource','expectedRevision'])));
    this.requireSource(context,['user']);
    const journal=this.options.nativeJournal;if(!journal)throw Error('goal_native_journal_unavailable');
    if(typeof sourceSessionId!=='string'||!sourceSessionId||Buffer.byteLength(sourceSessionId)>160||/[\x00-\x1f\x7f]/.test(sourceSessionId)||sourceSessionId===context.sessionId||context.expectedRevision!==null)throw Error('goal_native_fork_source');
    await this.assertOwned(context);signal?.throwIfAborted();
    if(await this.options.store.load(context.sessionId))throw Error('Target session already has a Goal');
    const original=await this.options.store.load(sourceSessionId);if(!original)throw Error('goal_native_fork_source');
    const state=original.state,stateHash=goalNativeStateHash(state),route=readInstalledCurrentOwner({ownerKind:'goal',ownerId:state.goalId});
    if(route.kind!=='protected-unregistered'&&route.kind!=='migrated')throw Error('goal_native_fork_authority');
    const client=createInstalledVerificationClient();
    try{
      const snapshot=await createOwnerEnrollmentClient(client.completionTransport).readGoalForkSource({ownerKind:'goal',ownerId:state.goalId,sessionId:sourceSessionId},signal);
      if(snapshot.source.authorityId!==route.authorityId||canonicalJson(snapshot.source.owner)!==canonicalJson(route.owner)
        ||canonicalJson(snapshot.application)!==canonicalJson(goalApplicationFromState(state)))throw Error('goal_native_fork_application');
      const definition=parseGoalVerificationDefinition({version:1,obligations:snapshot.registration.obligations.map(({obligation,recipe})=>({obligationId:obligation.obligationId,predicateId:obligation.predicateId,predicateVersion:obligation.predicateVersion,semantics:obligation.semantics,recipe}))});
      const now=Math.max(this.now(),state.updatedAt),candidate=createGoalState({sessionId:context.sessionId,objective:state.objective,completionCriterion:state.completionCriterion,expectedEvidenceKinds:state.expectedEvidenceKinds,turnLimit:state.budgetLimits.turnLimit,forkedFromGoalId:state.goalId,now});
      const row=parseGoalNativeMutation({id:`goal_native_${randomUUID()}`,revision:1,sessionId:context.sessionId,kind:'fork',previous:null,
        forkSource:{stateHash,snapshot},target:goalApplicationFromState(candidate),turnLimit:candidate.budgetLimits.turnLimit,definition,
        enrollmentRequestId:`goal_enroll_${randomUUID()}`,applicationRequestId:`goal_bind_${randomUUID()}`,status:'reserved',createdAt:now,updatedAt:now});
      await this.assertOwned(context);signal?.throwIfAborted();
      if(await this.options.store.load(context.sessionId)||goalNativeStateHash((await this.options.store.load(sourceSessionId))?.state??null)!==stateHash
        ||canonicalJson(readInstalledCurrentOwner({ownerKind:'goal',ownerId:state.goalId}))!==canonicalJson(route))throw Error('goal_native_fork_source_changed');
      signal?.throwIfAborted();journal.put({sessionId:context.sessionId,requestSource:'user',expectedRevision:null,next:row});return row;
    }finally{client.dispose();}
  }

  /** Fetch the original application's signed observation outside the host queue.
   * The closure consumes it once at the store's actual CAS boundary. */
  async prepareNativeMutationCommit(context: GoalMutationContext, mutationId: string, signal?: AbortSignal, assertAdmission?: () => void): Promise<{ commit(): Promise<GoalState> }> {
    context = JSON.parse(canonicalJson(captureFields(context, ['sessionId', 'instanceId', 'requestSource', 'expectedRevision'])));
    this.requireSource(context, ['user']);
    const journal = this.options.nativeJournal;
    if (!journal) throw Error('goal_native_journal_unavailable');
    await this.assertOwned(context);
    const row = journal.load(context.sessionId).find(item => item.id === mutationId);
    if (!row || row.status !== 'ready') throw Error('goal_native_mutation_not_ready');
    if (context.expectedRevision !== (row.kind === 'replace' ? row.previous!.revision : null)) throw Error('stale goal revision');
    const next = goalNativeCandidate(row);
    const authorized = await authorizeGoalNativeProjection(this.options.store, {
      sessionId: row.sessionId, expectedRevision: row.previous?.revision ?? null, next,
      events: [this.event(next, context, row.kind === 'fork' ? 'forked' : row.kind === 'create' ? 'created' : 'replaced')], turns: [], evidence: [],
    }, row, signal, assertAdmission);
    let used = false;
    return Object.freeze({ commit: async () => {
      if (used) throw Error('goal_native_projection_consumed');
      used = true;
      signal?.throwIfAborted(); await this.assertOwned(context); signal?.throwIfAborted();
      const latest = journal.load(context.sessionId).find(item => item.id === row.id);
      if (canonicalJson(latest ?? null) !== canonicalJson(row)) throw Error('goal_native_mutation_changed');
      await this.options.store.commit(authorized);
      // Goal committed first. If this durable record fails, recovery observes the
      // complete existing candidate; it must never replay the Goal write.
      journal.put({ sessionId: context.sessionId, requestSource: 'user', expectedRevision: row.revision,
        next: { ...row, revision: row.revision + 1, status: 'applied', updatedAt: Math.max(this.now(), row.updatedAt) } });
      return structuredClone(next);
    } });
  }

  /** Repairs only the post-commit journal gap. No Goal write, arm or SDK call. */
  async recoverNativeMutationCommit(context: GoalMutationContext, mutationId: string, signal?: AbortSignal): Promise<GoalState> {
    context = JSON.parse(canonicalJson(captureFields(context, ['sessionId', 'instanceId', 'requestSource', 'expectedRevision'])));
    this.requireSource(context, ['user', 'runtime']);
    const journal = this.options.nativeJournal;
    if (!journal) throw Error('goal_native_journal_unavailable');
    await this.assertOwned(context);
    const row = journal.load(context.sessionId).find(item => item.id === mutationId);
    if (!row || row.status !== 'ready') throw Error('goal_native_mutation_not_ready');
    const expected = goalNativeStateHash(goalNativeCandidate(row));
    const current = await this.requireCurrent(context);
    if (goalNativeStateHash(current.state) !== expected) throw Error('goal_native_mutation_basis_changed');
    await assertGoalNativeApplicationCurrent(row.target, signal);
    await this.assertOwned(context);
    const latest = await this.requireCurrent(context);
    if (goalNativeStateHash(latest.state) !== expected) throw Error('goal_native_mutation_basis_changed');
    signal?.throwIfAborted();
    journal.put({ sessionId: context.sessionId, requestSource: 'scheduler', expectedRevision: row.revision,
      next: { ...row, revision: row.revision + 1, status: 'applied', updatedAt: Math.max(this.now(), row.updatedAt) } });
    return latest.state;
  }

  async create(context: GoalMutationContext, input: GoalInput): Promise<GoalState> {
    this.requireSource(context, ['user']);
    await this.assertOwned(context);
    if (context.expectedRevision !== null) throw new Error('Goal create expects null revision');
    const existing = await this.options.store.load(context.sessionId);
    if (existing && !['complete', 'cancelled'].includes(existing.state.status)) {
      throw new Error('A current goal already exists');
    }
    const state = createGoalState({ ...input, sessionId: context.sessionId, now: this.now() });
    await this.commit({
      sessionId: context.sessionId,
      expectedRevision: existing?.state.revision ?? null,
      next: state,
      events: [this.event(state, context, 'created')],
      turns: [],
      evidence: [],
    });
    return state;
  }

  async fork(context: GoalMutationContext, source: GoalState): Promise<GoalState> {
    this.requireSource(context, ['user']);
    await this.assertOwned(context);
    if (context.expectedRevision !== null) throw new Error('Goal fork expects null revision');
    const existing = await this.options.store.load(context.sessionId);
    if (existing) throw new Error('Target session already has a Goal');
    const state = createGoalState({
      sessionId: context.sessionId,
      objective: source.objective,
      completionCriterion: source.completionCriterion,
      expectedEvidenceKinds: source.expectedEvidenceKinds,
      turnLimit: source.budgetLimits.turnLimit,
      forkedFromGoalId: source.goalId,
      now: this.now(),
    });
    await this.commit({
      sessionId: context.sessionId,
      expectedRevision: null,
      next: state,
      events: [this.event(state, context, 'forked')],
      turns: [],
      evidence: [],
    });
    return state;
  }

  async pause(context: GoalMutationContext, reason: string): Promise<GoalState> {
    this.requireSource(context, ['user', 'runtime']);
    return await this.mutate(context, 'paused', state => reduceGoal(state, {
      type: 'pause', reason, now: this.now(),
    }));
  }

  async resume(context: GoalMutationContext, input: { turnLimit?: number } = {}): Promise<GoalState> {
    this.requireSource(context, ['user']);
    return await this.mutate(context, 'resumed', state => reduceGoal(state, {
      type: 'resume', turnLimit: input.turnLimit, now: this.now(),
    }));
  }

  async resumePublication(context: GoalMutationContext): Promise<GoalState> {
    this.requireSource(context, ['user']);
    return this.mutate(context, 'publication_resumed', state => reduceGoal(state, { type: 'resume_publication', now: this.now() }));
  }

  async cancel(context: GoalMutationContext, reason: string): Promise<GoalState> {
    this.requireSource(context, ['user']);
    return await this.mutate(context, 'cancelled', state => reduceGoal(state, {
      type: 'cancel', reason, now: this.now(),
    }));
  }

  async replace(context: GoalMutationContext, input: GoalInput): Promise<GoalState> {
    this.requireSource(context, ['user']);
    return await this.mutate(context, 'replaced', state => reduceGoal(state, {
      type: 'replace', ...input, now: this.now(),
    }));
  }

  async complete(context: GoalMutationContext, reason: string): Promise<GoalState> {
    this.requireSource(context, ['user', 'runtime']);
    return await this.mutate(context, 'completed', state => reduceGoal(state, {
      type: 'complete', reason, now: this.now(),
    }));
  }

  /** Project only the original claim's committed publication; never approves it. */
  async completeClaim(context: GoalMutationContext, intentId: string): Promise<GoalState> {
    return (await this.prepareClaimCompletion(context, intentId)).commit();
  }

  /** Capture the fixed authority observation outside a host's serial queue.
   * The returned closure performs only ownership/CAS/persistence and is single use. */
  async prepareClaimCompletion(context: GoalMutationContext, intentId: string): Promise<{ commit(): Promise<GoalState> }> {
    context = structuredClone(context);
    this.requireSource(context, ['user', 'runtime']);
    await this.assertOwned(context);
    const current = await this.requireCurrent(context);
    const intent = await this.options.store.loadCompletionIntent(context.sessionId, intentId);
    if (current.state.pendingCompletionIntentId && current.state.pendingCompletionIntentId !== intentId) throw Error('goal_publication_intent_changed');
    if (!intent || intent.status !== 'committed' || intent.observation?.status !== 'committed'
      || canonicalJson(intent.application) !== canonicalJson(goalApplicationFromState(current.state))) {
      throw Error('goal_completion_intent_not_committed');
    }
    const next = reduceGoal(current.state, { type: 'complete', reason: intent.summary, now: this.now() });
    const authorized = await authorizeGoalCompletionProjection(this.options.store, {
      sessionId: context.sessionId, expectedRevision: current.state.revision, next,
      events: [this.event(next, context, 'completed')], turns: [], evidence: [], completionIntentId: intentId,
    });
    let used = false;
    return Object.freeze({ commit: async () => {
      if (used) throw Error('goal_projection_consumed');
      used = true;
      await this.assertOwned(context);
      await this.options.store.commit(authorized);
      return structuredClone(next);
    } });
  }

  async noteBlockedClaim(
    context: GoalMutationContext,
    input: { reason: string; fingerprint: string },
  ): Promise<GoalState> {
    this.requireSource(context, ['runtime']);
    return await this.mutate(context, 'blocker_noted', state => reduceGoal(state, {
      type: 'note_blocker', ...input, now: this.now(),
    }));
  }

  async recordTurn(context: GoalMutationContext, input: {
    turnId: string;
    tokensUsed: number;
    activeWallClockMs: number;
    evidence?: Array<GoalEvidenceEnvelope['record']>;
  }): Promise<GoalState> {
    this.requireSource(context, ['runtime']);
    await this.assertOwned(context);
    const current = await this.requireCurrent(context);
    if (this.isDuplicateTurn(current, input)) return current.state;
    const now = this.now();
    const next = reduceGoal(current.state, {
      type: 'record_turn', turnId: input.turnId, tokensUsed: input.tokensUsed,
      activeWallClockMs: input.activeWallClockMs, now,
    });
    const evidence = (input.evidence ?? []).map((record): GoalEvidenceEnvelope => ({
      goalId: current.state.goalId,
      epoch: current.state.epoch,
      goalTurnId: input.turnId,
      evidenceId: `goal_ev_${randomUUID()}`,
      record,
      recordedAt: now,
    }));
    await this.commit({
      sessionId: context.sessionId,
      expectedRevision: current.state.revision,
      next,
      events: [this.event(next, context, 'turn_recorded')],
      turns: [{
        goalId: current.state.goalId, epoch: current.state.epoch,
        turnId: input.turnId, tokensUsed: input.tokensUsed,
        activeWallClockMs: input.activeWallClockMs, recordedAt: now,
      }],
      evidence,
    });
    return next;
  }

  async settleTurn(context: GoalMutationContext, input: {
    turnId: string;
    tokensUsed: number;
    activeWallClockMs: number;
    evidence?: Array<GoalEvidenceEnvelope['record']>;
    terminalDecision:
      | { kind: 'none' }
      | { kind: 'complete'; reason: string }
      | { kind: 'publication_pending'; intentId: string }
      | { kind: 'blocked'; reason: string; fingerprint?: string }
      | { kind: 'blocker'; reason: string; fingerprint: string; threshold?: number }
      | { kind: 'paused'; reason: string };
  }): Promise<GoalState> {
    this.requireSource(context, ['runtime']);
    await this.assertOwned(context);
    const current = await this.requireCurrent(context);
    if (this.isDuplicateTurn(current, input)) return current.state;
    const now = this.now();
    if (input.terminalDecision.kind === 'publication_pending') {
      const intent = await this.options.store.loadCompletionIntent(context.sessionId, input.terminalDecision.intentId);
      if (!intent || intent.status !== 'claimed' || intent.turnId !== input.turnId
        || canonicalJson(intent.application) !== canonicalJson(goalApplicationFromState(current.state))) throw Error('goal_publication_intent_changed');
    }
    const next = reduceGoal(current.state, {
      type: 'settle_turn', turnId: input.turnId, tokensUsed: input.tokensUsed,
      activeWallClockMs: input.activeWallClockMs,
      terminalDecision: input.terminalDecision, now,
    });
    const evidence = (input.evidence ?? []).map((record): GoalEvidenceEnvelope => ({
      goalId: current.state.goalId,
      epoch: current.state.epoch,
      goalTurnId: input.turnId,
      evidenceId: `goal_ev_${randomUUID()}`,
      record,
      recordedAt: now,
    }));
    await this.commit({
      sessionId: context.sessionId,
      expectedRevision: current.state.revision,
      next,
      events: [this.event(next, context, 'turn_settled')],
      turns: [{
        goalId: current.state.goalId, epoch: current.state.epoch,
        turnId: input.turnId, tokensUsed: input.tokensUsed,
        activeWallClockMs: input.activeWallClockMs, recordedAt: now,
      }],
      evidence,
    });
    return next;
  }

  private async mutate(
    context: GoalMutationContext,
    eventType: string,
    reducer: (state: GoalState) => GoalState,
  ): Promise<GoalState> {
    await this.assertOwned(context);
    const current = await this.requireCurrent(context);
    const next = reducer(current.state);
    await this.commit({
      sessionId: context.sessionId,
      expectedRevision: current.state.revision,
      next,
      events: [this.event(next, context, eventType)],
      turns: [],
      evidence: [],
    });
    return next;
  }

  private async commit(input: GoalCommitInput): Promise<void> {
    const authorized = input.next.status === 'complete'
      ? await authorizeGoalCompletionProjection(this.options.store, input) : input;
    await this.options.store.commit(authorized);
  }

  private isDuplicateTurn(current: GoalDocument, input: {
    turnId: string; tokensUsed: number; activeWallClockMs: number; evidence?: Array<GoalEvidenceEnvelope['record']>;
  }): boolean {
    const original = current.turns.find(turn => turn.goalId === current.state.goalId
      && turn.epoch === current.state.epoch && turn.turnId === input.turnId);
    if (!original) return false;
    const evidence = current.evidence.filter(row => row.goalId === original.goalId && row.epoch === original.epoch
      && row.goalTurnId === original.turnId).map(row => row.record);
    if (original.tokensUsed !== input.tokensUsed || original.activeWallClockMs !== input.activeWallClockMs
      || canonicalJson(evidence) !== canonicalJson(input.evidence ?? [])) throw Error('goal_duplicate_turn_changed');
    return true;
  }

  private async requireCurrent(context: GoalMutationContext): Promise<GoalDocument> {
    const current = await this.options.store.load(context.sessionId);
    if (!current) throw new Error('Goal not found');
    if (current.state.revision !== context.expectedRevision) {
      throw new Error(`stale goal revision: expected ${context.expectedRevision}, found ${current.state.revision}`);
    }
    return current;
  }

  private async assertOwned(context: GoalMutationContext): Promise<void> {
    await this.options.ownership.assertOwned(context.sessionId, context.instanceId);
  }

  private requireSource(context: GoalMutationContext, allowed: GoalMutationContext['requestSource'][]): void {
    if (!allowed.includes(context.requestSource)) {
      throw new Error(`${context.requestSource} is not authorized for this Goal mutation`);
    }
  }

  private event(state: GoalState, context: GoalMutationContext, type: string) {
    return {
      eventId: `goal_event_${randomUUID()}`,
      goalId: state.goalId,
      revision: state.revision,
      type,
      actor: context.requestSource,
      recordedAt: this.now(),
    } as const;
  }
}
