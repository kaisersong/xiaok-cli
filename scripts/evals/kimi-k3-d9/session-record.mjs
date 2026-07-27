import { createHash } from 'node:crypto';

const CLI_STRATA = new Set([
  'cli-no-tool-multiturn',
  'cli-single-tool',
  'cli-multi-tool',
  'cli-long-history',
  'cli-compaction-parent-continuation',
]);

function fail(code) {
  throw new Error(code);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isNullableNonnegativeNumber(value) {
  return value === null
    || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function validUsageEvidence(usage) {
  if (
    typeof usage !== 'object'
    || usage === null
    || !['complete', 'incomplete', 'missing'].includes(usage.status)
  ) {
    return false;
  }
  if (usage.status === 'complete') {
    return Number.isSafeInteger(usage.inputTokens)
      && usage.inputTokens >= 0
      && Number.isSafeInteger(usage.outputTokens)
      && usage.outputTokens >= 0;
  }
  return usage.inputTokens === null && usage.outputTokens === null;
}

export function reduceCliUsageEvidence({ stratum, perTurnSnapshots }) {
  if (!CLI_STRATA.has(stratum)) {
    fail('KIMI_D9_CLI_USAGE_INVALID');
  }
  if (stratum === 'cli-single-tool' || stratum === 'cli-multi-tool') {
    return Object.freeze({
      status: 'incomplete',
      inputTokens: null,
      outputTokens: null,
    });
  }
  if (
    !Array.isArray(perTurnSnapshots)
    || perTurnSnapshots.length === 0
    || perTurnSnapshots.some(usage =>
      !Number.isSafeInteger(usage?.inputTokens)
      || usage.inputTokens < 0
      || !Number.isSafeInteger(usage?.outputTokens)
      || usage.outputTokens < 0)
  ) {
    return Object.freeze({
      status: 'missing',
      inputTokens: null,
      outputTokens: null,
    });
  }
  return Object.freeze({
    status: 'complete',
    inputTokens: perTurnSnapshots.reduce(
      (sum, usage) => sum + usage.inputTokens,
      0,
    ),
    outputTokens: perTurnSnapshots.reduce(
      (sum, usage) => sum + usage.outputTokens,
      0,
    ),
  });
}

function validateTurn(turn) {
  return typeof turn === 'object'
    && turn !== null
    && typeof turn.marker === 'string'
    && turn.marker.length > 0
    && isNullableNonnegativeNumber(turn.ttfvMs)
    && isNullableNonnegativeNumber(turn.totalLatencyMs)
    && ['completed', 'failed', 'timeout'].includes(turn.terminalStatus)
    && typeof turn.semanticPassed === 'boolean'
    && typeof turn.continuityPassed === 'boolean'
    && Array.isArray(turn.expectedToolNames)
    && turn.expectedToolNames.every(name => typeof name === 'string')
    && Array.isArray(turn.observedToolCalls)
    && turn.observedToolCalls.every(call => (
      typeof call === 'object'
      && call !== null
      && !Array.isArray(call)
      && Object.keys(call).length === 2
      && typeof call.name === 'string'
      && typeof call.ok === 'boolean'
    ));
}

function boundedCompaction(stratum, compaction) {
  if (stratum !== 'cli-compaction-parent-continuation') {
    if (compaction !== null) {
      fail('KIMI_D9_CLI_COMPACTION_EVIDENCE_INVALID');
    }
    return null;
  }
  if (
    typeof compaction !== 'object'
    || compaction === null
    || compaction.sameLiveTask !== true
    || compaction.productNoticeObserved !== true
    || compaction.recordCount !== 1
    || !Number.isSafeInteger(compaction.replacedMessages)
    || compaction.replacedMessages <= 0
  ) {
    fail('KIMI_D9_CLI_COMPACTION_EVIDENCE_INVALID');
  }
  return Object.freeze({
    sameLiveTask: true,
    productNoticeObserved: true,
    recordCount: 1,
    replacedMessages: compaction.replacedMessages,
  });
}

export function buildBoundedCliSessionRecord(input) {
  if (
    typeof input !== 'object'
    || input === null
    || !['k3', 'k3-256k'].includes(input.profile)
    || !['baseline', 'candidate'].includes(input.arm)
    || !CLI_STRATA.has(input.stratum)
    || typeof input.fixtureId !== 'string'
    || input.fixtureId.length === 0
    || !/^[0-9a-f]{64}$/u.test(input.closureManifestHash)
    || !Number.isSafeInteger(input.processId)
    || input.processId <= 0
    || typeof input.sessionId !== 'string'
    || input.sessionId.length === 0
    || !Number.isSafeInteger(input.processIdentityObservationCount)
    || input.processIdentityObservationCount <= 0
    || !Number.isSafeInteger(input.sessionIdentityObservationCount)
    || input.sessionIdentityObservationCount <= 0
    || !Array.isArray(input.turns)
    || input.turns.length < 2
    || input.turns.some(turn => !validateTurn(turn))
    || !validUsageEvidence(input.usage)
    || ![
      null,
      'provider-error',
      'reasoning-400',
      'reasoning-422',
    ].includes(input.providerErrorClass)
    || input.promptCacheKeySent !== false
  ) {
    fail('KIMI_D9_CLI_SESSION_RECORD_INVALID');
  }
  const compaction = boundedCompaction(input.stratum, input.compaction);
  const turns = input.turns.map((turn, turnIndex) => {
    const toolSuccess = turn.expectedToolNames.length
      === turn.observedToolCalls.length
      && turn.expectedToolNames.every(
        (name, index) => name === turn.observedToolCalls[index].name,
      )
      && turn.observedToolCalls.every(call => call.ok === true);
    return Object.freeze({
      turnIndex,
      ttfvMs: turn.ttfvMs,
      totalLatencyMs: turn.totalLatencyMs,
      terminalStatus: turn.terminalStatus,
      expectedToolCount: turn.expectedToolNames.length,
      observedToolCount: turn.observedToolCalls.length,
      markerObserved: turn.ttfvMs !== null,
      semanticSuccess: turn.semanticPassed,
      continuitySuccess: turn.continuityPassed,
      toolSuccess,
    });
  });
  const completedTurnCount = turns.filter(
    turn => turn.terminalStatus === 'completed',
  ).length;
  const missingTimingCount = turns.filter(
    turn => turn.ttfvMs === null || turn.totalLatencyMs === null,
  ).length;
  const timeoutCount = turns.filter(
    turn => turn.terminalStatus === 'timeout',
  ).length;
  const observedToolNames = input.turns.flatMap(
    turn => turn.observedToolCalls.map(call => call.name),
  );
  const failedToolCallCount = input.turns.reduce(
    (count, turn) => count + turn.observedToolCalls.filter(
      call => call.ok === false,
    ).length,
    0,
  );
  const taskSuccess = completedTurnCount === turns.length
    && turns.every(
      turn => turn.markerObserved && turn.semanticSuccess,
    );
  const toolSuccess = turns.every(turn => turn.toolSuccess);
  const continuitySuccess = turns.every(
    turn => (
      turn.terminalStatus === 'completed'
      && turn.markerObserved
      && turn.continuitySuccess
    ),
  );
  const status = taskSuccess && toolSuccess && continuitySuccess
    && input.providerErrorClass === null
      ? 'completed'
    : 'failed';
  const allTotalLatencyPresent = turns.every(
    turn => turn.totalLatencyMs !== null,
  );

  const record = {
    schemaVersion: 1,
    surface: 'cli',
    profile: input.profile,
    arm: input.arm,
    stratum: input.stratum,
    fixtureDigest: sha256(input.fixtureId),
    closureManifestHash: input.closureManifestHash,
    processIdentityDigest: sha256(input.processId),
    sessionIdentityDigest: sha256(input.sessionId),
    processIdentityObservationCount:
      input.processIdentityObservationCount,
    sessionIdentityObservationCount:
      input.sessionIdentityObservationCount,
    status,
    plannedTurnCount: turns.length,
    completedTurnCount,
    missingTimingCount,
    timeoutCount,
    reasoningRelated4xxCount:
      input.providerErrorClass === 'reasoning-400'
      || input.providerErrorClass === 'reasoning-422'
        ? 1
        : 0,
    providerErrorCount: input.providerErrorClass === null ? 0 : 1,
    timeToFirstUserVisibleAssistantContentMs: turns[0].ttfvMs,
    totalLatencyMs: allTotalLatencyPresent
      ? turns.reduce((sum, turn) => sum + turn.totalLatencyMs, 0)
      : null,
    taskSuccess,
    toolSuccess,
    continuitySuccess,
    turns,
    observedToolNames,
    failedToolCallCount,
    usage: Object.freeze({ ...input.usage }),
    compaction,
    promptCacheKeySent: false,
  };
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  if (bytes > 16_384) {
    fail('KIMI_D9_CLI_SESSION_RECORD_TOO_LARGE');
  }
  return Object.freeze(record);
}

export function validateCliStratumEvidence(evidence) {
  if (
    !Array.isArray(evidence?.processIds)
    || new Set(evidence.processIds).size !== 1
    || !Array.isArray(evidence.sessionIds)
    || new Set(evidence.sessionIds).size !== 1
  ) {
    fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
  }
  if (evidence.stratum === 'cli-compaction-parent-continuation') {
    boundedCompaction(evidence.stratum, evidence.compaction);
    if (evidence.fixtureInvocations !== 0) {
      fail('KIMI_D9_CLI_COMPACTION_EVIDENCE_INVALID');
    }
  }
  return Object.freeze({ success: true, stratum: evidence.stratum });
}
