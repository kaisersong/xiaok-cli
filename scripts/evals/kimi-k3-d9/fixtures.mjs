import { canonicalSha256 } from './canonical.mjs';
import {
  D9_PROFILE_ORDER,
  D9_SAMPLES_PER_STRATUM,
  D9_STRATA,
  D9_SURFACE_ORDER,
} from './constants.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RUNTIME_TOKEN = Object.freeze({
  nonce: '{{NONCE}}',
  environmentDigest: '{{ENVIRONMENT_DIGEST}}',
  assignmentDigest: '{{ASSIGNMENT_DIGEST}}',
});

function fail(code) {
  throw new Error(code);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function markerFor(fixtureId, turnOrdinal) {
  return `D9_${canonicalSha256({ fixtureId, turnOrdinal }).slice(0, 16).toUpperCase()}`;
}

function toolPrompt({
  toolName,
  deterministicArguments,
  marker,
}) {
  const argumentsText = Object.entries(deterministicArguments)
    .map(([key, value]) => `${key}=${value}`)
    .join('、');
  return [
    `必须且只能调用 mcp__d9_fixture__${toolName} 工具一次。`,
    `确定性参数：${argumentsText}。`,
    `证明参数：nonce=${RUNTIME_TOKEN.nonce}、`,
    `environmentDigest=${RUNTIME_TOKEN.environmentDigest}、`,
    `assignmentDigest=${RUNTIME_TOKEN.assignmentDigest}。`,
    `工具成功后只回复 ${marker}。`,
  ].join('');
}

function noToolTurn(fixtureId, ordinal, prefix = '') {
  const expectedMarker = markerFor(fixtureId, ordinal);
  return {
    ordinal,
    kind: 'model',
    promptTemplate:
      `${prefix}不要调用任何工具，只回复 ${expectedMarker}。`,
    expectedMarker,
    expectedTool: null,
    deterministicArguments: null,
  };
}

function toolTurn(fixtureId, ordinal, toolName, deterministicArguments) {
  const expectedMarker = markerFor(fixtureId, ordinal);
  return {
    ordinal,
    kind: 'model',
    promptTemplate: toolPrompt({
      toolName,
      deterministicArguments,
      marker: expectedMarker,
    }),
    expectedMarker,
    expectedTool: toolName,
    deterministicArguments,
  };
}

function longHistory(fixtureId) {
  return Array.from(
    { length: 128 },
    (_, index) => (
      `D9-HISTORY ${fixtureId} ${String(index).padStart(3, '0')} `
      + canonicalSha256({ fixtureId, index }).slice(0, 24)
    ),
  ).join('\n');
}

function turnsFor({ fixtureId, stratum, sampleIndex }) {
  if (stratum.endsWith('no-tool-multiturn')) {
    return [
      noToolTurn(fixtureId, 1),
      noToolTurn(fixtureId, 2, '延续上一轮且保持同一会话。'),
    ];
  }
  if (stratum.endsWith('single-tool')) {
    return [
      toolTurn(
        fixtureId,
        1,
        'd9_fixture_echo',
        { value: sampleIndex + 1 },
      ),
      noToolTurn(fixtureId, 2, '确认上一轮工具已经完成。'),
    ];
  }
  if (stratum.endsWith('multi-tool')) {
    return [
      toolTurn(
        fixtureId,
        1,
        'd9_fixture_accumulate',
        { left: sampleIndex + 1, right: 10 },
      ),
      toolTurn(
        fixtureId,
        2,
        'd9_fixture_accumulate',
        { left: sampleIndex + 2, right: 20 },
      ),
      noToolTurn(fixtureId, 3, '确认前两轮工具都已经完成。'),
    ];
  }
  if (
    stratum === 'cli-long-history'
    || stratum === 'desktop-long-synthesized-history'
  ) {
    const history = longHistory(fixtureId);
    return [
      noToolTurn(
        fixtureId,
        1,
        `以下是只读合成历史，记住最后一行的序号，不要复述全文：\n${history}\n`,
      ),
      noToolTurn(fixtureId, 2, '继续使用刚才的合成历史上下文。'),
    ];
  }
  if (stratum === 'cli-compaction-parent-continuation') {
    const history = longHistory(fixtureId);
    return [
      noToolTurn(
        fixtureId,
        1,
        `这是同一 live task 的压缩前长上下文：\n${history}\n`,
      ),
      {
        ordinal: 2,
        kind: 'slash-command',
        promptTemplate: '/compact',
        expectedMarker: '已压缩较早对话',
        expectedTool: null,
        deterministicArguments: null,
      },
      noToolTurn(fixtureId, 3, '在同一 live task 压缩后继续。'),
    ];
  }
  if (stratum === 'desktop-new-invocation-recovery') {
    return [
      {
        ordinal: 1,
        kind: 'recovery',
        promptTemplate: '',
        expectedMarker: null,
        expectedTool: null,
        deterministicArguments: null,
      },
      noToolTurn(fixtureId, 2, '新 invocation 恢复发生在首个 assistant turn 之前。'),
      noToolTurn(fixtureId, 3, '继续恢复后的同一产品会话。'),
    ];
  }
  fail('KIMI_D9_FIXTURE_STRATUM_INVALID');
}

function boundaryFor(stratum) {
  if (stratum === 'cli-compaction-parent-continuation') {
    return {
      kind: 'same-live-task-compaction',
      sameLiveTask: true,
      canonicalHistoryRoleVector: ['system', 'user', 'tool'],
    };
  }
  if (stratum === 'desktop-new-invocation-recovery') {
    return {
      kind: 'before-first-assistant-recovery',
      recoveryPhase: 'before-first-assistant',
      canonicalHistoryRoleVector: ['system', 'user'],
    };
  }
  return null;
}

function createFixture(profile, surface, stratum, sampleIndex) {
  const fixtureId = [
    'd9',
    profile,
    surface,
    stratum,
    String(sampleIndex + 1).padStart(2, '0'),
  ].join(':');
  const turns = turnsFor({ fixtureId, stratum, sampleIndex });
  const history = (
    stratum === 'cli-long-history'
    || stratum === 'desktop-long-synthesized-history'
    || stratum === 'cli-compaction-parent-continuation'
  ) ? longHistory(fixtureId) : null;
  const payload = {
    fixtureId,
    profile,
    surface,
    stratum,
    turns,
    expectedToolInvocationCount:
      turns.filter(turn => turn.expectedTool !== null).length,
    validatorId: `d9-validator:${stratum}:v1`,
    timeoutMs: 120_000,
    latencyPenaltyMs: 150_000,
    synthesizedHistoryDigest:
      history === null ? null : canonicalSha256(history),
    boundary: boundaryFor(stratum),
  };
  return deepFreeze({
    ...payload,
    promptTemplateSha256: canonicalSha256(
      turns.map(turn => turn.promptTemplate),
    ),
    digest: canonicalSha256(payload),
  });
}

export function createFormalFixtures() {
  const fixtures = [];
  for (const profile of D9_PROFILE_ORDER) {
    for (const surface of D9_SURFACE_ORDER) {
      for (const stratum of D9_STRATA[surface]) {
        for (
          let sampleIndex = 0;
          sampleIndex < D9_SAMPLES_PER_STRATUM;
          sampleIndex += 1
        ) {
          fixtures.push(createFixture(
            profile,
            surface,
            stratum,
            sampleIndex,
          ));
        }
      }
    }
  }
  return deepFreeze(fixtures);
}

function replaceRuntimeTokens(template, runtime) {
  return template
    .replaceAll(RUNTIME_TOKEN.nonce, runtime.nonce)
    .replaceAll(RUNTIME_TOKEN.environmentDigest, runtime.environmentDigest)
    .replaceAll(RUNTIME_TOKEN.assignmentDigest, runtime.assignmentDigest);
}

export function materializeFixture(fixture, runtime) {
  if (
    !SHA256_PATTERN.test(runtime?.nonce)
    || !SHA256_PATTERN.test(runtime?.environmentDigest)
    || !SHA256_PATTERN.test(runtime?.assignmentDigest)
  ) {
    fail('KIMI_D9_FIXTURE_RUNTIME_INVALID');
  }
  const turns = fixture.turns.map(turn => ({
    ...turn,
    prompt: replaceRuntimeTokens(turn.promptTemplate, runtime),
  }));
  const expectedInvocations = turns
    .filter(turn => turn.expectedTool !== null)
    .map(turn => ({
      toolName: turn.expectedTool,
      canonicalArgs: JSON.stringify(turn.deterministicArguments),
      cwd: runtime.cwd ?? '',
      nonce: runtime.nonce,
      environmentDigest: runtime.environmentDigest,
      assignmentDigest: runtime.assignmentDigest,
    }));
  return deepFreeze({
    ...fixture,
    turns,
    expectedInvocations,
  });
}
