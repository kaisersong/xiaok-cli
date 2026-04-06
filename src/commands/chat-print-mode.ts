import type { UsageStats } from '../types.js';

export interface PrintResult {
  sessionId: string;
  text: string;
  usage: UsageStats;
  /** Number of turns in the conversation */
  num_turns?: number;
  /** Number of AskUserQuestion tool calls */
  ask_user_calls?: number;
  /** List of tools called */
  tool_calls?: string[];
  /** Duration in milliseconds */
  duration_ms?: number;
}

export function formatPrintOutput(result: PrintResult, asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }

  return result.text;
}
