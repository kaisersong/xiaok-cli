const initialSnapshot = () => ({
    activeTurnToken: undefined,
    currentTurnIntentPlan: undefined,
    currentTurnStageIndex: 0,
    currentTurnStageStatus: 'Drafting Plan',
    completedTurnIntentSummaryLine: '',
    activeIntentReminderBlock: undefined,
});
export function createChatIntentTurnState() {
    let snapshot = initialSnapshot();
    const isActiveTurn = (turnToken) => snapshot.activeTurnToken === turnToken;
    const updateActiveTurn = (turnToken, update) => {
        if (!isActiveTurn(turnToken)) {
            return;
        }
        snapshot = update(snapshot);
    };
    return {
        beginTurn(turnToken) {
            snapshot = {
                ...initialSnapshot(),
                activeTurnToken: turnToken,
            };
        },
        getSnapshot() {
            return { ...snapshot };
        },
        isActiveTurn,
        setPlan(turnToken, plan) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                currentTurnIntentPlan: plan,
                currentTurnStageIndex: 0,
                currentTurnStageStatus: 'Drafting Plan',
                completedTurnIntentSummaryLine: '',
            }));
        },
        setActiveIntentReminderBlock(turnToken, block) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                activeIntentReminderBlock: block,
            }));
        },
        clearTurnContext(turnToken) {
            if (turnToken && !isActiveTurn(turnToken)) {
                return;
            }
            snapshot = initialSnapshot();
        },
        clearTurnContextPreservingCompletedSummary(turnToken) {
            if (turnToken && !isActiveTurn(turnToken)) {
                return;
            }
            const completedTurnIntentSummaryLine = snapshot.completedTurnIntentSummaryLine;
            snapshot = {
                ...initialSnapshot(),
                completedTurnIntentSummaryLine,
            };
        },
        clearCompletedSummary(turnToken) {
            if (turnToken && !isActiveTurn(turnToken)) {
                return;
            }
            snapshot = {
                ...snapshot,
                completedTurnIntentSummaryLine: '',
            };
        },
        noteStageActivated(turnToken, order) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                currentTurnStageIndex: order,
                currentTurnStageStatus: 'Working',
            }));
        },
        noteStepRunning(turnToken) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                currentTurnStageStatus: 'Working',
            }));
        },
        noteBreadcrumbStatus(turnToken, status) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                currentTurnStageStatus: status === 'blocked' ? 'Waiting User' : 'Working',
            }));
        },
        setStageCompleted(turnToken, totalStages) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                currentTurnStageIndex: Math.max(0, totalStages - 1),
                currentTurnStageStatus: 'Completed',
            }));
        },
        captureCompletedSummary(turnToken, summaryLine) {
            updateActiveTurn(turnToken, (current) => ({
                ...current,
                completedTurnIntentSummaryLine: summaryLine,
            }));
        },
    };
}
