export function tokenizeBaseline(query, segment = (value) => value) {
  return [...new Set(
    segment(query)
      .split(/\s+/u)
      .filter(Boolean)
      .map((term) => term.toLowerCase()),
  )];
}

function sourceChunks(source) {
  if (Array.isArray(source.chunks)) return source.chunks;
  return [{ chunkId: `${source.sourceId}:0`, text: source.body }];
}

export function runSubstringBaseline({
  sources,
  query,
  topK = 10,
  segment = (value) => value,
}) {
  const terms = tokenizeBaseline(query, segment);
  if (terms.length === 0) return [];

  let insertionIndex = 0;
  const hits = [];
  for (const source of sources) {
    for (const chunk of sourceChunks(source)) {
      const lower = chunk.text.toLowerCase();
      const matchedTerms = terms.filter((term) => lower.includes(term));
      if (matchedTerms.length > 0) {
        hits.push({
          sourceId: source.sourceId,
          sourceIds: [source.sourceId],
          title: source.title,
          chunkId: chunk.chunkId,
          text: chunk.text,
          matchedTerms,
          score: matchedTerms.length / terms.length,
          insertionIndex,
        });
      }
      insertionIndex += 1;
    }
  }

  return hits
    .sort((left, right) => right.score - left.score || left.insertionIndex - right.insertionIndex)
    .slice(0, topK)
    .map(({ insertionIndex: _insertionIndex, ...hit }) => hit);
}
