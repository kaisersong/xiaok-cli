// An omitted prompt budget delegates the document character limit to the loader.
export function promptAutoContextBudget(readBudget: () => number | undefined): { maxChars?: number } {
  let omitted = false;
  // Resolve Math.max and its receiver before reading budget, as in the original expression.
  const maxChars = Math.max(1_200, scaledBudget());
  return omitted ? {} : { maxChars };

  function scaledBudget(): number {
    const budget = readBudget();
    omitted = budget === undefined;
    return budget === undefined ? NaN : budget * 2;
  }
}

export function resolveAutoContextMaxChars(maxChars: number | undefined): number {
  return maxChars ?? 8_000;
}

export function truncateContextContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }

  const suffix = '\n...(已截断)';
  const sliceLength = Math.max(0, maxChars - suffix.length);
  return {
    content: content.slice(0, sliceLength) + suffix,
    truncated: true,
  };
}
