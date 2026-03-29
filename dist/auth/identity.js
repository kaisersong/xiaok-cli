import { loadConfig } from '../utils/config.js';
export async function getDevAppIdentity() {
    const config = await loadConfig();
    if (!config.devApp)
        return null;
    return config.devApp;
}
export function formatIdentityContext(identity) {
    if (!identity)
        return '';
    return `开发者应用：appKey=${identity.appKey}`;
}
