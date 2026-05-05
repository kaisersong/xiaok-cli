/**
 * Layer: Parallel-first heuristic — maximize concurrent operations.
 * English for stable model comprehension.
 */
export function getParallelExecutionSection(): string {
  return [
    '# Parallel execution heuristic',
    '',
    '**Parallel-first**: When operations have no dependencies, batch them into one turn.',
    '',
    'Parallel execution rules:',
    '- Multiple independent file reads: call Read for all files in one response',
    '- Multiple independent searches: call Grep/Glob for all patterns in one response',
    '- Multiple independent Bash commands: combine into single compound command or parallel calls',
    '- Dependent operations MUST be sequential (read then edit, analyze then act)',
    '',
    'Parallel detection:',
    '- If operation A does not need output from operation B, they can be parallel',
    '- If operation A validates/uses output from operation B, they must be sequential',
    '',
    'Maximize efficiency by reducing round-trips. One turn with 5 parallel reads is better than 5 turns with 1 read each.',
  ].join('\n');
}