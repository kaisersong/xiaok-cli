export type AgentRunOutcome = 'completed' | 'failed' | 'cancelled';
export interface AgentActivityRun {
  runId: string; groupId: string; threadId: string; bootId: string;
  kind: 'root' | 'user_followup'; originId: string; rootTaskId?: string;
  state: 'accepted' | 'running' | 'unknown' | AgentRunOutcome;
  acceptedAt: number; startSequence: number; terminalEventId?: string;
  sourceUnavailable?: string;
  rootTerminal?: { taskId: string; sessionId: string; eventIndex: number; outcome: AgentRunOutcome };
}
export interface AgentActivityMember {
  memberId: string; runId: string; groupId: string; agentId: string; operationId: string;
  turnId?: string; state: 'accepted' | 'running' | 'settled' | 'unknown';
  physicalSettled: boolean; outcome?: AgentRunOutcome;
}

/** Execution outcome only; business/project acceptance remains with its owner. */
export function agentRunState(run: AgentActivityRun, members: AgentActivityMember[]): AgentActivityRun['state'] {
  if (run.sourceUnavailable) return 'unknown';
  if (!members.length || members.some(member => member.state === 'unknown')) return 'unknown';
  if (members.some(member => !member.physicalSettled || member.state !== 'settled')) return members.some(member => member.state === 'running') ? 'running' : 'accepted';
  if (run.kind === 'root' && !run.rootTerminal) return 'accepted';
  const outcomes = [...members.map(member => member.outcome), ...(run.rootTerminal ? [run.rootTerminal.outcome] : [])];
  if (outcomes.some(outcome => !outcome)) return 'unknown';
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('cancelled')) return 'cancelled';
  return 'completed';
}
