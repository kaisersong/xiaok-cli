/** Execution outcome only; business/project acceptance remains with its owner. */
export function agentRunState(run, members) {
    if (run.sourceUnavailable)
        return 'unknown';
    if (!members.length || members.some(member => member.state === 'unknown'))
        return 'unknown';
    if (members.some(member => !member.physicalSettled || member.state !== 'settled'))
        return members.some(member => member.state === 'running') ? 'running' : 'accepted';
    if (run.kind === 'root' && !run.rootTerminal)
        return 'accepted';
    const outcomes = [...members.map(member => member.outcome), ...(run.rootTerminal ? [run.rootTerminal.outcome] : [])];
    if (outcomes.some(outcome => !outcome))
        return 'unknown';
    if (outcomes.includes('failed'))
        return 'failed';
    if (outcomes.includes('cancelled'))
        return 'cancelled';
    return 'completed';
}
