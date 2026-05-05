/**
 * Layer: Task decomposition philosophy — structured approach to complex work.
 * English for stable model comprehension.
 */
export function getDecompositionSection(): string {
  return [
    '# Decomposition philosophy',
    '',
    '**Always decompose before you act**. When facing a non-trivial task, break it down first rather than jumping straight to implementation.',
    '',
    'Decomposition patterns:',
    '- **PREVIEW**: Before editing a large file, preview its structure (read relevant sections first)',
    '- **CHUNK**: Split large operations into smaller, verifiable chunks',
    '- **RECURSIVE**: For nested structures, process one level at a time and verify before proceeding deeper',
    '',
    'Decomposition triggers:',
    '- Files with >100 lines that need modification',
    '- Multi-file operations affecting >3 files',
    '- Commands that may have side effects beyond immediate output',
    '- Tasks with unclear scope or multiple possible approaches',
    '',
    'After decomposition, execute chunk-by-chunk with verification between chunks.',
  ].join('\n');
}