/** Pure checks on already captured source bytes. No filesystem or authority. */
export function assertCapturedJsonUniqueKeys(raw, errorCode) {
    // JSON.parse has already checked grammar. Scan iteratively so one long value
    // cannot exhaust the regexp engine stack; only object keys need token copies.
    const frames = [];
    for (let i = 0; i < raw.length; i++) {
        const token = raw[i];
        if (token === '{')
            frames.push({ keys: new Set(), expectingKey: true });
        else if (token === '[')
            frames.push({ expectingKey: false });
        else if (token === '}' || token === ']')
            frames.pop();
        else if (token === ',') {
            const frame = frames.at(-1);
            if (frame?.keys)
                frame.expectingKey = true;
        }
        else if (token === '"') {
            const start = i;
            i = capturedJsonStringEnd(raw, i);
            const frame = frames.at(-1);
            if (frame?.keys && frame.expectingKey) {
                const key = JSON.parse(raw.slice(start, i + 1));
                if (frame.keys.has(key))
                    throw Error(errorCode);
                frame.keys.add(key);
                frame.expectingKey = false;
            }
        }
    }
}
export function parseCapturedSourceJson(raw) {
    if (typeof raw !== 'string')
        throw Error('captured_source_bytes');
    const value = JSON.parse(raw);
    assertCapturedJsonUniqueKeys(raw, 'captured_source_duplicate');
    return value;
}
export function capturedFields(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
        throw Error('captured_source_fields');
}
export function capturedIdentity(value) {
    if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
        throw Error('captured_source_identity');
}
export function capturedInteger(value, minimum = 0) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
        throw Error('captured_source_integer');
}
export function freezeCapturedData(value) {
    if (value && typeof value === 'object') {
        for (const entry of Object.values(value))
            freezeCapturedData(entry);
        Object.freeze(value);
    }
    return value;
}
/** String grammar is already checked by JSON.parse at the caller. */
function capturedJsonStringEnd(raw, start) {
    for (let i = start + 1; i < raw.length; i++) {
        if (raw[i] === '\\')
            i++;
        else if (raw[i] === '"')
            return i;
    }
    throw Error('captured_source_json_string');
}
/** Classifies numeric literals in already syntax-validated JSON; strings do not
 * participate. Fractions/exponents remain uninterpreted even if Number is integral. */
export function capturedJsonHasOnlySafeIntegerLiterals(raw) {
    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        if (char === '"') {
            i = capturedJsonStringEnd(raw, i);
            continue;
        }
        if (char !== '-' && (char < '0' || char > '9'))
            continue;
        const start = i;
        for (; i < raw.length && !',]} \t\r\n'.includes(raw[i]); i++)
            if (i - start >= 17)
                return false;
        const token = raw.slice(start, i);
        if (!/^-?(?:0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token)))
            return false;
        i--;
    }
    return true;
}
