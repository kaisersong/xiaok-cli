import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getCurrentBranch, getRecentCommitSubjects, isGitDirty, } from '../../utils/git.js';
const PROMPT_DOC_NAMES = ['AGENTS.md', 'CLAUDE.md'];
const DEFAULT_GIT_PROVIDER = {
    getBranch: getCurrentBranch,
    isDirty: isGitDirty,
    getRecentCommits: getRecentCommitSubjects,
};
function collectSearchDirs(cwd) {
    const dirs = [];
    let current = resolve(cwd);
    while (true) {
        dirs.push(current);
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return dirs.reverse();
}
function truncateContent(content, maxChars) {
    if (content.length <= maxChars) {
        return { content, truncated: false };
    }
    const suffix = '\n...(已截断)';
    const sliceLength = Math.max(0, maxChars - suffix.length);
    return {
        content: content.slice(0, sliceLength) + suffix,
        truncated: true,
    };
}
export async function loadAutoContext(options) {
    const maxChars = options.maxChars ?? 8_000;
    const docs = [];
    let remainingChars = maxChars;
    for (const dir of collectSearchDirs(options.cwd)) {
        for (const name of PROMPT_DOC_NAMES) {
            const path = join(dir, name);
            if (!existsSync(path) || remainingChars <= 0) {
                continue;
            }
            const raw = readFileSync(path, 'utf-8').trim();
            if (!raw) {
                continue;
            }
            const truncated = truncateContent(raw, remainingChars);
            docs.push({
                name,
                path,
                content: truncated.content,
                truncated: truncated.truncated,
            });
            remainingChars -= truncated.content.length;
        }
    }
    const gitProvider = options.git ?? DEFAULT_GIT_PROVIDER;
    const branch = await gitProvider.getBranch(options.cwd);
    const isDirty = await gitProvider.isDirty(options.cwd);
    const recentCommits = await gitProvider.getRecentCommits(options.cwd, 3);
    const git = branch || isDirty || recentCommits.length > 0
        ? { branch, isDirty, recentCommits }
        : null;
    return { docs, git };
}
export function formatLoadedContext(context) {
    const sections = [];
    if (context.docs.length > 0) {
        const docsSection = context.docs.map((doc) => {
            const truncationNote = doc.truncated ? ' [truncated]' : '';
            return `### ${doc.name}${truncationNote}\npath=${doc.path}\n${doc.content}`;
        }).join('\n\n');
        sections.push(`仓库提示文档:\n${docsSection}`);
    }
    if (context.git) {
        const gitLines = [
            `- branch=${context.git.branch || '(unknown)'}`,
            `- dirty=${context.git.isDirty ? 'yes' : 'no'}`,
        ];
        if (context.git.recentCommits.length > 0) {
            gitLines.push('- recent commits:');
            for (const commit of context.git.recentCommits) {
                gitLines.push(`  - ${commit}`);
            }
        }
        sections.push(`Git 上下文:\n${gitLines.join('\n')}`);
    }
    return sections.join('\n\n');
}
