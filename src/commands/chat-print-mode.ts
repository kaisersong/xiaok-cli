import type { UsageStats } from '../types.js';

export interface PrintResult {
  sessionId: string;
  text: string;
  usage: UsageStats;
}

export function formatPrintOutput(result: PrintResult, asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }

  return result.text;
}
