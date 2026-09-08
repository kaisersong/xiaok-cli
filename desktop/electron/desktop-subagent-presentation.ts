import { publicAgentSummary } from '../../src/ai/agents/subagent-presentation.js';

/** Same public sanitization as CLI; never persist terminal formatting in Desktop. */
export function desktopSubAgentSummary(value: string, limit = 180): string {
  return publicAgentSummary(Buffer.from(value, 'utf8').toString('utf8'), limit).replace(/[\uD800-\uDBFF]$/, '');
}
