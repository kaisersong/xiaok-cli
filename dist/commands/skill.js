import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, } from 'fs';
import { join, basename } from 'path';
import { getConfigDir } from '../utils/config.js';
import { loadSkills } from '../ai/skills/loader.js';
const GLOBAL_SKILLS_DIR = join(getConfigDir(), 'skills');
const REGISTRY_PATH = join(getConfigDir(), 'skills.json');
function getRegistry() {
    if (!existsSync(REGISTRY_PATH))
        return {};
    try {
        return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    }
    catch {
        return {};
    }
}
function saveRegistry(registry) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}
function ensureGlobalSkillsDir() {
    mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
}
function parseFrontmatterName(content) {
    const match = content.match(/^---\r?\n[\s\S]*?name:\s*(.+?)\r?\n[\s\S]*?---/);
    if (match) {
        return match[1].trim().replace(/^["']|["']$/g, '');
    }
    return null;
}
async function fetchText(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.text();
}
function isLikelyLocalPath(input) {
    return input.startsWith('.') || input.startsWith('/') || input.startsWith('\\') || /^[a-zA-Z]:/.test(input);
}
function normalizeUrlSource(input) {
    if (input.startsWith('http://') || input.startsWith('https://')) {
        return input;
    }
    // Support github:owner/repo/path/file.md shorthand
    if (input.startsWith('github:')) {
        const rest = input.slice('github:'.length);
        const [owner, repo, ...pathParts] = rest.split('/');
        if (!owner || !repo || pathParts.length === 0) {
            throw new Error('GitHub shorthand must be github:owner/repo/path/file.md');
        }
        return `https://raw.githubusercontent.com/${owner}/${repo}/main/${pathParts.join('/')}`;
    }
    // Auto-detect owner/repo/path/file.md without github: prefix
    if (!isLikelyLocalPath(input) && input.includes('/')) {
        const parts = input.split('/');
        if (parts.length >= 3 && parts[0].length > 0 && parts[1].length > 0) {
            const [owner, repo, ...pathParts] = parts;
            return `https://raw.githubusercontent.com/${owner}/${repo}/main/${pathParts.join('/')}`;
        }
    }
    return input;
}
async function installFromUrl(url, nameHint) {
    const text = await fetchText(url);
    const name = parseFrontmatterName(text) ?? nameHint ?? basename(url, '.md');
    if (!name) {
        throw new Error('Cannot determine skill name from URL or frontmatter');
    }
    ensureGlobalSkillsDir();
    const destPath = join(GLOBAL_SKILLS_DIR, `${name}.md`);
    writeFileSync(destPath, text, 'utf8');
    const registry = getRegistry();
    registry[name] = { source: url, installedAt: new Date().toISOString(), type: 'url' };
    saveRegistry(registry);
    const skills = await loadSkills();
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
        throw new Error(`Installed skill file is invalid: ${destPath}`);
    }
    return skill;
}
function installFromLocal(sourcePath) {
    if (!existsSync(sourcePath)) {
        throw new Error(`File not found: ${sourcePath}`);
    }
    const text = readFileSync(sourcePath, 'utf8');
    const name = parseFrontmatterName(text) ?? basename(sourcePath, '.md');
    if (!name) {
        throw new Error('Cannot determine skill name from file or frontmatter');
    }
    ensureGlobalSkillsDir();
    const destPath = join(GLOBAL_SKILLS_DIR, `${name}.md`);
    copyFileSync(sourcePath, destPath);
    const registry = getRegistry();
    registry[name] = { source: sourcePath, installedAt: new Date().toISOString(), type: 'local' };
    saveRegistry(registry);
    // Return a minimal SkillMeta since loadSkills is async
    return {
        name,
        description: '',
        content: text,
        path: destPath,
        source: 'global',
        tier: 'user',
        allowedTools: [],
        executionContext: 'inline',
        dependsOn: [],
        userInvocable: true,
    };
}
async function doInstall(source) {
    const normalized = normalizeUrlSource(source);
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        return installFromUrl(normalized, basename(source, '.md'));
    }
    return installFromLocal(normalized);
}
async function doUninstall(name) {
    const filePath = join(GLOBAL_SKILLS_DIR, `${name}.md`);
    if (existsSync(filePath)) {
        unlinkSync(filePath);
    }
    const registry = getRegistry();
    delete registry[name];
    saveRegistry(registry);
}
async function doUpdate(name) {
    const registry = getRegistry();
    const entry = registry[name];
    if (!entry) {
        throw new Error(`Skill "${name}" was not installed via marketplace. Cannot auto-update.`);
    }
    if (entry.type === 'local') {
        throw new Error(`Skill "${name}" was installed from a local path. Update it manually.`);
    }
    // Re-install from original URL
    return installFromUrl(entry.source, name);
}
export function registerSkillCommands(program) {
    const skillCmd = program
        .command('skill')
        .description('Manage xiaok skills (marketplace)');
    skillCmd
        .command('list')
        .description('List all installed skills')
        .action(async () => {
        const skills = await loadSkills();
        if (skills.length === 0) {
            console.log('No skills installed.');
            return;
        }
        const bySource = new Map();
        for (const skill of skills) {
            const list = bySource.get(skill.source) ?? [];
            list.push(skill);
            bySource.set(skill.source, list);
        }
        for (const [source, list] of bySource) {
            console.log(`\n[${source}]`);
            for (const skill of list) {
                console.log(`  ${skill.name} - ${skill.description}`);
            }
        }
    });
    skillCmd
        .command('install <source>')
        .description('Install a skill from URL, GitHub (github:owner/repo/path/file.md), or local path')
        .action(async (source) => {
        try {
            const skill = await doInstall(source);
            console.log(`Installed skill: ${skill.name}`);
            console.log(`  Path: ${skill.path}`);
        }
        catch (err) {
            console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
    skillCmd
        .command('uninstall <name>')
        .description('Uninstall a skill')
        .action(async (name) => {
        try {
            await doUninstall(name);
            console.log(`Uninstalled skill: ${name}`);
        }
        catch (err) {
            console.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
    skillCmd
        .command('update [name]')
        .description('Update installed skill(s)')
        .action(async (name) => {
        const registry = getRegistry();
        const names = name ? [name] : Object.keys(registry);
        if (names.length === 0) {
            console.log('No marketplace skills to update.');
            return;
        }
        for (const n of names) {
            try {
                const skill = await doUpdate(n);
                console.log(`Updated: ${skill.name}`);
            }
            catch (err) {
                console.error(`Update failed for "${n}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    });
    skillCmd
        .command('search')
        .description('Search available skills in the marketplace (placeholder)')
        .action(() => {
        console.log('Marketplace search is not yet configured.');
        console.log('Use "xiaok skill install <url>" to install skills directly.');
    });
}
