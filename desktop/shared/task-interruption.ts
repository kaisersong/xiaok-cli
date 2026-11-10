/** Exact persisted reasons for a lost execution; provider/model failures are excluded. */
export function isTaskExecutionInterruption(message: unknown): message is 'app_shutdown' | 'multi_agent_prepare_interrupted' {
  return message === 'app_shutdown' || message === 'multi_agent_prepare_interrupted';
}
