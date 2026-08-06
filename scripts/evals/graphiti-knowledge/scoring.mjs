const GRAPH_TARGETED_CATEGORIES = Object.freeze([
  'alias',
  'multi_hop',
  'temporal',
  'provenance',
]);

function hitText(hit) {
  return [hit.text, hit.fact, hit.name, hit.summary]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase();
}

function hitEpisodeUuids(hit) {
  return Array.isArray(hit.episodeUuids)
    ? hit.episodeUuids.filter((value) => typeof value === 'string')
    : [];
}

function hitSourceIds(hit) {
  if (Array.isArray(hit.sourceIds)) return hit.sourceIds.filter((value) => typeof value === 'string');
  return typeof hit.sourceId === 'string' ? [hit.sourceId] : [];
}

function isActiveAt(hit, validAt) {
  if (typeof hit.validAt !== 'string') return false;
  const target = Date.parse(validAt);
  const starts = Date.parse(hit.validAt);
  if (!Number.isFinite(target) || !Number.isFinite(starts) || starts > target) return false;
  if (hit.invalidAt === null || hit.invalidAt === undefined) return true;
  if (typeof hit.invalidAt !== 'string') return false;
  const ends = Date.parse(hit.invalidAt);
  return Number.isFinite(ends) && target < ends;
}

function sourceCovered(sourceId, hits, mode, sourceEpisodeMap) {
  if (mode === 'baseline') {
    return hits.some((hit) => hitSourceIds(hit).includes(sourceId));
  }
  const episodeUuid = sourceEpisodeMap[sourceId];
  return typeof episodeUuid === 'string'
    && hits.some((hit) => hitEpisodeUuids(hit).includes(episodeUuid));
}

function provenanceCovered(sourceId, hits, sourceEpisodeMap) {
  const episodeUuid = sourceEpisodeMap[sourceId];
  if (typeof episodeUuid !== 'string') return false;
  return hits.some((hit) => (
    typeof hit.edgeUuid === 'string'
    && hitEpisodeUuids(hit).includes(episodeUuid)
    && Array.isArray(hit.provenanceEdgeUuids)
    && hit.provenanceEdgeUuids.includes(hit.edgeUuid)
  ));
}

export function scoreQuestion(question, hits, { mode, sourceEpisodeMap }) {
  const temporalMatch = mode !== 'graph'
    || question.category !== 'temporal'
    || hits.some((hit) => isActiveAt(hit, question.validAt));
  const eligibleHits = mode === 'graph' && question.category === 'temporal'
    ? hits.filter((hit) => isActiveAt(hit, question.validAt))
    : hits;
  const haystack = eligibleHits.map(hitText).join('\n');
  const termMatch = question.expectedAnyTerms
    .some((term) => haystack.includes(term.toLowerCase()));
  const forbiddenMatch = Array.isArray(question.forbiddenTerms)
    && question.forbiddenTerms.some((term) => haystack.includes(term.toLowerCase()));
  const sourceMatch = question.expectedSourceIds
    .every((sourceId) => sourceCovered(sourceId, eligibleHits, mode, sourceEpisodeMap));
  const provenanceMatch = question.category !== 'provenance'
    || (mode === 'graph'
      ? question.expectedSourceIds.every((sourceId) => provenanceCovered(sourceId, eligibleHits, sourceEpisodeMap))
      : sourceMatch);

  return Object.freeze({
    questionId: question.id,
    category: question.category,
    correct: termMatch && !forbiddenMatch && sourceMatch && temporalMatch && provenanceMatch,
    termMatch,
    forbiddenMatch,
    sourceMatch,
    temporalMatch,
    provenanceMatch,
  });
}

function ratio(scores) {
  const total = scores.length;
  const correct = scores.filter((score) => score.correct === true).length;
  return Object.freeze({
    correct,
    total,
    accuracy: total === 0 ? 0 : correct / total,
  });
}

export function aggregateReplica({ completed, baselineScores, graphScores, failureCode }) {
  const byCategory = {};
  const baselineByCategory = {};
  for (const category of [...GRAPH_TARGETED_CATEGORIES, 'control']) {
    byCategory[category] = ratio(graphScores.filter((score) => score.category === category));
    baselineByCategory[category] = ratio(baselineScores.filter((score) => score.category === category));
  }
  return Object.freeze({
    completed: completed === true,
    ...(failureCode ? { failureCode } : {}),
    questionCount: graphScores.length,
    baselineQuestionCount: baselineScores.length,
    categories: Object.freeze(byCategory),
    baselineCategories: Object.freeze(baselineByCategory),
    graphTargeted: ratio(graphScores.filter((score) => GRAPH_TARGETED_CATEGORIES.includes(score.category))),
    baselineGraphTargeted: ratio(baselineScores.filter((score) => GRAPH_TARGETED_CATEGORIES.includes(score.category))),
    temporal: byCategory.temporal,
    provenance: byCategory.provenance,
    control: byCategory.control,
    baselineControl: baselineByCategory.control,
  });
}

function combineRatios(replicas, key) {
  const correct = replicas.reduce((sum, replica) => sum + replica[key].correct, 0);
  const total = replicas.reduce((sum, replica) => sum + replica[key].total, 0);
  return Object.freeze({ correct, total, accuracy: total === 0 ? 0 : correct / total });
}

export function qualifyReplicas(replicas, safety) {
  const safetyReasons = [];
  if (safety.unauthorizedMutationCount > 0) safetyReasons.push('UNAUTHORIZED_MUTATION_DETECTED');
  if (safety.crossGroupLeakCount > 0) safetyReasons.push('CROSS_GROUP_CANARY_LEAK_DETECTED');
  if (safetyReasons.length > 0) {
    return Object.freeze({ recommendation: 'NO_GO', reasons: Object.freeze(safetyReasons) });
  }

  const complete = replicas.length === 3 && replicas.every((replica) => (
    replica.completed === true
    && replica.questionCount === 30
    && replica.baselineQuestionCount === 30
  ));
  if (!complete) {
    return Object.freeze({
      recommendation: 'INCOMPLETE',
      reasons: Object.freeze(['QUALIFICATION_REQUIRES_THREE_COMPLETE_REPLICAS']),
    });
  }

  const metrics = Object.freeze({
    graphTargeted: combineRatios(replicas, 'graphTargeted'),
    baselineGraphTargeted: combineRatios(replicas, 'baselineGraphTargeted'),
    temporal: combineRatios(replicas, 'temporal'),
    provenance: combineRatios(replicas, 'provenance'),
    control: combineRatios(replicas, 'control'),
    baselineControl: combineRatios(replicas, 'baselineControl'),
  });
  const graphTargetedGain = metrics.graphTargeted.accuracy - metrics.baselineGraphTargeted.accuracy;
  const reasons = [];
  if (graphTargetedGain < 0.15) reasons.push('GRAPH_TARGETED_GAIN_BELOW_15PP');
  if (metrics.temporal.accuracy < 0.90) reasons.push('TEMPORAL_ACCURACY_BELOW_90_PERCENT');
  if (metrics.provenance.accuracy < 1) reasons.push('PROVENANCE_BELOW_100_PERCENT');
  if (metrics.control.accuracy < metrics.baselineControl.accuracy) reasons.push('CONTROL_BELOW_BASELINE');

  return Object.freeze({
    recommendation: reasons.length === 0 ? 'GO' : 'NO_GO',
    reasons: Object.freeze(reasons),
    graphTargetedGain,
    metrics,
  });
}
