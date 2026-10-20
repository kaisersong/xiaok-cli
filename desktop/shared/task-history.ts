import type { TaskSnapshot } from './task-types.js';

export interface TaskPublicPresentation {
  version: 1;
  basis?: 'qualified_legacy_owner' | 'claimed_archive';
  taskId: string;
  sourceEpoch: string;
  prompt: string;
  includeUser: boolean;
}

/** Raw Task data only. External workflow/artifact additions have separate owners. */
export interface TaskHistoryRead {
  snapshot: TaskSnapshot;
  /** null means the public-input origin is unproven. Never use raw prompt as its replacement. */
  presentation: TaskPublicPresentation | null;
}
