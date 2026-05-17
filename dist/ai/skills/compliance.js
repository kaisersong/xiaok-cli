export function evaluateSkillCompliance(input) {
    const expectedReferences = collectExpectedReferences(input.plan.resolved);
    const expectedScripts = collectExpectedScripts(input.plan.resolved);
    const expectedSteps = collectExpectedSteps(input.plan.resolved);
    const successChecks = collectSuccessChecks(input.plan.resolved);
    const finalAnswer = input.finalAnswer ?? '';
    const normalizedAnswer = normalizeText(finalAnswer);
    const readReferences = new Set(input.evidence.readReferences.map(normalizePath));
    const runScripts = new Set(input.evidence.runScripts.map(normalizeCommand));
    const completedSteps = new Set(input.evidence.completedSteps);
    const missingReferences = expectedReferences
        .filter((entry) => !readReferences.has(normalizePath(entry)));
    const missingScripts = expectedScripts
        .filter((entry) => !runScripts.has(normalizeCommand(entry)));
    const missingSteps = expectedSteps.filter((step) => {
        if (step === 'read_required_references') {
            return missingReferences.length > 0;
        }
        if (step === 'run_required_scripts') {
            return missingScripts.length > 0;
        }
        if (step === 'summarize_findings') {
            return !/\S/.test(finalAnswer);
        }
        return !completedSteps.has(step);
    });
    const failedChecks = successChecks.map((check) => ({
        type: check.type,
        terms: [...check.terms],
        passed: passesSuccessCheck(check, normalizedAnswer, finalAnswer),
    })).filter((result) => !result.passed);
    return {
        passed: missingReferences.length === 0
            && missingScripts.length === 0
            && missingSteps.length === 0
            && failedChecks.length === 0,
        missingReferences,
        missingScripts,
        missingSteps,
        failedChecks,
        checkedAt: input.checkedAt ?? Date.now(),
    };
}
export function buildComplianceReminder(result) {
    const lines = [
        'Continue the current strict skill. Do not restart from scratch.',
        'Close the remaining contract gaps before ending the response.',
    ];
    if (result.missingReferences.length > 0) {
        lines.push(`Missing required references: ${result.missingReferences.join(', ')}`);
    }
    if (result.missingScripts.length > 0) {
        lines.push(`Missing required scripts: ${result.missingScripts.join(', ')}`);
    }
    if (result.missingSteps.length > 0) {
        lines.push(`Missing required steps: ${result.missingSteps.join(', ')}`);
    }
    if (result.failedChecks.length > 0) {
        lines.push(`Failed success checks: ${result.failedChecks.map((check) => `${check.type}(${check.terms.join(', ')})`).join('; ')}`);
    }
    return lines.join('\n');
}
function collectExpectedReferences(steps) {
    return uniqueStrings(steps.flatMap((step) => (step.requiredReferences.map((entry) => normalizePath(entry)))));
}
function collectExpectedScripts(steps) {
    return uniqueStrings(steps.flatMap((step) => step.requiredScripts.map(normalizeCommand)));
}
function collectExpectedSteps(steps) {
    return uniqueStrings(steps.flatMap((step) => step.requiredSteps));
}
function collectSuccessChecks(steps) {
    const keySet = new Set();
    const checks = [];
    for (const step of steps) {
        for (const check of step.successChecks) {
            const key = `${check.type}:${check.terms.join('|')}`;
            if (keySet.has(key)) {
                continue;
            }
            keySet.add(key);
            checks.push({ type: check.type, terms: [...check.terms] });
        }
    }
    return checks;
}
function passesSuccessCheck(check, normalizedAnswer, rawAnswer) {
    if (check.type === 'must_mention_any') {
        return check.terms.some((term) => normalizedAnswer.includes(normalizeText(term)));
    }
    if (check.type === 'must_mention_all') {
        return check.terms.every((term) => normalizedAnswer.includes(normalizeText(term)));
    }
    if (check.type === 'must_emit_field') {
        return check.terms.every((term) => new RegExp(`(^|\\n)\\s*${escapeRegExp(term)}\\s*[:：]`, 'i').test(rawAnswer));
    }
    if (check.type === 'must_answer_yes_no') {
        const term = check.terms[0] ?? '';
        const proximity = new RegExp(`${escapeRegExp(term)}[\\s\\S]{0,24}(yes|no|是|否|ready|not ready)`, 'i');
        const field = new RegExp(`(^|\\n)\\s*${escapeRegExp(term)}\\s*[:：-]\\s*(yes|no|是|否|ready|not ready)`, 'i');
        return field.test(rawAnswer) || proximity.test(rawAnswer);
    }
    return false;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function normalizeText(value) {
    return value.trim().toLowerCase();
}
function normalizePath(value) {
    return value.replaceAll('\\', '/').trim();
}
function normalizeCommand(value) {
    return value.trim().replace(/\s+/g, ' ');
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
