import { readFileSync } from 'node:fs';
let cachedVersion;
export function readXiaokVersion() {
    if (cachedVersion) {
        return cachedVersion;
    }
    const payload = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    cachedVersion = payload.version ?? '0.0.0';
    return cachedVersion;
}
