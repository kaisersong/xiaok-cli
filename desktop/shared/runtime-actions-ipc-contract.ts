import { z } from 'zod';
export const RUNTIME_ACTION_METHODS = ['start', 'stop', 'restart', 'resumeWorkflowRun'] as const;
export type RuntimeActionMethod = typeof RUNTIME_ACTION_METHODS[number];
// Empty ids retain the original resolved invalid_input business result.
export const RUNTIME_RESUME_INPUT = z.object({ projectId: z.string(), workflowRunId: z.string() }).strict();
export const RUNTIME_RESUME_OUTPUT = z.object({ restored: z.boolean(), reason: z.string().optional(), jobId: z.string().optional() }).passthrough();
export const RUNTIME_ACTION_INPUTS = { start: z.tuple([]), stop: z.tuple([]), restart: z.tuple([]), resumeWorkflowRun: z.tuple([RUNTIME_RESUME_INPUT]) } as const;
export const RUNTIME_ACTION_OUTPUTS = { start: z.undefined(), stop: z.undefined(), restart: z.undefined(), resumeWorkflowRun: RUNTIME_RESUME_OUTPUT } as const;
