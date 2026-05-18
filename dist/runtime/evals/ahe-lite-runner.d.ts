import { type AheLiteEvalResult } from './result-schema.js';
export interface AheLiteEvalSummary {
    schemaVersion: 1;
    generatedAt: string;
    recommendation: 'ship' | 'revise' | 'rollback' | 'inconclusive';
    baselinePath: string;
    metrics: {
        redactionLeakCount: number;
        contractPassRate: number;
        incidentPrimaryFindingRate: number;
        generalChatFalseBlockCount: number;
        emptyArtifactDetectionRate: number;
        traceSchemaValidRate: number;
        baselineExplainabilityRate: number;
    };
    results: AheLiteEvalResult[];
}
export declare function runAheLiteEval(input: {
    outputPath: string;
    traceRoot: string;
    now?: () => Date;
}): Promise<AheLiteEvalSummary>;
