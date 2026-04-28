import { findSkillByCommandName } from './loader.js';
function toPlanStep(skill) {
    return {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        rootDir: skill.rootDir,
        source: skill.source,
        tier: skill.tier,
        executionContext: skill.executionContext,
        allowedTools: [...skill.allowedTools],
        agent: skill.agent,
        model: skill.model,
        effort: skill.effort,
        dependsOn: [...skill.dependsOn],
        content: skill.content,
        referencesManifest: skill.referencesManifest.map((entry) => ({ ...entry })),
        scriptsManifest: skill.scriptsManifest.map((entry) => ({ ...entry })),
        assetsManifest: skill.assetsManifest.map((entry) => ({ ...entry })),
        requiredReferences: [...skill.requiredReferences],
        requiredScripts: [...skill.requiredScripts],
        requiredSteps: [...skill.requiredSteps],
        successChecks: skill.successChecks.map((check) => ({ ...check, terms: [...check.terms] })),
        strict: skill.strict,
    };
}
export function buildSkillExecutionPlan(names, source) {
    const requested = names.filter(Boolean);
    const resolvedSkills = Array.isArray(source)
        ? resolveFromArray(requested, source)
        : source.resolve(requested);
    if (resolvedSkills.length === 0) {
        throw new Error(`找不到 skill: ${requested.join(', ') || '（空）'}`);
    }
    const primarySkill = resolvedSkills[resolvedSkills.length - 1];
    return {
        type: 'skill_plan',
        requested,
        resolved: resolvedSkills.map(toPlanStep),
        strategy: primarySkill.executionContext,
        primarySkill: primarySkill.name,
        strict: primarySkill.strict,
    };
}
function resolveFromArray(names, skills) {
    const ordered = [];
    const seen = new Set();
    const stack = new Set();
    const visit = (name) => {
        if (seen.has(name))
            return;
        if (stack.has(name)) {
            throw new Error(`skill dependency cycle detected: ${name}`);
        }
        const skill = findSkillByCommandName(skills, name);
        if (!skill)
            return;
        stack.add(name);
        for (const dependency of skill.dependsOn) {
            visit(dependency);
        }
        stack.delete(name);
        seen.add(name);
        ordered.push(skill);
    };
    for (const name of names) {
        visit(name);
    }
    return ordered;
}
