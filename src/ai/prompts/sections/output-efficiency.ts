/**
 * Layer 7: Output efficiency — keep it brief.
 * English.
 */
export function getOutputEfficiencySection(): string {
  return [
    '# Output efficiency',
    'Keep your text output brief and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions.',
    '',
    'Focus text output on:',
    "- Decisions that need the user's input",
    '- High-level status updates at natural milestones',
    '- Errors or blockers that change the plan',
    '',
    "If you can say it in one sentence, don't use three. Prefer short, direct sentences over long explanations. This does not apply to code or tool calls.",
  ].join('\n');
}
