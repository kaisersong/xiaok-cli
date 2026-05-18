import type { TraceBundleV1 } from '../trace/schema.js';
import type { DiagnosisFinding, DiagnosisReport } from './types.js';
export declare function diagnoseTraceBundle(bundle: TraceBundleV1): DiagnosisReport;
export declare function formatDiagnosisMarkdown(report: DiagnosisReport): string;
export declare function choosePrimaryFinding(findings: DiagnosisFinding[]): DiagnosisFinding | null;
