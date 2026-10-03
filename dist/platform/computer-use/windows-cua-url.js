import { InvalidComputerUseInputError } from './cua-action-contract.js';
export function validatedBrowserUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value)) {
        throw new InvalidComputerUseInputError('open_url requires one HTTP/HTTPS URL without whitespace or control characters');
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new InvalidComputerUseInputError('open_url requires a valid URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new InvalidComputerUseInputError('open_url allows only HTTP/HTTPS without embedded credentials');
    }
    return url.href;
}
/** Rechecked at native dispatch; no executable or arbitrary arguments escape. */
export function validateNativeBrowserLaunch(input) {
    if (Object.keys(input).length !== 1 || !Array.isArray(input.urls) || input.urls.length !== 1) {
        throw new InvalidComputerUseInputError('launch_app permits only one browser URL');
    }
    return { urls: [validatedBrowserUrl(input.urls[0])] };
}
