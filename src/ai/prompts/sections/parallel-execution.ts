export function getParallelExecutionSection(): string {
  return [
    "# Parallel tools",
    "Batch independent tool calls in parallel (reads, searches and independent commands). Run dependent operations sequentially: read before edit, prerequisite before consumer, question before work requiring its answer.",
  ].join('\n');
}
