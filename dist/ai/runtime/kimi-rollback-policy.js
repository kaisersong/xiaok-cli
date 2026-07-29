import { XIAOK_BUILD_FLAVOR } from '../../build-flavor.js';
export function assertKimiTransportAllowed(identity, buildFlavor = XIAOK_BUILD_FLAVOR) {
    if (buildFlavor !== 'rollback') {
        return;
    }
    let endpoint;
    try {
        endpoint = new URL(identity.canonicalBaseUrl ?? '');
    }
    catch {
        return;
    }
    const normalizedHostname = endpoint.hostname
        .toLowerCase()
        .replace(/\.+$/u, '');
    const effectivePort = endpoint.port || (endpoint.protocol === 'https:' ? '443' : '');
    const officialHost = endpoint.protocol === 'https:'
        && normalizedHostname === 'api.kimi.com'
        && effectivePort === '443';
    const strictModel = identity.wireModel.toLowerCase() === 'k3'
        || identity.wireModel.toLowerCase() === 'k3-256k';
    if (officialHost && strictModel) {
        throw new Error('KIMI_K3_DISABLED_IN_ROLLBACK_BUILD');
    }
}
