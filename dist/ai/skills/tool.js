import { readFileSync, realpathSync, statSync } from 'fs';
import { resolve as resolvePath, sep as pathSep } from 'path';
import { buildSkillExecutionPlan } from './planner.js';
function summarizeManifests(skill) {
    if (!skill)
        return { references: 0, scripts: 0, assets: 0 };
    return {
        references: skill.referencesManifest.length,
        scripts: skill.scriptsManifest.length,
        assets: skill.assetsManifest.length,
    };
}
function buildLitePlan(plan, skills) {
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    return {
        ...plan,
        resolved: plan.resolved.map((step) => {
            const skill = byName.get(step.name);
            const { referencesManifest: _references, scriptsManifest: _scripts, assetsManifest: _assets, ...rest } = step;
            return {
                ...rest,
                taskHints: skill?.taskHints ?? {
                    taskGoals: [],
                    inputKinds: [],
                    outputKinds: [],
                    examples: [],
                },
                contentBytes: Buffer.byteLength(step.content, 'utf8'),
                manifestsAvailable: summarizeManifests(skill),
            };
        }),
    };
}
export function formatSkillPayload(skill) {
    return JSON.stringify({
        type: 'skill',
        name: skill.name,
        description: skill.description,
        path: skill.path,
        rootDir: skill.rootDir,
        source: skill.source,
        tier: skill.tier,
        allowedTools: skill.allowedTools,
        executionContext: skill.executionContext,
        agent: skill.agent,
        model: skill.model,
        effort: skill.effort,
        dependsOn: skill.dependsOn,
        userInvocable: skill.userInvocable,
        whenToUse: skill.whenToUse,
        taskHints: skill.taskHints,
        referencesManifest: skill.referencesManifest,
        scriptsManifest: skill.scriptsManifest,
        assetsManifest: skill.assetsManifest,
        requiredReferences: skill.requiredReferences,
        requiredScripts: skill.requiredScripts,
        requiredSteps: skill.requiredSteps,
        successChecks: skill.successChecks,
        strict: skill.strict,
        content: skill.content,
    }, null, 2);
}
function isSkillCatalog(value) {
    return !Array.isArray(value);
}
export function createSkillTool(skills, capabilityRegistry) {
    const listSkillNames = () => {
        if (isSkillCatalog(skills)) {
            return skills.list().map((skill) => skill.name);
        }
        return skills.map((skill) => skill.name);
    };
    const listSkillRecords = () => {
        if (isSkillCatalog(skills)) {
            return skills.list();
        }
        return skills;
    };
    const syncCapabilities = () => {
        for (const skill of listSkillRecords()) {
            capabilityRegistry?.register({
                kind: 'skill',
                name: skill.name,
                description: skill.description,
            });
        }
    };
    syncCapabilities();
    return {
        permission: 'safe',
        definition: {
            name: 'skill',
            description: `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - name: "matched-skill-name" - invoke the skill that best matches the current user intent
  - name: "explicit-slash-command-name" - invoke the skill the user explicitly named

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see skill content already loaded in the current conversation turn, follow the instructions directly instead of calling this tool again

Resource manifests:
- The plan returned here lists \`manifestsAvailable\` counts (references / scripts / assets) and \`contentBytes\` for each step.
- The actual contents of those manifests are NOT inlined. Use the \`skillFetchAssets\` tool to retrieve specific files when needed (skillName + kind + paths[]).`,
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: '单个 skill 名称（不含 / 前缀）',
                    },
                    names: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '多个 skill 名称。会自动解析依赖并去重。',
                    },
                },
            },
        },
        async execute(input) {
            syncCapabilities();
            const { name, names } = input;
            const requested = [
                ...(Array.isArray(names) ? names : []),
                ...(name ? [name] : []),
            ].filter(Boolean);
            if (requested.length === 0) {
                return 'Error: skill 工具至少需要提供 name 或 names';
            }
            try {
                const plan = buildSkillExecutionPlan(requested, skills);
                return JSON.stringify(buildLitePlan(plan, listSkillRecords()), null, 2);
            }
            catch {
                const available = listSkillNames().join(', ') || '（无）';
                return `Error: 找不到 skill "${requested.join(', ')}"。可用 skills：${available}`;
            }
        },
    };
}
const MANIFEST_KIND_BY_REQUEST = {
    references: 'reference',
    scripts: 'script',
    assets: 'asset',
};
const MAX_SKILL_FETCH_RESULT_BYTES = 64 * 1024;
function getManifestForKind(skill, kind) {
    switch (kind) {
        case 'references': return skill.referencesManifest;
        case 'scripts': return skill.scriptsManifest;
        case 'assets': return skill.assetsManifest;
    }
}
function isPathContained(rootCanonical, candidateCanonical) {
    if (candidateCanonical === rootCanonical)
        return true;
    const rootWithSep = rootCanonical.endsWith(pathSep) ? rootCanonical : rootCanonical + pathSep;
    return candidateCanonical.startsWith(rootWithSep);
}
export function createSkillFetchAssetsTool(skills) {
    const listSkills = () => (Array.isArray(skills) ? skills : skills.list());
    const findSkill = (name) => listSkills().find((skill) => skill.name === name || (skill.aliases ?? []).includes(name));
    return {
        permission: 'safe',
        definition: {
            name: 'skillFetchAssets',
            description: `Fetch on-demand contents of files listed in a skill's references / scripts / assets manifest.

Use this when the skill plan returned by the \`skill\` tool indicates manifestsAvailable counts > 0 and the agent needs the actual file contents to proceed.

Inputs:
- skillName: the skill name (no slash prefix).
- kind: "references" | "scripts" | "assets".
- paths: optional list of relative paths (as listed in the manifest). When omitted, the tool returns the manifest summary (relativePath + size) only, not file bodies.

Behavior:
- Files are read from disk on the fly with realpath containment check; paths outside the skill root are rejected.
- Total returned bytes are capped at 64KB. If the cap is hit, remaining files are returned with size only and truncated=true.
- Only paths present in the manifest are honored. Arbitrary paths are rejected.`,
            inputSchema: {
                type: 'object',
                properties: {
                    skillName: { type: 'string', description: 'Skill 名称（不含 / 前缀）' },
                    kind: {
                        type: 'string',
                        enum: ['references', 'scripts', 'assets'],
                        description: '资源类别',
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '相对路径数组（manifest 中列出的）；省略则只返回清单摘要',
                    },
                },
                required: ['skillName', 'kind'],
            },
        },
        async execute(input) {
            const { skillName, kind, paths } = input;
            if (!skillName || !kind) {
                return 'Error: skillFetchAssets 需要 skillName 和 kind';
            }
            if (!(kind in MANIFEST_KIND_BY_REQUEST)) {
                return `Error: kind 只支持 references / scripts / assets，收到 "${kind}"`;
            }
            const skill = findSkill(skillName);
            if (!skill) {
                return `Error: 找不到 skill "${skillName}"`;
            }
            const manifest = getManifestForKind(skill, kind);
            const summary = manifest.map((entry) => ({
                relativePath: entry.relativePath,
                size: entry.size,
            }));
            if (!paths || paths.length === 0) {
                return JSON.stringify({
                    type: 'skill_assets_summary',
                    skillName: skill.name,
                    kind,
                    totalCount: manifest.length,
                    entries: summary,
                }, null, 2);
            }
            let rootCanonical;
            try {
                rootCanonical = realpathSync(skill.rootDir);
            }
            catch (error) {
                return `Error: 无法解析 skill 根目录：${error instanceof Error ? error.message : String(error)}`;
            }
            const files = [];
            let cumulativeBytes = 0;
            let truncatedReached = false;
            for (const requestedPath of paths) {
                const entry = manifest.find((item) => item.relativePath === requestedPath);
                if (!entry) {
                    files.push({
                        relativePath: requestedPath,
                        size: 0,
                        error: 'not_in_manifest',
                    });
                    continue;
                }
                const targetAbs = resolvePath(skill.rootDir, requestedPath);
                let targetCanonical;
                try {
                    targetCanonical = realpathSync(targetAbs);
                }
                catch (error) {
                    files.push({
                        relativePath: requestedPath,
                        size: entry.size,
                        error: `realpath_failed: ${error instanceof Error ? error.message : String(error)}`,
                    });
                    continue;
                }
                if (!isPathContained(rootCanonical, targetCanonical)) {
                    files.push({
                        relativePath: requestedPath,
                        size: entry.size,
                        error: 'path_escapes_skill_root',
                    });
                    continue;
                }
                let fileSize;
                try {
                    fileSize = statSync(targetCanonical).size;
                }
                catch (error) {
                    files.push({
                        relativePath: requestedPath,
                        size: entry.size,
                        error: `stat_failed: ${error instanceof Error ? error.message : String(error)}`,
                    });
                    continue;
                }
                if (truncatedReached || cumulativeBytes + fileSize > MAX_SKILL_FETCH_RESULT_BYTES) {
                    truncatedReached = true;
                    files.push({
                        relativePath: requestedPath,
                        size: fileSize,
                        truncated: true,
                    });
                    continue;
                }
                try {
                    const content = readFileSync(targetCanonical, 'utf8');
                    cumulativeBytes += Buffer.byteLength(content, 'utf8');
                    files.push({
                        relativePath: requestedPath,
                        size: fileSize,
                        content,
                    });
                }
                catch (error) {
                    files.push({
                        relativePath: requestedPath,
                        size: fileSize,
                        error: `read_failed: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            }
            return JSON.stringify({
                type: 'skill_assets',
                skillName: skill.name,
                kind,
                totalManifestCount: manifest.length,
                bytesReturned: cumulativeBytes,
                bytesCap: MAX_SKILL_FETCH_RESULT_BYTES,
                truncated: truncatedReached,
                files,
            }, null, 2);
        },
    };
}
