/** Bootstrap errors may already be presented to the user. Consumers must still
 * refuse requests when the bootstrap Promise was caught by the composition root. */
export function createDesktopServiceReadiness(wait: () => Promise<void>, status: () => { running: boolean; lastError: string | null }): () => Promise<void> {
  return async () => {
    await wait();
    const current = status();
    if (!current.running || current.lastError) throw new Error(current.lastError ?? 'Desktop services unavailable');
  };
}
