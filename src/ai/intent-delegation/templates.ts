import type { DelegationTemplate } from './types.js';

export const DELEGATION_TEMPLATES: readonly DelegationTemplate[] = [
  {
    id: 'generate_v1',
    intentType: 'generate',
    label: 'Generate deliverable from source materials',
    steps: [
      { key: 'collect', role: 'collect', label: 'Collect materials', required: true },
      { key: 'normalize', role: 'normalize', label: 'Normalize inputs', required: true },
      { key: 'compose', role: 'compose', label: 'Compose deliverable', required: true },
      {
        key: 'validate',
        role: 'validate',
        label: 'Validate result',
        required: true,
        fallbackRoles: ['compose'],
      },
    ],
  },
  {
    id: 'revise_v1',
    intentType: 'revise',
    label: 'Revise existing output',
    steps: [
      {
        key: 'inspect_current',
        role: 'inspect_current',
        label: 'Inspect current version',
        required: true,
      },
      {
        key: 'identify_delta',
        role: 'identify_delta',
        label: 'Identify requested changes',
        required: true,
      },
      { key: 'rewrite', role: 'rewrite', label: 'Rewrite content', required: true },
      {
        key: 'validate',
        role: 'validate',
        label: 'Validate revision',
        required: true,
        fallbackRoles: ['rewrite'],
      },
    ],
  },
  {
    id: 'summarize_v1',
    intentType: 'summarize',
    label: 'Summarize source materials',
    steps: [
      { key: 'collect', role: 'collect', label: 'Collect materials', required: true },
      { key: 'extract', role: 'extract', label: 'Extract key points', required: true },
      { key: 'structure', role: 'structure', label: 'Structure summary', required: true },
      { key: 'finalize', role: 'finalize', label: 'Finalize summary', required: true },
    ],
  },
  {
    id: 'analyze_v1',
    intentType: 'analyze',
    label: 'Analyze and conclude',
    steps: [
      { key: 'collect', role: 'collect', label: 'Collect inputs', required: true },
      { key: 'compare', role: 'compare', label: 'Compare evidence', required: true },
      { key: 'conclude', role: 'conclude', label: 'Draw conclusion', required: true },
      {
        key: 'validate',
        role: 'validate',
        label: 'Validate reasoning',
        required: true,
        fallbackRoles: ['conclude'],
      },
    ],
  },
];
