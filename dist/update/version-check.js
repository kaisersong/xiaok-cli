import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const CACHE_FILE = join(homedir(), '.xiaok', '.update-check.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REGISTRY_URL = 'https://registry.npmjs.org/xiaokcode/latest';
function readCache() {
    try {
        if (!existsSync(CACHE_FILE))
            return null;
        const raw = readFileSync(CACHE_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function writeCache(latest) {
    try {
        const dir = join(homedir(), '.xiaok');
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        writeFileSync(CACHE_FILE, JSON.stringify({ latest, checkedAt: Date.now() }));
    }
    catch { }
}
function semverGt(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) > (pb[i] ?? 0))
            return true;
        if ((pa[i] ?? 0) < (pb[i] ?? 0))
            return false;
    }
    return false;
}
export async function checkForUpdate(currentVersion) {
    const cache = readCache();
    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
        return {
            current: currentVersion,
            latest: cache.latest,
            hasUpdate: semverGt(cache.latest, currentVersion),
        };
    }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(REGISTRY_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok)
            return null;
        const data = await res.json();
        const latest = data.version;
        if (!latest)
            return null;
        writeCache(latest);
        return {
            current: currentVersion,
            latest,
            hasUpdate: semverGt(latest, currentVersion),
        };
    }
    catch {
        // Network error or timeout — use stale cache if available
        if (cache) {
            return {
                current: currentVersion,
                latest: cache.latest,
                hasUpdate: semverGt(cache.latest, currentVersion),
            };
        }
        return null;
    }
}
