export type BashRiskLevel = 'safe' | 'warn' | 'block';
export interface BashRiskResult {
    level: BashRiskLevel;
    reason?: string;
}
export declare function classifyBashCommand(command: string): BashRiskResult;
export declare function requiresAutoPromptForBashCommand(command: string): BashRiskResult | null;
