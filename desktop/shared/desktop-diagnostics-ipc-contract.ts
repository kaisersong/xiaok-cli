import { z } from 'zod';
import type { DiagnosisReport } from '../../src/runtime/diagnostics/types.js';
export type DesktopDiagnosisReport = DiagnosisReport;
export type DesktopTraceTarget = { kind: 'session' | 'project' | 'task'; id: string };
export type DesktopTraceExportResult = { ok: boolean; path?: string; error?: string };
export interface DesktopSkillStats {
  skillName: string; totalCalls: number; successCount: number; errorCount: number;
  avgDurationMs: number; p95DurationMs: number; totalInputTokens: number;
  totalOutputTokens: number; lastCalledAt: number; firstCalledAt: number;
}
/** Public target DTO is reused at the captured single-target tuple boundary. */
export const DESKTOP_TRACE_TARGET_SCHEMA = z.object({ kind: z.enum(['session', 'project', 'task']), id: z.string() }).passthrough();
const historicalNumber = z.custom<number>(value => typeof value === 'number');
const finding = z.object({ id: z.string(), severity: z.enum(['critical','high','medium','low']),
  category: z.enum(['blocked_task','dispatch_stalled','empty_artifact','approval_wait','missing_verification','protected_output','missing_recovery_runtime','quality_failure','unknown']),
  title: z.string(), explanation: z.string(), confidence: z.number(), evidenceIds: z.array(z.string()),
}).passthrough();
export const DIAGNOSTICS_IPC_CHANNELS = Object.freeze({ getSkillStats: 'desktop:getSkillStats', exportTraceBundle: 'desktop:trace:export', diagnose: 'desktop:diagnose' });
export type DesktopDiagnosticsMethod = keyof typeof DIAGNOSTICS_IPC_CHANNELS;
export const DIAGNOSTICS_INPUT_QUALIFICATION = Object.freeze({ getSkillStats: 'qualified-zero-tuple', exportTraceBundle: 'qualified-target-tuple', diagnose: 'qualified-target-tuple' });
export const DIAGNOSTICS_INPUT_SCHEMAS = Object.freeze({
  getSkillStats: z.tuple([]).describe(DIAGNOSTICS_INPUT_QUALIFICATION.getSkillStats),
  exportTraceBundle: z.tuple([DESKTOP_TRACE_TARGET_SCHEMA]).describe(DIAGNOSTICS_INPUT_QUALIFICATION.exportTraceBundle),
  diagnose: z.tuple([DESKTOP_TRACE_TARGET_SCHEMA]).describe(DIAGNOSTICS_INPUT_QUALIFICATION.diagnose),
});
export const DIAGNOSTICS_OUTPUT_SCHEMAS = Object.freeze({
  getSkillStats: z.array(z.object({ skillName: z.string(), totalCalls: historicalNumber, successCount: historicalNumber,
    errorCount: historicalNumber, avgDurationMs: historicalNumber, p95DurationMs: historicalNumber,
    totalInputTokens: historicalNumber, totalOutputTokens: historicalNumber, lastCalledAt: historicalNumber, firstCalledAt: historicalNumber,
  }).passthrough()),
  exportTraceBundle: z.object({ ok: z.boolean(), path: z.string().optional(), error: z.string().optional() }).passthrough(),
  diagnose: z.object({ schemaVersion: z.literal(1), target: z.object({kind: z.enum(['session','project','task']),id:z.string().optional()}).passthrough(),
    generatedAt:z.string(),health:z.enum(['healthy','running','waiting','blocked','failed','unknown']),primaryFinding:finding.nullable(),findings:z.array(finding),
    recommendedActions:z.array(z.object({id:z.string(),label:z.string(),recommended:z.boolean().optional()}).passthrough()),
    evidence:z.array(z.object({id:z.string(),label:z.string(),data:z.record(z.string(),z.unknown()).optional()}).passthrough()),
  }).passthrough(),
});
